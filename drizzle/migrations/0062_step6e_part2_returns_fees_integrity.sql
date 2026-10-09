-- Step 6E (0058) part 2: purchase return refresh, transfer fees taken twice (detect / cancel-only repair), cancel_voucher fix, E1/L7/F1 checks.
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.allocate_purchase_return_settlement()'::regprocedure);
  v_new := replace(v_def,
$a$  IF NEW.contact_id IS NOT NULL THEN
    v_debt := public.supplier_outstanding_payable(NEW.contact_id);
  END IF;$a$,
$b$  IF NEW.contact_id IS NOT NULL THEN
    PERFORM public.ledger_refresh_contact(NEW.contact_id);
    v_debt := public.supplier_outstanding_payable(NEW.contact_id);   -- (trigger runs BEFORE INSERT only)
  END IF;$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6E: allocate_purchase_return_settlement patch did not apply'; END IF;
  EXECUTE v_new;
END
$patch$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.edit_invoice_payment(uuid,numeric,text,text,text,text,numeric,boolean,text,text)'::regprocedure);
  v_new := replace(v_def,
$a$  IF v_fee_delta <> 0 AND NOT v_new_fee_on_cust THEN
    INSERT INTO public.expenses($a$,
$b$  IF v_fee_delta > 0 AND NOT v_new_fee_on_cust THEN
    PERFORM set_config('app.skip_expense_till', '1', true);   -- Step 6E: one till row for the fee (below)
    INSERT INTO public.expenses($b$);
  v_new := replace(v_new,
$a$      true, v_uid, v_pay.tenant_id
    );
    IF v_fee_delta > 0 THEN
      INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, created_by, tenant_id)
      VALUES (v_pay.branch_id, 'expense', 'fee_edit', v_fee_delta,
              'زيادة عمولة ' || p_payment_method, p_payment_method, v_uid, v_pay.tenant_id);
    ELSE
      INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, created_by, tenant_id)
      VALUES (v_pay.branch_id, 'income', 'fee_edit', -v_fee_delta,
              'خصم عمولة ' || p_payment_method, p_payment_method, v_uid, v_pay.tenant_id);
    END IF;
  END IF;$a$,
$b$      true, v_uid, v_pay.tenant_id
    );
    PERFORM set_config('app.skip_expense_till', '', true);
    INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id)
    VALUES (v_pay.branch_id, 'expense', 'fee_edit', v_fee_delta,
            'زيادة عمولة ' || p_payment_method, p_payment_method, true, v_uid, v_pay.tenant_id);
  ELSIF v_fee_delta < 0 AND NOT v_new_fee_on_cust THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id)
    VALUES (v_pay.branch_id, 'income', 'fee_edit', -v_fee_delta,
            'خصم عمولة ' || p_payment_method, p_payment_method, true, v_uid, v_pay.tenant_id);
  END IF;$b$);
  IF v_new = v_def OR position('ELSIF v_fee_delta < 0 AND NOT v_new_fee_on_cust' IN v_new) = 0
     OR position('IF v_fee_delta > 0 AND NOT v_new_fee_on_cust' IN v_new) = 0 THEN
    RAISE EXCEPTION 'Step 6E: edit_invoice_payment fee block not found';
  END IF;
  EXECUTE v_new;
END
$patch$;

CREATE INDEX IF NOT EXISTS treasury_fee_rows_idx ON public.treasury (branch_id, created_at, amount)
  WHERE category IN ('fee', 'fee_edit') AND type = 'expense';
CREATE INDEX IF NOT EXISTS expenses_fee_idx ON public.expenses (tenant_id, created_at) WHERE is_fee;

DROP FUNCTION IF EXISTS public.duplicate_fee_till_rows(uuid);
CREATE OR REPLACE FUNCTION public.duplicate_fee_till_rows(p_tenant uuid DEFAULT NULL)
RETURNS TABLE (treasury_id uuid, voucher_id uuid, voucher_number text, branch_id uuid, branch_name text,
               amount numeric, payment_method text, fee_date date, expense_id uuid, kept_treasury_id uuid,
               description text, already_corrected boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_t uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    v_t := p_tenant;
  ELSE
    v_t := public.assert_company_access(NULL);
    IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
      RAISE EXCEPTION 'للإدارة فقط' USING ERRCODE = '42501';
    END IF;
    IF p_tenant IS NOT NULL AND public.is_super_admin(auth.uid()) THEN v_t := p_tenant; END IF;
  END IF;
  RETURN QUERY
  WITH te AS (
    SELECT t.id, t.branch_id, t.amount, t.created_at, t.payment_method, t.transaction_date, e.id AS expense_id, e.description,
           row_number() OVER (PARTITION BY t.branch_id, t.amount, t.created_at ORDER BY t.id) AS rn
      FROM expenses e
      JOIN treasury t ON t.reference_id = e.id AND t.type::text = 'expense' AND t.amount = e.amount AND t.branch_id = e.branch_id
     WHERE e.tenant_id = v_t AND e.is_fee AND e.amount > 0
       AND COALESCE(t.category, '') NOT IN ('fee', 'fee_edit')
  ),
  f AS (
    SELECT f.id, f.branch_id, f.amount, f.created_at,
           row_number() OVER (PARTITION BY f.branch_id, f.amount, f.created_at ORDER BY f.id) AS rn
      FROM treasury f
     WHERE f.category IN ('fee', 'fee_edit') AND f.type::text = 'expense'
       AND (f.branch_id, f.created_at, f.amount) IN (SELECT te.branch_id, te.created_at, te.amount FROM te)
       AND NOT EXISTS (SELECT 1 FROM vouchers fv WHERE fv.treasury_id = f.id AND fv.status::text <> 'active')
  )
  SELECT te.id, v.id, v.voucher_number, te.branch_id, b.name, te.amount, te.payment_method,
         COALESCE(te.transaction_date, public.ledger_day(te.created_at)), te.expense_id, f.id, te.description,
         (v.status::text = 'cancelled')
    FROM te
    JOIN f ON f.branch_id = te.branch_id AND f.amount = te.amount AND f.created_at = te.created_at AND f.rn = te.rn
    JOIN branches b ON b.id = te.branch_id
    LEFT JOIN vouchers v ON v.treasury_id = te.id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.repair_duplicate_fee_till_rows(p_apply boolean DEFAULT false, p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE r record; v_t uuid; v_uid uuid := auth.uid(); v_n int := 0; v_sum numeric := 0; v_skipped int := 0; v_closed int := 0;
        v_list jsonb := '[]'::jsonb; v_claimed uuid; v_by uuid;
BEGIN
  IF v_uid IS NULL THEN
    v_t := p_tenant;
  ELSE
    v_t := public.assert_company_access(NULL);
    IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN RAISE EXCEPTION 'للإدارة فقط' USING ERRCODE = '42501'; END IF;
    IF p_tenant IS NOT NULL AND public.is_super_admin(v_uid) THEN v_t := p_tenant; END IF;
  END IF;
  IF v_t IS NULL THEN RAISE EXCEPTION 'حدد الشركة'; END IF;
  IF p_apply THEN PERFORM pg_advisory_xact_lock(hashtextextended('repair_fee:' || v_t::text, 0)); END IF;
  v_by := COALESCE(v_uid, (SELECT ur.user_id FROM user_roles ur WHERE ur.tenant_id = v_t AND ur.role::text IN ('owner', 'admin') ORDER BY ur.role::text DESC LIMIT 1));

  FOR r IN SELECT * FROM public.duplicate_fee_till_rows(v_t) d WHERE NOT COALESCE(d.already_corrected, false) ORDER BY d.fee_date, d.treasury_id LOOP
    IF r.voucher_id IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    IF public.ledger_period_closed(v_t, r.fee_date) THEN v_closed := v_closed + 1; CONTINUE; END IF;
    v_list := v_list || jsonb_build_object('voucher', r.voucher_number, 'branch', r.branch_name, 'amount', r.amount, 'date', r.fee_date);
    IF NOT p_apply THEN v_n := v_n + 1; v_sum := v_sum + r.amount; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM vouchers fv WHERE fv.treasury_id = r.kept_treasury_id AND fv.status::text <> 'active') THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;
    UPDATE vouchers SET status = 'cancelled', cancelled_by = v_by, cancelled_at = now(),
                        cancel_reason = 'عمولة تحويل مكررة (اتخصمت مرتين من الخزنة) — تصحيح Step 6E'
     WHERE id = r.voucher_id AND status::text = 'active'
    RETURNING id INTO v_claimed;
    IF v_claimed IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    PERFORM set_config('app.skip_treasury_voucher', '1', true);
    PERFORM set_config('app.voucher_cancel_reversal', '1', true);
    INSERT INTO treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by, payment_method,
                          reference_number, is_fee)
    VALUES (r.branch_id, v_t, 'income'::treasury_type, 'إلغاء سند', r.amount,
            'تصحيح عمولة اتخصمت مرتين — ' || COALESCE(r.voucher_number, ''), r.voucher_id, v_by,
            r.payment_method, r.voucher_number, true);
    PERFORM set_config('app.voucher_cancel_reversal', '0', true);
    PERFORM set_config('app.skip_treasury_voucher', '0', true);
    INSERT INTO audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
    VALUES (v_by, COALESCE((SELECT name FROM profiles WHERE id = v_uid), 'system'), v_t, r.branch_id, 'CANCEL', 'voucher', r.voucher_id::text,
            jsonb_build_object('reason', 'duplicate transfer fee', 'amount', r.amount, 'expense_id', r.expense_id,
                               'kept_treasury_id', r.kept_treasury_id, 'step', '6E'));
    v_n := v_n + 1; v_sum := v_sum + r.amount;
    v_claimed := NULL;
  END LOOP;
  RETURN jsonb_build_object('applied', p_apply, 'count', v_n, 'amount', round(v_sum, 2), 'skipped_without_voucher_or_taken', v_skipped,
                            'skipped_closed_period', v_closed, 'rows', v_list);
END
$fn$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.cancel_voucher(uuid,text)'::regprocedure);
  v_new := replace(v_def,
$a$  PERFORM public.assert_access((SELECT v.branch_id FROM public.vouchers v WHERE v.id = p_voucher_id),
      (SELECT CASE WHEN v.type = 'receipt' THEN 'receipt_vouchers.delete' ELSE 'payment_vouchers.delete' END
         FROM public.vouchers v WHERE v.id = p_voucher_id));$a$,
$b$  PERFORM public.assert_access((SELECT gv.branch_id FROM public.vouchers gv WHERE gv.id = p_voucher_id),
      (SELECT CASE WHEN gv.type = 'receipt' THEN 'receipt_vouchers.delete' ELSE 'payment_vouchers.delete' END
         FROM public.vouchers gv WHERE gv.id = p_voucher_id));$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6E: cancel_voucher guard not found'; END IF;
  EXECUTE v_new;
END
$patch$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.system_integrity_audit_gl(uuid)'::regprocedure);
  v_new := replace(v_def,
$a$  IF (r->'not_posted'->>'closed_period_skipped')::int > 0 THEN$a$,
$b$  IF EXISTS (SELECT 1 FROM ledger_sync_errors s WHERE s.tenant_id = p_tenant AND s.created_at > now() - interval '7 days') THEN
    check_code := 'E1'; severity := 'warning'; area := 'ledger'; title := 'أخطاء في مزامنة الدفتر الموحد (آخر 7 أيام)';
    details := (SELECT count(*) || ' خطأ على ' || count(DISTINCT COALESCE(s.contact_id, s.invoice_id)) || ' جهة/فاتورة'
                  FROM ledger_sync_errors s WHERE s.tenant_id = p_tenant AND s.created_at > now() - interval '7 days')
               || ' — آخر واحد: '
               || COALESCE((SELECT left(s.error, 200) FROM ledger_sync_errors s WHERE s.tenant_id = p_tenant ORDER BY s.created_at DESC LIMIT 1), '')
               || ' — أي تعديل على الجهة أو «إعادة مزامنة» بيصلّحها';
    amount := NULL;
    contact_id := NULL; contact_name := NULL; branch_id := NULL; branch_name := NULL; doc_type := NULL; doc_id := NULL; doc_number := NULL;
    RETURN NEXT;
  END IF;
  FOR r2 IN
    SELECT 'invoice' AS t, i.id, i.invoice_number AS num, i.contact_id, i.branch_id, i.total AS amt, public.ledger_day(i.invoice_date) AS d
      FROM invoices i
     WHERE i.tenant_id = p_tenant AND i.status <> 'cancelled' AND public.ledger_day(i.invoice_date) < public.ledger_cutoff()
       AND NOT public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
    UNION ALL
    SELECT 'shipment', s.id, s.shipment_number, s.contact_id, s.branch_id, s.total_cost, public.ledger_day(COALESCE(s.invoice_date::timestamptz, s.created_at))
      FROM shipments s
     WHERE s.tenant_id = p_tenant AND s.status <> 'cancelled'
       AND public.ledger_day(COALESCE(s.invoice_date::timestamptz, s.created_at)) < public.ledger_cutoff()
       AND NOT public.ledger_invoice_is_archive(COALESCE(s.invoice_date::timestamptz, s.created_at), s.created_at, s.is_migrated, s.migration_batch_id)
     ORDER BY 7 LIMIT 200
  LOOP
    check_code := 'L7'; severity := 'warning'; area := 'ledger'; title := 'مستند بتاريخ قبل 2026 اتسجل بعد بداية الدفتر';
    details := 'تاريخه ' || r2.d || ' — مش داخل الرصيد الافتتاحي ولا الدفتر الموحد: عدّل تاريخه لـ 2026 أو ضيف قيمته للرصيد الافتتاحي';
    amount := round(r2.amt, 2);
    contact_id := r2.contact_id; contact_name := (SELECT c.name FROM contacts c WHERE c.id = r2.contact_id);
    branch_id := r2.branch_id; branch_name := (SELECT b.name FROM branches b WHERE b.id = r2.branch_id);
    doc_type := r2.t; doc_id := r2.id; doc_number := r2.num;
    RETURN NEXT;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.duplicate_fee_till_rows(p_tenant) d WHERE NOT d.already_corrected) THEN
    check_code := 'F1'; severity := 'warning'; area := 'treasury'; title := 'عمولات تحويل اتخصمت مرتين من الخزنة';
    details := (SELECT count(*) || ' عمولة بإجمالي ' || round(sum(d.amount), 2) FROM public.duplicate_fee_till_rows(p_tenant) d WHERE NOT d.already_corrected)
               || ' — صحّحها من «مطابقة القيود» (إلغاء السند المكرر، من غير حذف)';
    amount := (SELECT round(sum(d.amount), 2) FROM public.duplicate_fee_till_rows(p_tenant) d WHERE NOT d.already_corrected);
    contact_id := NULL; contact_name := NULL; branch_id := NULL; branch_name := NULL; doc_type := NULL; doc_id := NULL; doc_number := NULL;
    RETURN NEXT;
  END IF;
  IF (r->'not_posted'->>'closed_period_skipped')::int > 0 THEN$b$);
  v_new := replace(v_new, $a$DECLARE r jsonb;$a$, $b$DECLARE r jsonb; r2 record;$b$);
  v_new := replace(v_new, $a$— رحّل الأرصدة الافتتاحية من شاشتها (بيتعمل قيد عكسي للقديم ومفيش حذف)$a$,
                          $b$— «طابق القيود مع الدفتر» من شاشة الأرصدة الافتتاحية (قيد بالفرق بس، ومفيش حذف)$b$);
  IF v_new = v_def OR position('r2 record' IN v_new) = 0 OR position('''F1''' IN v_new) = 0 THEN
    RAISE EXCEPTION 'Step 6E: system_integrity_audit_gl patch did not apply';
  END IF;
  EXECUTE v_new;
END
$patch$;