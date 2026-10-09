-- Step 6C (0056) part 1 — opening balances linked to the main treasury; cancel-only re-post.
INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system)
SELECT t.id, '3950', 'Opening Balance Equity', 'أرصدة افتتاحية', 'equity', 'credit', true FROM public.tenants t
ON CONFLICT (tenant_id, code) DO NOTHING;
DO $coa$
DECLARE v_def text; v_anchor text := '(p_tenant_id,''3900'',''Income Summary'',''ملخص الدخل'',''equity'',''credit'',true),';
BEGIN
  v_def := pg_get_functiondef('public.seed_default_chart_of_accounts(uuid)'::regprocedure);
  IF position('''3950''' IN v_def) = 0 THEN
    IF position(v_anchor IN v_def) = 0 THEN RAISE EXCEPTION 'Step 6C: chart seed anchor not found'; END IF;
    EXECUTE replace(v_def, v_anchor, v_anchor || '
    (p_tenant_id,''3950'',''Opening Balance Equity'',''أرصدة افتتاحية'',''equity'',''credit'',true),');
  END IF;
END
$coa$;

CREATE OR REPLACE FUNCTION public.ledger_opening_branch(p_tenant uuid, p_contact uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT b.id FROM branches b WHERE b.tenant_id = p_tenant AND b.code = 'MAIN-TREASURY' LIMIT 1),
    (SELECT c.branch_id FROM contacts c WHERE c.id = p_contact),
    (SELECT b.id FROM branches b WHERE b.tenant_id = p_tenant ORDER BY b.created_at, b.id LIMIT 1))
$$;
CREATE OR REPLACE FUNCTION public.ledger_opening_branch_is_fallback(p_tenant uuid, p_contact uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM branches b WHERE b.tenant_id = p_tenant AND b.code = 'MAIN-TREASURY')
     AND (SELECT c.branch_id FROM contacts c WHERE c.id = p_contact) IS NULL
$$;

DO $rule$
DECLARE v_def text; v_old text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ledger_desired_movements(uuid)'::regprocedure);
  v_old := 'COALESCE(c.branch_id, public.ledger_fallback_branch(c.tenant_id, c.id)), NULL, round(abs(o.amt), 2), v_cut,
         NULL, NULL, NULL, c.branch_id IS NULL';
  v_new := 'public.ledger_opening_branch(c.tenant_id, c.id), NULL, round(abs(o.amt), 2), v_cut,
         NULL, NULL, NULL, public.ledger_opening_branch_is_fallback(c.tenant_id, c.id)';
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Step 6C: opening rule of ledger_desired_movements not found';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$rule$;

DO $guard$
DECLARE v_def text; v_anchor text := 'BEGIN
  IF NEW.category = ''تصحيح قيد عكسي''';
BEGIN
  v_def := pg_get_functiondef('public.check_treasury_balance()'::regprocedure);
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'Step 6C: check_treasury_balance anchor not found';
  END IF;
  IF position('app.opening_reversal' IN v_def) = 0 THEN
    EXECUTE replace(v_def, v_anchor, 'BEGIN
  IF NEW.category = ''رصيد افتتاحي''
     AND COALESCE(current_setting(''app.opening_reversal'', true), '''') = ''1'' THEN
    RETURN NEW;
  END IF;
  IF NEW.category = ''تصحيح قيد عكسي''');
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.opening_section_key(p_tenant uuid, p_section text, p_branch uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(p_tenant::text || ':opening:' || p_section || ':' || COALESCE(p_branch::text, ''))::uuid
$$;

CREATE OR REPLACE FUNCTION public.reverse_opening_entry(p_entry uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE e record; v_lines jsonb; v_new uuid;
BEGIN
  SELECT * INTO e FROM journal_entries WHERE id = p_entry AND status = 'posted' AND reversed_by IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_agg(jsonb_build_object('account_code', a.code, 'debit', l.credit, 'credit', l.debit,
                                      'description', p_reason || ' — ' || COALESCE(l.description, '')) ORDER BY l.line_order, l.id)
    INTO v_lines
    FROM journal_entry_lines l JOIN chart_of_accounts a ON a.id = l.account_id WHERE l.entry_id = e.id;
  v_new := public.post_journal(e.tenant_id, e.entry_date, p_reason || ' — ' || e.entry_number,
                               'opening_balance_reversal', e.id, v_lines);
  IF v_new IS NOT NULL THEN
    UPDATE journal_entries SET branch_id = e.branch_id, created_by = auth.uid() WHERE id = v_new;
    UPDATE journal_entries SET reversed_by = v_new WHERE id = e.id;
  END IF;
  RETURN v_new;
END
$fn$;

CREATE OR REPLACE FUNCTION public.opening_entry_section(p_entry uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN e.source_id = public.opening_section_key(e.tenant_id, 'contacts') THEN 'contacts'
    WHEN e.source_id = public.opening_section_key(e.tenant_id, 'inventory') THEN 'inventory'
    WHEN e.source_id IS NOT NULL AND e.source_id = public.opening_section_key(e.tenant_id, 'cash', e.branch_id) THEN 'cash'
    WHEN e.source_id IS NULL AND e.description LIKE '%نقدية%' THEN 'cash'
    WHEN e.source_id IS NULL AND e.description LIKE '%العملاء والموردين%' THEN 'contacts'
    WHEN e.source_id IS NULL AND e.description LIKE '%المخزون%' THEN 'inventory'
  END
  FROM journal_entries e WHERE e.id = p_entry
$$;

DROP FUNCTION IF EXISTS public.post_opening_balances(date, jsonb, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.post_opening_balances(p_date date, p_cash jsonb DEFAULT NULL, p_contacts jsonb DEFAULT NULL, p_inventory jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_main uuid;
  r record; v_row jsonb; v_entry uuid; v_lines jsonb;
  v_branch uuid; v_amount numeric; v_type text;
  v_ar numeric := 0; v_c_adv numeric := 0; v_ap numeric := 0; v_s_adv numeric := 0;
  v_cash_total numeric := 0; v_inv_total numeric := 0; v_entries int := 0; v_reversed int := 0;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF NOT (public.is_owner(v_uid) OR public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'غير مصرح — الأرصدة الافتتاحية للمالك أو المدير فقط' USING ERRCODE = '42501';
  END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'تاريخ الأرصدة الافتتاحية مطلوب'; END IF;
  SELECT id INTO v_main FROM branches WHERE tenant_id = v_tenant AND code = 'MAIN-TREASURY' LIMIT 1;

  IF p_cash IS NOT NULL THEN
    FOR r IN SELECT e.id FROM journal_entries e
              WHERE e.tenant_id = v_tenant AND e.source_type = 'opening_balance' AND e.status = 'posted'
                AND e.reversed_by IS NULL AND public.opening_entry_section(e.id) = 'cash' LOOP
      IF public.reverse_opening_entry(r.id, 'عكس رصيد افتتاحي') IS NOT NULL THEN v_reversed := v_reversed + 1; END IF;
    END LOOP;
    PERFORM set_config('app.skip_treasury_voucher', '1', true);
    PERFORM set_config('app.opening_reversal', '1', true);
    FOR r IN SELECT t.* FROM treasury t
              WHERE t.tenant_id = v_tenant AND t.category = 'رصيد افتتاحي' AND t.type::text = 'income'
                AND NOT EXISTS (SELECT 1 FROM treasury x WHERE x.tenant_id = v_tenant AND x.category = 'رصيد افتتاحي'
                                   AND x.type::text = 'expense' AND x.reference_id = t.id) LOOP
      INSERT INTO treasury (tenant_id, branch_id, type, category, amount, description, reference_id, created_by,
                            payment_method, transaction_date)
      VALUES (v_tenant, r.branch_id, 'expense', 'رصيد افتتاحي', r.amount, 'عكس رصيد افتتاحي (إعادة ترحيل)', r.id, v_uid,
              COALESCE(r.payment_method, 'cash'), r.transaction_date);
    END LOOP;
    PERFORM set_config('app.opening_reversal', '', true);

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_cash) LOOP
      v_branch := (v_row->>'branch_id')::uuid;
      v_amount := ROUND(COALESCE((v_row->>'amount')::numeric, 0), 2);
      CONTINUE WHEN v_amount = 0 OR v_branch IS NULL;
      IF v_amount < 0 THEN RAISE EXCEPTION 'رصيد النقدية الافتتاحي مينفعش يكون بالسالب'; END IF;
      IF NOT EXISTS (SELECT 1 FROM branches WHERE id = v_branch AND tenant_id = v_tenant) THEN
        RAISE EXCEPTION 'الفرع مش تبع الشركة';
      END IF;
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code','1100','debit',v_amount,'credit',0,'description','رصيد افتتاحي - نقدية'),
        jsonb_build_object('account_code','3950','debit',0,'credit',v_amount,'description','رصيد افتتاحي - نقدية'));
      v_entry := public.post_journal(v_tenant, p_date, 'رصيد افتتاحي — نقدية الخزنة', 'opening_balance',
                                     public.opening_section_key(v_tenant, 'cash', v_branch), v_lines);
      IF v_entry IS NOT NULL THEN
        UPDATE journal_entries SET branch_id = v_branch, created_by = v_uid WHERE id = v_entry;
        INSERT INTO treasury (tenant_id, branch_id, type, category, amount, description, reference_id, created_by,
                              payment_method, transaction_date)
        VALUES (v_tenant, v_branch, 'income', 'رصيد افتتاحي', v_amount, 'رصيد افتتاحي — نقدية الخزنة', v_entry, v_uid,
                'cash', p_date);
        v_entries := v_entries + 1;
        v_cash_total := v_cash_total + v_amount;
      END IF;
    END LOOP;
    PERFORM set_config('app.skip_treasury_voucher', '', true);
  END IF;

  IF p_contacts IS NOT NULL THEN
    FOR r IN SELECT e.id FROM journal_entries e
              WHERE e.tenant_id = v_tenant AND e.source_type = 'opening_balance' AND e.status = 'posted'
                AND e.reversed_by IS NULL AND public.opening_entry_section(e.id) = 'contacts' LOOP
      IF public.reverse_opening_entry(r.id, 'عكس رصيد افتتاحي') IS NOT NULL THEN v_reversed := v_reversed + 1; END IF;
    END LOOP;
    UPDATE contacts SET opening_balance = 0 WHERE tenant_id = v_tenant AND opening_balance <> 0;
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
      v_amount := ROUND(COALESCE((v_row->>'amount')::numeric, 0), 2);
      CONTINUE WHEN v_amount = 0;
      UPDATE contacts SET opening_balance = v_amount
       WHERE id = (v_row->>'contact_id')::uuid AND tenant_id = v_tenant
      RETURNING type INTO v_type;
      IF NOT FOUND THEN RAISE EXCEPTION 'جهة التعامل مش تبع الشركة'; END IF;
      IF v_type = 'supplier' THEN
        IF v_amount > 0 THEN v_s_adv := v_s_adv + v_amount; ELSE v_ap := v_ap - v_amount; END IF;
      ELSIF v_type = 'customer' THEN
        IF v_amount > 0 THEN v_ar := v_ar + v_amount; ELSE v_c_adv := v_c_adv - v_amount; END IF;
      ELSE
        IF v_amount > 0 THEN v_ar := v_ar + v_amount; ELSE v_ap := v_ap - v_amount; END IF;
      END IF;
    END LOOP;
    IF v_ar + v_c_adv + v_ap + v_s_adv > 0 THEN
      v_lines := '[]'::jsonb;
      IF v_ar > 0 THEN v_lines := v_lines || jsonb_build_object('account_code','1200','debit',v_ar,'credit',0,'description','رصيد افتتاحي - مديونية عملاء'); END IF;
      IF v_s_adv > 0 THEN v_lines := v_lines || jsonb_build_object('account_code','1460','debit',v_s_adv,'credit',0,'description','رصيد افتتاحي - مقدمات موردين'); END IF;
      IF v_ap > 0 THEN v_lines := v_lines || jsonb_build_object('account_code','2100','debit',0,'credit',v_ap,'description','رصيد افتتاحي - مستحقات موردين'); END IF;
      IF v_c_adv > 0 THEN v_lines := v_lines || jsonb_build_object('account_code','2150','debit',0,'credit',v_c_adv,'description','رصيد افتتاحي - مقدمات عملاء'); END IF;
      IF (v_ar + v_s_adv) - (v_ap + v_c_adv) > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_code','3950','debit',0,'credit',(v_ar + v_s_adv) - (v_ap + v_c_adv),'description','رصيد افتتاحي');
      ELSIF (v_ar + v_s_adv) - (v_ap + v_c_adv) < 0 THEN
        v_lines := v_lines || jsonb_build_object('account_code','3950','debit',(v_ap + v_c_adv) - (v_ar + v_s_adv),'credit',0,'description','رصيد افتتاحي');
      END IF;
      v_entry := public.post_journal(v_tenant, p_date, 'رصيد افتتاحي — أرصدة العملاء والموردين', 'opening_balance',
                                     public.opening_section_key(v_tenant, 'contacts'), v_lines);
      IF v_entry IS NOT NULL THEN
        UPDATE journal_entries SET created_by = v_uid, branch_id = COALESCE(v_main, branch_id) WHERE id = v_entry;
        v_entries := v_entries + 1;
      END IF;
    END IF;
  END IF;

  IF p_inventory IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM product_batches b WHERE b.tenant_id = v_tenant AND b.batch_type = 'opening'
                 AND b.quantity_remaining < b.quantity_purchased) THEN
      RAISE EXCEPTION 'مخزون أول المدة اتباع أو اتحول منه بالفعل — مينفعش يتعاد ترحيله. عدّل الكميات بجرد (تسوية مخزون) بدل كده.';
    END IF;
    FOR r IN SELECT e.id FROM journal_entries e
              WHERE e.tenant_id = v_tenant AND e.source_type = 'opening_balance' AND e.status = 'posted'
                AND e.reversed_by IS NULL AND public.opening_entry_section(e.id) = 'inventory' LOOP
      IF public.reverse_opening_entry(r.id, 'عكس رصيد افتتاحي') IS NOT NULL THEN v_reversed := v_reversed + 1; END IF;
    END LOOP;
    FOR r IN SELECT b.id, b.product_id, b.quantity_remaining FROM product_batches b
              WHERE b.tenant_id = v_tenant AND b.batch_type = 'opening' AND b.quantity_remaining > 0 LOOP
      UPDATE products SET quantity = quantity - r.quantity_remaining::int WHERE id = r.product_id;
      UPDATE product_batches SET quantity_remaining = 0, batch_type = 'opening_reversed' WHERE id = r.id;
    END LOOP;
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_inventory) LOOP
      DECLARE
        v_pid uuid := (v_row->>'product_id')::uuid;
        v_qty numeric := COALESCE((v_row->>'quantity')::numeric, 0);
        v_cost numeric := ROUND(COALESCE((v_row->>'cost_price')::numeric, 0), 2);
        v_pbranch uuid;
      BEGIN
        SELECT branch_id INTO v_pbranch FROM products WHERE id = v_pid AND tenant_id = v_tenant;
        CONTINUE WHEN v_pbranch IS NULL OR v_qty <= 0;
        IF v_qty <> trunc(v_qty) THEN RAISE EXCEPTION 'الكمية لازم تكون رقم صحيح'; END IF;
        UPDATE products SET quantity = quantity + v_qty::int,
               cost_price = CASE WHEN v_cost > 0 THEN v_cost ELSE cost_price END
         WHERE id = v_pid AND tenant_id = v_tenant;
        INSERT INTO product_batches (tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
                                     cost_price, base_purchase_price, shipping_cost_per_unit, true_unit_cost, batch_type)
        VALUES (v_tenant, v_pbranch, v_pid, v_qty, v_qty, v_cost, v_cost, 0, v_cost, 'opening');
        v_inv_total := v_inv_total + (v_qty * v_cost);
      END;
    END LOOP;
    IF v_inv_total > 0 THEN
      v_inv_total := ROUND(v_inv_total, 2);
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code','1300','debit',v_inv_total,'credit',0,'description','رصيد افتتاحي - مخزون'),
        jsonb_build_object('account_code','3950','debit',0,'credit',v_inv_total,'description','رصيد افتتاحي - مخزون'));
      v_entry := public.post_journal(v_tenant, p_date, 'رصيد افتتاحي — المخزون', 'opening_balance',
                                     public.opening_section_key(v_tenant, 'inventory'), v_lines);
      IF v_entry IS NOT NULL THEN
        UPDATE journal_entries SET created_by = v_uid WHERE id = v_entry;
        v_entries := v_entries + 1;
      END IF;
    END IF;
  END IF;

  PERFORM public.log_audit_event('CREATE', 'OpeningBalances', NULL, NULL,
    jsonb_build_object('date', p_date, 'cash', v_cash_total, 'receivables', v_ar, 'customer_advances', v_c_adv,
                       'payables', v_ap, 'supplier_advances', v_s_adv, 'inventory', v_inv_total, 'reversed', v_reversed));
  RETURN jsonb_build_object('success', true, 'entries', v_entries, 'reversed_entries', v_reversed,
    'cash_total', v_cash_total, 'receivables_total', v_ar, 'customer_advances_total', v_c_adv,
    'payables_total', v_ap, 'supplier_advances_total', v_s_adv, 'inventory_total', v_inv_total);
END
$fn$;

CREATE OR REPLACE FUNCTION public.get_opening_balances()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
BEGIN
  IF v_tenant IS NULL OR NOT (public.is_owner(v_uid) OR public.is_admin(v_uid)) THEN
    RETURN jsonb_build_object('cash','[]'::jsonb,'contacts','[]'::jsonb,'inventory','[]'::jsonb,'posted_at',NULL);
  END IF;
  RETURN jsonb_build_object(
    'posted_at', (SELECT max(created_at) FROM journal_entries WHERE tenant_id = v_tenant AND source_type = 'opening_balance'
                    AND status = 'posted' AND reversed_by IS NULL),
    'opening_date', (SELECT max(entry_date) FROM journal_entries WHERE tenant_id = v_tenant AND source_type = 'opening_balance'
                    AND status = 'posted' AND reversed_by IS NULL),
    'cash', COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id', je.branch_id, 'amount', l.debit))
                        FROM journal_entries je
                        JOIN journal_entry_lines l ON l.entry_id = je.id
                        JOIN chart_of_accounts a ON a.id = l.account_id AND a.code = '1100'
                       WHERE je.tenant_id = v_tenant AND je.source_type = 'opening_balance' AND je.status = 'posted'
                         AND je.reversed_by IS NULL AND l.debit > 0), '[]'::jsonb),
    'contacts', COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', id, 'amount', opening_balance))
                            FROM contacts WHERE tenant_id = v_tenant AND opening_balance <> 0), '[]'::jsonb),
    'inventory', COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity_purchased, 'cost_price', cost_price))
                             FROM product_batches WHERE tenant_id = v_tenant AND batch_type = 'opening'), '[]'::jsonb),
    'inventory_locked', EXISTS (SELECT 1 FROM product_batches WHERE tenant_id = v_tenant AND batch_type = 'opening'
                                  AND quantity_remaining < quantity_purchased),
    'main_treasury', (SELECT jsonb_build_object('id', b.id, 'name', b.name) FROM branches b
                       WHERE b.tenant_id = v_tenant AND b.code = 'MAIN-TREASURY' LIMIT 1)
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.opening_balances_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid; v jsonb;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF NOT (public.is_admin(auth.uid()) OR public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'غير مصرح — ملخص الأرصدة الافتتاحية للإدارة' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'as_of', (SELECT max(e.entry_date) FROM journal_entries e WHERE e.tenant_id = v_tenant AND e.source_type = 'opening_balance'
               AND e.status = 'posted' AND e.reversed_by IS NULL),
    'ledger_date', public.ledger_cutoff(),
    'main_treasury', (SELECT jsonb_build_object('id', b.id, 'name', b.name) FROM branches b
                       WHERE b.tenant_id = v_tenant AND b.code = 'MAIN-TREASURY' LIMIT 1),
    'cash', COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id', x.branch_id, 'branch_name', x.name, 'amount', x.amt) ORDER BY x.name)
                        FROM (SELECT t.branch_id, b.name, sum(CASE WHEN t.type::text = 'income' THEN t.amount ELSE -t.amount END) amt
                                FROM treasury t JOIN branches b ON b.id = t.branch_id
                               WHERE t.tenant_id = v_tenant AND t.category = 'رصيد افتتاحي' GROUP BY 1, 2) x
                       WHERE abs(x.amt) > 0.005), '[]'::jsonb),
    'cash_total', COALESCE((SELECT sum(CASE WHEN t.type::text = 'income' THEN t.amount ELSE -t.amount END) FROM treasury t
                             WHERE t.tenant_id = v_tenant AND t.category = 'رصيد افتتاحي'), 0),
    'customers_debt', COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.tenant_id = v_tenant AND m.status = 'active'
                                 AND m.kind = 'opening' AND m.side = 'customer' AND m.effect = 'charge'), 0),
    'customers_advance', COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.tenant_id = v_tenant AND m.status = 'active'
                                 AND m.kind = 'opening' AND m.side = 'customer' AND m.effect = 'settle'), 0),
    'suppliers_payable', COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.tenant_id = v_tenant AND m.status = 'active'
                                 AND m.kind = 'opening' AND m.side = 'supplier' AND m.effect = 'charge'), 0),
    'suppliers_advance', COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.tenant_id = v_tenant AND m.status = 'active'
                                 AND m.kind = 'opening' AND m.side = 'supplier' AND m.effect = 'settle'), 0),
    'contacts_count', (SELECT count(*) FROM contacts c WHERE c.tenant_id = v_tenant AND COALESCE(c.opening_balance, 0) <> 0),
    'inventory_value', COALESCE((SELECT round(sum(b.quantity_purchased * b.cost_price), 2) FROM product_batches b
                                  WHERE b.tenant_id = v_tenant AND b.batch_type IN ('opening', 'opening_stock')), 0),
    'inventory_remaining_value', COALESCE((SELECT round(sum(b.quantity_remaining * b.cost_price), 2) FROM product_batches b
                                  WHERE b.tenant_id = v_tenant AND b.batch_type IN ('opening', 'opening_stock')), 0)
  ) INTO v;
  RETURN v;
END
$fn$;

REVOKE ALL ON FUNCTION public.ledger_opening_branch(uuid, uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_opening_branch_is_fallback(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_opening_entry(uuid, text)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.opening_entry_section(uuid)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_opening_balances(date, jsonb, jsonb, jsonb), public.opening_balances_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_opening_balances(date, jsonb, jsonb, jsonb), public.opening_balances_summary() TO authenticated, service_role;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('post_opening_balances',     '0056', 'owner/admin; cancel-only re-post (reversals), per-side accounts, till row for opening cash'),
  ('opening_balances_summary',  '0056', 'read-only; company admins')
ON CONFLICT (function_name) DO UPDATE SET added_in = EXCLUDED.added_in, note = EXCLUDED.note;

DO $check$
DECLARE v_list text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Step 6C: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
END
$check$;