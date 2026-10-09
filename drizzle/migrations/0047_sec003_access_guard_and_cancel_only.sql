-- SEC-003 + no hard delete (owner rules, approved 8 Oct 2026).
--
--  1. assert_access(branch, permission): one guard for company, branch, role permission and
--     suspension. Added at the top of every cancel / void / edit RPC used by the app.
--  2. Purchase invoices get a real cancellation (status + full reversal of stock, batches,
--     payment plan and journal). Every balance/stock reader ignores cancelled purchases.
--  3. Hard delete is gone: the delete RPCs are dropped, a trigger blocks DELETE on document and
--     money tables, purge tools are no longer callable from the app.
--  4. Audit trails (audit_log, price_audit_log) are read-only.

-- =============================================================================================
-- 0. Purchase invoice status
-- =============================================================================================
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by  uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_status_check') THEN
    ALTER TABLE public.shipments ADD CONSTRAINT shipments_status_check CHECK (status IN ('active', 'cancelled'));
  END IF;
END
$c$;

-- =============================================================================================
-- 1. Permissions: server-side mirror of the app's role defaults (src/lib/roles.ts,
--    DEFAULT_ROLE_PERMISSIONS). Used only when a company has not saved its own role matrix.
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.role_permission_default(p_role text, p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
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
      'attachments.view','attachments.create','attachments.update','attachments.delete'])
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
$fn$;

-- Same resolution order as the app (checkPermission): admin/owner/super → per-user override →
-- the company's saved role matrix → the defaults above. Roles count only inside the user's company.
CREATE OR REPLACE FUNCTION public.effective_permission(_uid uuid, _key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid; v_override boolean; v_role_val boolean; v_has_rows boolean;
BEGIN
  IF _uid IS NULL OR _key IS NULL THEN RETURN false; END IF;
  IF public.is_super_admin(_uid) OR public.is_admin(_uid) THEN RETURN true; END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = _uid;
  IF v_tenant IS NULL THEN RETURN false; END IF;

  SELECT up.allowed INTO v_override
    FROM public.user_permissions up
   WHERE up.user_id = _uid AND up.tenant_id = v_tenant AND up.permission_key = _key
   LIMIT 1;
  IF v_override IS NOT NULL THEN RETURN v_override; END IF;

  SELECT bool_or(rp.allowed), count(*) > 0 INTO v_role_val, v_has_rows
    FROM public.user_roles ur
    JOIN public.role_permissions rp
      ON rp.tenant_id = v_tenant AND rp.role = ur.role::text AND rp.permission_key = _key
   WHERE ur.user_id = _uid AND ur.tenant_id = v_tenant;
  IF v_has_rows THEN RETURN COALESCE(v_role_val, false); END IF;

  RETURN COALESCE((
    SELECT bool_or(public.role_permission_default(ur.role::text, _key))
      FROM public.user_roles ur
     WHERE ur.user_id = _uid AND ur.tenant_id = v_tenant
  ), false);
END
$fn$;

-- =============================================================================================
-- 2. The single guard
--    p_permission NULL = scope only (company, branch, suspension); the RPC keeps its own role rule.
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.assert_access(p_branch_id uuid, p_permission text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_branch_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'المستند غير موجود' USING ERRCODE = 'P0002';
  END IF;

  SELECT tenant_id INTO v_branch_tenant FROM public.branches WHERE id = p_branch_id;
  IF v_branch_tenant IS NULL THEN
    RAISE EXCEPTION 'الفرع غير موجود' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_super_admin(v_uid) THEN
    IF v_branch_tenant IS DISTINCT FROM public.current_tenant_id() THEN
      RAISE EXCEPTION 'غير مصرح: المستند يخص شركة أخرى' USING ERRCODE = '42501';
    END IF;
    IF public.current_tenant_is_suspended() THEN
      RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية' USING ERRCODE = '42501';
    END IF;
    IF NOT public.user_in_branch(v_uid, p_branch_id) THEN
      RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
    END IF;
    IF p_permission IS NOT NULL AND NOT public.effective_permission(v_uid, p_permission) THEN
      RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية «%»', p_permission USING ERRCODE = '42501';
    END IF;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.assert_access(uuid, text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.effective_permission(uuid, text)   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_access(uuid, text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.effective_permission(uuid, text) TO service_role;

-- =============================================================================================
-- 3. Guard every cancel / void / edit RPC
-- =============================================================================================
CREATE OR REPLACE FUNCTION pg_temp.add_guard(p_name text, p_guard text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  r record; d text; s int; b int; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, l.lanname
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE ns.nspname = 'public' AND p.proname = p_name
  LOOP
    n := n + 1;
    IF r.lanname <> 'plpgsql' THEN
      RAISE EXCEPTION 'SEC-003: % is %, expected plpgsql', p_name, r.lanname;
    END IF;
    d := pg_get_functiondef(r.oid);
    IF position('SEC-003 guard' IN d) > 0 THEN CONTINUE; END IF;        -- already applied
    s := position('$function$' IN d);
    IF s = 0 THEN RAISE EXCEPTION 'SEC-003: unexpected definition format for %', p_name; END IF;
    b := regexp_instr(substr(d, s), '\mBEGIN\M', 1, 1, 0, 'i');
    IF b = 0 THEN RAISE EXCEPTION 'SEC-003: no BEGIN in %', p_name; END IF;
    b := s - 1 + b + 4;                                                  -- last char of BEGIN
    d := left(d, b) || E'\n  -- SEC-003 guard (migration 0051)\n  ' || p_guard || E'\n' || substr(d, b + 1);
    EXECUTE d;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'SEC-003: function % not found', p_name; END IF;
END
$fn$;

SELECT pg_temp.add_guard('void_invoice_payment',
  $g$PERFORM public.assert_access((SELECT ip.branch_id FROM public.invoice_payments ip WHERE ip.id = p_payment_id), 'invoices.update');$g$);
SELECT pg_temp.add_guard('edit_invoice_payment',
  $g$PERFORM public.assert_access((SELECT ip.branch_id FROM public.invoice_payments ip WHERE ip.id = p_payment_id), 'invoices.update');$g$);
SELECT pg_temp.add_guard('void_payment_transaction',
  $g$PERFORM public.assert_access((SELECT pt.branch_id FROM public.payment_transactions pt WHERE pt.id = p_tx_id), 'invoices.update');$g$);
SELECT pg_temp.add_guard('edit_payment_transaction',
  $g$PERFORM public.assert_access((SELECT pt.branch_id FROM public.payment_transactions pt WHERE pt.id = p_tx_id), 'invoices.update');$g$);
SELECT pg_temp.add_guard('request_void_payment_transaction',
  $g$PERFORM public.assert_access((SELECT pt.branch_id FROM public.payment_transactions pt WHERE pt.id = p_tx_id), NULL);$g$);
SELECT pg_temp.add_guard('cancel_invoice_with_refund',
  $g$PERFORM public.assert_access((SELECT i.branch_id FROM public.invoices i WHERE i.id = _invoice_id), 'sales.delete');$g$);
SELECT pg_temp.add_guard('edit_invoice',
  $g$PERFORM public.assert_access((SELECT i.branch_id FROM public.invoices i WHERE i.id = _invoice_id), 'sales.update');$g$);
SELECT pg_temp.add_guard('update_invoice_date_sovereign',
  $g$PERFORM public.assert_access((SELECT i.branch_id FROM public.invoices i WHERE i.id = p_invoice_id), NULL);$g$);
SELECT pg_temp.add_guard('update_return_sovereign',
  $g$PERFORM public.assert_access(CASE WHEN p_kind = 'sale_return'
      THEN (SELECT r.branch_id FROM public.returns r WHERE r.id = p_return_id)
      ELSE (SELECT pr.branch_id FROM public.purchase_returns pr WHERE pr.id = p_return_id) END, NULL);$g$);
SELECT pg_temp.add_guard('edit_shipment',
  $g$PERFORM public.assert_access((SELECT sh.branch_id FROM public.shipments sh WHERE sh.id = p_shipment_id), 'shipments.update');
  IF EXISTS (SELECT 1 FROM public.shipments sh WHERE sh.id = p_shipment_id AND sh.status = 'cancelled') THEN
    RAISE EXCEPTION 'فاتورة الشراء ملغاة — لا يمكن تعديلها';
  END IF;$g$);
SELECT pg_temp.add_guard('cancel_voucher',
  $g$PERFORM public.assert_access((SELECT v.branch_id FROM public.vouchers v WHERE v.id = p_voucher_id),
      (SELECT CASE WHEN v.type = 'receipt' THEN 'receipt_vouchers.delete' ELSE 'payment_vouchers.delete' END
         FROM public.vouchers v WHERE v.id = p_voucher_id));$g$);
SELECT pg_temp.add_guard('edit_voucher',
  $g$PERFORM public.assert_access((SELECT v.branch_id FROM public.vouchers v WHERE v.id = p_voucher_id), NULL);$g$);
SELECT pg_temp.add_guard('cancel_sale_return',
  $g$PERFORM public.assert_access((SELECT r.branch_id FROM public.returns r WHERE r.id = _return_id), NULL);$g$);
SELECT pg_temp.add_guard('cancel_purchase_return',
  $g$PERFORM public.assert_access((SELECT pr.branch_id FROM public.purchase_returns pr WHERE pr.id = _return_id), NULL);$g$);
SELECT pg_temp.add_guard('cancel_pre_order',
  $g$PERFORM public.assert_access((SELECT po.branch_id FROM public.pre_orders po WHERE po.id = p_pre_order_id), NULL);$g$);

-- =============================================================================================
-- 4. Purchase invoice cancellation (replaces every shipments.delete())
-- =============================================================================================
-- Status changes only through cancel_purchase_invoice; a cancelled invoice is frozen.
CREATE OR REPLACE FUNCTION public.guard_shipment_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'فاتورة الشراء ملغاة — لا يمكن تعديلها' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(current_setting('app.shipment_cancel', true), '') <> 'on' THEN
    RAISE EXCEPTION 'إلغاء فاتورة الشراء يتم من زر الإلغاء فقط' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_guard_shipment_status ON public.shipments;
CREATE TRIGGER trg_guard_shipment_status
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.guard_shipment_status();

CREATE OR REPLACE FUNCTION public.cancel_purchase_invoice(p_shipment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  s public.shipments%ROWTYPE;
  it record;
  v_plan record;
  v_cur numeric;
  v_consumed int;
  v_paid numeric := 0;
  v_lines int := 0;
  v_uname text;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'لازم تكتب سبب الإلغاء';
  END IF;

  SELECT * INTO s FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء غير موجودة'; END IF;

  PERFORM public.assert_access(s.branch_id, 'shipments.delete');

  IF s.status = 'cancelled' THEN RAISE EXCEPTION 'فاتورة الشراء ملغاة بالفعل'; END IF;

  IF EXISTS (SELECT 1 FROM public.purchase_returns pr WHERE pr.shipment_id = s.id AND pr.status = 'active') THEN
    RAISE EXCEPTION 'على الفاتورة دي مرتجع شراء نشط — ألغِ المرتجع الأول';
  END IF;

  -- Stock from this invoice must be untouched (not sold, not transferred).
  SELECT count(*) INTO v_consumed
    FROM public.product_batches b
   WHERE b.shipment_id = s.id AND b.quantity_remaining < b.quantity_purchased;
  IF v_consumed > 0 THEN
    RAISE EXCEPTION 'لا يمكن إلغاء فاتورة الشراء: % دفعة منها اتباعت أو اتحولت. ألغِ المبيعات/التحويلات الأول أو اعمل مرتجع شراء.', v_consumed;
  END IF;

  -- 1) Stock out, recorded in the stock ledger as a purchase cancellation.
  FOR it IN
    SELECT si.product_id, SUM(si.quantity)::numeric AS qty
      FROM public.shipment_items si
     WHERE si.shipment_id = s.id AND si.product_id IS NOT NULL
     GROUP BY si.product_id
  LOOP
    SELECT quantity INTO v_cur FROM public.products WHERE id = it.product_id FOR UPDATE;
    IF COALESCE(v_cur, 0) < it.qty THEN
      RAISE EXCEPTION 'المخزون الحالي (%) أقل من كمية الفاتورة (%) لأحد الأصناف — راجع حركة الصنف', COALESCE(v_cur, 0), it.qty;
    END IF;
    PERFORM public.stock_mv_ctx('purchase_cancel', 'shipment', s.id, it.product_id, now());
    UPDATE public.products SET quantity = quantity - it.qty WHERE id = it.product_id;
    v_lines := v_lines + 1;
  END LOOP;
  UPDATE public.product_batches SET quantity_remaining = 0 WHERE shipment_id = s.id;

  -- 2) Payment plan closed. Money already paid stays with the supplier as an advance.
  FOR v_plan IN
    SELECT * FROM public.payment_plans
     WHERE reference_type = 'shipment' AND reference_id = s.id
     FOR UPDATE
  LOOP
    v_paid := v_paid + COALESCE(v_plan.paid_amount, 0);
    UPDATE public.payment_installments
       SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           adjustment_reason = 'إلغاء فاتورة الشراء'
     WHERE payment_plan_id = v_plan.id AND status IN ('pending', 'overdue', 'partial');
    UPDATE public.payment_plans
       SET status = 'cancelled', remaining_amount = 0, updated_at = now()
     WHERE id = v_plan.id;
  END LOOP;

  -- 3) Status (the only path allowed to change it).
  PERFORM set_config('app.shipment_cancel', 'on', true);
  UPDATE public.shipments
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason)
   WHERE id = s.id;
  PERFORM set_config('app.shipment_cancel', '', true);

  -- 4) Journal: the original entry stays; a reversing entry is posted today.
  PERFORM public.reverse_journal_for_source(s.tenant_id, 'shipment', s.id,
    'إلغاء فاتورة شراء ' || COALESCE(s.shipment_number, ''));

  SELECT name INTO v_uname FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), COALESCE(v_uname, '?'), s.tenant_id, s.branch_id, 'CANCEL', 'shipment', s.id::text,
          jsonb_build_object('shipment_number', s.shipment_number, 'total_cost', s.total_cost,
                              'reason', btrim(p_reason), 'paid_before_cancel', v_paid));

  RETURN jsonb_build_object('shipment_id', s.id, 'stock_lines_reversed', v_lines, 'paid_before_cancel', v_paid);
END
$fn$;

REVOKE ALL ON FUNCTION public.cancel_purchase_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_invoice(uuid, text) TO authenticated, service_role;

-- No new payments on a cancelled plan; no purchase return on a cancelled purchase.
CREATE OR REPLACE FUNCTION public.guard_cancelled_plan_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.payment_plan_id IS NOT NULL AND NEW.reverses_tx_id IS NULL
     AND EXISTS (SELECT 1 FROM public.payment_plans pp WHERE pp.id = NEW.payment_plan_id AND pp.status = 'cancelled') THEN
    RAISE EXCEPTION 'خطة الدفع ملغاة (المستند الأصلي ملغي) — سجّل الدفعة كسند على حساب الجهة';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS trg_guard_cancelled_plan_payment ON public.payment_transactions;
CREATE TRIGGER trg_guard_cancelled_plan_payment
  BEFORE INSERT ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_cancelled_plan_payment();

CREATE OR REPLACE FUNCTION public.guard_return_on_cancelled_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.shipment_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.shipments sh WHERE sh.id = NEW.shipment_id AND sh.status = 'cancelled') THEN
    RAISE EXCEPTION 'فاتورة الشراء ملغاة — لا يمكن عمل مرتجع عليها';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS trg_guard_return_on_cancelled_purchase ON public.purchase_returns;
CREATE TRIGGER trg_guard_return_on_cancelled_purchase
  BEFORE INSERT ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.guard_return_on_cancelled_purchase();

-- Readers: a cancelled purchase is not a debt, not a document to allocate, and not stock.
CREATE OR REPLACE FUNCTION public.sync_shipment_journal(p_shipment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s RECORD; v_lines jsonb; v_existing uuid; v_vat numeric; v_goods numeric;
BEGIN
  SELECT id, tenant_id, invoice_date, shipment_number, total_cost, COALESCE(vat_amount,0) AS vat_amount, status
    INTO s FROM public.shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN RETURN; END IF;
  -- A cancelled purchase keeps its original entry; cancel_purchase_invoice posts the reversal.
  IF s.status = 'cancelled' THEN RETURN; END IF;

  SELECT id INTO v_existing FROM public.journal_entries
   WHERE source_type = 'shipment' AND source_id = s.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    DELETE FROM public.journal_entry_lines WHERE entry_id = v_existing;
    DELETE FROM public.journal_entries WHERE id = v_existing;
  END IF;

  IF COALESCE(s.total_cost, 0) <= 0 THEN RETURN; END IF;

  v_vat := LEAST(GREATEST(COALESCE(s.vat_amount,0), 0), s.total_cost);
  v_goods := s.total_cost - v_vat;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','1300','debit',v_goods,'credit',0,'description','Shipment '||s.shipment_number||' inventory received'),
    jsonb_build_object('account_code','2100','debit',0,'credit',s.total_cost,'description','Shipment '||s.shipment_number||' payable to supplier')
  );
  IF v_vat > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code','1350','debit',v_vat,'credit',0,'description','Shipment '||s.shipment_number||' input VAT')
    );
  END IF;
  PERFORM public.post_journal(s.tenant_id, s.invoice_date::date, 'Shipment '||s.shipment_number, 'shipment', s.id, v_lines);
END $function$;

CREATE OR REPLACE VIEW public.v_contact_balances WITH (security_invoker = true) AS
 SELECT c.id AS contact_id,
    c.tenant_id,
    c.name,
    c.type,
    COALESCE(c.credit_balance, 0::numeric) AS credit_balance,
    COALESCE(inv.total_invoiced, 0::numeric) AS total_invoiced,
    COALESCE(ret.total_returned, 0::numeric) AS total_returned,
    COALESCE(pay.total_paid, 0::numeric) AS total_paid,
    COALESCE(ship.total_shipments, 0::numeric) AS total_shipments,
    COALESCE(pur_ret.total_purchase_returns, 0::numeric) AS total_purchase_returns,
    COALESCE(sup_pay.total_supplier_paid, 0::numeric) AS total_supplier_paid,
    COALESCE(vouch_receipt.total_receipts, 0::numeric) AS total_voucher_receipts,
    COALESCE(vouch_payment.total_payments, 0::numeric) AS total_voucher_payments,
    COALESCE(c.opening_balance, 0::numeric) + COALESCE(inv.total_invoiced, 0::numeric) - COALESCE(ret.total_returned, 0::numeric) - COALESCE(pay.total_paid, 0::numeric) - (COALESCE(ship.total_shipments, 0::numeric) - COALESCE(pur_ret.total_purchase_returns, 0::numeric) - COALESCE(sup_pay.total_supplier_paid, 0::numeric)) - COALESCE(vouch_receipt.total_receipts, 0::numeric) + COALESCE(vouch_payment.total_payments, 0::numeric) AS ledger_balance,
    COALESCE(c.opening_balance, 0::numeric) + COALESCE(inv.total_invoiced, 0::numeric) - COALESCE(ret.total_returned, 0::numeric) - COALESCE(pay.total_paid, 0::numeric) - (COALESCE(ship.total_shipments, 0::numeric) - COALESCE(pur_ret.total_purchase_returns, 0::numeric) - COALESCE(sup_pay.total_supplier_paid, 0::numeric)) - COALESCE(vouch_receipt.total_receipts, 0::numeric) + COALESCE(vouch_payment.total_payments, 0::numeric) + COALESCE(c.credit_balance, 0::numeric) AS total_balance,
    COALESCE(overdue.total_overdue, 0::numeric) AS overdue_amount,
    GREATEST(inv.last_at, ret.last_at, pay.last_at, ship.last_at, pur_ret.last_at, sup_pay.last_at, vouch_receipt.last_at, vouch_payment.last_at) AS last_transaction_date,
    COALESCE(c.opening_balance, 0::numeric) AS opening_balance,
    COALESCE(pay.total_settlement, 0::numeric) AS total_settlement
   FROM contacts c
     LEFT JOIN LATERAL ( SELECT sum(i.total) AS total_invoiced,
            max(i.created_at) AS last_at
           FROM invoices i
          WHERE i.contact_id = c.id AND i.tenant_id = c.tenant_id AND i.status = 'active'::invoice_status) inv ON true
     LEFT JOIN LATERAL ( SELECT sum(GREATEST(COALESCE(r.total_refund, 0::numeric) - COALESCE(r.refund_cash_amount, 0::numeric) - COALESCE(r.refund_transfer_amount, 0::numeric), 0::numeric)) AS total_returned,
            max(r.created_at) AS last_at
           FROM returns r
             JOIN invoices i ON i.id = r.invoice_id
          WHERE i.contact_id = c.id AND r.tenant_id = c.tenant_id AND (COALESCE(r.status, 'active'::text) <> ALL (ARRAY['draft'::text, 'cancelled'::text]))) ret ON true
     LEFT JOIN LATERAL ( SELECT sum(ip.amount) FILTER (WHERE ip.payment_method <> 'settlement'::text) AS total_paid,
            sum(ip.amount) FILTER (WHERE ip.payment_method = 'settlement'::text) AS total_settlement,
            max(ip.created_at) AS last_at
           FROM invoice_payments ip
             JOIN invoices i ON i.id = ip.invoice_id
          WHERE i.contact_id = c.id AND ip.tenant_id = c.tenant_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL) pay ON true
     LEFT JOIN LATERAL ( SELECT sum(s.total_cost) AS total_shipments,
            max(s.created_at) AS last_at
           FROM shipments s
          WHERE s.contact_id = c.id AND s.tenant_id = c.tenant_id AND s.status = 'active') ship ON true
     LEFT JOIN LATERAL ( SELECT sum(GREATEST(COALESCE(pr.total_amount, 0::numeric) - COALESCE(pr.refund_cash_amount, 0::numeric) - COALESCE(pr.refund_transfer_amount, 0::numeric), 0::numeric)) AS total_purchase_returns,
            max(pr.created_at) AS last_at
           FROM purchase_returns pr
          WHERE pr.contact_id = c.id AND pr.tenant_id = c.tenant_id AND pr.status = 'active'::text) pur_ret ON true
     LEFT JOIN LATERAL ( SELECT sum(sp.amount) AS total_supplier_paid,
            max(sp.created_at) AS last_at
           FROM supplier_payments sp
          WHERE sp.contact_id = c.id AND sp.tenant_id = c.tenant_id) sup_pay ON true
     LEFT JOIN LATERAL ( SELECT sum(v.amount) AS total_receipts,
            max(v.created_at) AS last_at
           FROM vouchers v
          WHERE v.party_id = c.id AND v.tenant_id = c.tenant_id AND v.type = 'receipt'::voucher_type AND v.status = 'active'::voucher_status AND (v.party_type = ANY (ARRAY['customer'::voucher_party_type, 'supplier'::voucher_party_type]))) vouch_receipt ON true
     LEFT JOIN LATERAL ( SELECT sum(v.amount) AS total_payments,
            max(v.created_at) AS last_at
           FROM vouchers v
          WHERE v.party_id = c.id AND v.tenant_id = c.tenant_id AND v.type = 'payment'::voucher_type AND v.status = 'active'::voucher_status AND (v.party_type = ANY (ARRAY['customer'::voucher_party_type, 'supplier'::voucher_party_type]))) vouch_payment ON true
     LEFT JOIN LATERAL ( SELECT sum(pi.amount) AS total_overdue
           FROM payment_installments pi
             JOIN payment_plans pp ON pp.id = pi.payment_plan_id
             JOIN invoices i ON i.id = pp.reference_id AND pp.reference_type = 'invoice'::text
          WHERE i.contact_id = c.id AND pi.tenant_id = c.tenant_id AND pi.due_date < CURRENT_DATE AND pi.status <> 'paid'::text) overdue ON true
  WHERE c.tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()) OR auth.role() = 'service_role';

CREATE OR REPLACE FUNCTION public.contact_branch_balances(p_branch_id uuid)
RETURNS TABLE(contact_id uuid, balance numeric, overdue numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT c.id,
    (CASE WHEN c.branch_id = p_branch_id THEN COALESCE(c.opening_balance,0) ELSE 0 END)
    + COALESCE((SELECT sum(i.total) FROM invoices i WHERE i.contact_id=c.id AND i.branch_id=p_branch_id AND i.status='active'),0)
    - COALESCE((SELECT sum(GREATEST(COALESCE(r.total_refund,0)-COALESCE(r.refund_cash_amount,0)-COALESCE(r.refund_transfer_amount,0),0)) FROM returns r JOIN invoices i ON i.id=r.invoice_id WHERE i.contact_id=c.id AND i.branch_id=p_branch_id AND COALESCE(r.status,'active') NOT IN ('draft','cancelled')),0)
    - COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip JOIN invoices i ON i.id=ip.invoice_id WHERE i.contact_id=c.id AND i.branch_id=p_branch_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL),0)
    - ( COALESCE((SELECT sum(s.total_cost) FROM shipments s WHERE s.contact_id=c.id AND s.branch_id=p_branch_id AND s.status='active'),0)
      - COALESCE((SELECT sum(GREATEST(COALESCE(pr.total_amount,0)-COALESCE(pr.refund_cash_amount,0)-COALESCE(pr.refund_transfer_amount,0),0)) FROM purchase_returns pr WHERE pr.contact_id=c.id AND pr.branch_id=p_branch_id AND pr.status='active'),0)
      - COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp WHERE sp.contact_id=c.id AND sp.branch_id=p_branch_id),0) )
    - COALESCE((SELECT sum(v.amount) FROM vouchers v WHERE v.party_id=c.id AND v.branch_id=p_branch_id AND v.type='receipt' AND v.status='active' AND v.party_type IN ('customer','supplier')),0)
    + COALESCE((SELECT sum(v.amount) FROM vouchers v WHERE v.party_id=c.id AND v.branch_id=p_branch_id AND v.type='payment' AND v.status='active' AND v.party_type IN ('customer','supplier')),0)
    AS balance,
    COALESCE((SELECT sum(GREATEST(pi.amount-COALESCE(pi.paid_amount,0),0)) FROM payment_installments pi JOIN payment_plans pp ON pp.id=pi.payment_plan_id JOIN invoices i ON i.id=pp.reference_id AND pp.reference_type='invoice' WHERE i.contact_id=c.id AND i.branch_id=p_branch_id AND pi.due_date < public.cairo_today() AND pi.status<>'paid' AND pi.cancelled_at IS NULL),0) AS overdue
  FROM contacts c
  WHERE c.tenant_id = public.current_tenant_id() AND c.is_archived = false;
$$;

CREATE OR REPLACE FUNCTION public.doc_ledger_allocation(p_kind text, p_branch_id uuid, p_contact_ids uuid[], p_as_of date DEFAULT NULL::date, p_cash_only boolean DEFAULT false)
 RETURNS TABLE(doc_id uuid, contact_id uuid, doc_date date, amount numeric, paid numeric, remaining numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = p_branch_id AND b.tenant_id = public.current_tenant_id())
     OR NOT (public.user_in_branch(auth.uid(), p_branch_id) OR public.is_admin(auth.uid())
              OR public.has_role(auth.uid(), 'viewer'::app_role) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  -- FIFO matching of each contact's branch statement. p_cash_only = true (purchases): only real cash/bank
  -- outflows to the supplier (supplier_payments + active supplier-payment vouchers) — no returns, no netting.
  WITH c AS (
    SELECT ct.id, ct.branch_id, COALESCE(ct.opening_balance,0) AS ob
    FROM contacts ct WHERE ct.id = ANY(p_contact_ids) AND ct.tenant_id = public.current_tenant_id()
  ),
  debts AS (
    SELECT 's'::text AS side, NULL::uuid AS doc_id, c.id AS cid, '0001-01-01'::date AS dd, NULL::timestamptz AS ts, GREATEST(c.ob,0) AS amt
      FROM c WHERE c.branch_id = p_branch_id
    UNION ALL
    SELECT 'p', NULL::uuid, c.id, '0001-01-01'::date, NULL::timestamptz, GREATEST(-c.ob,0)
      FROM c WHERE c.branch_id = p_branch_id
    UNION ALL
    SELECT 's', i.id, i.contact_id, (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date, i.created_at, i.total
      FROM invoices i JOIN c ON c.id=i.contact_id
     WHERE i.branch_id=p_branch_id AND i.status='active'
       AND (p_as_of IS NULL OR (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 'p', s.id, s.contact_id, (COALESCE(s.invoice_date,s.created_at) AT TIME ZONE 'Africa/Cairo')::date, s.created_at, s.total_cost
      FROM shipments s JOIN c ON c.id=s.contact_id
     WHERE s.branch_id=p_branch_id AND s.status='active'
       AND (p_as_of IS NULL OR (COALESCE(s.invoice_date,s.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
  ),
  credits AS (
    SELECT 's'::text AS side, i.contact_id AS cid, ip.amount AS amt
      FROM invoice_payments ip JOIN invoices i ON i.id=ip.invoice_id JOIN c ON c.id=i.contact_id
     WHERE NOT p_cash_only AND i.branch_id=p_branch_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
       AND (p_as_of IS NULL OR (ip.created_at AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 's', i.contact_id, GREATEST(COALESCE(r.total_refund,0)-COALESCE(r.refund_cash_amount,0)-COALESCE(r.refund_transfer_amount,0),0)
      FROM returns r JOIN invoices i ON i.id=r.invoice_id JOIN c ON c.id=i.contact_id
     WHERE NOT p_cash_only AND i.branch_id=p_branch_id AND COALESCE(r.status,'active') NOT IN ('draft','cancelled')
       AND (p_as_of IS NULL OR (COALESCE(r.invoice_date,r.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 'p', sp.contact_id, sp.amount FROM supplier_payments sp JOIN c ON c.id=sp.contact_id
     WHERE sp.branch_id=p_branch_id
       AND (p_as_of IS NULL OR (COALESCE(sp.paid_at,sp.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 'p', pr.contact_id, GREATEST(COALESCE(pr.total_amount,0)-COALESCE(pr.refund_cash_amount,0)-COALESCE(pr.refund_transfer_amount,0),0)
      FROM purchase_returns pr JOIN c ON c.id=pr.contact_id
     WHERE NOT p_cash_only AND pr.branch_id=p_branch_id AND pr.status='active'
       AND (p_as_of IS NULL OR (COALESCE(pr.invoice_date,pr.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT CASE WHEN v.type='receipt' THEN 's' ELSE 'p' END, v.party_id, v.amount
      FROM vouchers v JOIN c ON c.id=v.party_id
     WHERE v.branch_id=p_branch_id AND v.status='active' AND v.party_type IN ('customer','supplier')
       AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)
       AND (NOT p_cash_only OR (v.type='payment' AND EXISTS (
             SELECT 1 FROM voucher_categories vc WHERE vc.id=v.category_id AND vc.system_key='supplier_payment')))
  ),
  net AS (
    SELECT cid, side, SUM(amt) AS amt FROM (
      SELECT cid, side, amt FROM debts UNION ALL SELECT cid, side, -amt FROM credits
    ) x GROUP BY cid, side
  ),
  own AS (SELECT cid, SUM(amt) AS amt FROM credits WHERE side = CASE WHEN p_kind='sale' THEN 's' ELSE 'p' END GROUP BY cid),
  pool AS (
    SELECT c.id AS cid,
           COALESCE((SELECT amt FROM own WHERE own.cid=c.id),0)
         + CASE WHEN p_cash_only THEN 0 ELSE
             COALESCE((SELECT amt FROM net WHERE net.cid=c.id AND net.side = CASE WHEN p_kind='sale' THEN 'p' ELSE 's' END),0) END AS amt
      FROM c
  ),
  ordered AS (
    SELECT dt.*, COALESCE(SUM(dt.amt) OVER (PARTITION BY dt.cid ORDER BY dt.dd, dt.ts NULLS FIRST, dt.doc_id NULLS FIRST
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS before
       FROM debts dt
     WHERE dt.side = CASE WHEN p_kind='sale' THEN 's' ELSE 'p' END AND (dt.amt > 0 OR dt.doc_id IS NOT NULL)
  )
  SELECT o.doc_id, o.cid, o.dd, round(o.amt,2),
         round(LEAST(o.amt, GREATEST(0, COALESCE(p.amt,0) - o.before)),2),
         round(o.amt - LEAST(o.amt, GREATEST(0, COALESCE(p.amt,0) - o.before)),2)
    FROM ordered o LEFT JOIN pool p ON p.cid=o.cid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stock_balance_as_of(
  _branch_id uuid, _product_id uuid, _as_of date
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_cur numeric; v_after numeric;
BEGIN
  SELECT tenant_id, COALESCE(quantity,0) INTO v_tenant, v_cur
    FROM products WHERE id = _product_id AND branch_id = _branch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'منتج غير موجود في الفرع'; END IF;
  PERFORM assert_same_tenant(v_tenant);
  IF NOT (is_admin(auth.uid()) OR is_super_admin(auth.uid())
          OR has_role(auth.uid(),'owner') OR user_in_branch(auth.uid(), _branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;

  -- Net effect of every movement that happened AFTER the chosen operational day
  SELECT COALESCE(SUM(d),0) INTO v_after FROM (
    -- Sales (out)
    SELECT -ii.quantity::numeric AS d
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
     WHERE ii.product_id = _product_id AND i.branch_id = _branch_id
       AND i.status <> 'cancelled'
       AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Sales returns (in)
    SELECT ri.quantity::numeric
      FROM return_items ri JOIN returns r ON r.id = ri.return_id
     WHERE ri.product_id = _product_id AND r.branch_id = _branch_id
       AND (r.invoice_date AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Purchases (in)
    SELECT si.quantity::numeric
      FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
     WHERE si.product_id = _product_id AND s.branch_id = _branch_id
       AND (COALESCE(s.invoice_date, s.created_at) AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Cancelled purchases (out on the cancellation day; the purchase itself stays above as "in")
    SELECT -si.quantity::numeric
      FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
     WHERE si.product_id = _product_id AND s.branch_id = _branch_id
       AND s.status = 'cancelled'
       AND (s.cancelled_at AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Purchase returns (out)
    SELECT -pri.quantity::numeric
      FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
     WHERE pri.product_id = _product_id AND pr.branch_id = _branch_id
       AND (COALESCE(pr.invoice_date, pr.created_at) AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Manual stock adjustments
    SELECT sai.difference::numeric
      FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adjustment_id
     WHERE sai.product_id = _product_id AND sa.branch_id = _branch_id
       AND (sa.created_at AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Inventory count adjustments
    SELECT ia.adjustment_amount::numeric
      FROM inventory_adjustments ia JOIN inventory_sessions ses ON ses.id = ia.session_id
     WHERE ia.product_id = _product_id AND ses.branch_id = _branch_id
       AND (ia.created_at AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Transfers out: pending reserves full qty, confirmed keeps received qty, rejected nets to zero
    SELECT -(CASE WHEN st.status = 'pending' THEN st.quantity
                  WHEN st.status = 'confirmed' THEN COALESCE(st.received_quantity, st.quantity)
                  ELSE 0 END)::numeric
      FROM stock_transfers st
     WHERE st.product_id = _product_id AND st.from_branch_id = _branch_id
       AND COALESCE(st.transfer_date, (st.created_at AT TIME ZONE 'Africa/Cairo')::date) > _as_of
    UNION ALL
    -- Transfers in
    SELECT COALESCE(st.received_quantity, st.quantity)::numeric
      FROM stock_transfers st
     WHERE st.to_branch_id = _branch_id AND st.status = 'confirmed'
       AND EXISTS (
         SELECT 1 FROM products dp
          WHERE dp.id = _product_id AND dp.branch_id = _branch_id
            AND dp.name = (SELECT sp.name FROM products sp WHERE sp.id = st.product_id)
       )
       AND COALESCE(st.transfer_date, (st.created_at AT TIME ZONE 'Africa/Cairo')::date) > _as_of
  ) x;

  RETURN v_cur - v_after;
END $$;

CREATE OR REPLACE FUNCTION public.historical_stock_at(_branch_id uuid, _as_of timestamptz)
RETURNS TABLE(product_id uuid, name text, sku text, quantity_at_date numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH base AS (
  SELECT id, name, sku, quantity::numeric AS current_qty
  FROM products WHERE branch_id = _branch_id
),
delta_after AS (
  SELECT product_id, SUM(d) AS delta FROM (
    SELECT ii.product_id, -ii.quantity::numeric AS d
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.branch_id = _branch_id AND i.status <> 'cancelled' AND i.created_at > _as_of
    UNION ALL
    SELECT ri.product_id, ri.quantity::numeric
      FROM return_items ri JOIN returns r ON r.id = ri.return_id
      WHERE r.branch_id = _branch_id AND r.created_at > _as_of
    UNION ALL
    SELECT si.product_id, si.quantity::numeric
      FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
      WHERE s.branch_id = _branch_id AND s.created_at > _as_of
    UNION ALL
    SELECT si.product_id, -si.quantity::numeric
      FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
      WHERE s.branch_id = _branch_id AND s.status = 'cancelled' AND s.cancelled_at > _as_of
    UNION ALL
    SELECT pri.product_id, -pri.quantity::numeric
      FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
      WHERE pr.branch_id = _branch_id AND pr.created_at > _as_of
    UNION ALL
    SELECT sai.product_id, sai.difference::numeric
      FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adjustment_id
      WHERE sa.branch_id = _branch_id AND sa.created_at > _as_of
    UNION ALL
    SELECT st.product_id, -st.quantity::numeric
      FROM stock_transfers st
      WHERE st.from_branch_id = _branch_id AND st.status = 'confirmed' AND st.created_at > _as_of
    UNION ALL
    SELECT st.product_id, COALESCE(st.received_quantity, st.quantity)::numeric
      FROM stock_transfers st
      WHERE st.to_branch_id = _branch_id AND st.status = 'confirmed' AND st.created_at > _as_of
    UNION ALL
    SELECT ia.product_id, ia.adjustment_amount::numeric
      FROM inventory_adjustments ia JOIN inventory_sessions ses ON ses.id = ia.session_id
      WHERE ses.branch_id = _branch_id AND ia.created_at > _as_of
  ) x
  GROUP BY product_id
)
SELECT b.id, b.name, b.sku,
       (b.current_qty - COALESCE(da.delta, 0))::numeric
FROM base b
LEFT JOIN delta_after da ON da.product_id = b.id
ORDER BY b.name;
$$;

-- An approved "delete" request on a purchase now cancels it (approval_action enum keeps 'delete').
CREATE OR REPLACE FUNCTION public.process_approval_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text;
  v_body text;
  v_link text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'approved' THEN
    NEW.decided_at = now();
    IF NEW.action = 'delete' THEN
      IF NEW.entity_type = 'contact' THEN
        DELETE FROM public.contacts WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;
      ELSIF NEW.entity_type = 'invoice' THEN
        UPDATE public.invoices SET status = 'cancelled', cancel_reason = COALESCE(NEW.admin_note, NEW.reason, 'Approved deletion')
          WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;
      ELSIF NEW.entity_type = 'shipment' THEN
        -- No hard delete (owner rule): an approved request cancels the purchase invoice with full reversal.
        PERFORM public.cancel_purchase_invoice(NEW.entity_id, COALESCE(NEW.admin_note, NEW.reason, 'إلغاء بموافقة الإدارة'));
      END IF;
    ELSIF NEW.action = 'update' AND NEW.payload IS NOT NULL THEN
      IF NEW.entity_type = 'contact' THEN
        UPDATE public.contacts SET
          name = COALESCE(NEW.payload->>'name', name),
          phone = COALESCE(NEW.payload->>'phone', phone),
          address = COALESCE(NEW.payload->>'address', address),
          contact_person = COALESCE(NEW.payload->>'contact_person', contact_person),
          notes = COALESCE(NEW.payload->>'notes', notes)
        WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;
      END IF;
    END IF;

    v_title = 'تمت الموافقة على طلبك';
    v_body  = 'تمت الموافقة على طلب ' || (CASE WHEN NEW.action='delete' THEN 'إلغاء' ELSE 'تعديل' END) || ' ' || NEW.entity_label;
  ELSIF NEW.status = 'rejected' THEN
    NEW.decided_at = now();
    v_title = 'تم رفض طلبك';
    v_body  = 'تم رفض طلب ' || (CASE WHEN NEW.action='delete' THEN 'إلغاء' ELSE 'تعديل' END) || ' ' || NEW.entity_label
              || COALESCE(' — ' || NEW.admin_note, '');
  END IF;

  v_link = CASE
    WHEN NEW.branch_id IS NOT NULL THEN '/branch/' || NEW.branch_id || '/approval-requests'
    ELSE '/admin/approval-requests'
  END;

  INSERT INTO public.notifications(tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
  VALUES (NEW.tenant_id, NEW.requested_by, v_title, v_body, 'general', v_link, 'approval_request', NEW.id);

  RETURN NEW;
END $$;

-- =============================================================================================
-- 5. No hard delete
-- =============================================================================================
DO $drop$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('hard_delete_invoice', 'hard_delete_invoice__impl', 'delete_voucher_admin',
                         'delete_partner_transaction', 'admin_clear_treasury', 'admin_cancel_all_invoices')
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;

  -- Bulk purge tools stay in the database for the DBA, but the app can no longer call them.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('admin_reset_branch_data', 'admin_reset_vouchers', 'admin_reset_price_audit')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$drop$;

-- Direct DELETE is refused on document, money and audit tables. Deletes that cascade from a
-- parent row or run inside another trigger (pg_trigger_depth() > 1) are still allowed.
CREATE OR REPLACE FUNCTION public.block_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF COALESCE(current_setting('app.allow_hard_delete', true), '') = 'on' OR pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'الحذف النهائي ممنوع (%) — استخدم الإلغاء', TG_TABLE_NAME USING ERRCODE = '42501';
END
$fn$;

DO $blk$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'shipments', 'returns', 'purchase_returns', 'vouchers',
                           'invoice_payments', 'payment_transactions', 'supplier_payments',
                           'customer_credit_log', 'partner_transactions',
                           'audit_log', 'price_audit_log'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete()', t);
  END LOOP;
END
$blk$;

-- =============================================================================================
-- 6. Audit trails are read-only
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.block_audit_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF COALESCE(current_setting('app.allow_hard_delete', true), '') = 'on' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'سجل التدقيق للقراءة فقط' USING ERRCODE = '42501';
END
$fn$;

DROP TRIGGER IF EXISTS zz_block_audit_update ON public.audit_log;
CREATE TRIGGER zz_block_audit_update BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.block_audit_update();
DROP TRIGGER IF EXISTS zz_block_audit_update ON public.price_audit_log;
CREATE TRIGGER zz_block_audit_update BEFORE UPDATE ON public.price_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.block_audit_update();

REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log       FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.price_audit_log FROM anon, authenticated;

-- =============================================================================================
-- 7. Internal helpers of this migration are not callable from the browser; allow-list update
-- =============================================================================================
REVOKE ALL ON FUNCTION public.guard_shipment_status()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_cancelled_plan_payment()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_return_on_cancelled_purchase()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_hard_delete()                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_audit_update()                   FROM PUBLIC, anon, authenticated;

DELETE FROM public.security_rpc_allowlist
 WHERE function_name IN ('hard_delete_invoice', 'delete_voucher_admin', 'delete_partner_transaction',
                         'admin_clear_treasury', 'admin_cancel_all_invoices',
                         'admin_reset_branch_data', 'admin_reset_vouchers', 'admin_reset_price_audit');
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('cancel_purchase_invoice', '0051', 'purchase cancellation; guarded by assert_access shipments.delete')
ON CONFLICT (function_name) DO NOTHING;

DO $check$
DECLARE v_list text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'SEC-003: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
END
$check$;