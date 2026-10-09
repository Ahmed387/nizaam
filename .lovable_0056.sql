-- =============================================================================================
-- Step 6C — Screens read the unified ledger; no netting anywhere; opening balances linked to the
--           main treasury; automatic integrity checks (approved 8 Oct 2026)
--
--   1. Opening balances   contact openings sit on the main treasury branch (MAIN-TREASURY); opening
--                         cash also enters the till (treasury) so every till card includes it;
--                         post_opening_balances never deletes: a re-post reverses the old entries,
--                         contact openings post by side (1200 / 2150 / 2100 / 1460), stock openings
--                         add to the quantity instead of overwriting it
--   2. Ledger readers     side balances (customer and supplier never meet), contacts page, contact
--                         360° file (overview, documents, money, statement), document status for the
--                         six document screens, company / branch position for the home cards
--   3. Retired readers    v_contact_balances, contact_branch_balances, doc_ledger_allocation,
--                         invoice_outstanding_debt, v_supplier_ledger: netted or partial formulas —
--                         no longer readable from the browser
--   4. Contacts           delete = archive (hard delete banned); wallet balances need branch access
--   5. Integrity checks   system_integrity_audit(): opening / on-account / cross-branch checks and
--                         document, stock, treasury and journal consistency checks, read-only
--
-- Branch view of a contact (one rule everywhere):
--   documents of that branch − money recorded in that branch, with the cross-branch uses of money shown
--   as their own lines ("paid from branch X" / "used in branch Y"). Summed over all branches it equals
--   the company-wide balance. The historical archive and the owner's personal ledger are not read.
-- =============================================================================================

-- =============================================================================================
-- 1. Opening balances
-- =============================================================================================
-- 1.0 Account 3950 (opening balance equity) is used by post_opening_balances but was never in the chart
--     seed: posting opening balances failed with "حساب مفقود (3950)". Added for every company and the seed.
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

-- 1a. Contact openings are recorded on the main treasury branch (owner decision, 8 Oct).
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

-- 1b. A reversal of an opening cash row may take the till below zero (the cash was spent since).
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

-- 1c. Posting opening balances: one call per section; a section passed as NULL is left untouched.
--     Nothing is deleted: the previous postings of a re-posted section are reversed (journal reversal,
--     till reversal row, stock taken back out of the untouched opening batches).
--     Contact amount sign: + = the contact owes us, − = we owe the contact.
--       customer: + → 1200 receivable,      − → 2150 customer advance
--       supplier: + → 1460 supplier advance, − → 2100 payable
--       both    : + → 1200 (customer side),  − → 2100 (supplier side)
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

-- section of an opening entry: tagged by source_id since 6C; older entries by their description
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

  -- ---------------- cash per branch: journal 1100 / 3950 and a till row ----------------
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

  -- ---------------- contacts: one signed amount per contact, posted by side ----------------
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

  -- ---------------- stock: opening batches; quantities are added, never overwritten ----------------
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
    -- take the untouched opening batches back out of stock (batch kept, emptied, marked opening_reversed)
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

-- 1d. Opening cash already posted to the journal but never put in the till: add the till row now.
DO $cash$
DECLARE r record; n int := 0;
BEGIN
  PERFORM set_config('app.skip_treasury_voucher', '1', true);
  FOR r IN
    SELECT e.id, e.tenant_id, e.branch_id, e.entry_date,
           COALESCE(e.created_by,
                    (SELECT ur.user_id FROM user_roles ur WHERE ur.tenant_id = e.tenant_id AND ur.role::text IN ('owner', 'admin')
                      ORDER BY ur.role::text DESC, ur.user_id LIMIT 1),
                    (SELECT p.id FROM profiles p WHERE p.tenant_id = e.tenant_id ORDER BY p.id LIMIT 1)) AS created_by,
           (SELECT sum(l.debit) FROM journal_entry_lines l JOIN chart_of_accounts a ON a.id = l.account_id
             WHERE l.entry_id = e.id AND a.code = '1100') AS amt
      FROM journal_entries e
     WHERE e.source_type = 'opening_balance' AND e.status = 'posted' AND e.reversed_by IS NULL
       AND e.branch_id IS NOT NULL AND public.opening_entry_section(e.id) = 'cash'
       AND NOT EXISTS (SELECT 1 FROM treasury t WHERE t.reference_id = e.id AND t.category = 'رصيد افتتاحي')
  LOOP
    CONTINUE WHEN COALESCE(r.amt, 0) <= 0;
    IF r.created_by IS NULL THEN
      RAISE NOTICE 'Step 6C: opening cash entry % has no user to stamp the till row — left for the integrity check (O4)', r.id;
      CONTINUE;
    END IF;
    INSERT INTO treasury (tenant_id, branch_id, type, category, amount, description, reference_id, created_by,
                          payment_method, transaction_date)
    VALUES (r.tenant_id, r.branch_id, 'income', 'رصيد افتتاحي', r.amt, 'رصيد افتتاحي — نقدية الخزنة', r.id, r.created_by,
            'cash', r.entry_date);
    n := n + 1;
  END LOOP;
  PERFORM set_config('app.skip_treasury_voucher', '', true);
  RAISE NOTICE 'Step 6C: opening cash rows added to the till: %', n;
END
$cash$;


-- 1f. What the opening balances page loads: only the standing postings (reversed ones are history),
--     plus whether the stock opening can still be re-posted.
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

-- 1e. Opening summary for the home page, the main treasury and the opening balances page.
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

-- =============================================================================================
-- 2. Ledger readers (server-side; the browser never reads money_movements / payment_allocations raw)
-- =============================================================================================
-- 2a. Access: signed in, company not suspended, branch membership for a branch view, and the view
--     permission of the side (customers.view / suppliers.view; 'any' = either). Returns the company.
CREATE OR REPLACE FUNCTION public.ledger_read_scope(p_branch uuid, p_side text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF p_branch IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = p_branch AND b.tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'الفرع غير موجود في شركتك' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid) OR public.user_in_branch(v_uid, p_branch)) THEN
      RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_side = 'customer' AND NOT public.effective_permission(v_uid, 'customers.view') THEN
    RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية «customers.view»' USING ERRCODE = '42501';
  ELSIF p_side = 'supplier' AND NOT public.effective_permission(v_uid, 'suppliers.view') THEN
    RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية «suppliers.view»' USING ERRCODE = '42501';
  ELSIF p_side = 'any' AND NOT (public.effective_permission(v_uid, 'customers.view')
                                OR public.effective_permission(v_uid, 'suppliers.view')) THEN
    RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية عرض العملاء أو الموردين' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_can_see_side(p_side text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.effective_permission(auth.uid(), CASE WHEN p_side = 'customer' THEN 'customers.view' ELSE 'suppliers.view' END)
$$;

CREATE OR REPLACE FUNCTION public.ledger_contact_tenant_check(p_contact uuid, p_tenant uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = p_contact AND c.tenant_id = p_tenant) THEN
    RAISE EXCEPTION 'جهة التعامل غير موجودة في شركتك' USING ERRCODE = '42501';
  END IF;
END
$fn$;

-- 2b. Building blocks (internal): every open debt with what is allocated to it; every settling movement
--     with what is still unallocated (= the advance, 2150 customer / 1460 supplier).
CREATE OR REPLACE FUNCTION public.ledger_debt_rows(p_tenant uuid, p_contact uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid, side text, debt_type text, debt_id uuid, branch_id uuid, doc_date date,
               created_at timestamptz, amount numeric, allocated numeric, remaining numeric,
               paid_by_returns numeric, paid_from_other_branches numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH d AS (
    SELECT i.contact_id, 'customer'::text AS side, 'invoice'::text AS t, i.id, i.branch_id,
           public.ledger_day(i.invoice_date) AS dd, i.created_at AS ts, i.total AS amt
      FROM invoices i
     WHERE i.tenant_id = p_tenant AND (p_contact IS NULL OR i.contact_id = p_contact)
       AND i.status = 'active' AND i.total > 0 AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff()
    UNION ALL
    SELECT s.contact_id, 'supplier', 'shipment', s.id, s.branch_id,
           public.ledger_day(COALESCE(s.invoice_date, s.created_at)), s.created_at, s.total_cost
      FROM shipments s
     WHERE s.tenant_id = p_tenant AND s.contact_id IS NOT NULL AND (p_contact IS NULL OR s.contact_id = p_contact)
       AND s.status = 'active' AND s.total_cost > 0
       AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= public.ledger_cutoff()
    UNION ALL
    SELECT m.contact_id, m.side, 'movement', m.id, m.branch_id, m.movement_date, m.created_at, m.amount
      FROM money_movements m
     WHERE m.tenant_id = p_tenant AND (p_contact IS NULL OR m.contact_id = p_contact)
       AND m.status = 'active' AND m.effect = 'charge'
  ),
  a AS (
    SELECT pa.debt_type, pa.debt_id, sum(pa.amount) AS s,
           sum(pa.amount) FILTER (WHERE mv.kind = 'return_credit') AS s_ret,
           sum(pa.amount) FILTER (WHERE pa.is_cross_branch) AS s_x
      FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
     WHERE pa.tenant_id = p_tenant AND pa.status = 'active'
       AND (p_contact IS NULL OR pa.contact_id = p_contact)
     GROUP BY 1, 2
  )
  SELECT d.contact_id, d.side, d.t, d.id, d.branch_id, d.dd, d.ts, d.amt,
         COALESCE(a.s, 0), d.amt - COALESCE(a.s, 0), COALESCE(a.s_ret, 0), COALESCE(a.s_x, 0)
    FROM d LEFT JOIN a ON a.debt_type = d.t AND a.debt_id = d.id
$$;

CREATE OR REPLACE FUNCTION public.ledger_credit_rows(p_tenant uuid, p_contact uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid, side text, movement_id uuid, kind text, branch_id uuid, movement_date date,
               created_at timestamptz, amount numeric, allocated numeric, unallocated numeric, used_in_other_branches numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.contact_id, m.side, m.id, m.kind, m.branch_id, m.movement_date, m.created_at, m.amount,
         COALESCE(a.s, 0), m.amount - COALESCE(a.s, 0), COALESCE(a.s_x, 0)
    FROM money_movements m
    LEFT JOIN (SELECT pa.movement_id, sum(pa.amount) AS s, sum(pa.amount) FILTER (WHERE pa.is_cross_branch) AS s_x
                 FROM payment_allocations pa
                WHERE pa.tenant_id = p_tenant AND pa.status = 'active' AND (p_contact IS NULL OR pa.contact_id = p_contact)
                GROUP BY 1) a ON a.movement_id = m.id
   WHERE m.tenant_id = p_tenant AND (p_contact IS NULL OR m.contact_id = p_contact)
     AND m.status = 'active' AND m.effect = 'settle'
$$;

-- Overdue installments per contact and side, capped by what the ledger still shows open: a plan
-- whose document is already paid (e.g. by a general payment through FIFO) is not overdue.
CREATE OR REPLACE FUNCTION public.ledger_overdue_rows(p_tenant uuid, p_branch uuid DEFAULT NULL, p_contact uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid, side text, overdue numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH plan AS (
    SELECT pp.id, pp.entity_id, pp.entity_type AS side, pp.reference_type, pp.reference_id,
           sum(GREATEST(pi.amount - COALESCE(pi.paid_amount, 0), 0)) AS due
      FROM payment_plans pp
      JOIN payment_installments pi ON pi.payment_plan_id = pp.id
     WHERE pp.tenant_id = p_tenant AND pp.entity_type IN ('customer', 'supplier')
       AND COALESCE(pp.status, 'active') NOT IN ('cancelled', 'completed')
       AND pi.cancelled_at IS NULL AND COALESCE(pi.status, '') NOT IN ('paid', 'cancelled')
       AND pi.due_date < public.cairo_today()
       AND (p_branch IS NULL OR pp.branch_id = p_branch)
       AND (p_contact IS NULL OR pp.entity_id = p_contact)
     GROUP BY 1, 2, 3, 4, 5
  ),
  capped AS (
    SELECT p.entity_id, p.side,
           CASE WHEN p.reference_type IN ('invoice', 'shipment') THEN
                  LEAST(p.due, COALESCE((SELECT GREATEST(dr.remaining, 0) FROM public.ledger_debt_rows(p_tenant, p.entity_id) dr
                                          WHERE dr.debt_type = p.reference_type AND dr.debt_id = p.reference_id), 0))
                ELSE p.due END AS due
      FROM plan p
  ),
  open_side AS (
    SELECT dr.contact_id, dr.side, sum(GREATEST(dr.remaining, 0)) AS rem
      FROM public.ledger_debt_rows(p_tenant, p_contact) dr
     WHERE dr.contact_id IS NOT NULL AND (p_branch IS NULL OR dr.branch_id = p_branch)
     GROUP BY 1, 2
  )
  SELECT c.entity_id, c.side, round(LEAST(sum(c.due), COALESCE(max(o.rem), 0)), 2)
    FROM capped c LEFT JOIN open_side o ON o.contact_id = c.entity_id AND o.side = c.side
   GROUP BY c.entity_id, c.side
  HAVING sum(c.due) > 0.005
$$;

-- 2c. Side balances per contact (branch view or company-wide). balance = open − advance;
--     customer: + they owe us / − we hold their advance; supplier: + we owe them / − our advance with them.
CREATE OR REPLACE FUNCTION public.ledger_side_balances(p_tenant uuid, p_branch uuid DEFAULT NULL, p_contact uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid, side text, open_remaining numeric, open_docs int, advance numeric, balance numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH d AS (
    SELECT dr.contact_id, dr.side, sum(dr.remaining) AS r, count(*) FILTER (WHERE dr.remaining > 0.005 AND dr.debt_type <> 'movement') AS n
      FROM public.ledger_debt_rows(p_tenant, p_contact) dr
     WHERE dr.contact_id IS NOT NULL AND (p_branch IS NULL OR dr.branch_id = p_branch)
     GROUP BY 1, 2
  ),
  c AS (
    SELECT cr.contact_id, cr.side, sum(cr.unallocated) AS u
      FROM public.ledger_credit_rows(p_tenant, p_contact) cr
     WHERE cr.contact_id IS NOT NULL AND (p_branch IS NULL OR cr.branch_id = p_branch)
     GROUP BY 1, 2
  )
  SELECT COALESCE(d.contact_id, c.contact_id), COALESCE(d.side, c.side),
         round(COALESCE(d.r, 0), 2), COALESCE(d.n, 0)::int, round(COALESCE(c.u, 0), 2),
         round(COALESCE(d.r, 0) - COALESCE(c.u, 0), 2)
    FROM d FULL JOIN c ON c.contact_id = d.contact_id AND c.side = d.side
$$;

-- 2d. Balances of given contacts for pickers, payment dialogs and lists (both sides, never netted).
CREATE OR REPLACE FUNCTION public.contact_side_balances(p_contact_ids uuid[], p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid,
               customer_balance numeric, customer_open numeric, customer_advance numeric, customer_overdue numeric,
               supplier_balance numeric, supplier_open numeric, supplier_advance numeric, supplier_overdue numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid; v_c boolean; v_s boolean;
BEGIN
  v_tenant := public.ledger_read_scope(p_branch_id, 'any');
  v_c := public.ledger_can_see_side('customer');
  v_s := public.ledger_can_see_side('supplier');
  IF COALESCE(cardinality(p_contact_ids), 0) > 5000 THEN
    RAISE EXCEPTION 'عدد جهات كبير في طلب واحد (الحد 5000)';
  END IF;
  RETURN QUERY
  WITH ids AS (SELECT DISTINCT x AS id FROM unnest(p_contact_ids) x
                JOIN contacts ct ON ct.id = x AND ct.tenant_id = v_tenant),
       b AS (SELECT sb.* FROM ids, LATERAL public.ledger_side_balances(v_tenant, p_branch_id, ids.id) sb
              WHERE cardinality(p_contact_ids) <= 50
             UNION ALL
             SELECT sb.* FROM public.ledger_side_balances(v_tenant, p_branch_id, NULL) sb
              WHERE cardinality(p_contact_ids) > 50 AND sb.contact_id IN (SELECT ids.id FROM ids)),
       o AS (SELECT ov.* FROM ids, LATERAL public.ledger_overdue_rows(v_tenant, p_branch_id, ids.id) ov
              WHERE cardinality(p_contact_ids) <= 50
             UNION ALL
             SELECT ov.* FROM public.ledger_overdue_rows(v_tenant, p_branch_id, NULL) ov
              WHERE cardinality(p_contact_ids) > 50 AND ov.contact_id IN (SELECT ids.id FROM ids))
  SELECT ids.id,
         CASE WHEN v_c THEN COALESCE((SELECT b.balance FROM b WHERE b.contact_id = ids.id AND b.side = 'customer'), 0) END,
         CASE WHEN v_c THEN COALESCE((SELECT b.open_remaining FROM b WHERE b.contact_id = ids.id AND b.side = 'customer'), 0) END,
         CASE WHEN v_c THEN COALESCE((SELECT b.advance FROM b WHERE b.contact_id = ids.id AND b.side = 'customer'), 0) END,
         CASE WHEN v_c THEN COALESCE((SELECT o.overdue FROM o WHERE o.contact_id = ids.id AND o.side = 'customer'), 0) END,
         CASE WHEN v_s THEN COALESCE((SELECT b.balance FROM b WHERE b.contact_id = ids.id AND b.side = 'supplier'), 0) END,
         CASE WHEN v_s THEN COALESCE((SELECT b.open_remaining FROM b WHERE b.contact_id = ids.id AND b.side = 'supplier'), 0) END,
         CASE WHEN v_s THEN COALESCE((SELECT b.advance FROM b WHERE b.contact_id = ids.id AND b.side = 'supplier'), 0) END,
         CASE WHEN v_s THEN COALESCE((SELECT o.overdue FROM o WHERE o.contact_id = ids.id AND o.side = 'supplier'), 0) END
    FROM ids;
END
$fn$;

-- 2e. Contacts page: same arguments as before; balances by side (branch view and company-wide).
--     p_branch_id NULL = all branches (company admins). Balance filters:
--     owe_us (customer +), we_owe (supplier +), customer_advance, supplier_advance, overdue, settled.
DROP FUNCTION IF EXISTS public.contacts_page(uuid, text, text, text[], integer, integer);
CREATE OR REPLACE FUNCTION public.contacts_page(p_branch_id uuid, p_type text DEFAULT 'all', p_query text DEFAULT NULL,
                                                p_balance text[] DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid; v_c boolean; v_s boolean; v jsonb;
BEGIN
  v_tenant := public.ledger_read_scope(p_branch_id, 'any');
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'عرض كل الفروع للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  v_c := public.ledger_can_see_side('customer');
  v_s := public.ledger_can_see_side('supplier');
  WITH toks AS (
    SELECT array_remove(regexp_split_to_array(public.normalize_search_text(p_query), '\s+'), '') AS t
  ),
  sb AS (SELECT * FROM public.ledger_side_balances(v_tenant, p_branch_id, NULL)),
  sball AS (SELECT * FROM public.ledger_side_balances(v_tenant, NULL, NULL)),
  ov AS (SELECT * FROM public.ledger_overdue_rows(v_tenant, p_branch_id, NULL)),
  base AS (
    SELECT c.id, c.name, c.phone, c.contact_person, c.email, c.address, c.notes, c.type, c.branch_id, c.created_at,
           c.opening_balance, c.is_migrated,
           COALESCE(bc.balance, 0) AS customer_balance, COALESCE(bc.open_remaining, 0) AS customer_open,
           COALESCE(bc.advance, 0) AS customer_advance, COALESCE(oc.overdue, 0) AS customer_overdue,
           COALESCE(bs.balance, 0) AS supplier_balance, COALESCE(bs.open_remaining, 0) AS supplier_open,
           COALESCE(bs.advance, 0) AS supplier_advance, COALESCE(os.overdue, 0) AS supplier_overdue,
           COALESCE(ac.balance, 0) AS customer_balance_all, COALESCE(asu.balance, 0) AS supplier_balance_all,
           (p_branch_id IS NULL OR c.branch_id = p_branch_id OR c.branch_id IS NULL
             OR abs(COALESCE(bc.balance, 0)) > 0.005 OR abs(COALESCE(bs.balance, 0)) > 0.005
             OR COALESCE(oc.overdue, 0) > 0.005 OR COALESCE(os.overdue, 0) > 0.005
             OR EXISTS (SELECT 1 FROM invoices i WHERE i.contact_id = c.id AND i.branch_id = p_branch_id)
             OR EXISTS (SELECT 1 FROM shipments s WHERE s.contact_id = c.id AND s.branch_id = p_branch_id)
             OR EXISTS (SELECT 1 FROM purchase_returns pr WHERE pr.contact_id = c.id AND pr.branch_id = p_branch_id)
             OR EXISTS (SELECT 1 FROM money_movements m WHERE m.contact_id = c.id AND m.branch_id = p_branch_id)
             OR EXISTS (SELECT 1 FROM vouchers v WHERE v.party_id = c.id AND v.branch_id = p_branch_id)) AS in_branch
      FROM contacts c
      LEFT JOIN sb bc ON bc.contact_id = c.id AND bc.side = 'customer'
      LEFT JOIN sb bs ON bs.contact_id = c.id AND bs.side = 'supplier'
      LEFT JOIN sball ac ON ac.contact_id = c.id AND ac.side = 'customer'
      LEFT JOIN sball asu ON asu.contact_id = c.id AND asu.side = 'supplier'
      LEFT JOIN ov oc ON oc.contact_id = c.id AND oc.side = 'customer'
      LEFT JOIN ov os ON os.contact_id = c.id AND os.side = 'supplier'
     WHERE c.tenant_id = v_tenant AND c.is_archived = false
  ),
  vis AS (  -- a side the user may not view is shown as 0 (never mixed into the other side)
    SELECT b.id, b.name, b.phone, b.contact_person, b.email, b.address, b.notes, b.type, b.branch_id, b.created_at,
           b.opening_balance, b.is_migrated, b.in_branch,
           CASE WHEN v_c THEN b.customer_balance ELSE 0 END AS customer_balance,
           CASE WHEN v_c THEN b.customer_open ELSE 0 END AS customer_open,
           CASE WHEN v_c THEN b.customer_advance ELSE 0 END AS customer_advance,
           CASE WHEN v_c THEN b.customer_overdue ELSE 0 END AS customer_overdue,
           CASE WHEN v_c THEN b.customer_balance_all ELSE 0 END AS customer_balance_all,
           CASE WHEN v_s THEN b.supplier_balance ELSE 0 END AS supplier_balance,
           CASE WHEN v_s THEN b.supplier_open ELSE 0 END AS supplier_open,
           CASE WHEN v_s THEN b.supplier_advance ELSE 0 END AS supplier_advance,
           CASE WHEN v_s THEN b.supplier_overdue ELSE 0 END AS supplier_overdue,
           CASE WHEN v_s THEN b.supplier_balance_all ELSE 0 END AS supplier_balance_all
      FROM base b
  ),
  scoped AS (
    SELECT vis.* FROM vis, toks
     WHERE CASE WHEN COALESCE(cardinality(toks.t), 0) = 0 THEN vis.in_branch
           ELSE NOT EXISTS (SELECT 1 FROM unnest(toks.t) tk
                             WHERE public.normalize_search_text(concat_ws(' ', vis.name, vis.phone, vis.contact_person, vis.email, vis.address, vis.notes))
                                   NOT LIKE '%' || tk || '%') END
  ),
  typed AS (
    SELECT * FROM scoped
     WHERE p_type = 'all' OR (p_type = 'both' AND type::text = 'both')
        OR (p_type <> 'both' AND type::text IN (p_type, 'both'))
  ),
  filtered AS (
    SELECT * FROM typed
     WHERE p_balance IS NULL OR cardinality(p_balance) = 0
        -- same definitions as the cards: open documents / unused money of each side
        OR ('owe_us' = ANY (p_balance) AND customer_open > 0.005)
        OR ('we_owe' = ANY (p_balance) AND supplier_open > 0.005)
        OR ('customer_advance' = ANY (p_balance) AND customer_advance > 0.005)
        OR ('supplier_advance' = ANY (p_balance) AND supplier_advance > 0.005)
        OR ('overdue' = ANY (p_balance) AND (customer_overdue > 0.005 OR supplier_overdue > 0.005))
        OR ('settled' = ANY (p_balance) AND customer_open <= 0.005 AND customer_advance <= 0.005
                                       AND supplier_open <= 0.005 AND supplier_advance <= 0.005)
  ),
  page AS (
    SELECT * FROM filtered ORDER BY created_at DESC, id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100000) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(page) - 'in_branch' ORDER BY page.created_at DESC, page.id) FROM page), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'counts', (SELECT jsonb_build_object(
        'all', count(*),
        'customer', count(*) FILTER (WHERE type::text IN ('customer', 'both')),
        'supplier', count(*) FILTER (WHERE type::text IN ('supplier', 'both')),
        'both', count(*) FILTER (WHERE type::text = 'both')) FROM scoped),
    'totals', (SELECT jsonb_build_object(
        'customers_open', COALESCE(round(sum(customer_open), 2), 0),
        'customers_open_count', count(*) FILTER (WHERE customer_open > 0.005),
        'customer_advances', COALESCE(round(sum(customer_advance), 2), 0),
        'customer_advances_count', count(*) FILTER (WHERE customer_advance > 0.005),
        'suppliers_open', COALESCE(round(sum(supplier_open), 2), 0),
        'suppliers_open_count', count(*) FILTER (WHERE supplier_open > 0.005),
        'supplier_advances', COALESCE(round(sum(supplier_advance), 2), 0),
        'supplier_advances_count', count(*) FILTER (WHERE supplier_advance > 0.005),
        'customer_overdue', COALESCE(round(sum(customer_overdue), 2), 0),
        'supplier_overdue', COALESCE(round(sum(supplier_overdue), 2), 0)) FROM typed),
    'sides', jsonb_build_object('customer', v_c, 'supplier', v_s)
  ) INTO v;
  RETURN v;
END
$fn$;

-- 2f. Reference label of a movement (voucher number, invoice number, …) for statements and lists.
CREATE OR REPLACE FUNCTION public.ledger_movement_ref(p_source_table text, p_source_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE p_source_table
    WHEN 'vouchers' THEN (SELECT v.voucher_number FROM vouchers v WHERE v.id = p_source_id)
    WHEN 'invoice_payments' THEN (SELECT 'دفعة على ' || i.invoice_number || COALESCE(' #' || NULLIF(ip.reference_number, ''), '')
                                    FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id WHERE ip.id = p_source_id)
    WHEN 'payment_transactions' THEN (SELECT COALESCE(NULLIF(pt.reference_number, ''), 'دفعة') FROM payment_transactions pt WHERE pt.id = p_source_id)
    WHEN 'supplier_payments' THEN (SELECT COALESCE(NULLIF(sp.notes, ''), 'دفعة مورد') FROM supplier_payments sp WHERE sp.id = p_source_id)
    WHEN 'returns' THEN (SELECT COALESCE(r.return_number, 'مرتجع بيع') FROM returns r WHERE r.id = p_source_id)
    WHEN 'purchase_returns' THEN (SELECT COALESCE(pr.return_number, 'مرتجع شراء') FROM purchase_returns pr WHERE pr.id = p_source_id)
    WHEN 'invoices' THEN (SELECT 'رد نقدية — ' || i.invoice_number FROM invoices i WHERE i.id = p_source_id)
    WHEN 'customer_credit_log' THEN 'إيداع تحت الحساب'
    WHEN 'contacts' THEN 'رصيد افتتاحي'
  END
$$;

CREATE OR REPLACE FUNCTION public.ledger_kind_label(p_side text, p_kind text, p_effect text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_kind = 'opening' AND p_effect = 'charge' THEN CASE WHEN p_side = 'customer' THEN 'رصيد افتتاحي (مديونية عليه)' ELSE 'رصيد افتتاحي (مستحق له)' END
    WHEN p_kind = 'opening' THEN CASE WHEN p_side = 'customer' THEN 'رصيد افتتاحي (مقدم منه)' ELSE 'رصيد افتتاحي (مقدم لينا عنده)' END
    WHEN p_kind = 'payment' THEN CASE WHEN p_side = 'customer' THEN 'تحصيل' ELSE 'سداد للمورد' END
    WHEN p_kind = 'deposit' THEN 'إيداع تحت الحساب'
    WHEN p_kind = 'refund' THEN CASE WHEN p_side = 'customer' THEN 'رد فلوس للعميل' ELSE 'استرداد من المورد' END
    WHEN p_kind = 'return_credit' THEN CASE WHEN p_side = 'customer' THEN 'مرتجع بيع (رصيد)' ELSE 'مرتجع شراء (خصم من المديونية)' END
  END
$$;

-- 2g. Contact file: documents of one side (open / closed / cancelled / before the ledger date).
CREATE OR REPLACE FUNCTION public.ledger_contact_documents(p_contact uuid, p_side text, p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (doc_type text, doc_id uuid, doc_number text, doc_date date, branch_id uuid, branch_name text,
               state text, total numeric, paid_money numeric, paid_by_returns numeric, paid_from_other_branches numeric,
               remaining numeric, cancel_reason text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid;
BEGIN
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'side غير صحيح'; END IF;
  v_tenant := public.ledger_read_scope(p_branch_id, p_side);
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'حركات كل الفروع للإدارة فقط — اختار فرعك' USING ERRCODE = '42501';
  END IF;
  PERFORM public.ledger_contact_tenant_check(p_contact, v_tenant);
  RETURN QUERY
  WITH dr AS (SELECT * FROM public.ledger_debt_rows(v_tenant, p_contact) x WHERE x.side = p_side)
  -- documents in the ledger
  SELECT dr.debt_type, dr.debt_id,
         CASE WHEN dr.debt_type = 'invoice' THEN (SELECT i.invoice_number FROM invoices i WHERE i.id = dr.debt_id)
              WHEN dr.debt_type = 'shipment' THEN (SELECT s.shipment_number FROM shipments s WHERE s.id = dr.debt_id)
              ELSE (SELECT public.ledger_movement_ref(m.source_table, m.source_id) FROM money_movements m WHERE m.id = dr.debt_id) END,
         dr.doc_date, dr.branch_id, (SELECT b.name FROM branches b WHERE b.id = dr.branch_id),
         CASE WHEN dr.remaining > 0.005 THEN 'open' ELSE 'closed' END,
         round(dr.amount, 2), round(dr.allocated - dr.paid_by_returns, 2), round(dr.paid_by_returns, 2),
         round(dr.paid_from_other_branches, 2), round(dr.remaining, 2), NULL::text
    FROM dr
   WHERE p_branch_id IS NULL OR dr.branch_id = p_branch_id
  UNION ALL
  -- cancelled documents (kept for the record, outside every balance)
  SELECT 'invoice', i.id, i.invoice_number, public.ledger_day(i.invoice_date), i.branch_id, b.name, 'cancelled',
         round(i.total, 2), 0::numeric, 0::numeric, 0::numeric, 0::numeric, i.cancel_reason
    FROM invoices i JOIN branches b ON b.id = i.branch_id
   WHERE p_side = 'customer' AND i.contact_id = p_contact AND i.status <> 'active'
     AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
  UNION ALL
  SELECT 'shipment', s.id, s.shipment_number, public.ledger_day(COALESCE(s.invoice_date, s.created_at)), s.branch_id, b.name, 'cancelled',
         round(s.total_cost, 2), 0, 0, 0, 0, s.cancel_reason
    FROM shipments s JOIN branches b ON b.id = s.branch_id
   WHERE p_side = 'supplier' AND s.contact_id = p_contact AND s.status <> 'active'
     AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  UNION ALL
  -- before the ledger date (archive period): listed, not in any balance
  SELECT 'invoice', i.id, i.invoice_number, public.ledger_day(i.invoice_date), i.branch_id, b.name, 'before_ledger',
         round(i.total, 2), NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::text
    FROM invoices i JOIN branches b ON b.id = i.branch_id
   WHERE p_side = 'customer' AND i.contact_id = p_contact AND i.status = 'active'
     AND public.ledger_day(i.invoice_date) < public.ledger_cutoff()
     AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
  UNION ALL
  SELECT 'shipment', s.id, s.shipment_number, public.ledger_day(COALESCE(s.invoice_date, s.created_at)), s.branch_id, b.name, 'before_ledger',
         round(s.total_cost, 2), NULL, NULL, NULL, NULL, NULL
    FROM shipments s JOIN branches b ON b.id = s.branch_id
   WHERE p_side = 'supplier' AND s.contact_id = p_contact AND s.status = 'active'
     AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) < public.ledger_cutoff()
     AND (p_branch_id IS NULL OR s.branch_id = p_branch_id);
END
$fn$;

-- 2h. Contact file: money of one side (collections / payments / deposits / refunds / return credits).
CREATE OR REPLACE FUNCTION public.ledger_contact_money(p_contact uuid, p_side text, p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (movement_id uuid, kind text, kind_label text, effect text, movement_date date, branch_id uuid, branch_name text,
               method text, amount numeric, allocated numeric, unallocated numeric, used_in_other_branches numeric,
               status text, reference text, source_table text, source_id uuid, target_doc_number text, cancel_reason text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid;
BEGIN
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'side غير صحيح'; END IF;
  v_tenant := public.ledger_read_scope(p_branch_id, p_side);
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'حركات كل الفروع للإدارة فقط — اختار فرعك' USING ERRCODE = '42501';
  END IF;
  PERFORM public.ledger_contact_tenant_check(p_contact, v_tenant);
  RETURN QUERY
  SELECT m.id, m.kind, public.ledger_kind_label(m.side, m.kind, m.effect), m.effect, m.movement_date, m.branch_id, b.name,
         m.method, round(m.amount, 2),
         round(CASE WHEN m.effect = 'settle' THEN COALESCE(a.s, 0) ELSE COALESCE(d.s, 0) END, 2),
         round(CASE WHEN m.status <> 'active' THEN 0 WHEN m.effect = 'settle' THEN m.amount - COALESCE(a.s, 0) ELSE m.amount - COALESCE(d.s, 0) END, 2),
         round(CASE WHEN m.effect = 'settle' THEN COALESCE(a.sx, 0) ELSE 0 END, 2),
         m.status, public.ledger_movement_ref(m.source_table, m.source_id), m.source_table, m.source_id,
         CASE m.target_doc_type WHEN 'invoice' THEN (SELECT i.invoice_number FROM invoices i WHERE i.id = m.target_doc_id)
                                WHEN 'shipment' THEN (SELECT s.shipment_number FROM shipments s WHERE s.id = m.target_doc_id) END,
         m.cancel_reason
    FROM money_movements m
    JOIN branches b ON b.id = m.branch_id
    LEFT JOIN (SELECT pa.movement_id, sum(pa.amount) s, sum(pa.amount) FILTER (WHERE pa.is_cross_branch) sx
                 FROM payment_allocations pa WHERE pa.status = 'active' AND pa.contact_id = p_contact GROUP BY 1) a ON a.movement_id = m.id
    LEFT JOIN (SELECT pa.debt_id, sum(pa.amount) s
                 FROM payment_allocations pa WHERE pa.status = 'active' AND pa.contact_id = p_contact AND pa.debt_type = 'movement' GROUP BY 1) d ON d.debt_id = m.id
   WHERE m.tenant_id = v_tenant AND m.contact_id = p_contact AND m.side = p_side
     AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)
     -- a movement cancelled only because the ledger re-synced its source is noise; a source that was
     -- really cancelled has no active replacement
     AND (m.status = 'active' OR NOT EXISTS (SELECT 1 FROM money_movements r WHERE r.status = 'active'
            AND r.source_table = m.source_table AND r.source_id = m.source_id AND r.kind = m.kind AND r.side = m.side));
END
$fn$;

-- 2i. Contact statement of one side with a running balance. Branch view adds the cross-branch lines.
CREATE OR REPLACE FUNCTION public.ledger_contact_statement(p_contact uuid, p_side text, p_branch_id uuid DEFAULT NULL,
                                                          p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (line_no int, line_date date, line_type text, reference text, branch_name text, description text,
               debit numeric, credit numeric, balance numeric, doc_type text, doc_id uuid, branch_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid;
BEGIN
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'side غير صحيح'; END IF;
  v_tenant := public.ledger_read_scope(p_branch_id, p_side);
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'حركات كل الفروع للإدارة فقط — اختار فرعك' USING ERRCODE = '42501';
  END IF;
  PERFORM public.ledger_contact_tenant_check(p_contact, v_tenant);
  RETURN QUERY
  WITH ev AS (
    -- documents: increase what is open
    SELECT dr.doc_date AS d, 1 AS o, dr.created_at AS ts, dr.debt_id AS id,
           CASE WHEN dr.debt_type = 'invoice' THEN 'فاتورة بيع' WHEN dr.debt_type = 'shipment' THEN 'فاتورة شراء'
                ELSE (SELECT public.ledger_kind_label(m.side, m.kind, m.effect) FROM money_movements m WHERE m.id = dr.debt_id) END AS t,
           CASE WHEN dr.debt_type = 'invoice' THEN (SELECT i.invoice_number FROM invoices i WHERE i.id = dr.debt_id)
                WHEN dr.debt_type = 'shipment' THEN (SELECT s.shipment_number FROM shipments s WHERE s.id = dr.debt_id)
                ELSE (SELECT public.ledger_movement_ref(m.source_table, m.source_id) FROM money_movements m WHERE m.id = dr.debt_id) END AS ref,
           dr.branch_id AS br, NULL::text AS descr, dr.amount AS dr_amt, 0::numeric AS cr_amt,
           CASE WHEN dr.debt_type = 'movement' THEN NULL ELSE dr.debt_type END AS dt,
           CASE WHEN dr.debt_type = 'movement' THEN NULL ELSE dr.debt_id END AS did
      FROM public.ledger_debt_rows(v_tenant, p_contact) dr
     WHERE dr.side = p_side AND (p_branch_id IS NULL OR dr.branch_id = p_branch_id)
    UNION ALL
    -- money and credits: reduce what is open
    SELECT m.movement_date, 2, m.created_at, m.id, public.ledger_kind_label(m.side, m.kind, m.effect),
           public.ledger_movement_ref(m.source_table, m.source_id), m.branch_id,
           CASE WHEN m.method IS NOT NULL THEN m.method END, 0, m.amount, NULL, NULL
      FROM money_movements m
     WHERE m.tenant_id = v_tenant AND m.contact_id = p_contact AND m.side = p_side AND m.status = 'active'
       AND m.effect = 'settle' AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)
    UNION ALL
    -- branch view: a debt of this branch paid with money recorded in another branch
    SELECT pa.effective_date, 3, pa.created_at, pa.id, 'سداد من فرع آخر',
           (SELECT b.name FROM branches b WHERE b.id = pa.movement_branch_id), pa.debt_branch_id,
           'اتسدد من فلوس متسجلة في فرع تاني (حساب جاري بين الفروع 1910)', 0, pa.amount, NULL, NULL
      FROM payment_allocations pa
     WHERE p_branch_id IS NOT NULL AND pa.tenant_id = v_tenant AND pa.contact_id = p_contact AND pa.side = p_side
       AND pa.status = 'active' AND pa.is_cross_branch AND pa.debt_branch_id = p_branch_id
    UNION ALL
    -- branch view: money of this branch used for a debt of another branch
    SELECT pa.effective_date, 3, pa.created_at, pa.id, 'استخدام في فرع آخر',
           (SELECT b.name FROM branches b WHERE b.id = pa.debt_branch_id), pa.movement_branch_id,
           'فلوس اتسجلت هنا واتسدد بيها مستند في فرع تاني (حساب جاري بين الفروع 1910)', pa.amount, 0, NULL, NULL
      FROM payment_allocations pa
     WHERE p_branch_id IS NOT NULL AND pa.tenant_id = v_tenant AND pa.contact_id = p_contact AND pa.side = p_side
       AND pa.status = 'active' AND pa.is_cross_branch AND pa.movement_branch_id = p_branch_id
  ),
  ordered AS (
    SELECT ev.*, sum(ev.dr_amt - ev.cr_amt) OVER (ORDER BY ev.d, ev.o, ev.ts, ev.id ROWS UNBOUNDED PRECEDING) AS run,
           row_number() OVER (ORDER BY ev.d, ev.o, ev.ts, ev.id) AS rn
      FROM ev
  ),
  pre AS (
    SELECT COALESCE(sum(o.dr_amt - o.cr_amt), 0) AS v FROM ordered o WHERE p_from IS NOT NULL AND o.d < p_from
  )
  SELECT 0, p_from, 'رصيد أول المدة'::text, NULL::text, NULL::text, NULL::text, 0::numeric, 0::numeric, round(pre.v, 2), NULL::text, NULL::uuid, NULL::uuid
    FROM pre WHERE p_from IS NOT NULL
  UNION ALL
  SELECT o.rn::int, o.d, o.t, o.ref, (SELECT b.name FROM branches b WHERE b.id = o.br), o.descr,
         round(o.dr_amt, 2), round(o.cr_amt, 2), round(o.run, 2), o.dt, o.did, o.br
    FROM ordered o
   WHERE (p_from IS NULL OR o.d >= p_from) AND (p_to IS NULL OR o.d <= p_to)
   ORDER BY 1;
END
$fn$;

-- 2j. Contact file: the overview (cards of both sides; a side the user may not view is null).
CREATE OR REPLACE FUNCTION public.ledger_contact_overview(p_contact uuid, p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid; v_cust jsonb; v_supp jsonb; v_contact jsonb;
BEGIN
  v_tenant := public.ledger_read_scope(p_branch_id, 'any');
  PERFORM public.ledger_contact_tenant_check(p_contact, v_tenant);

  SELECT jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type, 'phone', c.phone, 'contact_person', c.contact_person,
                            'address', c.address, 'notes', c.notes, 'email', c.email, 'is_archived', c.is_archived,
                            'opening_balance', c.opening_balance, 'branch_id', c.branch_id,
                            'branch_name', (SELECT b.name FROM branches b WHERE b.id = c.branch_id),
                            'branches', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name)
                                                    FROM branches b WHERE b.tenant_id = v_tenant AND (
                                                      EXISTS (SELECT 1 FROM invoices i WHERE i.contact_id = c.id AND i.branch_id = b.id)
                                                      OR EXISTS (SELECT 1 FROM shipments s WHERE s.contact_id = c.id AND s.branch_id = b.id)
                                                      OR EXISTS (SELECT 1 FROM money_movements m WHERE m.contact_id = c.id AND m.branch_id = b.id AND m.status = 'active')
                                                      OR EXISTS (SELECT 1 FROM vouchers v WHERE v.party_id = c.id AND v.branch_id = b.id))), '[]'::jsonb))
    INTO v_contact FROM contacts c WHERE c.id = p_contact;

  IF public.ledger_can_see_side('customer') THEN
    WITH dr AS (SELECT * FROM public.ledger_debt_rows(v_tenant, p_contact) x
                 WHERE x.side = 'customer' AND (p_branch_id IS NULL OR x.branch_id = p_branch_id)),
         cr AS (SELECT * FROM public.ledger_credit_rows(v_tenant, p_contact) x
                 WHERE x.side = 'customer' AND (p_branch_id IS NULL OR x.branch_id = p_branch_id)),
         mv AS (SELECT * FROM money_movements m WHERE m.contact_id = p_contact AND m.side = 'customer' AND m.status = 'active'
                   AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)),
         rt AS (SELECT r.* FROM returns r JOIN invoices i ON i.id = r.invoice_id
                 WHERE i.contact_id = p_contact AND COALESCE(r.status, 'active') NOT IN ('draft', 'cancelled')
                   AND public.ledger_day(COALESCE(r.invoice_date, r.created_at)) >= public.ledger_cutoff()
                   AND (p_branch_id IS NULL OR COALESCE(r.branch_id, i.branch_id) = p_branch_id))
    SELECT jsonb_build_object(
      'documents', jsonb_build_object(
        'count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'invoice'),
        'total', (SELECT COALESCE(round(sum(dr.amount), 2), 0) FROM dr WHERE dr.debt_type = 'invoice'),
        'open_count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'invoice' AND dr.remaining > 0.005),
        'closed_count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'invoice' AND dr.remaining <= 0.005),
        'cancelled_count', (SELECT count(*) FROM invoices i WHERE i.contact_id = p_contact AND i.status <> 'active'
                              AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)),
        'cancelled_total', (SELECT COALESCE(round(sum(i.total), 2), 0) FROM invoices i WHERE i.contact_id = p_contact AND i.status <> 'active'
                              AND (p_branch_id IS NULL OR i.branch_id = p_branch_id))),
      'returns', jsonb_build_object(
        'count', (SELECT count(*) FROM rt),
        'total', (SELECT COALESCE(round(sum(rt.total_refund), 2), 0) FROM rt),
        'cash', (SELECT COALESCE(round(sum(COALESCE(rt.refund_cash_amount, 0) + COALESCE(rt.refund_transfer_amount, 0)), 2), 0) FROM rt),
        'credit', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'return_credit')),
      'money', jsonb_build_object(
        'collected', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind IN ('payment', 'deposit')),
        'deposits', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'deposit'),
        'by_method', COALESCE((SELECT jsonb_object_agg(x.method, x.amt) FROM (
                         SELECT COALESCE(mv.method, 'other') AS method, round(sum(mv.amount), 2) AS amt FROM mv
                          WHERE mv.kind IN ('payment', 'deposit') GROUP BY 1) x), '{}'::jsonb),
        'refunded', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'refund'),
        'opening_debt', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'opening' AND mv.effect = 'charge'),
        'opening_advance', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'opening' AND mv.effect = 'settle')),
      'open_remaining', (SELECT COALESCE(round(sum(dr.remaining), 2), 0) FROM dr),
      'advance', (SELECT COALESCE(round(sum(cr.unallocated), 2), 0) FROM cr),
      'balance', (SELECT COALESCE(round(sum(dr.remaining), 2), 0) FROM dr) - (SELECT COALESCE(round(sum(cr.unallocated), 2), 0) FROM cr),
      'overdue', COALESCE((SELECT o.overdue FROM public.ledger_overdue_rows(v_tenant, p_branch_id, p_contact) o WHERE o.side = 'customer'), 0),
      'paid_from_other_branches', (SELECT COALESCE(round(sum(dr.paid_from_other_branches), 2), 0) FROM dr),
      'used_in_other_branches', (SELECT COALESCE(round(sum(cr.used_in_other_branches), 2), 0) FROM cr),
      'before_ledger', jsonb_build_object(
        'count', (SELECT count(*) FROM invoices i WHERE i.contact_id = p_contact AND i.status = 'active'
                    AND public.ledger_day(i.invoice_date) < public.ledger_cutoff() AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)),
        'total', (SELECT COALESCE(round(sum(i.total), 2), 0) FROM invoices i WHERE i.contact_id = p_contact AND i.status = 'active'
                    AND public.ledger_day(i.invoice_date) < public.ledger_cutoff() AND (p_branch_id IS NULL OR i.branch_id = p_branch_id))))
      INTO v_cust;
  END IF;

  IF public.ledger_can_see_side('supplier') THEN
    WITH dr AS (SELECT * FROM public.ledger_debt_rows(v_tenant, p_contact) x
                 WHERE x.side = 'supplier' AND (p_branch_id IS NULL OR x.branch_id = p_branch_id)),
         cr AS (SELECT * FROM public.ledger_credit_rows(v_tenant, p_contact) x
                 WHERE x.side = 'supplier' AND (p_branch_id IS NULL OR x.branch_id = p_branch_id)),
         mv AS (SELECT * FROM money_movements m WHERE m.contact_id = p_contact AND m.side = 'supplier' AND m.status = 'active'
                   AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)),
         rt AS (SELECT pr.* FROM purchase_returns pr
                 WHERE pr.contact_id = p_contact AND pr.status = 'active'
                   AND public.ledger_day(COALESCE(pr.invoice_date, pr.created_at)) >= public.ledger_cutoff()
                   AND (p_branch_id IS NULL OR pr.branch_id = p_branch_id))
    SELECT jsonb_build_object(
      'documents', jsonb_build_object(
        'count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'shipment'),
        'total', (SELECT COALESCE(round(sum(dr.amount), 2), 0) FROM dr WHERE dr.debt_type = 'shipment'),
        'open_count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'shipment' AND dr.remaining > 0.005),
        'closed_count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'shipment' AND dr.remaining <= 0.005),
        'cancelled_count', (SELECT count(*) FROM shipments s WHERE s.contact_id = p_contact AND s.status <> 'active'
                              AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)),
        'cancelled_total', (SELECT COALESCE(round(sum(s.total_cost), 2), 0) FROM shipments s WHERE s.contact_id = p_contact AND s.status <> 'active'
                              AND (p_branch_id IS NULL OR s.branch_id = p_branch_id))),
      'returns', jsonb_build_object(
        'count', (SELECT count(*) FROM rt),
        'total', (SELECT COALESCE(round(sum(rt.total_amount), 2), 0) FROM rt),
        'cash', (SELECT COALESCE(round(sum(COALESCE(rt.refund_cash_amount, 0) + COALESCE(rt.refund_transfer_amount, 0)), 2), 0) FROM rt),
        'credit', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'return_credit')),
      'money', jsonb_build_object(
        'paid', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind IN ('payment', 'deposit')),
        'by_method', COALESCE((SELECT jsonb_object_agg(x.method, x.amt) FROM (
                         SELECT COALESCE(mv.method, 'other') AS method, round(sum(mv.amount), 2) AS amt FROM mv
                          WHERE mv.kind IN ('payment', 'deposit') GROUP BY 1) x), '{}'::jsonb),
        'refunded', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'refund'),
        'opening_debt', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'opening' AND mv.effect = 'charge'),
        'opening_advance', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'opening' AND mv.effect = 'settle')),
      'open_remaining', (SELECT COALESCE(round(sum(dr.remaining), 2), 0) FROM dr),
      'advance', (SELECT COALESCE(round(sum(cr.unallocated), 2), 0) FROM cr),
      'balance', (SELECT COALESCE(round(sum(dr.remaining), 2), 0) FROM dr) - (SELECT COALESCE(round(sum(cr.unallocated), 2), 0) FROM cr),
      'overdue', COALESCE((SELECT o.overdue FROM public.ledger_overdue_rows(v_tenant, p_branch_id, p_contact) o WHERE o.side = 'supplier'), 0),
      'paid_from_other_branches', (SELECT COALESCE(round(sum(dr.paid_from_other_branches), 2), 0) FROM dr),
      'used_in_other_branches', (SELECT COALESCE(round(sum(cr.used_in_other_branches), 2), 0) FROM cr),
      'discounts', (SELECT COALESCE(round(sum(s.discount_amount), 2), 0) FROM shipments s WHERE s.contact_id = p_contact AND s.status = 'active'
                      AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= public.ledger_cutoff()
                      AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)),
      'before_ledger', jsonb_build_object(
        'count', (SELECT count(*) FROM shipments s WHERE s.contact_id = p_contact AND s.status = 'active'
                    AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) < public.ledger_cutoff() AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)),
        'total', (SELECT COALESCE(round(sum(s.total_cost), 2), 0) FROM shipments s WHERE s.contact_id = p_contact AND s.status = 'active'
                    AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) < public.ledger_cutoff() AND (p_branch_id IS NULL OR s.branch_id = p_branch_id))))
      INTO v_supp;
  END IF;

  -- invoices and money are branch-isolated: company-wide detail is for admins; branch staff get the
  -- contact's global totals only (owner rule: names and total balances are global)
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    v_cust := CASE WHEN v_cust IS NULL THEN NULL ELSE jsonb_build_object('totals_only', true,
                'balance', v_cust->'balance', 'open_remaining', v_cust->'open_remaining', 'advance', v_cust->'advance', 'overdue', v_cust->'overdue') END;
    v_supp := CASE WHEN v_supp IS NULL THEN NULL ELSE jsonb_build_object('totals_only', true,
                'balance', v_supp->'balance', 'open_remaining', v_supp->'open_remaining', 'advance', v_supp->'advance', 'overdue', v_supp->'overdue') END;
    v_contact := v_contact - 'branches';
  END IF;
  RETURN jsonb_build_object('contact', v_contact, 'branch_id', p_branch_id, 'ledger_date', public.ledger_cutoff(),
                            'customer', v_cust, 'supplier', v_supp);
END
$fn$;

-- 2k. Document screens: paid / remaining of the listed sale or purchase invoices from the ledger.
CREATE OR REPLACE FUNCTION public.ledger_document_status(p_doc_type text, p_ids uuid[])
RETURNS TABLE (doc_id uuid, total numeric, paid numeric, paid_money numeric, paid_by_returns numeric,
               paid_from_other_branches numeric, remaining numeric, state text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid; v_uid uuid := auth.uid(); v_all boolean;
BEGIN
  IF p_doc_type NOT IN ('invoice', 'shipment') THEN RAISE EXCEPTION 'نوع المستند غير صحيح'; END IF;
  v_tenant := public.assert_company_access(NULL);
  IF COALESCE(cardinality(p_ids), 0) > 5000 THEN RAISE EXCEPTION 'عدد مستندات كبير في طلب واحد (الحد 5000)'; END IF;
  v_all := public.is_admin(v_uid) OR public.is_super_admin(v_uid);
  RETURN QUERY
  WITH docs AS (
    SELECT i.id, i.tenant_id, i.branch_id, i.total AS amt, i.status::text AS st,
           public.ledger_day(i.invoice_date) >= public.ledger_cutoff() AS in_ledger
      FROM invoices i WHERE p_doc_type = 'invoice' AND i.id = ANY (p_ids)
    UNION ALL
    SELECT s.id, s.tenant_id, s.branch_id, s.total_cost, s.status,
           public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= public.ledger_cutoff()
      FROM shipments s WHERE p_doc_type = 'shipment' AND s.id = ANY (p_ids)
  ),
  ok AS (SELECT * FROM docs WHERE docs.tenant_id = v_tenant AND (v_all OR public.user_in_branch(v_uid, docs.branch_id))),
  a AS (
    SELECT pa.debt_id, sum(pa.amount) s, sum(pa.amount) FILTER (WHERE mv.kind = 'return_credit') sr,
           sum(pa.amount) FILTER (WHERE pa.is_cross_branch) sx
      FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
     WHERE pa.status = 'active' AND pa.debt_type = p_doc_type AND pa.debt_id IN (SELECT ok.id FROM ok)
     GROUP BY 1
  )
  SELECT ok.id, round(ok.amt, 2),
         round(COALESCE(a.s, 0), 2), round(COALESCE(a.s, 0) - COALESCE(a.sr, 0), 2), round(COALESCE(a.sr, 0), 2),
         round(COALESCE(a.sx, 0), 2),
         CASE WHEN ok.st <> 'active' OR NOT ok.in_ledger THEN 0 ELSE round(ok.amt - COALESCE(a.s, 0), 2) END,
         CASE WHEN ok.st <> 'active' THEN 'cancelled'
              WHEN NOT ok.in_ledger THEN 'before_ledger'
              WHEN ok.amt - COALESCE(a.s, 0) <= 0.005 THEN 'paid'
              WHEN COALESCE(a.s, 0) > 0.005 THEN 'partial'
              ELSE 'unpaid' END
    FROM ok LEFT JOIN a ON a.debt_id = ok.id;
END
$fn$;

-- 2l. Company / branch position for the home, cockpit and main treasury cards (both sides, separate).
CREATE OR REPLACE FUNCTION public.ledger_position(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid; v_c boolean; v_s boolean; v jsonb;
BEGIN
  v_tenant := public.ledger_read_scope(p_branch_id, 'any');
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'مركز الشركة كلها للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  v_c := public.ledger_can_see_side('customer');
  v_s := public.ledger_can_see_side('supplier');
  WITH sb AS (SELECT * FROM public.ledger_side_balances(v_tenant, p_branch_id, NULL)),
       ov AS (SELECT * FROM public.ledger_overdue_rows(v_tenant, p_branch_id, NULL)),
       walk AS (SELECT dr.* FROM public.ledger_debt_rows(v_tenant, NULL) dr
                 WHERE dr.contact_id IS NULL AND (p_branch_id IS NULL OR dr.branch_id = p_branch_id)),
       xb AS (SELECT pa.* FROM payment_allocations pa
               WHERE pa.tenant_id = v_tenant AND pa.status = 'active' AND pa.is_cross_branch
                 AND (p_branch_id IS NULL OR pa.debt_branch_id = p_branch_id OR pa.movement_branch_id = p_branch_id))
  SELECT jsonb_build_object(
    'branch_id', p_branch_id,
    'ledger_date', public.ledger_cutoff(),
    'customers', CASE WHEN v_c THEN jsonb_build_object(
        'open', COALESCE((SELECT round(sum(open_remaining), 2) FROM sb WHERE side = 'customer'), 0),
        'open_contacts', (SELECT count(*) FROM sb WHERE side = 'customer' AND open_remaining > 0.005),
        'advances', COALESCE((SELECT round(sum(advance), 2) FROM sb WHERE side = 'customer'), 0),
        'advance_contacts', (SELECT count(*) FROM sb WHERE side = 'customer' AND advance > 0.005),
        'overdue', COALESCE((SELECT round(sum(overdue), 2) FROM ov WHERE side = 'customer'), 0),
        'walkin_open', COALESCE((SELECT round(sum(remaining), 2) FROM walk WHERE remaining > 0.005), 0)) END,
    'suppliers', CASE WHEN v_s THEN jsonb_build_object(
        'open', COALESCE((SELECT round(sum(open_remaining), 2) FROM sb WHERE side = 'supplier'), 0),
        'open_contacts', (SELECT count(*) FROM sb WHERE side = 'supplier' AND open_remaining > 0.005),
        'advances', COALESCE((SELECT round(sum(advance), 2) FROM sb WHERE side = 'supplier'), 0),
        'advance_contacts', (SELECT count(*) FROM sb WHERE side = 'supplier' AND advance > 0.005),
        'overdue', COALESCE((SELECT round(sum(overdue), 2) FROM ov WHERE side = 'supplier'), 0)) END,
    'cross_branch', jsonb_build_object(
        'paid_here_for_other_branches', COALESCE((SELECT round(sum(amount), 2) FROM xb WHERE p_branch_id IS NOT NULL AND movement_branch_id = p_branch_id), 0),
        'paid_elsewhere_for_this_branch', COALESCE((SELECT round(sum(amount), 2) FROM xb WHERE p_branch_id IS NOT NULL AND debt_branch_id = p_branch_id), 0),
        'total', COALESCE((SELECT round(sum(amount), 2) FROM xb), 0),
        'count', (SELECT count(*) FROM xb))
  ) INTO v;
  RETURN v;
END
$fn$;

-- 2m. Aging of what is still open, by side (documents and charges by their date; advances apart).
CREATE OR REPLACE FUNCTION public.ledger_aging(p_side text, p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid, contact_name text, contact_type text, d0_30 numeric, d31_60 numeric, d61_90 numeric,
               d91_120 numeric, d120_plus numeric, total_open numeric, advance numeric, oldest_date date)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid; v_today date := public.cairo_today();
BEGIN
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'side غير صحيح'; END IF;
  v_tenant := public.ledger_read_scope(p_branch_id, p_side);
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'أعمار الديون لكل الفروع للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH d AS (
    SELECT dr.contact_id, dr.remaining, v_today - dr.doc_date AS age, dr.doc_date
      FROM public.ledger_debt_rows(v_tenant, NULL) dr
     WHERE dr.side = p_side AND dr.contact_id IS NOT NULL AND dr.remaining > 0.005
       AND (p_branch_id IS NULL OR dr.branch_id = p_branch_id)
  ),
  a AS (
    SELECT cr.contact_id, sum(cr.unallocated) AS adv
      FROM public.ledger_credit_rows(v_tenant, NULL) cr
     WHERE cr.side = p_side AND cr.contact_id IS NOT NULL AND cr.unallocated > 0.005
       AND (p_branch_id IS NULL OR cr.branch_id = p_branch_id)
     GROUP BY 1
  ),
  ids AS (SELECT d.contact_id FROM d UNION SELECT a.contact_id FROM a)
  SELECT c.id, c.name, c.type,
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age <= 30), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age BETWEEN 31 AND 60), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age BETWEEN 61 AND 90), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age BETWEEN 91 AND 120), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age > 120), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id), 0), 2),
         round(COALESCE((SELECT a.adv FROM a WHERE a.contact_id = c.id), 0), 2),
         (SELECT min(d.doc_date) FROM d WHERE d.contact_id = c.id)
    FROM ids JOIN contacts c ON c.id = ids.contact_id;
END
$fn$;

-- =============================================================================================
-- 3. No netting left in server logic that feeds screens or prints
-- =============================================================================================
-- 3a. Balance snapshots printed on sale / purchase invoices: the contact's side only.
--     Sale invoice: customer side (+ = owes us). Purchase invoice: supplier side (+ = we owe).
DO $snap$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.process_sale(uuid, uuid, numeric, numeric, numeric, text, numeric, text, jsonb, jsonb, numeric, numeric, date)'::regprocedure);
  IF position('INTO v_prev_balance FROM public.v_contact_balances' IN v_def) = 0
     OR position('INTO v_curr_balance FROM public.v_contact_balances' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Step 6C: process_sale balance snapshot not found';
  END IF;
  v_def := replace(v_def,
    'SELECT COALESCE(total_balance, 0) INTO v_prev_balance FROM public.v_contact_balances WHERE contact_id = p_customer_id;',
    'v_prev_balance := public.ledger_contact_side_balance(p_customer_id, ''customer'');');
  v_def := replace(v_def,
    'SELECT COALESCE(total_balance, 0) INTO v_curr_balance FROM public.v_contact_balances WHERE contact_id = p_customer_id;',
    'v_curr_balance := v_prev_balance + v_calc_total - COALESCE((SELECT sum(ip.amount) FROM public.invoice_payments ip
       WHERE ip.invoice_id = v_invoice_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
         AND ip.payment_method NOT IN (''credit_balance'', ''credit_applied'', ''settlement'')), 0);');
  EXECUTE v_def;

  v_def := pg_get_functiondef('public.capture_shipment_prev_balance()'::regprocedure);
  IF position('FROM public.v_contact_balances' IN v_def) = 0 THEN RAISE EXCEPTION 'Step 6C: shipment prev snapshot not found'; END IF;
  v_def := replace(v_def, 'SELECT COALESCE(total_balance, 0) INTO NEW.previous_balance
      FROM public.v_contact_balances WHERE contact_id = NEW.contact_id;',
      'NEW.previous_balance := public.ledger_contact_side_balance(NEW.contact_id, ''supplier'');');
  EXECUTE v_def;

  v_def := pg_get_functiondef('public.capture_shipment_curr_balance()'::regprocedure);
  IF position('FROM public.v_contact_balances' IN v_def) = 0 THEN RAISE EXCEPTION 'Step 6C: shipment curr snapshot not found'; END IF;
  v_def := replace(v_def, 'SELECT COALESCE(total_balance, 0) INTO v_curr
      FROM public.v_contact_balances WHERE contact_id = NEW.contact_id;',
      'v_curr := COALESCE(NEW.previous_balance, 0) + CASE WHEN public.ledger_day(COALESCE(NEW.invoice_date, NEW.created_at)) >= public.ledger_cutoff()
                                                       THEN COALESCE(NEW.total_cost, 0) ELSE 0 END;');
  EXECUTE v_def;
END
$snap$;

-- 3b. Purchase return: how much of it reduces the supplier's debt used the netted balance (a customer
--     debt of the same contact lowered it). Now: the supplier side only.
CREATE OR REPLACE FUNCTION public.supplier_outstanding_payable(_contact_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT GREATEST(COALESCE(public.ledger_contact_side_balance(_contact_id, 'supplier'), 0), 0);
$$;

-- 3c. Netted or partial readers: no longer readable from the browser (server functions keep them).
REVOKE ALL ON public.v_contact_balances FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_supplier_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contact_branch_balances(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.doc_ledger_allocation(text, uuid, uuid[], date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoice_outstanding_debt(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supplier_outstanding_payable(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON VIEW public.v_contact_balances IS
  'Retired in Step 6C (netted customer and supplier sides). Screens read the unified ledger: contacts_page, contact_side_balances, ledger_contact_*.';

-- =============================================================================================
-- 4. Contacts: delete = archive; till balances need branch access
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.delete_contact(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_ct uuid;
  v_name text;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'أرشفة جهة التعامل للإدارة فقط — مدير الفرع يرسل طلب موافقة' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id, name INTO v_ct, v_name FROM public.contacts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'جهة التعامل غير موجودة' USING ERRCODE = 'P0002'; END IF;
  IF v_ct IS DISTINCT FROM v_tenant AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'غير مصرح: جهة التعامل تخص شركة أخرى' USING ERRCODE = '42501';
  END IF;
  IF abs(COALESCE(public.ledger_contact_side_balance(p_id, 'customer'), 0)) > 0.005
     OR abs(COALESCE(public.ledger_contact_side_balance(p_id, 'supplier'), 0)) > 0.005 THEN
    RAISE EXCEPTION 'مينفعش أرشفة «%» وعليه أو ليه رصيد مفتوح — سوّي الحساب الأول', v_name;
  END IF;
  -- no hard delete (owner rule): the contact is archived; history and documents stay
  UPDATE public.contacts SET is_archived = true WHERE id = p_id;
  PERFORM public.log_audit_event('DELETE', 'Contact', p_id::text, NULL,
                                 jsonb_build_object('name', v_name, 'mode', 'archive'));
END
$fn$;

DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.contacts;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

DROP FUNCTION IF EXISTS public.get_branch_wallet_balances(uuid);
CREATE OR REPLACE FUNCTION public.get_branch_wallet_balances(p_branch_id uuid)
RETURNS TABLE (cash_balance numeric, vodafone_balance numeric, instapay_balance numeric, bank_balance numeric,
               other_balance numeric, total_balance numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- the till of a branch: its treasury rows (opening cash included since 6C); branch members and admins
  PERFORM public.assert_access(p_branch_id, NULL);
  RETURN QUERY
  WITH t AS (
    SELECT COALESCE(NULLIF(tr.payment_method, ''), 'cash') AS pm,
           (CASE WHEN tr.type::text = 'income' THEN tr.amount ELSE -tr.amount END) AS signed
      FROM public.treasury tr WHERE tr.branch_id = p_branch_id
  )
  SELECT
    COALESCE(SUM(CASE WHEN pm = 'cash' THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm IN ('vodafone', 'wallet', 'etisalat', 'orange') THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm = 'instapay' THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm IN ('bank', 'bank_transfer') THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm NOT IN ('cash', 'vodafone', 'wallet', 'etisalat', 'orange', 'instapay', 'bank', 'bank_transfer') THEN signed ELSE 0 END), 0),
    COALESCE(SUM(signed), 0)
  FROM t;
END
$fn$;


-- An approved "delete contact" request deleted the row from inside a trigger (depth 2 slips past the
-- hard-delete block). It now archives, with the same open-balance rule as delete_contact.
DO $appr$
DECLARE v_def text;
  v_old text := 'DELETE FROM public.contacts WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;';
BEGIN
  v_def := pg_get_functiondef('public.process_approval_request()'::regprocedure);
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'Step 6C: approval contact delete not found'; END IF;
  EXECUTE replace(v_def, v_old,
    'IF abs(COALESCE(public.ledger_contact_side_balance(NEW.entity_id, ''customer''), 0)) > 0.005
           OR abs(COALESCE(public.ledger_contact_side_balance(NEW.entity_id, ''supplier''), 0)) > 0.005 THEN
          RAISE EXCEPTION ''مينفعش أرشفة جهة عليها أو ليها رصيد مفتوح — سوّي الحساب الأول'';
        END IF;
        UPDATE public.contacts SET is_archived = true WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;');
END
$appr$;

-- =============================================================================================
-- 5. Integrity checks (read-only). One row per finding; nothing is changed or "fixed" automatically.
--    severity: error (numbers on screen are wrong until fixed) / warning (needs a look) / info.
--    area: opening | ledger | documents | stock | treasury | journal
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.system_integrity_audit(p_tenant uuid DEFAULT NULL)
RETURNS TABLE (check_code text, severity text, area text, title text, details text,
               contact_id uuid, contact_name text, branch_id uuid, branch_name text,
               doc_type text, doc_id uuid, doc_number text, amount numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_t uuid; v_cut date := public.ledger_cutoff(); v_today date := public.cairo_today();
BEGIN
  IF auth.uid() IS NULL THEN
    v_t := p_tenant;                                   -- service role / migration
  ELSE
    v_t := public.assert_company_access(NULL);
    IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
      RAISE EXCEPTION 'فحص سلامة البيانات للإدارة فقط' USING ERRCODE = '42501';
    END IF;
    IF p_tenant IS NOT NULL AND public.is_super_admin(auth.uid()) THEN v_t := p_tenant; END IF;
  END IF;
  IF v_t IS NULL THEN RAISE EXCEPTION 'حدد الشركة'; END IF;

  RETURN QUERY
  -- ===================== opening balances and on-account money =====================
  -- O1 opening balance and historical (migrated) documents for the same contact: the debt counts twice
  SELECT 'O1', 'error', 'opening', 'رصيد افتتاحي + فواتير تاريخية لنفس الجهة',
         'الجهة ليها رصيد افتتاحي وكمان فواتير مُرحّلة من النظام القديم — الدين محسوب مرتين',
         c.id, c.name, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, round(c.opening_balance, 2)
    FROM contacts c
   WHERE c.tenant_id = v_t AND COALESCE(c.opening_balance, 0) <> 0 AND public.contact_has_legacy_docs(c.id)
  UNION ALL
  -- O2 opening amount entered again as an on-account deposit / payment (same contact, side and amount)
  SELECT 'O2', 'warning', 'opening', 'رصيد افتتاحي متكرر كإيداع أو دفعة',
         'نفس مبلغ الرصيد الافتتاحي اتسجل تاني كحركة فلوس على نفس الجانب في ' || b.name || ' بتاريخ ' || m.movement_date,
         c.id, c.name, m.branch_id, b.name, NULL, NULL, public.ledger_movement_ref(m.source_table, m.source_id), m.amount
    FROM money_movements o
    JOIN contacts c ON c.id = o.contact_id
    JOIN money_movements m ON m.contact_id = o.contact_id AND m.side = o.side AND m.status = 'active'
                          AND m.kind IN ('payment', 'deposit') AND m.effect = o.effect AND m.amount = o.amount
                          AND m.movement_date <= v_cut + 60
    JOIN branches b ON b.id = m.branch_id
   WHERE o.tenant_id = v_t AND o.kind = 'opening' AND o.status = 'active' AND o.effect = 'settle'
  UNION ALL
  -- O3 opening balance not on the main treasury (no MAIN-TREASURY branch and no contact branch)
  SELECT 'O3', 'warning', 'opening', 'حركة على فرع بديل',
         CASE WHEN m.kind = 'opening' THEN 'مفيش خزنة رئيسية (MAIN-TREASURY) للشركة ولا فرع للجهة، فالرصيد الافتتاحي اتسجل على أقدم فرع'
              ELSE 'إيداع تحت الحساب من غير فرع معروف، اتسجل على الخزنة الرئيسية' END,
         c.id, c.name, m.branch_id, b.name, NULL, NULL, NULL, m.amount
    FROM money_movements m JOIN contacts c ON c.id = m.contact_id JOIN branches b ON b.id = m.branch_id
   WHERE m.tenant_id = v_t AND m.status = 'active'
     AND CASE WHEN m.kind = 'opening' THEN public.ledger_opening_branch_is_fallback(m.tenant_id, m.contact_id)
              ELSE m.notes = 'fallback_branch' END
  UNION ALL
  -- O4 opening cash: journal (1100) and the till do not agree for a branch
  SELECT 'O4', 'error', 'opening', 'نقدية افتتاحية مختلفة بين القيود والخزنة',
         'القيود: ' || COALESCE(j.amt, 0) || ' — الخزنة: ' || COALESCE(t.amt, 0),
         NULL, NULL, COALESCE(j.branch_id, t.branch_id), b.name, NULL, NULL, NULL,
         round(COALESCE(j.amt, 0) - COALESCE(t.amt, 0), 2)
    FROM (SELECT e.branch_id, sum(l.debit - l.credit) AS amt
            FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
            JOIN chart_of_accounts a ON a.id = l.account_id AND a.code = '1100'
           WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.source_type IN ('opening_balance', 'opening_balance_reversal')
           GROUP BY 1) j
    FULL JOIN (SELECT tr.branch_id, sum(CASE WHEN tr.type::text = 'income' THEN tr.amount ELSE -tr.amount END) AS amt
                 FROM treasury tr WHERE tr.tenant_id = v_t AND tr.category = 'رصيد افتتاحي' GROUP BY 1) t
           ON t.branch_id = j.branch_id
    LEFT JOIN branches b ON b.id = COALESCE(j.branch_id, t.branch_id)
   WHERE abs(COALESCE(j.amt, 0) - COALESCE(t.amt, 0)) > 0.005
  UNION ALL
  -- O5 documents before the ledger date that are still unpaid in the old tables while the contact has
  --    no opening balance: that old debt is in no balance today
  SELECT 'O5', 'warning', 'opening', 'مستند قبل 2026 مش متسدد ومش متغطي برصيد افتتاحي',
         'المستند تاريخه قبل بداية الدفتر الموحد ومتبقي عليه ' || round(x.rem, 2) || ' — يتحسب في الرصيد الافتتاحي أو يتقفل',
         x.contact_id, c.name, x.branch_id, b.name, x.t, x.id, x.num, round(x.rem, 2)
    FROM (SELECT i.contact_id, i.branch_id, 'invoice'::text AS t, i.id, i.invoice_number AS num,
                 i.total - COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id
                                       AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL), 0)
                         - COALESCE((SELECT sum(GREATEST(COALESCE(r.total_refund,0)-COALESCE(r.refund_cash_amount,0)-COALESCE(r.refund_transfer_amount,0),0))
                                       FROM returns r WHERE r.invoice_id = i.id AND COALESCE(r.status,'active') NOT IN ('draft','cancelled')), 0) AS rem
            FROM invoices i
           WHERE i.tenant_id = v_t AND i.status = 'active' AND i.contact_id IS NOT NULL
             AND public.ledger_day(i.invoice_date) < v_cut) x
    JOIN contacts c ON c.id = x.contact_id
    JOIN branches b ON b.id = x.branch_id
   WHERE x.rem > 0.005 AND COALESCE(c.opening_balance, 0) = 0 AND NOT public.contact_has_legacy_docs(c.id)
  UNION ALL
  -- ===================== unified ledger =====================
  -- L1 the same contact has open debt and unused money on the same side (FIFO should have matched them)
  SELECT 'L1', 'error', 'ledger', 'رصيد تحت الحساب ومديونية مفتوحة لنفس الجانب',
         'متبقي ' || s.open_remaining || ' ومقدم ' || s.advance || ' في نفس الوقت (غالباً فترة مقفولة)',
         s.contact_id, c.name, NULL, NULL, s.side, NULL, NULL, LEAST(s.open_remaining, s.advance)
    FROM public.ledger_side_balances(v_t, NULL, NULL) s JOIN contacts c ON c.id = s.contact_id
   WHERE s.open_remaining > 0.005 AND s.advance > 0.005
  UNION ALL
  -- L2 money recorded in one branch paid a document of another branch (inter-branch account 1910;
  --    posted with Phase 5) — listed per contact and branch pair so it can be checked
  SELECT 'L2', 'info', 'ledger', 'فلوس فرع اتسدد بيها مستند فرع تاني',
         'من ' || bm.name || ' إلى ' || bd.name || ' (' || x.n || ' توزيع)',
         x.contact_id, c.name, x.movement_branch_id, bm.name, x.side, NULL, NULL, x.amt
    FROM (SELECT pa.contact_id, pa.side, pa.movement_branch_id, pa.debt_branch_id, round(sum(pa.amount), 2) AS amt, count(*) AS n
            FROM payment_allocations pa
           WHERE pa.tenant_id = v_t AND pa.status = 'active' AND pa.is_cross_branch
           GROUP BY 1, 2, 3, 4) x
    JOIN contacts c ON c.id = x.contact_id
    JOIN branches bm ON bm.id = x.movement_branch_id
    JOIN branches bd ON bd.id = x.debt_branch_id
  UNION ALL
  -- L3 possible double entry: two money movements, same contact / side / amount / day, different origin
  SELECT 'L3', 'warning', 'ledger', 'دفعة محتمل تكون متسجلة مرتين',
         'نفس المبلغ ونفس اليوم لنفس الجهة من مصدرين: ' || public.ledger_movement_ref(m1.source_table, m1.source_id)
           || ' (' || b1.name || ') و ' || public.ledger_movement_ref(m2.source_table, m2.source_id) || ' (' || b2.name || ')',
         m1.contact_id, c.name, m1.branch_id, b1.name, m1.side, NULL, NULL, m1.amount
    FROM money_movements m1
    JOIN money_movements m2 ON m2.contact_id = m1.contact_id AND m2.side = m1.side AND m2.kind = m1.kind
                           AND m2.amount = m1.amount AND m2.movement_date = m1.movement_date
                           AND m2.status = 'active' AND m2.id > m1.id
                           AND (m2.source_table <> m1.source_table OR m2.branch_id <> m1.branch_id)
    JOIN contacts c ON c.id = m1.contact_id
    JOIN branches b1 ON b1.id = m1.branch_id
    JOIN branches b2 ON b2.id = m2.branch_id
   WHERE m1.tenant_id = v_t AND m1.status = 'active' AND m1.kind IN ('payment', 'deposit')
  UNION ALL
  -- L4 a contact that is both customer and supplier holds money on one side and owes on the other.
  --    No netting: both stay as they are; listed so the owner sees both at once.
  SELECT 'L4', 'info', 'ledger', 'نفس الجهة ليها رصيد على الجانبين',
         'حساب العميل ' || COALESCE(sc.balance, 0) || ' / حساب المورد ' || COALESCE(ss.balance, 0) || ' — كل حساب لوحده',
         c.id, c.name, NULL, NULL, NULL, NULL, NULL, NULL::numeric
    FROM contacts c
    JOIN public.ledger_side_balances(v_t, NULL, NULL) sc ON sc.contact_id = c.id AND sc.side = 'customer'
    JOIN public.ledger_side_balances(v_t, NULL, NULL) ss ON ss.contact_id = c.id AND ss.side = 'supplier'
   WHERE c.tenant_id = v_t AND abs(sc.balance) > 0.005 AND abs(ss.balance) > 0.005
  UNION ALL
  -- L5 the old stored prepaid credit (still used by the sale screen) differs from the ledger advance
  SELECT 'L5', 'warning', 'ledger', 'الرصيد المسبق القديم مختلف عن مقدمات الدفتر',
         'contacts.credit_balance = ' || COALESCE(-c.credit_balance, 0) || ' / مقدم العميل في الدفتر = ' || COALESCE(s.advance, 0),
         c.id, c.name, NULL, NULL, 'customer', NULL, NULL, round(COALESCE(-c.credit_balance, 0) - COALESCE(s.advance, 0), 2)
    FROM contacts c
    LEFT JOIN public.ledger_side_balances(v_t, NULL, NULL) s ON s.contact_id = c.id AND s.side = 'customer'
   WHERE c.tenant_id = v_t AND abs(COALESCE(-c.credit_balance, 0) - COALESCE(s.advance, 0)) > 0.005
     AND (COALESCE(c.credit_balance, 0) <> 0 OR COALESCE(s.advance, 0) <> 0)
  UNION ALL
  -- L6 ledger sync errors waiting
  SELECT 'L6', 'error', 'ledger', 'خطأ في مزامنة الدفتر', e.context || ': ' || e.error,
         e.contact_id, c.name, NULL, NULL, CASE WHEN e.invoice_id IS NOT NULL THEN 'invoice' END, e.invoice_id, NULL, NULL
    FROM ledger_sync_errors e LEFT JOIN contacts c ON c.id = e.contact_id
   WHERE e.tenant_id = v_t AND e.created_at > now() - interval '30 days'
  UNION ALL
  -- ===================== documents =====================
  -- D1 sale invoice totals: lines vs subtotal, subtotal − discount + VAT vs total
  SELECT 'D1', 'error', 'documents', 'إجمالي فاتورة بيع مش مطابق لبنودها',
         'البنود ' || x.items || ' / الإجمالي قبل الخصم ' || i.subtotal || ' / الصافي المحسوب ' || round(i.subtotal - COALESCE(i.discount_amount,0) + COALESCE(i.vat_amount,0), 2) || ' / الإجمالي ' || i.total,
         i.contact_id, c.name, i.branch_id, b.name, 'invoice', i.id, i.invoice_number,
         round(i.total - (i.subtotal - COALESCE(i.discount_amount,0) + COALESCE(i.vat_amount,0)), 2)
    FROM invoices i
    JOIN branches b ON b.id = i.branch_id
    LEFT JOIN contacts c ON c.id = i.contact_id
    JOIN LATERAL (SELECT round(sum(ii.total), 2) AS items, count(*) AS n FROM invoice_items ii WHERE ii.invoice_id = i.id) x ON x.n > 0
   WHERE i.tenant_id = v_t AND i.status = 'active' AND NOT COALESCE(i.is_migrated, false)
     AND (abs(x.items - i.subtotal) > 0.05 OR abs(i.total - (i.subtotal - COALESCE(i.discount_amount,0) + COALESCE(i.vat_amount,0))) > 0.05)
  UNION ALL
  -- D2 a cancelled sale invoice kept money that was neither refunded nor turned into credit
  SELECT 'D2', 'error', 'documents', 'فاتورة ملغاة عليها فلوس مش متردة ولا متحولة رصيد',
         'مدفوع ' || x.paid || ' / مردود ' || COALESCE(i.refund_amount, 0) || ' / متحول رصيد ' || x.credit,
         i.contact_id, c.name, i.branch_id, b.name, 'invoice', i.id, i.invoice_number,
         round(x.paid - COALESCE(i.refund_amount, 0) - x.credit, 2)
    FROM invoices i
    JOIN branches b ON b.id = i.branch_id
    LEFT JOIN contacts c ON c.id = i.contact_id
    JOIN LATERAL (SELECT COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id AND ip.voided_at IS NULL
                                     AND ip.reverses_payment_id IS NULL AND ip.payment_method NOT IN ('credit_balance','credit_applied','settlement')), 0) AS paid,
                         COALESCE((SELECT sum(l.amount) FROM customer_credit_log l WHERE l.invoice_id = i.id AND l.type = 'credit_added'), 0) AS credit) x ON true
   WHERE i.tenant_id = v_t AND i.status = 'cancelled'
     AND x.paid - COALESCE(i.refund_amount, 0) - x.credit > 0.05
  UNION ALL
  -- D3 returned more than was sold on the invoice (per product)
  SELECT 'D3', 'error', 'documents', 'مرتجع بيع أكبر من الكمية المباعة',
         'الصنف مرتجع منه ' || x.ret || ' والمباع ' || x.sold,
         i.contact_id, c.name, i.branch_id, b.name, 'invoice', i.id, i.invoice_number, x.ret - x.sold
    FROM (SELECT r.invoice_id, ri.product_id, sum(ri.quantity) AS ret,
                 COALESCE((SELECT sum(ii.quantity) FROM invoice_items ii WHERE ii.invoice_id = r.invoice_id AND ii.product_id = ri.product_id), 0) AS sold
            FROM returns r JOIN return_items ri ON ri.return_id = r.id
           WHERE r.tenant_id = v_t AND COALESCE(r.status, 'active') NOT IN ('draft', 'cancelled')
           GROUP BY 1, 2) x
    JOIN invoices i ON i.id = x.invoice_id
    JOIN branches b ON b.id = i.branch_id
    LEFT JOIN contacts c ON c.id = i.contact_id
   WHERE x.ret > x.sold
  UNION ALL
  -- D4 returned to the supplier more than was bought on the purchase invoice (per product)
  SELECT 'D4', 'error', 'documents', 'مرتجع شراء أكبر من الكمية المشتراة',
         'الصنف مرتجع منه ' || x.ret || ' والمشترى ' || x.bought,
         s.contact_id, c.name, s.branch_id, b.name, 'shipment', s.id, s.shipment_number, x.ret - x.bought
    FROM (SELECT pr.shipment_id, pri.product_id, sum(pri.quantity) AS ret,
                 COALESCE((SELECT sum(si.quantity) FROM shipment_items si WHERE si.shipment_id = pr.shipment_id AND si.product_id = pri.product_id), 0) AS bought
            FROM purchase_returns pr JOIN purchase_return_items pri ON pri.purchase_return_id = pr.id
           WHERE pr.tenant_id = v_t AND pr.status = 'active' AND pr.shipment_id IS NOT NULL
           GROUP BY 1, 2) x
    JOIN shipments s ON s.id = x.shipment_id
    JOIN branches b ON b.id = s.branch_id
    LEFT JOIN contacts c ON c.id = s.contact_id
   WHERE x.ret > x.bought
  UNION ALL
  -- D5 an active return on a cancelled document
  SELECT 'D5', 'error', 'documents', 'مرتجع ساري على مستند ملغي',
         'المرتجع ' || COALESCE(r.return_number, '') || ' ساري والفاتورة ملغاة',
         i.contact_id, c.name, r.branch_id, b.name, 'invoice', i.id, i.invoice_number, r.total_refund
    FROM returns r JOIN invoices i ON i.id = r.invoice_id
    LEFT JOIN branches b ON b.id = r.branch_id
    LEFT JOIN contacts c ON c.id = i.contact_id
   WHERE r.tenant_id = v_t AND COALESCE(r.status, 'active') NOT IN ('draft', 'cancelled') AND i.status <> 'active'
  UNION ALL
  SELECT 'D5', 'error', 'documents', 'مرتجع شراء ساري على فاتورة شراء ملغاة',
         'المرتجع ' || COALESCE(pr.return_number, '') || ' ساري وفاتورة الشراء ملغاة',
         s.contact_id, c.name, pr.branch_id, b.name, 'shipment', s.id, s.shipment_number, pr.total_amount
    FROM purchase_returns pr JOIN shipments s ON s.id = pr.shipment_id
    LEFT JOIN branches b ON b.id = pr.branch_id
    LEFT JOIN contacts c ON c.id = s.contact_id
   WHERE pr.tenant_id = v_t AND pr.status = 'active' AND s.status <> 'active'
  UNION ALL
  -- D6 return amount vs its lines, and cash + transfer + credit vs the return total
  SELECT 'D6', 'warning', 'documents', 'إجمالي مرتجع بيع مش مطابق لبنوده أو لطريقة الرد',
         'البنود ' || COALESCE(x.items, 0) || ' / الإجمالي ' || r.total_refund || ' / نقدي+تحويل+رصيد ' ||
           (COALESCE(r.refund_cash_amount,0) + COALESCE(r.refund_transfer_amount,0) + COALESCE(r.refund_balance_amount,0)),
         i.contact_id, c.name, r.branch_id, b.name, 'sale_return', r.id, r.return_number, r.total_refund
    FROM returns r JOIN invoices i ON i.id = r.invoice_id
    LEFT JOIN branches b ON b.id = r.branch_id
    LEFT JOIN contacts c ON c.id = i.contact_id
    LEFT JOIN LATERAL (SELECT round(sum(ri.refund), 2) AS items, count(*) AS n FROM return_items ri WHERE ri.return_id = r.id) x ON true
   WHERE r.tenant_id = v_t AND COALESCE(r.status, 'active') NOT IN ('draft', 'cancelled') AND r.migration_batch_id IS NULL
     AND ((x.n > 0 AND abs(x.items - r.total_refund) > 0.05)
       OR (COALESCE(r.refund_cash_amount,0) + COALESCE(r.refund_transfer_amount,0) + COALESCE(r.refund_balance_amount,0) > 0.005
           AND abs(COALESCE(r.refund_cash_amount,0) + COALESCE(r.refund_transfer_amount,0) + COALESCE(r.refund_balance_amount,0) - r.total_refund) > 0.05))
  UNION ALL
  SELECT 'D6', 'warning', 'documents', 'إجمالي مرتجع شراء مش مطابق لبنوده أو لطريقة الرد',
         'البنود ' || COALESCE(x.items, 0) || ' / الإجمالي ' || pr.total_amount || ' / نقدي+تحويل+خصم ' ||
           (COALESCE(pr.refund_cash_amount,0) + COALESCE(pr.refund_transfer_amount,0) + COALESCE(pr.refund_balance_amount,0)),
         pr.contact_id, c.name, pr.branch_id, b.name, 'purchase_return', pr.id, pr.return_number, pr.total_amount
    FROM purchase_returns pr
    LEFT JOIN branches b ON b.id = pr.branch_id
    LEFT JOIN contacts c ON c.id = pr.contact_id
    LEFT JOIN LATERAL (SELECT round(sum(pri.total), 2) AS items, count(*) AS n FROM purchase_return_items pri WHERE pri.purchase_return_id = pr.id) x ON true
   WHERE pr.tenant_id = v_t AND pr.status = 'active' AND pr.migration_batch_id IS NULL
     AND ((x.n > 0 AND abs(x.items - pr.total_amount) > 0.05)
       OR (COALESCE(pr.refund_cash_amount,0) + COALESCE(pr.refund_transfer_amount,0) + COALESCE(pr.refund_balance_amount,0) > 0.005
           AND abs(COALESCE(pr.refund_cash_amount,0) + COALESCE(pr.refund_transfer_amount,0) + COALESCE(pr.refund_balance_amount,0) - pr.total_amount) > 0.05))
  UNION ALL
  -- ===================== treasury =====================
  -- T1 an active voucher and its till row disagree (amount, branch, direction) or the till row is missing
  SELECT 'T1', 'error', 'treasury', 'سند والخزنة مش متطابقين',
         CASE WHEN t.id IS NULL THEN 'السند ملوش حركة خزنة' ELSE 'السند ' || v.amount || ' / الخزنة ' || t.amount END,
         v.party_id, v.party_name, v.branch_id, b.name, 'voucher', v.id, v.voucher_number, v.amount
    FROM vouchers v
    JOIN branches b ON b.id = v.branch_id
    LEFT JOIN treasury t ON t.id = v.treasury_id
   WHERE v.tenant_id = v_t AND v.status::text = 'active' AND v.amount > 0
     AND (v.treasury_id IS NULL AND COALESCE(v.payment_method, 'cash') NOT IN ('credit_balance', 'balance')
          OR (t.id IS NOT NULL AND (abs(t.amount - v.amount) > 0.005 OR t.branch_id <> v.branch_id
              OR (t.type::text = 'income') <> (v.type::text = 'receipt'))))
  UNION ALL
  -- T2 a cancelled voucher whose till row was not reversed
  SELECT 'T2', 'error', 'treasury', 'سند ملغي وحركته لسه في الخزنة',
         'السند اتلغى ومفيش حركة عكسية ليه في الخزنة',
         v.party_id, v.party_name, v.branch_id, b.name, 'voucher', v.id, v.voucher_number, v.amount
    FROM vouchers v
    JOIN branches b ON b.id = v.branch_id
   WHERE v.tenant_id = v_t AND v.status::text = 'cancelled' AND v.treasury_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM treasury t WHERE t.id = v.treasury_id)
     AND NOT EXISTS (SELECT 1 FROM treasury x WHERE x.tenant_id = v_t AND x.reference_id = v.id AND x.id <> v.treasury_id)
     AND NOT EXISTS (SELECT 1 FROM treasury x WHERE x.tenant_id = v_t AND x.category = 'إلغاء سند' AND x.reference_id IN (v.id, v.treasury_id))
  UNION ALL
  -- T3 till (treasury rows) and the general ledger cash accounts (11xx) disagree for a branch
  SELECT 'T3', 'info', 'treasury', 'رصيد خزنة الفرع مختلف عن حسابات النقدية للفرع في القيود',
         'الخزنة ' || round(t.bal, 2) || ' / القيود (11xx) ' || round(COALESCE(g.bal, 0), 2)
           || ' — غالباً فلوس اتحصلت في فرع على فاتورة فرع تاني؛ بيتظبط مع قيود الحساب الجاري 1910 (المرحلة 5)',
         NULL, NULL, t.branch_id, b.name, NULL, NULL, NULL, round(t.bal - COALESCE(g.bal, 0), 2)
    FROM (SELECT tr.branch_id, sum(CASE WHEN tr.type::text = 'income' THEN tr.amount ELSE -tr.amount END) AS bal
            FROM treasury tr WHERE tr.tenant_id = v_t GROUP BY 1) t
    JOIN branches b ON b.id = t.branch_id
    LEFT JOIN (SELECT e.branch_id, sum(l.debit - l.credit) AS bal
                 FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
                 JOIN chart_of_accounts a ON a.id = l.account_id AND a.code LIKE '11%'
                WHERE e.tenant_id = v_t AND e.status = 'posted' GROUP BY 1) g ON g.branch_id = t.branch_id
   WHERE abs(t.bal - COALESCE(g.bal, 0)) > 0.05
  UNION ALL
  -- T3C the company as a whole: every till vs every cash account
  SELECT 'T3C', 'warning', 'treasury', 'إجمالي الخزائن مختلف عن إجمالي حسابات النقدية في القيود',
         'الخزائن ' || round(t.bal, 2) || ' / القيود (11xx) ' || round(COALESCE(g.bal, 0), 2),
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, round(t.bal - COALESCE(g.bal, 0), 2)
    FROM (SELECT sum(CASE WHEN tr.type::text = 'income' THEN tr.amount ELSE -tr.amount END) AS bal
            FROM treasury tr WHERE tr.tenant_id = v_t) t
    CROSS JOIN (SELECT sum(l.debit - l.credit) AS bal
                  FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
                  JOIN chart_of_accounts a ON a.id = l.account_id AND a.code LIKE '11%'
                 WHERE e.tenant_id = v_t AND e.status = 'posted') g
   WHERE abs(COALESCE(t.bal, 0) - COALESCE(g.bal, 0)) > 0.05
  UNION ALL
  -- T4 inter-branch cash transfers still open after 3 days, or accepted but never credited
  SELECT 'T4', CASE WHEN tt.acknowledged_at IS NOT NULL THEN 'error' ELSE 'warning' END, 'treasury',
         CASE WHEN tt.acknowledged_at IS NOT NULL THEN 'تحويل خزنة متأكد ومش متضاف للفرع المستلم' ELSE 'تحويل خزنة معلق' END,
         'من ' || bf.name || ' إلى ' || bt.name || ' بتاريخ ' || public.ledger_day(tt.created_at),
         NULL, NULL, tt.from_branch_id, bf.name, 'treasury_transfer', tt.id, tt.reference_number, tt.amount
    FROM treasury_transfers tt
    JOIN branches bf ON bf.id = tt.from_branch_id
    JOIN branches bt ON bt.id = tt.to_branch_id
   WHERE tt.tenant_id = v_t AND tt.rejected_at IS NULL
     AND ((tt.acknowledged_at IS NULL AND tt.created_at < now() - interval '3 days')
       OR (tt.acknowledged_at IS NOT NULL AND tt.dest_credited_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM treasury x WHERE x.reference_id = tt.id AND x.branch_id = tt.to_branch_id AND x.type::text = 'income')))
  UNION ALL
  -- ===================== stock =====================
  -- S1 product quantity vs its open batches (FIFO cost layers)
  SELECT 'S1', 'warning', 'stock', 'كمية الصنف مختلفة عن مجموع دفعاته',
         p.name || ': الكمية ' || p.quantity || ' / الدفعات ' || x.rem,
         NULL, NULL, p.branch_id, b.name, 'product', p.id, p.sku, round(p.quantity - x.rem, 2)
    FROM products p
    JOIN branches b ON b.id = p.branch_id
    JOIN LATERAL (SELECT COALESCE(sum(pb.quantity_remaining), 0) AS rem, count(*) AS n FROM product_batches pb WHERE pb.product_id = p.id) x ON x.n > 0
   WHERE p.tenant_id = v_t AND p.archived_at IS NULL AND abs(p.quantity - x.rem) > 0.005
  UNION ALL
  -- S2 negative stock
  SELECT 'S2', 'error', 'stock', 'رصيد صنف بالسالب', p.name || ': ' || p.quantity,
         NULL, NULL, p.branch_id, b.name, 'product', p.id, p.sku, p.quantity
    FROM products p JOIN branches b ON b.id = p.branch_id
   WHERE p.tenant_id = v_t AND p.quantity < 0
  UNION ALL
  -- S3 stock movement log vs the product quantity (last balance_after)
  SELECT 'S3', 'warning', 'stock', 'سجل حركة الصنف مختلف عن رصيده',
         p.name || ': آخر رصيد في السجل ' || x.bal || ' / الرصيد الحالي ' || p.quantity,
         NULL, NULL, p.branch_id, b.name, 'product', p.id, p.sku, p.quantity - x.bal
    FROM products p
    JOIN branches b ON b.id = p.branch_id
    JOIN LATERAL (SELECT sm.balance_after AS bal FROM stock_movements sm WHERE sm.product_id = p.id
                   ORDER BY sm.created_at DESC, sm.id DESC LIMIT 1) x ON true
   WHERE p.tenant_id = v_t AND p.archived_at IS NULL AND x.bal IS NOT NULL AND x.bal <> p.quantity
  UNION ALL
  -- S4 stock transfers: received more than sent, or pending for more than 3 days
  SELECT 'S4', CASE WHEN COALESCE(st.received_quantity, 0) > st.quantity THEN 'error' ELSE 'warning' END, 'stock',
         CASE WHEN COALESCE(st.received_quantity, 0) > st.quantity THEN 'تحويل مخزني: المستلم أكبر من المرسل' ELSE 'تحويل مخزني معلق' END,
         'من ' || bf.name || ' إلى ' || bt.name || ' — مرسل ' || st.quantity || ' / مستلم ' || COALESCE(st.received_quantity::text, '—'),
         NULL, NULL, st.from_branch_id, bf.name, 'stock_transfer', st.id, NULL, st.quantity
    FROM stock_transfers st
    JOIN branches bf ON bf.id = st.from_branch_id
    JOIN branches bt ON bt.id = st.to_branch_id
   WHERE st.tenant_id = v_t
     AND (COALESCE(st.received_quantity, 0) > st.quantity
       OR (st.status::text = 'pending' AND st.created_at < now() - interval '3 days'))
  UNION ALL
  -- S5 a cancelled purchase invoice whose batches still hold stock
  SELECT 'S5', 'error', 'stock', 'فاتورة شراء ملغاة ودفعاتها لسه في المخزن',
         'متبقي في الدفعات ' || x.rem,
         s.contact_id, c.name, s.branch_id, b.name, 'shipment', s.id, s.shipment_number, x.rem
    FROM shipments s
    JOIN branches b ON b.id = s.branch_id
    LEFT JOIN contacts c ON c.id = s.contact_id
    JOIN LATERAL (SELECT COALESCE(sum(pb.quantity_remaining), 0) AS rem FROM product_batches pb WHERE pb.shipment_id = s.id) x ON x.rem > 0
   WHERE s.tenant_id = v_t AND s.status = 'cancelled'
  UNION ALL
  -- ===================== journal =====================
  -- J1 an active document without its journal entry
  SELECT 'J1', 'warning', 'journal', 'مستند من غير قيد يومية', 'مفيش قيد مرحّل للمستند',
         x.contact_id, c.name, x.branch_id, b.name, x.t, x.id, x.num, x.amt
    FROM (SELECT i.contact_id, i.branch_id, 'invoice'::text AS t, i.id, i.invoice_number AS num, i.total AS amt, 'invoice'::text AS st
            FROM invoices i WHERE i.tenant_id = v_t AND i.status = 'active' AND i.total > 0 AND NOT COALESCE(i.is_migrated, false)
          UNION ALL
          SELECT s.contact_id, s.branch_id, 'shipment', s.id, s.shipment_number, s.total_cost, 'shipment'
            FROM shipments s WHERE s.tenant_id = v_t AND s.status = 'active' AND s.total_cost > 0 AND NOT COALESCE(s.is_migrated, false)) x
    JOIN branches b ON b.id = x.branch_id
    LEFT JOIN contacts c ON c.id = x.contact_id
   WHERE NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.tenant_id = v_t AND e.source_type = x.st AND e.source_id = x.id AND e.status = 'posted')
  UNION ALL
  -- J2 a cancelled document whose journal entry is still standing (not reversed)
  SELECT 'J2', 'error', 'journal', 'مستند ملغي وقيده لسه قايم', 'القيد ما اتعكسش بعد الإلغاء',
         x.contact_id, c.name, x.branch_id, b.name, x.t, x.id, x.num, x.amt
    FROM (SELECT i.contact_id, i.branch_id, 'invoice'::text AS t, i.id, i.invoice_number AS num, i.total AS amt, 'invoice'::text AS st
            FROM invoices i WHERE i.tenant_id = v_t AND i.status = 'cancelled'
          UNION ALL
          SELECT s.contact_id, s.branch_id, 'shipment', s.id, s.shipment_number, s.total_cost, 'shipment'
            FROM shipments s WHERE s.tenant_id = v_t AND s.status = 'cancelled'
          UNION ALL
          SELECT v.party_id, v.branch_id, 'voucher', v.id, v.voucher_number, v.amount, 'voucher'
            FROM vouchers v WHERE v.tenant_id = v_t AND v.status::text = 'cancelled') x
    JOIN branches b ON b.id = x.branch_id
    LEFT JOIN contacts c ON c.id = x.contact_id
   WHERE EXISTS (SELECT 1 FROM journal_entries e WHERE e.tenant_id = v_t AND e.source_type = x.st AND e.source_id = x.id
                    AND e.status = 'posted' AND e.reversed_by IS NULL)
     AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.tenant_id = v_t AND e.source_type = x.st || '_reversal' AND e.source_id = x.id
                    AND e.status = 'posted');
END
$fn$;

CREATE OR REPLACE FUNCTION public.system_integrity_audit_json(p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.severity, a.check_code), '[]'::jsonb) FROM public.system_integrity_audit(p_tenant) a
$$;

CREATE OR REPLACE FUNCTION public.system_integrity_summary(p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'checked_at', now(),
    'errors', count(*) FILTER (WHERE severity = 'error'),
    'warnings', count(*) FILTER (WHERE severity = 'warning'),
    'info', count(*) FILTER (WHERE severity = 'info'),
    'by_check', COALESCE((SELECT jsonb_object_agg(k, n) FROM (
        SELECT a.check_code AS k, count(*) AS n FROM public.system_integrity_audit(p_tenant) a GROUP BY 1) z), '{}'::jsonb))
  FROM public.system_integrity_audit(p_tenant)
$$;

-- =============================================================================================
-- Access and allow-list
-- =============================================================================================
REVOKE ALL ON FUNCTION public.ledger_opening_branch(uuid, uuid)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_opening_branch_is_fallback(uuid, uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_opening_entry(uuid, text)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.opening_entry_section(uuid)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_can_see_side(text)                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_read_scope(uuid, text)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_contact_tenant_check(uuid, uuid)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_debt_rows(uuid, uuid)                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_credit_rows(uuid, uuid)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_overdue_rows(uuid, uuid, uuid)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_side_balances(uuid, uuid, uuid)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_movement_ref(text, uuid)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_integrity_summary(uuid)                       FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.post_opening_balances(date, jsonb, jsonb, jsonb),
  public.opening_balances_summary(),
  public.contact_side_balances(uuid[], uuid),
  public.contacts_page(uuid, text, text, text[], integer, integer),
  public.ledger_contact_documents(uuid, text, uuid),
  public.ledger_contact_money(uuid, text, uuid),
  public.ledger_contact_statement(uuid, text, uuid, date, date),
  public.ledger_contact_overview(uuid, uuid),
  public.ledger_document_status(text, uuid[]),
  public.ledger_position(uuid),
  public.ledger_aging(text, uuid),
  public.get_branch_wallet_balances(uuid),
  public.system_integrity_audit(uuid),
  public.system_integrity_audit_json(uuid),
  public.system_integrity_summary(uuid)
TO authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.post_opening_balances(date, jsonb, jsonb, jsonb),
  public.opening_balances_summary(),
  public.contact_side_balances(uuid[], uuid),
  public.contacts_page(uuid, text, text, text[], integer, integer),
  public.ledger_contact_documents(uuid, text, uuid),
  public.ledger_contact_money(uuid, text, uuid),
  public.ledger_contact_statement(uuid, text, uuid, date, date),
  public.ledger_contact_overview(uuid, uuid),
  public.ledger_document_status(text, uuid[]),
  public.ledger_position(uuid),
  public.ledger_aging(text, uuid),
  public.get_branch_wallet_balances(uuid),
  public.system_integrity_audit(uuid),
  public.system_integrity_audit_json(uuid)
FROM PUBLIC, anon;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('post_opening_balances',     '0056', 'owner/admin; cancel-only re-post (reversals), per-side accounts, till row for opening cash'),
  ('opening_balances_summary',  '0056', 'read-only; company admins'),
  ('contact_side_balances',     '0056', 'read-only; customer/supplier sides separate; side permission and branch membership'),
  ('contacts_page',             '0056', 'read-only; ledger side balances; all-branches view for admins'),
  ('ledger_contact_documents',  '0056', 'read-only contact file; side permission and branch membership; all branches for admins'),
  ('ledger_contact_money',      '0056', 'read-only contact file; side permission and branch membership'),
  ('ledger_contact_statement',  '0056', 'read-only contact statement per side; side permission and branch membership'),
  ('ledger_contact_overview',   '0056', 'read-only contact file cards; hidden side = null'),
  ('ledger_document_status',    '0056', 'read-only paid/remaining of listed documents; tenant and branch membership'),
  ('ledger_position',           '0056', 'read-only company/branch receivables, payables and advances'),
  ('ledger_aging',              '0056', 'read-only aging of open documents per side; all-branches view for admins'),
  ('get_branch_wallet_balances','0056', 'read-only till balance; branch membership (assert_access)'),
  ('system_integrity_audit',    '0056', 'read-only integrity checks; company admins and super admin'),
  ('system_integrity_summary',  '0056', 'read-only integrity counts; company admins and super admin'),
  ('system_integrity_audit_json','0056', 'read-only integrity checks as one json value; company admins and super admin')
ON CONFLICT (function_name) DO UPDATE SET added_in = EXCLUDED.added_in, note = EXCLUDED.note;

-- contact_branch_balances / doc_ledger_allocation / invoice_outstanding_debt leave the allow-list (no browser access)
DELETE FROM public.security_rpc_allowlist
 WHERE function_name IN ('contact_branch_balances', 'doc_ledger_allocation', 'invoice_outstanding_debt', 'supplier_outstanding_payable');

-- =============================================================================================
-- Re-sync the ledger (opening movements move to the main treasury) and final checks
-- =============================================================================================
DO $bf$
DECLARE v jsonb;
BEGIN
  v := public.ledger_backfill(NULL);
  RAISE NOTICE 'Step 6C re-sync: %', v;
  RAISE NOTICE 'Step 6C reconciliation: %', public.ledger_reconciliation_summary(NULL);
END
$bf$;

DO $check$
DECLARE v_list text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Step 6C: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
END
$check$;