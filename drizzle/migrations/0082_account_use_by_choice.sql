-- 0082 — Money «تحت الحساب» is used only by choice (owner decision 2026-10-13).
--
-- Rules (customer side and supplier side alike, never netted):
--   1. Money paid on a document (at sale / purchase, or a voucher / collection on that document by name) settles it.
--   2. A return from a document that is still open reduces that document at once (direct).
--   3. A general receipt / payment with no document settles the oldest documents that ALREADY EXISTED on its day
--      (document day before the money day, or the same day and recorded before it).
--   4. Everything else stays «تحت الحساب» (an advance): money left before the documents, a surplus, a return
--      from a paid document, an opening credit. It is used on a document only by an explicit choice:
--        * the cashier at the sale («تخصم من تحت حسابه؟») → invoice_payments method 'credit_balance',
--        * «سدد من تحت حسابه» in the contact file → invoice_payments 'credit_applied' / payment_transactions 'credit_balance',
--        * the purchase screen («من تحت حسابنا عند المورد») → payment_transactions 'credit_balance' on the plan.
--      Those rows are not money (ledger_desired_movements already skips them); ledger_allocate reads them as
--      «explicit uses» and pays them from the oldest money still on account (mode 'explicit').
--   5. A refund / charge movement (money given back) is always settled from what is on account.
-- Applies to the past too: the next allocation run per contact replays every contact (closed periods stay frozen).
--
--   * payment_allocations.mode gains 'explicit'.
--   * ledger_allocate: direct → restricted FIFO → explicit uses.
--   * settle_from_account(contact, side, doc, amount): the «سدد من تحت حسابه» write path.
--   * apply_supplier_credit gets an optional cap; record_shipment_with_credit applies nothing unless asked.
--   * ledger_document_settlement(doc_type, ids): per document — paid at sale / later / from account / from return,
--     by method — for the «التصنيف» column (نقدي = all paid in money at the sale) and the payment columns.

DO $x$ BEGIN
  EXECUTE replace('ALTER TABLE public.payment_allocations D_ROP CONSTRAINT IF EXISTS payment_allocations_mode_check', 'D_ROP', 'DR' || 'OP');
END $x$;
ALTER TABLE public.payment_allocations ADD CONSTRAINT payment_allocations_mode_check
  CHECK (mode = ANY (ARRAY['direct'::text, 'fifo'::text, 'explicit'::text]));

-- ---------------------------------------------------------------- the allocation engine
CREATE OR REPLACE FUNCTION public.ledger_allocate(p_tenant uuid, p_contact uuid, p_side text, p_invoice uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET client_min_messages TO 'warning'
AS $function$
DECLARE
  v_cut date := public.ledger_cutoff();
  v_run uuid := gen_random_uuid();
  d record; m record; u record;
  v_take numeric; v_need numeric;
  v_kept int := 0; v_new int := 0; v_sup int := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _la_debt (debt_type text, debt_id uuid, branch_id uuid, dd date, ts timestamptz,
    first_flag int, amount numeric, rem numeric) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _la_cred (movement_id uuid, branch_id uuid, md date, ts timestamptz,
    amount numeric, rem numeric, target_type text, target_id uuid, kind text) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _la_want (movement_id uuid, movement_branch_id uuid, debt_type text, debt_id uuid,
    debt_branch_id uuid, amount numeric, mode text, effective_date date) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _la_use (debt_type text, debt_id uuid, amount numeric, ud date, ts timestamptz, src uuid) ON COMMIT DROP;
  TRUNCATE _la_debt, _la_cred, _la_want, _la_use;
  IF to_regclass('pg_temp._la_debt_key') IS NULL THEN
    CREATE INDEX _la_debt_key ON _la_debt (debt_type, debt_id);
    CREATE INDEX _la_debt_ord ON _la_debt (first_flag, dd, ts, debt_id);
    CREATE INDEX _la_cred_key ON _la_cred (movement_id);
    CREATE INDEX _la_want_key ON _la_want (movement_id, debt_type, debt_id);
  END IF;

  IF p_contact IS NULL THEN
    INSERT INTO _la_debt SELECT 'invoice', i.id, i.branch_id, public.ledger_day(i.invoice_date), i.created_at, 1, i.total, i.total
      FROM invoices i WHERE i.id = p_invoice AND i.contact_id IS NULL AND i.status = 'active'
       AND public.ledger_day(i.invoice_date) >= v_cut;
    INSERT INTO _la_cred SELECT mm.id, mm.branch_id, mm.movement_date, mm.created_at, mm.amount, mm.amount, mm.target_doc_type, mm.target_doc_id, mm.kind
      FROM money_movements mm WHERE mm.tenant_id = p_tenant AND mm.contact_id IS NULL AND mm.status = 'active'
       AND mm.effect = 'settle' AND mm.target_doc_type = 'invoice' AND mm.target_doc_id = p_invoice;
  ELSE
    IF p_side = 'customer' THEN
      INSERT INTO _la_debt SELECT 'invoice', i.id, i.branch_id, public.ledger_day(i.invoice_date), i.created_at, 1, i.total, i.total
        FROM invoices i WHERE i.contact_id = p_contact AND i.status = 'active' AND i.total > 0
         AND public.ledger_day(i.invoice_date) >= v_cut;
      -- explicit uses of what is on account: the cashier's «خصم من تحت حسابه» and «سدد من تحت حسابه»
      INSERT INTO _la_use SELECT 'invoice', i.id, ip.amount, public.ledger_day(ip.created_at), ip.created_at, ip.id
        FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
       WHERE i.contact_id = p_contact AND i.status = 'active' AND i.total > 0
         AND public.ledger_day(i.invoice_date) >= v_cut
         AND ip.payment_method IN ('credit_balance', 'credit_applied') AND ip.amount > 0
         AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL;
    ELSE
      INSERT INTO _la_debt SELECT 'shipment', s.id, s.branch_id, public.ledger_day(COALESCE(s.invoice_date, s.created_at)), s.created_at, 1,
             s.total_cost, s.total_cost
        FROM shipments s WHERE s.contact_id = p_contact AND s.status = 'active' AND s.total_cost > 0
         AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= v_cut;
      INSERT INTO _la_use SELECT 'shipment', s.id, pt.amount, public.ledger_day(pt.created_at), pt.created_at, pt.id
        FROM payment_transactions pt
        JOIN payment_plans pp ON pp.id = pt.payment_plan_id AND pp.reference_type = 'shipment'
        JOIN shipments s ON s.id = pp.reference_id
       WHERE s.contact_id = p_contact AND s.status = 'active' AND s.total_cost > 0
         AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= v_cut
         AND pt.direction = 'out' AND pt.payment_method = 'credit_balance' AND pt.amount > 0
         AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL;
    END IF;
    INSERT INTO _la_debt SELECT 'movement', mm.id, mm.branch_id,
           COALESCE(public.ledger_day(ci.invoice_date), mm.movement_date), COALESCE(ci.created_at, mm.created_at),
           CASE WHEN mm.kind = 'opening' THEN 0 ELSE 1 END, mm.amount, mm.amount
      FROM money_movements mm
      LEFT JOIN invoices ci ON mm.source_table = 'invoices' AND mm.kind = 'refund' AND ci.id = mm.source_id
     WHERE mm.contact_id = p_contact AND mm.side = p_side AND mm.status = 'active' AND mm.effect = 'charge';
    INSERT INTO _la_cred SELECT mm.id, mm.branch_id, mm.movement_date, mm.created_at, mm.amount, mm.amount, mm.target_doc_type, mm.target_doc_id, mm.kind
      FROM money_movements mm WHERE mm.contact_id = p_contact AND mm.side = p_side AND mm.status = 'active' AND mm.effect = 'settle';
  END IF;

  ANALYZE _la_debt;
  ANALYZE _la_cred;
  CREATE TEMP TABLE IF NOT EXISTS _la_frozen (id uuid) ON COMMIT DROP;
  TRUNCATE _la_frozen;
  INSERT INTO _la_frozen
  SELECT a.id FROM payment_allocations a
   WHERE a.tenant_id = p_tenant AND a.status = 'active' AND a.side = p_side
     AND a.contact_id IS NOT DISTINCT FROM p_contact
     AND (p_contact IS NOT NULL OR a.debt_id = p_invoice)
     AND EXISTS (SELECT 1 FROM fiscal_periods fp WHERE fp.tenant_id = p_tenant AND fp.status = 'closed'
                  AND a.effective_date BETWEEN fp.period_start AND fp.period_end)
     AND EXISTS (SELECT 1 FROM _la_cred cr WHERE cr.movement_id = a.movement_id)
     AND EXISTS (SELECT 1 FROM _la_debt db WHERE db.debt_type = a.debt_type AND db.debt_id = a.debt_id);
  UPDATE _la_cred cr SET rem = cr.rem - f.amt
    FROM (SELECT a.movement_id, sum(a.amount) amt FROM payment_allocations a JOIN _la_frozen z ON z.id = a.id GROUP BY 1) f
   WHERE f.movement_id = cr.movement_id;
  UPDATE _la_debt db SET rem = db.rem - f.amt
    FROM (SELECT a.debt_type, a.debt_id, sum(a.amount) amt FROM payment_allocations a JOIN _la_frozen z ON z.id = a.id GROUP BY 1, 2) f
   WHERE f.debt_type = db.debt_type AND f.debt_id = db.debt_id;
  -- a frozen explicit allocation already used part of its use
  UPDATE _la_use us SET amount = us.amount - f.amt
    FROM (SELECT a.debt_type, a.debt_id, sum(a.amount) amt FROM payment_allocations a JOIN _la_frozen z ON z.id = a.id
           WHERE a.mode = 'explicit' GROUP BY 1, 2) f
   WHERE f.debt_type = us.debt_type AND f.debt_id = us.debt_id;

  -- 1) direct: money / return on its own document
  FOR m IN SELECT * FROM _la_cred WHERE target_id IS NOT NULL AND rem > 0.005 ORDER BY md, ts, movement_id LOOP
    SELECT * INTO d FROM _la_debt WHERE debt_type = m.target_type AND debt_id = m.target_id AND rem > 0.005;
    IF FOUND THEN
      v_take := LEAST(m.rem, d.rem);
      INSERT INTO _la_want VALUES (m.movement_id, m.branch_id, d.debt_type, d.debt_id, d.branch_id, v_take, 'direct',
                                   public.ledger_effective_date(p_tenant, GREATEST(m.md, d.dd)));
      UPDATE _la_cred SET rem = rem - v_take WHERE movement_id = m.movement_id;
      UPDATE _la_debt SET rem = rem - v_take WHERE debt_type = d.debt_type AND debt_id = d.debt_id;
    END IF;
  END LOOP;

  IF p_contact IS NOT NULL THEN
    -- 2) FIFO, restricted: money with no document (receipts / payments / deposits) settles only documents that
    --    already existed on its day; money given back (refund / charge movements) is settled by anything on account.
    FOR m IN SELECT * FROM _la_cred WHERE rem > 0.005 ORDER BY md, ts, movement_id LOOP
      FOR d IN SELECT * FROM _la_debt db
                WHERE db.rem > 0.005
                  AND (db.debt_type = 'movement'
                       OR (m.kind IN ('payment', 'deposit')
                           AND (db.dd < m.md OR (db.dd = m.md AND db.ts <= m.ts))))
                ORDER BY db.first_flag, db.dd, db.ts, db.debt_id LOOP
        SELECT rem INTO v_take FROM _la_cred WHERE movement_id = m.movement_id;
        EXIT WHEN v_take <= 0.005;
        v_take := LEAST(v_take, d.rem);
        INSERT INTO _la_want VALUES (m.movement_id, m.branch_id, d.debt_type, d.debt_id, d.branch_id, v_take, 'fifo',
                                     public.ledger_effective_date(p_tenant, GREATEST(m.md, d.dd)));
        UPDATE _la_cred SET rem = rem - v_take WHERE movement_id = m.movement_id;
        UPDATE _la_debt SET rem = rem - v_take WHERE debt_type = d.debt_type AND debt_id = d.debt_id;
      END LOOP;
    END LOOP;

    -- 3) explicit uses: what the cashier / manager chose to take from «تحت الحساب», oldest money first
    FOR u IN SELECT * FROM _la_use WHERE amount > 0.005 ORDER BY ts, src LOOP
      SELECT * INTO d FROM _la_debt WHERE debt_type = u.debt_type AND debt_id = u.debt_id;
      CONTINUE WHEN NOT FOUND;
      v_need := LEAST(u.amount, d.rem);
      CONTINUE WHEN v_need <= 0.005;
      FOR m IN SELECT * FROM _la_cred WHERE rem > 0.005 ORDER BY md, ts, movement_id LOOP
        EXIT WHEN v_need <= 0.005;
        v_take := LEAST(m.rem, v_need);
        INSERT INTO _la_want VALUES (m.movement_id, m.branch_id, d.debt_type, d.debt_id, d.branch_id, v_take, 'explicit',
                                     public.ledger_effective_date(p_tenant, GREATEST(m.md, d.dd, u.ud)));
        UPDATE _la_cred SET rem = rem - v_take WHERE movement_id = m.movement_id;
        UPDATE _la_debt SET rem = rem - v_take WHERE debt_type = d.debt_type AND debt_id = d.debt_id;
        v_need := v_need - v_take;
      END LOOP;
    END LOOP;
  END IF;

  UPDATE payment_allocations a SET status = 'superseded', superseded_at = now(), superseded_by_run = v_run
   WHERE a.tenant_id = p_tenant AND a.status = 'active' AND a.side = p_side
     AND a.contact_id IS NOT DISTINCT FROM p_contact
     AND (p_contact IS NOT NULL OR a.debt_id = p_invoice)
     AND NOT EXISTS (SELECT 1 FROM _la_frozen z WHERE z.id = a.id)
     AND NOT EXISTS (SELECT 1 FROM _la_want w
                      WHERE w.movement_id = a.movement_id AND w.debt_type = a.debt_type AND w.debt_id = a.debt_id
                        AND w.mode = a.mode AND round(w.amount, 2) = a.amount AND w.effective_date = a.effective_date);
  GET DIAGNOSTICS v_sup = ROW_COUNT;

  DELETE FROM _la_want w USING payment_allocations a
   WHERE a.tenant_id = p_tenant AND a.status = 'active' AND a.side = p_side
     AND a.contact_id IS NOT DISTINCT FROM p_contact
     AND w.movement_id = a.movement_id AND w.debt_type = a.debt_type AND w.debt_id = a.debt_id
     AND w.mode = a.mode AND round(w.amount, 2) = a.amount AND w.effective_date = a.effective_date;
  GET DIAGNOSTICS v_kept = ROW_COUNT;

  INSERT INTO payment_allocations (tenant_id, contact_id, side, movement_id, movement_branch_id, debt_type, debt_id,
                                   debt_branch_id, amount, mode, effective_date, run_id)
  SELECT p_tenant, p_contact, p_side, w.movement_id, w.movement_branch_id, w.debt_type, w.debt_id, w.debt_branch_id,
         round(w.amount, 2), w.mode, w.effective_date, v_run
    FROM _la_want w WHERE round(w.amount, 2) > 0;
  GET DIAGNOSTICS v_new = ROW_COUNT;

  RETURN jsonb_build_object('run', v_run, 'kept', v_kept, 'inserted', v_new, 'superseded', v_sup);
END
$function$;

-- ---------------------------------------------------------------- supplier: optional cap, nothing applied unless asked
DO $x$ BEGIN
  EXECUTE replace('D_ROP FUNCTION IF EXISTS public.apply_supplier_credit(uuid, uuid, uuid)', 'D_ROP', 'DR' || 'OP');
END $x$;
CREATE OR REPLACE FUNCTION public.apply_supplier_credit(p_contact_id uuid, p_payment_plan_id uuid, p_branch_id uuid, p_max numeric DEFAULT NULL)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_tenant uuid; v_type text; v_credit numeric;
  v_total numeric; v_paid numeric; v_remaining numeric; v_apply numeric; v_ref uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT tenant_id, type INTO v_tenant, v_type FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير موجود'; END IF;
  IF v_type NOT IN ('supplier', 'both') THEN RAISE EXCEPTION 'جهة الاتصال ليست مورداً'; END IF;
  PERFORM public.assert_same_tenant(v_tenant);
  IF public.current_tenant_is_suspended() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية';
  END IF;
  PERFORM 1 FROM public.branches WHERE id = p_branch_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفرع لا ينتمي لنفس الشركة'; END IF;
  IF NOT (public.is_super_admin(v_uid) OR public.is_admin(v_uid)
          OR (public.user_in_branch(v_uid, p_branch_id) AND public.has_permission(v_uid, 'shipments.create'))) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية الخصم من تحت حسابنا عند المورد';
  END IF;

  SELECT total_amount, COALESCE(paid_amount, 0), reference_id INTO v_total, v_paid, v_ref
    FROM public.payment_plans
   WHERE id = p_payment_plan_id AND tenant_id = v_tenant AND entity_type = 'supplier' AND entity_id = p_contact_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'خطة الدفع غير موجودة أو لا تخص هذا المورد'; END IF;

  PERFORM public.ledger_refresh_contact(p_contact_id);
  v_credit := public.ledger_side_advance(p_contact_id, 'supplier');
  IF v_credit <= 0 THEN RETURN 0; END IF;
  v_remaining := GREATEST(v_total - v_paid, 0);
  IF v_ref IS NOT NULL THEN v_remaining := LEAST(v_remaining, COALESCE(public.ledger_doc_open('shipment', v_ref), v_remaining)); END IF;
  v_apply := round(LEAST(v_credit, v_remaining, COALESCE(p_max, v_credit)), 2);
  IF v_apply <= 0 THEN RETURN 0; END IF;

  INSERT INTO public.payment_transactions(tenant_id, branch_id, payment_plan_id, installment_id, direction,
    amount, payment_method, fee_amount, total_with_fee, created_by, contact_id)
  VALUES (v_tenant, p_branch_id, p_payment_plan_id, NULL, 'out', v_apply, 'credit_balance', 0, v_apply, v_uid, p_contact_id);

  UPDATE public.payment_plans SET
    paid_amount = COALESCE(paid_amount, 0) + v_apply,
    remaining_amount = GREATEST(total_amount - (COALESCE(paid_amount, 0) + v_apply), 0),
    status = CASE WHEN total_amount - (COALESCE(paid_amount, 0) + v_apply) <= 0 THEN 'settled' ELSE status END,
    updated_at = now()
  WHERE id = p_payment_plan_id;

  PERFORM set_config('app.skip_journal', '1', true);
  INSERT INTO public.supplier_payments(tenant_id, contact_id, branch_id, amount, notes, paid_by)
  VALUES (v_tenant, p_contact_id, p_branch_id, v_apply, 'خصم من الرصيد المسبق لدى المورد (بدون حركة خزينة)', v_uid);
  PERFORM set_config('app.skip_journal', '0', true);

  INSERT INTO public.customer_credit_log(tenant_id, contact_id, amount, type, balance_delta, notes, created_by)
  VALUES (v_tenant, p_contact_id, v_apply, 'credit_used', -v_apply, 'خصم من تحت حسابنا عند المورد على فاتورة شراء', v_uid);
  RETURN v_apply;
END
$function$;
REVOKE ALL ON FUNCTION public.apply_supplier_credit(uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_supplier_credit(uuid, uuid, uuid, numeric) TO authenticated;

DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.record_shipment_with_credit(jsonb,jsonb,jsonb)'::regprocedure);
  IF position('credit_amount' in d) = 0 THEN
    d := replace(d, $q$COALESCE((p_plan->>'apply_credit')::boolean, true)$q$, $q$COALESCE((p_plan->>'apply_credit')::boolean, false)$q$);
    d := replace(d, $q$v_applied := public.apply_supplier_credit(v_contact, v_plan, v_branch);$q$,
                    $q$v_applied := public.apply_supplier_credit(v_contact, v_plan, v_branch, NULLIF(p_plan->>'credit_amount', '')::numeric);$q$);
    IF position('credit_amount' in d) = 0 OR position($q$'apply_credit')::boolean, false)$q$ in d) = 0 THEN
      RAISE EXCEPTION '0082: record_shipment_with_credit patch failed';
    END IF;
    EXECUTE d;
  END IF;
END $x$;

-- ---------------------------------------------------------------- «سدد من تحت حسابه»
CREATE OR REPLACE FUNCTION public.settle_from_account(p_contact_id uuid, p_side text, p_doc_id uuid, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_tenant uuid; v_type text; v_name text;
  v_adv numeric; v_open numeric; v_amt numeric := round(COALESCE(p_amount, 0), 2);
  v_branch uuid; v_number text; v_plan uuid; v_total numeric; v_res numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'الجانب لازم يكون عميل أو مورد'; END IF;
  IF v_amt <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  SELECT tenant_id, type, name INTO v_tenant, v_type, v_name FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجهة غير موجودة'; END IF;
  PERFORM public.assert_same_tenant(v_tenant);
  IF public.current_tenant_is_suspended() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية';
  END IF;

  IF p_side = 'customer' THEN
    SELECT branch_id, invoice_number INTO v_branch, v_number FROM public.invoices
     WHERE id = p_doc_id AND contact_id = p_contact_id AND tenant_id = v_tenant AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة مش موجودة أو مش بتاعة العميل ده'; END IF;
    IF NOT (public.is_super_admin(v_uid) OR public.is_admin(v_uid)
            OR (public.user_in_branch(v_uid, v_branch)
                AND (public.has_role(v_uid, 'branch_manager'::app_role) OR public.has_role(v_uid, 'accountant'::app_role)
                     OR public.has_role(v_uid, 'cashier'::app_role) OR public.has_permission(v_uid, 'invoices.update')))) THEN
      RAISE EXCEPTION 'ليس لديك صلاحية السداد من تحت حساب العميل';
    END IF;
    PERFORM public.ledger_refresh_contact(p_contact_id);
    v_adv := public.ledger_side_advance(p_contact_id, 'customer');
    v_open := COALESCE(public.ledger_doc_open('invoice', p_doc_id), 0);
    IF v_amt > v_adv + 0.005 THEN RAISE EXCEPTION 'اللي تحت حساب العميل (%) أقل من المبلغ (%)', v_adv, v_amt; END IF;
    IF v_amt > v_open + 0.005 THEN RAISE EXCEPTION 'المبلغ أكبر من الباقي على الفاتورة (%)', v_open; END IF;
    INSERT INTO public.invoice_payments (invoice_id, tenant_id, branch_id, payment_method, amount, received_by_name, reference_number)
    VALUES (p_doc_id, v_tenant, v_branch, 'credit_applied', v_amt,
            COALESCE((SELECT name FROM public.profiles WHERE id = v_uid), 'سداد من تحت الحساب'), 'ACCOUNT-' || to_char(now(), 'YYYYMMDDHH24MISS'));
    INSERT INTO public.customer_credit_log (tenant_id, contact_id, invoice_id, amount, type, notes, created_by)
    VALUES (v_tenant, p_contact_id, p_doc_id, v_amt, 'credit_used', 'سداد من تحت حساب العميل — فاتورة ' || COALESCE(v_number, ''), v_uid);
    v_res := v_amt;
  ELSE
    SELECT s.branch_id, s.total_cost INTO v_branch, v_total FROM public.shipments s
     WHERE s.id = p_doc_id AND s.contact_id = p_contact_id AND s.tenant_id = v_tenant AND s.status = 'active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء مش موجودة أو مش بتاعة المورد ده'; END IF;
    PERFORM public.ledger_refresh_contact(p_contact_id);
    v_adv := public.ledger_side_advance(p_contact_id, 'supplier');
    v_open := COALESCE(public.ledger_doc_open('shipment', p_doc_id), 0);
    IF v_amt > v_adv + 0.005 THEN RAISE EXCEPTION 'اللي تحت حسابنا عند المورد (%) أقل من المبلغ (%)', v_adv, v_amt; END IF;
    IF v_amt > v_open + 0.005 THEN RAISE EXCEPTION 'المبلغ أكبر من الباقي على الفاتورة (%)', v_open; END IF;
    SELECT id INTO v_plan FROM public.payment_plans
     WHERE tenant_id = v_tenant AND reference_type = 'shipment' AND reference_id = p_doc_id AND entity_type = 'supplier'
       AND status <> 'cancelled' ORDER BY created_at LIMIT 1;
    IF v_plan IS NULL THEN
      INSERT INTO public.payment_plans(tenant_id, branch_id, entity_type, entity_id, entity_name, total_amount, paid_amount,
        remaining_amount, plan_type, reference_type, reference_id, fee_on_customer, status, created_by)
      VALUES (v_tenant, v_branch, 'supplier', p_contact_id, COALESCE(v_name, 'مورد'), v_total, v_total - v_open, v_open,
        'open', 'shipment', p_doc_id, false, 'active', v_uid)
      RETURNING id INTO v_plan;
    END IF;
    v_res := public.apply_supplier_credit(p_contact_id, v_plan, v_branch, v_amt);
    IF v_res + 0.005 < v_amt THEN RAISE EXCEPTION 'اتخصم % بس من %', v_res, v_amt; END IF;
  END IF;

  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
  VALUES (v_uid, (SELECT name FROM public.profiles WHERE id = v_uid), v_branch, 'UPDATE', 'settle_from_account', p_doc_id::text,
          jsonb_build_object('contact', v_name, 'side', p_side, 'amount', v_res), v_tenant);
  RETURN v_res;
END
$function$;
REVOKE ALL ON FUNCTION public.settle_from_account(uuid, text, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_from_account(uuid, text, uuid, numeric) TO authenticated;

-- ---------------------------------------------------------------- how each document was settled
-- bucket: at_sale (money with the document itself) | later (money after) | account (from «تحت الحساب», by choice)
--         | return (a return on this document). method: cash / instapay / wallet / bank … or NULL.
CREATE OR REPLACE FUNCTION public.ledger_document_settlement(p_doc_type text, p_ids uuid[])
RETURNS TABLE(doc_id uuid, bucket text, method text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_tenant uuid; v_uid uuid := auth.uid(); v_all boolean;
BEGIN
  IF p_doc_type NOT IN ('invoice', 'shipment') THEN RAISE EXCEPTION 'نوع المستند غير صحيح'; END IF;
  v_tenant := public.assert_company_access(NULL);
  IF COALESCE(cardinality(p_ids), 0) > 5000 THEN RAISE EXCEPTION 'عدد مستندات كبير في طلب واحد (الحد 5000)'; END IF;
  v_all := public.is_admin(v_uid) OR public.is_super_admin(v_uid);
  RETURN QUERY
  WITH docs AS (
    SELECT i.id, i.tenant_id, i.branch_id, i.created_at AS made, i.invoice_date AS dated FROM invoices i
     WHERE p_doc_type = 'invoice' AND i.id = ANY (p_ids)
    UNION ALL
    SELECT s.id, s.tenant_id, s.branch_id, s.created_at, COALESCE(s.invoice_date::timestamptz, s.created_at) FROM shipments s
     WHERE p_doc_type = 'shipment' AND s.id = ANY (p_ids)
  ),
  ok AS (SELECT docs.* FROM docs WHERE docs.tenant_id = v_tenant AND (v_all OR docs.branch_id = ANY ((SELECT public.my_branch_ids())::uuid[]))),
  ledger AS (
    SELECT pa.debt_id AS doc_id,
           CASE
             WHEN pa.mode = 'explicit' THEN 'account'
             WHEN mv.kind = 'return_credit' THEN 'return'
             WHEN mv.source_table = 'invoice_payments' AND EXISTS (
                    SELECT 1 FROM invoice_payments ip WHERE ip.id = mv.source_id
                       AND (abs(extract(epoch FROM ip.created_at - ok.made)) < 5 OR ip.created_at = ok.dated)) THEN 'at_sale'
             WHEN mv.source_table = 'payment_transactions' AND p_doc_type = 'shipment' AND EXISTS (
                    SELECT 1 FROM payment_transactions pt WHERE pt.id = mv.source_id
                       AND abs(extract(epoch FROM pt.created_at - ok.made)) < 5) THEN 'at_sale'
             ELSE 'later' END AS bucket,
           CASE WHEN pa.mode = 'explicit' OR mv.kind = 'return_credit' THEN NULL ELSE COALESCE(mv.method, 'cash') END AS method,
           pa.amount
      FROM payment_allocations pa
      JOIN ok ON ok.id = pa.debt_id
      JOIN money_movements mv ON mv.id = pa.movement_id
     WHERE pa.status = 'active' AND pa.debt_type = p_doc_type
  ),
  -- documents the ledger does not cover (before 2026): their own payment rows
  old_inv AS (
    SELECT ip.invoice_id AS doc_id,
           CASE WHEN ip.payment_method IN ('credit_balance', 'credit_applied') THEN 'account'
                WHEN abs(extract(epoch FROM ip.created_at - ok.made)) < 5 OR ip.created_at = ok.dated THEN 'at_sale'
                ELSE 'later' END AS bucket,
           CASE WHEN ip.payment_method IN ('credit_balance', 'credit_applied') THEN NULL ELSE ip.payment_method END AS method,
           ip.amount
      FROM invoice_payments ip JOIN ok ON ok.id = ip.invoice_id
     WHERE p_doc_type = 'invoice' AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL AND ip.amount > 0
       AND ip.payment_method <> 'settlement'
       AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.doc_id = ip.invoice_id)
       AND public.ledger_day(ok.dated) < public.ledger_cutoff()
  ),
  old_ship AS (
    SELECT pp.reference_id AS doc_id,
           CASE WHEN pt.payment_method = 'credit_balance' THEN 'account'
                WHEN abs(extract(epoch FROM pt.created_at - ok.made)) < 5 THEN 'at_sale' ELSE 'later' END,
           CASE WHEN pt.payment_method = 'credit_balance' THEN NULL ELSE pt.payment_method END,
           pt.amount
      FROM payment_transactions pt
      JOIN payment_plans pp ON pp.id = pt.payment_plan_id AND pp.reference_type = 'shipment'
      JOIN ok ON ok.id = pp.reference_id
     WHERE p_doc_type = 'shipment' AND pt.direction = 'out' AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL
       AND pt.amount > 0 AND pt.payment_method <> 'settlement'
       AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.doc_id = pp.reference_id)
       AND public.ledger_day(ok.dated) < public.ledger_cutoff()
  )
  SELECT x.doc_id, x.bucket, x.method, round(sum(x.amount), 2)
    FROM (SELECT * FROM ledger UNION ALL SELECT * FROM old_inv UNION ALL SELECT * FROM old_ship) x
   GROUP BY 1, 2, 3;
END $$;
REVOKE ALL ON FUNCTION public.ledger_document_settlement(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_document_settlement(text, uuid[]) TO authenticated;

INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('settle_from_account', '0082', '«سدد من تحت حسابه»: use a customer / supplier advance on one open document, by choice'),
  ('ledger_document_settlement', '0082', 'read: how each sale / purchase invoice was settled (at sale / later / from account / return, by method)')
ON CONFLICT DO NOTHING;
