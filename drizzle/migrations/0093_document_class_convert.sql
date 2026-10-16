-- 0093 — «تحويل لنقدي / تحويل لآجل» on sale and purchase invoices (owner decision 2026-10-16).
-- The class is never a label to flip: it is what the money says (نقدي = fully paid in money on the invoice's own
-- day by its own payments). The button therefore moves the MONEY, on the right days:
--   to نقدي: money it got later on its own (not a hand-over that also paid other invoices) MOVES to the invoice day
--            (same voucher, new date); advance uses on it are released back to the account; the rest is a NEW
--            payment on the invoice day (method chosen, transfer receipt allowed). Money that reached it from a
--            general voucher or a return goes, by the ledger rule, to the oldest open invoice — or stays on account.
--   to آجل: its own payments of the invoice day are cancelled on that day (cancel-on-original-day, 0084).
-- Refused: cancelled, before 2026, closed period, a payment that also paid other invoices, a walk-in sale to آجل.
-- Warnings: the branch till goes below zero that day; a transfer fee lands in a month whose profit was distributed.
-- Permission «doc_class.update» (settings → permissions), default owner / admin / branch manager.

-- 1) «التصنيف»: a sale's own payment dated the invoice day is «with the invoice», like purchases (0092)
CREATE OR REPLACE FUNCTION public.ledger_settlement_rows(p_doc_type text, p_ids uuid[])
 RETURNS TABLE(doc_id uuid, bucket text, method text, amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ok AS (
    SELECT i.id, i.created_at AS made, i.invoice_date AS dated FROM invoices i
     WHERE p_doc_type = 'invoice' AND i.id = ANY (p_ids)
    UNION ALL
    SELECT s.id, s.created_at, COALESCE(s.invoice_date::timestamptz, s.created_at) FROM shipments s
     WHERE p_doc_type = 'shipment' AND s.id = ANY (p_ids)
  ),
  ledger AS (
    SELECT pa.debt_id AS doc_id,
           CASE
             WHEN pa.mode = 'explicit' THEN 'account'
             WHEN mv.kind = 'return_credit' THEN 'return'
             WHEN mv.source_table = 'invoice_payments' AND EXISTS (
                    SELECT 1 FROM invoice_payments ip WHERE ip.id = mv.source_id
                       AND (abs(extract(epoch FROM ip.created_at - ok.made)) < 5 OR ip.created_at = ok.dated
                            OR (ip.invoice_id = ok.id AND public.ledger_day(ip.created_at) = public.ledger_day(ok.dated)))) THEN 'at_sale'
             WHEN mv.source_table = 'payment_transactions' AND EXISTS (
                    SELECT 1 FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id
                     WHERE pt.id = mv.source_id
                       AND ((p_doc_type = 'shipment' AND abs(extract(epoch FROM pt.created_at - ok.made)) < 5)
                            OR (pp.reference_id = ok.id AND public.ledger_day(pt.created_at) = public.ledger_day(ok.dated)))) THEN 'at_sale'
             ELSE 'later' END AS bucket,
           CASE WHEN pa.mode = 'explicit' OR mv.kind = 'return_credit' THEN NULL ELSE COALESCE(mv.method, 'cash') END AS method,
           pa.amount
      FROM payment_allocations pa
      JOIN ok ON ok.id = pa.debt_id
      JOIN money_movements mv ON mv.id = pa.movement_id
     WHERE pa.status = 'active' AND pa.debt_type = p_doc_type
  ),
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
                WHEN abs(extract(epoch FROM pt.created_at - ok.made)) < 5
                     OR public.ledger_day(pt.created_at) = public.ledger_day(ok.dated) THEN 'at_sale' ELSE 'later' END AS bucket,
           CASE WHEN pt.payment_method = 'credit_balance' THEN NULL ELSE pt.payment_method END AS method,
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
$function$;

-- 2) permission default: branch manager yes (owner / admin always)
CREATE OR REPLACE FUNCTION public.role_permission_default(p_role text, p_key text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE p_role
    -- branch_manager: every action of every branch page
    WHEN 'branch_manager' THEN p_key = ANY (ARRAY[
      'dashboard.view',
      'sales.view','sales.create','sales.update','sales.delete',
      'invoices.view','invoices.update','invoices.delete',
      'preorders.view','preorders.create','preorders.update','preorders.delete',
      'shipments.view','shipments.create','shipments.update','shipments.delete',
      'inventory.view','inventory.create','inventory.update','inventory.delete',
      'transfers.view','transfers.create',
      'customers.view','customers.create','customers.update','customers.delete',
      'suppliers.view','suppliers.create','suppliers.update','suppliers.delete',
      'treasury.view',
      'receipt_vouchers.view','receipt_vouchers.create','receipt_vouchers.delete',
      'payment_vouchers.view','payment_vouchers.create','payment_vouchers.delete',
      'employees.view','employees.create','employees.update','employees.delete',
      'advances.view','advances.create','advances.update',
      'attendance.view','attendance.create','attendance.update',
      'reports.view',
      'attachments.view','attachments.create','attachments.update','attachments.delete',
      'doc_class.update'])
    WHEN 'accountant' THEN p_key = ANY (ARRAY[
      'dashboard.view','sales.view','invoices.view','invoices.update',
      'preorders.view','shipments.view','inventory.view',
      'customers.view','suppliers.view','treasury.view',
      'receipt_vouchers.view','receipt_vouchers.create',
      'payment_vouchers.view','payment_vouchers.create',
      'employees.view','employees.create','employees.update',
      'advances.view','advances.create','advances.update',
      'attendance.view','attendance.create','attendance.update',
      'reports.view'])
    WHEN 'cashier' THEN p_key = ANY (ARRAY[
      'dashboard.view','sales.view','sales.create',
      'invoices.view','preorders.view','preorders.create',
      'inventory.view','customers.view','customers.create',
      'receipt_vouchers.view','receipt_vouchers.create',
      'attendance.view','attendance.create'])
    WHEN 'warehouse' THEN p_key = ANY (ARRAY[
      'dashboard.view','inventory.view','inventory.create','inventory.update',
      'transfers.view','transfers.create',
      'shipments.view','shipments.create','shipments.update',
      'suppliers.view','suppliers.create','suppliers.update',
      'employees.view','employees.create','employees.update',
      'advances.view','advances.create',
      'attendance.view','attendance.create'])
    WHEN 'supervisor' THEN p_key = ANY (ARRAY[
      'employees.view','attendance.view','attendance.create','attendance.update'])
    WHEN 'viewer' THEN p_key LIKE '%.view'
    ELSE false
  END
$function$;

-- tenants that already saved a branch-manager permission matrix get the new key switched on
INSERT INTO public.role_permissions(tenant_id, role, permission_key, allowed)
SELECT DISTINCT rp.tenant_id, 'branch_manager', 'doc_class.update', true
  FROM public.role_permissions rp
 WHERE rp.role = 'branch_manager'
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                    WHERE x.tenant_id = rp.tenant_id AND x.role = 'branch_manager' AND x.permission_key = 'doc_class.update');

-- 3) the plan of one document (read only): what the button would do, refusals, warnings
CREATE OR REPLACE FUNCTION public._doc_class_plan(p_doc_type text, p_id uuid, p_target text, p_method text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  d record; v_day date; v_class text; v_err text; v_skip text; v_warn jsonb := '[]'::jsonb; s record;
  v_keep numeric := 0; v_moves jsonb := '[]'::jsonb; v_moved numeric := 0; v_credit numeric := 0;
  v_paid numeric := 0; v_new numeric := 0; v_fee numeric := 0; v_voids jsonb := '[]'::jsonb; v_void numeric := 0;
  v_displaced numeric := 0; v_ret numeric := 0; v_till numeric := 0; v_delta numeric := 0; v_sign int;
BEGIN
  IF p_doc_type = 'invoice' THEN
    SELECT i.id, i.invoice_number AS num, i.invoice_date AS dated, COALESCE(i.total, 0) AS total, i.status::text AS st,
           i.branch_id, i.tenant_id, i.contact_id
      INTO d FROM invoices i WHERE i.id = p_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('doc_id', p_id, 'status', 'error', 'message', 'المستند مش موجود'); END IF;
    SELECT x.class INTO v_class FROM invoice_settlement x WHERE x.invoice_id = p_id;
  ELSIF p_doc_type = 'shipment' THEN
    SELECT s2.id, s2.shipment_number AS num, COALESCE(s2.invoice_date, s2.created_at) AS dated, COALESCE(s2.total_cost, 0) AS total,
           s2.status::text AS st, s2.branch_id, s2.tenant_id, s2.contact_id
      INTO d FROM shipments s2 WHERE s2.id = p_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('doc_id', p_id, 'status', 'error', 'message', 'المستند مش موجود'); END IF;
    SELECT x.class INTO v_class FROM shipment_settlement x WHERE x.shipment_id = p_id;
  ELSE
    RAISE EXCEPTION 'نوع المستند غير صحيح';
  END IF;
  IF p_target NOT IN ('cash', 'credit') THEN RAISE EXCEPTION 'التحويل لازم يكون لنقدي أو لآجل'; END IF;
  v_day := public.ledger_day(d.dated);
  v_class := COALESCE(v_class, 'credit');
  v_sign := CASE WHEN p_doc_type = 'invoice' THEN 1 ELSE -1 END;   -- money into the till (sale) / out (purchase)

  IF d.st <> 'active' THEN v_err := 'الفاتورة ملغاة';
  ELSIF v_day < public.ledger_cutoff() THEN v_err := 'فاتورة قبل 2026 (أرشيف) — مينفعش تتحول';
  ELSIF public.ledger_period_closed(d.tenant_id, v_day) THEN v_err := 'الفترة المحاسبية لشهر الفاتورة مقفولة';
  ELSIF COALESCE(d.total, 0) <= 0 THEN v_err := 'الفاتورة قيمتها صفر';
  ELSIF v_class = p_target THEN v_skip := CASE WHEN p_target = 'cash' THEN 'هي أصلاً نقدي' ELSE 'هي أصلاً آجل' END;
  END IF;

  IF v_err IS NULL AND v_skip IS NULL AND p_target = 'cash' THEN
    -- its own money payments: kept (invoice day) / moved to the invoice day
    FOR s IN SELECT * FROM public.cancel_void_set(p_doc_type, p_id) x ORDER BY x.pay_day LOOP
      IF s.pay_day = v_day THEN
        v_keep := v_keep + s.amount;
      ELSIF s.block IS NOT NULL THEN
        v_err := COALESCE(v_err, s.block);
      ELSE
        v_moved := v_moved + s.amount;
        v_moves := v_moves || jsonb_build_object('src', s.src, 'id', s.id, 'amount', s.amount, 'day', s.pay_day,
                                                 'method', s.method, 'voucher', s.voucher_number);
      END IF;
    END LOOP;
    -- advance uses on it: back to the account
    IF p_doc_type = 'invoice' THEN
      SELECT COALESCE(sum(ip.amount), 0) INTO v_credit FROM invoice_payments ip
       WHERE ip.invoice_id = p_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL AND ip.amount > 0
         AND ip.payment_method IN ('credit_balance', 'credit_applied');
    ELSE
      SELECT COALESCE(sum(pt.amount), 0) INTO v_credit FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id
       WHERE pp.reference_type = 'shipment' AND pp.reference_id = p_id AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL
         AND pt.amount > 0 AND pt.payment_method = 'credit_balance';
    END IF;
    SELECT COALESCE(sum(pa.amount), 0) INTO v_paid FROM payment_allocations pa
     WHERE pa.status = 'active' AND pa.debt_type = p_doc_type AND pa.debt_id = p_id;
    v_new := round(d.total - v_keep - v_moved, 2);
    IF v_new < -0.005 THEN
      v_err := COALESCE(v_err, 'المدفوع على الفاتورة نفسها (' || round(v_keep + v_moved, 2) || ') أكتر من قيمتها — راجعها الأول');
    END IF;
    v_new := GREATEST(v_new, 0);
    IF v_new > 0 AND COALESCE(p_method, 'cash') <> 'cash' THEN v_fee := COALESCE(public.calculate_payment_fee(p_method, v_new), 0); END IF;
    v_displaced := GREATEST(round(v_paid - v_keep - v_moved - v_credit, 2), 0);
    v_delta := v_sign * (v_new + v_moved) - v_fee;
    IF v_credit > 0.005 THEN
      v_warn := v_warn || jsonb_build_object('code', 'credit_release', 'level', 'info',
        'text', round(v_credit, 2) || ' كانت متسددة من تحت الحساب — هترجع تحت الحساب');
    END IF;
    SELECT COALESCE(sum(pa.amount), 0) INTO v_ret FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
     WHERE pa.status = 'active' AND pa.debt_type = p_doc_type AND pa.debt_id = p_id AND mv.kind = 'return_credit';
    v_ret := LEAST(v_ret, v_displaced);
    IF v_ret > 0.005 THEN
      v_warn := v_warn || jsonb_build_object('code', 'return', 'level', 'info',
        'text', round(v_ret, 2) || ' كانت متسددة من مرتجع — المرتجع مش بيتلغي، قيمته بتبقى تحت الحساب (أو تسدد أقدم فاتورة مفتوحة)');
    END IF;
    IF v_displaced - v_ret > 0.005 THEN
      v_warn := v_warn || jsonb_build_object('code', 'displaced', 'level', 'info',
        'text', round(v_displaced - v_ret, 2) || ' جت للفاتورة دي من سند عام — هتسدد أقدم فاتورة مفتوحة، ولو مفيش تبقى تحت الحساب');
    END IF;
    IF v_fee > 0 AND EXISTS (SELECT 1 FROM profit_distributions pd WHERE pd.tenant_id = d.tenant_id
                               AND COALESCE(pd.status, '') <> 'cancelled' AND v_day BETWEEN pd.period_from AND pd.period_to) THEN
      v_warn := v_warn || jsonb_build_object('code', 'distributed', 'level', 'warning',
        'text', 'أرباح الفترة دي اتوزعت على الشركاء — عمولة التحويل ' || v_fee || ' هتقلل ربحها');
    END IF;
  ELSIF v_err IS NULL AND v_skip IS NULL AND p_target = 'credit' THEN
    IF p_doc_type = 'invoice' AND d.contact_id IS NULL THEN
      v_err := 'فاتورة لعميل نقدي من غير اسم — مينفعش تبقى آجل (اختار العميل الأول)';
    ELSE
      FOR s IN SELECT * FROM public.cancel_void_set(p_doc_type, p_id) x WHERE x.pay_day = v_day ORDER BY x.src DESC LOOP
        IF s.block IS NOT NULL THEN v_err := COALESCE(v_err, s.block); END IF;
        v_void := v_void + s.amount;
        v_voids := v_voids || jsonb_build_object('src', s.src, 'id', s.id, 'amount', s.amount, 'day', s.pay_day,
                                                 'method', s.method, 'voucher', s.voucher_number);
      END LOOP;
      IF v_err IS NULL AND v_void <= 0.005 THEN v_err := 'مفيش دفعات على الفاتورة يوم الفاتورة تتلغي'; END IF;
      v_delta := -v_sign * v_void;
    END IF;
  END IF;

  SELECT COALESCE(sum(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0) INTO v_till
    FROM treasury t WHERE t.branch_id = d.branch_id AND t.transaction_date <= v_day;
  IF v_err IS NULL AND v_skip IS NULL AND v_delta < 0 AND v_till + v_delta < 0 THEN
    v_warn := v_warn || jsonb_build_object('code', 'till_negative', 'level', 'warning',
      'text', 'خزنة الفرع يوم ' || to_char(v_day, 'DD/MM') || ' كان فيها ' || round(v_till, 2) || ' — بعد التحويل تبقى '
              || round(v_till + v_delta, 2) || '. اتأكد إن الفلوس دي فعلاً طلعت من الخزنة دي، أو إن في فلوس دخلت يومها ومش متسجلة');
  END IF;

  RETURN jsonb_build_object(
    'doc_id', d.id, 'doc_type', p_doc_type, 'number', d.num, 'date', v_day, 'total', round(d.total, 2),
    'branch_id', d.branch_id, 'contact_id', d.contact_id, 'class', v_class, 'target', p_target,
    'status', CASE WHEN v_err IS NOT NULL THEN 'error' WHEN v_skip IS NOT NULL THEN 'skip' ELSE 'ok' END,
    'message', COALESCE(v_err, v_skip),
    'keep', round(v_keep, 2), 'moves', v_moves, 'moved', round(v_moved, 2), 'credit_release', round(v_credit, 2),
    'new_amount', round(v_new, 2), 'method', COALESCE(p_method, 'cash'), 'fee', round(v_fee, 2),
    'displaced', round(v_displaced, 2), 'voids', v_voids, 'void_total', round(v_void, 2),
    'till_before', round(v_till, 2), 'till_after', round(v_till + v_delta, 2), 'warnings', v_warn);
END $function$;
REVOKE ALL ON FUNCTION public._doc_class_plan(text, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- 4) preview (browser): one row per document
CREATE OR REPLACE FUNCTION public.document_class_preview(p_doc_type text, p_ids uuid[], p_target text, p_method text DEFAULT 'cash')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_out jsonb := '[]'::jsonb; v_branch uuid; v_row jsonb;
BEGIN
  IF COALESCE(cardinality(p_ids), 0) = 0 THEN RETURN v_out; END IF;
  IF cardinality(p_ids) > 200 THEN RAISE EXCEPTION 'الحد 200 فاتورة في المرة'; END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    v_branch := CASE WHEN p_doc_type = 'invoice' THEN (SELECT branch_id FROM invoices WHERE id = v_id)
                     ELSE (SELECT branch_id FROM shipments WHERE id = v_id) END;
    BEGIN
      PERFORM public.assert_access(v_branch, 'doc_class.update');
      v_row := public._doc_class_plan(p_doc_type, v_id, p_target, p_method);
    EXCEPTION WHEN others THEN
      v_row := jsonb_build_object('doc_id', v_id, 'status', 'error', 'message', SQLERRM);
    END;
    v_out := v_out || v_row;
  END LOOP;
  RETURN v_out;
END $function$;
REVOKE ALL ON FUNCTION public.document_class_preview(text, uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_class_preview(text, uuid[], text, text) TO authenticated;

-- 5) a payment of the document on its own day (internal): returns the new voucher id
CREATE OR REPLACE FUNCTION public._doc_pay_on_day(p_doc_type text, p_id uuid, p_amount numeric, p_method text,
                                                  p_reference text, p_from text, p_to text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_plan uuid; v_tx uuid; v_tr uuid; v_inv record; v_day date; v_fee numeric := 0; v_uid uuid := auth.uid(); v_uname text;
BEGIN
  IF p_doc_type = 'shipment' THEN
    SELECT pp.id INTO v_plan FROM payment_plans pp WHERE pp.reference_type = 'shipment' AND pp.reference_id = p_id
     ORDER BY (pp.status <> 'cancelled') DESC, pp.created_at LIMIT 1;
    IF v_plan IS NULL THEN RAISE EXCEPTION 'فاتورة الشراء ملهاش خطة دفع'; END IF;
    v_tx := public.record_payment_transaction(v_plan, NULL, p_amount, COALESCE(p_method, 'cash'), p_reference, p_to, NULL, 0, NULL,
              false, 'out', p_from,
              (SELECT public.ledger_day(COALESCE(s.invoice_date, s.created_at)) FROM shipments s WHERE s.id = p_id));
    SELECT pt.treasury_id INTO v_tr FROM payment_transactions pt WHERE pt.id = v_tx;
  ELSE
    SELECT * INTO v_inv FROM invoices WHERE id = p_id;
    v_day := public.ledger_day(v_inv.invoice_date);
    SELECT pp.id INTO v_plan FROM payment_plans pp WHERE pp.reference_type = 'invoice' AND pp.reference_id = p_id AND pp.status <> 'cancelled'
     ORDER BY pp.created_at LIMIT 1;
    IF v_plan IS NOT NULL THEN
      v_tx := public.record_payment_transaction(v_plan, NULL, p_amount, COALESCE(p_method, 'cash'), p_reference, p_to, NULL, 0, NULL,
                false, 'in', p_from, v_day);
      SELECT pt.treasury_id INTO v_tr FROM payment_transactions pt WHERE pt.id = v_tx;
    ELSE
      PERFORM public._validate_transfer_payment(p_method, p_reference, p_from, p_to);
      v_fee := CASE WHEN COALESCE(p_method, 'cash') <> 'cash' THEN COALESCE(public.calculate_payment_fee(p_method, p_amount), 0) ELSE 0 END;
      SELECT name INTO v_uname FROM profiles WHERE id = v_uid;
      INSERT INTO invoice_payments(invoice_id, tenant_id, branch_id, payment_method, amount, reference_number, received_by_name,
                                   transfer_to_account, transfer_from_account, fee_amount, fee_on_customer, created_at)
      VALUES (p_id, v_inv.tenant_id, v_inv.branch_id, COALESCE(p_method, 'cash'), p_amount, NULLIF(p_reference, ''), v_uname,
              NULLIF(p_to, ''), NULLIF(p_from, ''), v_fee, false, v_inv.invoice_date);
      PERFORM set_config('app.contact_money', CASE WHEN v_inv.contact_id IS NOT NULL THEN '1' ELSE '' END, true);
      INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, reference_number, transfer_to_account,
                           transfer_from_account, reference_id, created_by, tenant_id, transaction_date, created_at)
      VALUES (v_inv.branch_id, 'income', 'sales', p_amount, 'تحصيل فاتورة ' || COALESCE(v_inv.invoice_number, '') || ' (تحويل لنقدي)',
              COALESCE(p_method, 'cash'), NULLIF(p_reference, ''), NULLIF(p_to, ''), NULLIF(p_from, ''), p_id, v_uid, v_inv.tenant_id,
              v_day, v_inv.invoice_date)
      RETURNING id INTO v_tr;
      PERFORM set_config('app.contact_money', '', true);
      IF v_fee > 0 THEN
        PERFORM set_config('app.skip_expense_till', '1', true);
        INSERT INTO expenses(branch_id, type, amount, description, date, payment_method, reference_number, is_fee, created_by, tenant_id)
        VALUES (v_inv.branch_id, 'عمولة تحويل', v_fee, 'عمولة ' || p_method || ' — فاتورة ' || COALESCE(v_inv.invoice_number, ''),
                v_day, p_method, NULLIF(p_reference, ''), true, v_uid, v_inv.tenant_id);
        PERFORM set_config('app.skip_expense_till', '', true);
        INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id, transaction_date, created_at)
        VALUES (v_inv.branch_id, 'expense', 'fee', v_fee, 'عمولة ' || p_method, p_method, true, v_uid, v_inv.tenant_id, v_day, v_inv.invoice_date);
      END IF;
    END IF;
  END IF;
  RETURN (SELECT v.id FROM vouchers v WHERE v.treasury_id = v_tr LIMIT 1);
END $function$;
REVOKE ALL ON FUNCTION public._doc_pay_on_day(text, uuid, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- 6) a purchase plan payment moved to the invoice day in place (same voucher, new date; its trigger moves the till row
--    and the voucher journal) — the sale side already has invoice_move_sale_payments (0086)
CREATE OR REPLACE FUNCTION public._shipment_move_plan_payment(p_tx_id uuid, p_day date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pt record; v_ts timestamptz := (p_day + time '12:00') AT TIME ZONE 'Africa/Cairo';
BEGIN
  SELECT * INTO pt FROM payment_transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND OR pt.voided_at IS NOT NULL THEN RETURN; END IF;
  UPDATE vouchers SET voucher_date = p_day WHERE treasury_id IN (pt.treasury_id, pt.fee_treasury_id);
  UPDATE treasury SET created_at = v_ts, transaction_date = p_day WHERE id IN (pt.treasury_id, pt.fee_treasury_id);
  UPDATE expenses e SET date = p_day
   WHERE pt.fee_amount > 0 AND e.is_fee AND e.branch_id = pt.branch_id AND e.amount = pt.fee_amount
     AND e.date = public.ledger_day(pt.created_at) AND e.description LIKE '%' || substr(pt.payment_plan_id::text, 1, 8) || '%';
  UPDATE payment_transactions SET created_at = v_ts WHERE id = p_tx_id;
END $function$;
REVOKE ALL ON FUNCTION public._shipment_move_plan_payment(uuid, date) FROM PUBLIC, anon, authenticated;

-- 7) the conversion (browser)
CREATE OR REPLACE FUNCTION public.document_class_convert(p_doc_type text, p_ids uuid[], p_target text, p_method text DEFAULT 'cash',
                                                         p_reference text DEFAULT NULL, p_transfer_from text DEFAULT NULL,
                                                         p_transfer_to text DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_out jsonb := '[]'::jsonb; v_plan jsonb; v_branch uuid; m jsonb; v_voucher uuid; v_uid uuid := auth.uid();
  v_reason text := btrim(COALESCE(p_reason, '')); v_why text; v_day date; v_dated timestamptz; r record; v_tag text;
BEGIN
  IF v_reason = '' THEN RAISE EXCEPTION 'لازم تكتب سبب التحويل'; END IF;
  IF COALESCE(cardinality(p_ids), 0) = 0 THEN RETURN v_out; END IF;
  IF cardinality(p_ids) > 200 THEN RAISE EXCEPTION 'الحد 200 فاتورة في المرة'; END IF;
  IF p_target NOT IN ('cash', 'credit') THEN RAISE EXCEPTION 'التحويل لازم يكون لنقدي أو لآجل'; END IF;
  v_tag := CASE WHEN p_target = 'cash' THEN 'تحويل لنقدي' ELSE 'تحويل لآجل' END;

  FOREACH v_id IN ARRAY p_ids LOOP
    v_voucher := NULL; v_plan := NULL;
    v_branch := CASE WHEN p_doc_type = 'invoice' THEN (SELECT branch_id FROM invoices WHERE id = v_id)
                     ELSE (SELECT branch_id FROM shipments WHERE id = v_id) END;
    BEGIN
      PERFORM public.assert_access(v_branch, 'doc_class.update');
      v_plan := public._doc_class_plan(p_doc_type, v_id, p_target, p_method);
      IF v_plan->>'status' <> 'ok' THEN
        v_out := v_out || v_plan;
        CONTINUE;
      END IF;
      v_day := (v_plan->>'date')::date;
      v_why := v_tag || ' — ' || v_reason;

      IF p_target = 'cash' THEN
        -- a) advance uses back to the account
        IF p_doc_type = 'invoice' THEN
          FOR r IN SELECT * FROM invoice_payments ip
                    WHERE ip.invoice_id = v_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL AND ip.amount > 0
                      AND ip.payment_method IN ('credit_balance', 'credit_applied') FOR UPDATE LOOP
            INSERT INTO invoice_payments(invoice_id, tenant_id, branch_id, payment_method, amount, reference_number, received_by_name,
                                         fee_amount, fee_on_customer, reverses_payment_id, created_at)
            VALUES (r.invoice_id, r.tenant_id, r.branch_id, r.payment_method, r.amount, r.reference_number,
                    'إلغاء — ' || COALESCE(r.received_by_name, ''), 0, false, r.id, r.created_at);
            UPDATE invoice_payments SET voided_at = now(), voided_by = v_uid, void_reason = v_why WHERE id = r.id;
          END LOOP;
        ELSE
          FOR r IN SELECT pt.id FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id
                    WHERE pp.reference_type = 'shipment' AND pp.reference_id = v_id AND pt.voided_at IS NULL
                      AND pt.reverses_tx_id IS NULL AND pt.amount > 0 AND pt.payment_method = 'credit_balance' LOOP
            PERFORM public._void_payment_transaction_exec(r.id, v_why);
          END LOOP;
        END IF;
        -- b) its own later payments move to the invoice day (same voucher)
        IF jsonb_array_length(v_plan->'moves') > 0 THEN
          IF p_doc_type = 'invoice' THEN
            v_dated := (SELECT invoice_date FROM invoices WHERE id = v_id);
            FOR r IN SELECT DISTINCT (x->>'day')::date AS dday FROM jsonb_array_elements(v_plan->'moves') x LOOP
              PERFORM public.invoice_move_sale_payments(v_id, r.dday, v_dated);
            END LOOP;
          ELSE
            FOR m IN SELECT * FROM jsonb_array_elements(v_plan->'moves') LOOP
              PERFORM public._shipment_move_plan_payment((m->>'id')::uuid, v_day);
            END LOOP;
          END IF;
        END IF;
        -- c) the rest: a new payment on the invoice day
        IF (v_plan->>'new_amount')::numeric > 0.005 THEN
          v_voucher := public._doc_pay_on_day(p_doc_type, v_id, (v_plan->>'new_amount')::numeric, COALESCE(p_method, 'cash'),
                                              p_reference, p_transfer_from, p_transfer_to);
        END IF;
      ELSE
        -- to آجل: its own payments of the invoice day are cancelled on that day
        FOR m IN SELECT * FROM jsonb_array_elements(v_plan->'voids') LOOP
          IF m->>'src' = 'payment_transactions' THEN
            IF EXISTS (SELECT 1 FROM payment_transactions WHERE id = (m->>'id')::uuid AND voided_at IS NULL) THEN
              PERFORM public._void_payment_transaction_exec((m->>'id')::uuid, v_why);
            END IF;
          ELSIF EXISTS (SELECT 1 FROM invoice_payments WHERE id = (m->>'id')::uuid AND voided_at IS NULL) THEN
            PERFORM public.void_invoice_payment((m->>'id')::uuid, v_why);
          END IF;
        END LOOP;
      END IF;

      INSERT INTO audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
      VALUES (v_uid, (SELECT name FROM profiles WHERE id = v_uid), v_branch, 'doc_class_convert', p_doc_type, v_id::text,
              v_plan || jsonb_build_object('reason', v_reason, 'voucher_id', v_voucher),
              (SELECT tenant_id FROM branches WHERE id = v_branch));
      v_out := v_out || (v_plan || jsonb_build_object('status', 'done', 'voucher_id', v_voucher));
    EXCEPTION WHEN others THEN
      v_out := v_out || jsonb_build_object('doc_id', v_id, 'number', v_plan->>'number', 'status', 'error', 'message', SQLERRM);
    END;
  END LOOP;
  RETURN v_out;
END $function$;
REVOKE ALL ON FUNCTION public.document_class_convert(text, uuid[], text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_class_convert(text, uuid[], text, text, text, text, text, text) TO authenticated;

INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('document_class_preview', '0093', 'read: what «تحويل لنقدي / لآجل» would do on sale / purchase invoices (money, till, warnings)'),
  ('document_class_convert', '0093', 'convert sale / purchase invoices to نقدي / آجل by moving their money on the right days')
ON CONFLICT DO NOTHING;
