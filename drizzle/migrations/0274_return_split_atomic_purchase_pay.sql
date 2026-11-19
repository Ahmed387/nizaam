-- 0274 (owner «نفذ» 2026-11-19)
-- 1) A purchase return is saved with the cashier's split (cash / transfer / on his account) — like the sale return
--    since 0217. Before, `allocate_purchase_return_settlement` re-split every return by «what we still owe him»:
--    on account with nothing owed became cash into the drawer, cash with money owed became «on account».
--    A return written with no split at all (old callers) keeps the old rule. Import mode keeps «سهل»'s own split.
-- 2) A purchase invoice and the money paid with it are ONE transaction: `record_shipment_with_credit` records
--    `p_plan.payments` itself (record_payment_transaction, direction out, the invoice day). Before, the browser paid in
--    a second step after the save, so a cut connection left the invoice «آجل» with the cash already gone.
-- 3) `opening_balances_reconciliation` follows merged accounts (0230): the kept account is compared with the openings
--    of its whole merge chain (`contact_opening_side`), a merged-away account is not listed — «البيت (الحاج ناصر)»
--    showed −1,400 vs −1,050 and the merged account 350 vs 0 although the merge was right.

CREATE OR REPLACE FUNCTION public.allocate_purchase_return_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := COALESCE(NEW.total_amount, 0);
  v_debt numeric := 0;
  v_bal numeric := 0;
  v_excess numeric := 0;
  v_method text := COALESCE(NULLIF(NEW.refund_method,''), 'cash');
  v_given numeric := COALESCE(NEW.refund_cash_amount, 0) + COALESCE(NEW.refund_transfer_amount, 0) + COALESCE(NEW.refund_balance_amount, 0);
BEGIN
  -- 0156 import mode: the old program's own split and day
  IF public.sahl_import_mode() AND nullif(current_setting('app.sahl_split', true), '') IS NOT NULL THEN
    NEW.status := 'active';
    NEW.refund_balance_amount := round(coalesce((current_setting('app.sahl_split')::jsonb->>'balance')::numeric, 0), 2);
    NEW.refund_cash_amount := round(coalesce((current_setting('app.sahl_split')::jsonb->>'cash')::numeric, 0), 2);
    NEW.refund_transfer_amount := round(coalesce((current_setting('app.sahl_split')::jsonb->>'transfer')::numeric, 0), 2);
    NEW.refund_method := coalesce(nullif(current_setting('app.sahl_split')::jsonb->>'method', ''), NEW.refund_method);
    IF current_setting('app.sahl_split')::jsonb ? 'at' THEN
      NEW.invoice_date := (current_setting('app.sahl_split')::jsonb->>'at')::timestamptz;
    END IF;
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.status, 'active') = 'draft' THEN
    NEW.status := 'active';
  END IF;
  IF COALESCE(NEW.status, 'active') <> 'active' THEN
    RETURN NEW;
  END IF;
  NEW.status := 'active';

  -- 0274: the cashier's split stands (create_purchase_return already checked it adds up to the total)
  IF v_given > 0.005 THEN
    IF abs(v_given - v_total) > 0.01 THEN
      RAISE EXCEPTION 'مجموع توزيع الرد (%) لازم يساوي إجمالي المرتجع (%)', v_given, v_total USING ERRCODE = '22023';
    END IF;
    IF COALESCE(NEW.refund_cash_amount, 0) + COALESCE(NEW.refund_transfer_amount, 0) <= 0.005 THEN
      NEW.refund_method := 'balance';
    ELSIF v_method = 'balance' THEN
      NEW.refund_method := CASE WHEN COALESCE(NEW.refund_transfer_amount, 0) > 0.005 AND COALESCE(NEW.refund_cash_amount, 0) <= 0.005 THEN 'transfer' ELSE 'cash' END;
    END IF;
    RETURN NEW;
  END IF;

  -- no split given (old callers): the old rule — on his account up to what we owe him, the rest by the method
  IF NEW.contact_id IS NOT NULL THEN
    PERFORM public.ledger_refresh_contact(NEW.contact_id);
    v_debt := public.supplier_outstanding_payable(NEW.contact_id);
  END IF;
  IF NULLIF(current_setting('app.return_edit_id', true), '') IS NOT NULL THEN
    v_debt := GREATEST(v_debt, COALESCE((SELECT o.refund_balance_amount FROM public.purchase_returns o
                WHERE o.id = current_setting('app.return_edit_id', true)::uuid AND o.shipment_id = NEW.shipment_id), 0));
  END IF;
  v_bal := LEAST(v_total, v_debt);
  v_excess := GREATEST(v_total - v_bal, 0);
  NEW.refund_balance_amount := v_bal;
  IF v_method IN ('cash', 'balance') THEN
    NEW.refund_cash_amount := v_excess;
    NEW.refund_transfer_amount := 0;
    IF v_excess > 0 AND v_method = 'balance' THEN NEW.refund_method := 'cash'; END IF;
    IF v_excess = 0 THEN NEW.refund_method := 'balance'; END IF;
  ELSE
    NEW.refund_cash_amount := 0;
    NEW.refund_transfer_amount := v_excess;
    IF v_excess = 0 THEN NEW.refund_method := 'balance'; END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.record_shipment_with_credit(p_header jsonb, p_lines jsonb, p_plan jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_branch uuid := (p_header->>'branch_id')::uuid;
  v_contact uuid := NULLIF(p_header->>'contact_id','')::uuid;
  v_res jsonb; v_ship uuid; v_total numeric; v_plan uuid; v_tenant uuid; v_name text;
  v_paid_now numeric := GREATEST(COALESCE((p_plan->>'paid_now')::numeric, 0), 0);
  v_applied numeric := 0; v_after numeric;
  v_p jsonb; v_amt numeric; v_paid numeric := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'branch_id required'; END IF;
  IF v_contact IS NULL THEN RAISE EXCEPTION 'المورد مطلوب'; END IF;
  -- 0264: «المشتريات ← يضيف» in this branch
  PERFORM public.assert_access(v_branch, NULL);
  PERFORM public.require_switch('shipments.create', v_branch, 'المشتريات ← يضيف');

  v_res := public.record_shipment(p_header, p_lines, NULL);
  v_ship := (v_res->>'shipment_id')::uuid;
  v_total := (v_res->>'total_cost')::numeric;

  IF NULLIF(p_header->>'invoice_date','') IS NOT NULL THEN
    UPDATE public.shipments SET invoice_date = (p_header->>'invoice_date')::date WHERE id = v_ship;
  END IF;

  SELECT tenant_id, name INTO v_tenant, v_name FROM public.contacts WHERE id = v_contact;

  INSERT INTO public.payment_plans(tenant_id, branch_id, entity_type, entity_id, entity_name,
    total_amount, paid_amount, remaining_amount, plan_type, reference_type, reference_id,
    fee_on_customer, status, created_by)
  VALUES (v_tenant, v_branch, 'supplier', v_contact, COALESCE(v_name, 'مورد'),
    v_total, 0, v_total, COALESCE(NULLIF(p_plan->>'plan_type',''), 'open'), 'shipment', v_ship,
    false, 'active', v_uid)
  RETURNING id INTO v_plan;

  -- Credit covers only what the explicit payments of this invoice leave unpaid.
  IF COALESCE((p_plan->>'apply_credit')::boolean, false) AND v_total - v_paid_now > 0.005 THEN
    UPDATE public.payment_plans SET paid_amount = LEAST(v_paid_now, v_total) WHERE id = v_plan;
    v_applied := public.apply_supplier_credit(v_contact, v_plan, v_branch, NULLIF(p_plan->>'credit_amount', '')::numeric);
    UPDATE public.payment_plans
       SET paid_amount = v_applied,
           remaining_amount = GREATEST(total_amount - v_applied, 0),
           status = CASE WHEN total_amount - v_applied <= 0 THEN 'settled' ELSE 'active' END
     WHERE id = v_plan;
    IF v_applied > 0 THEN
      UPDATE public.shipments
         SET notes = CONCAT_WS(' — ', NULLIF(notes,''), 'تم خصم ' || to_char(v_applied, 'FM999,999,990.00') || ' ج من الرصيد المسبق لدى المورد')
       WHERE id = v_ship;
    END IF;
  END IF;

  -- 0274: the money paid with the invoice, in the same transaction (a failure saves nothing at all)
  FOR v_p IN SELECT * FROM jsonb_array_elements(COALESCE(p_plan->'payments', '[]'::jsonb)) LOOP
    v_amt := round(COALESCE((v_p->>'amount')::numeric, 0), 2);
    IF v_amt <= 0 THEN CONTINUE; END IF;
    v_paid := v_paid + v_amt;
    IF v_paid > v_total + 0.01 THEN RAISE EXCEPTION 'المدفوع (%) أكبر من إجمالي فاتورة الشراء (%)', v_paid, v_total USING ERRCODE = '22023'; END IF;
    PERFORM public.record_payment_transaction(v_plan, NULL, v_amt, NULLIF(v_p->>'method', ''),
      NULLIF(v_p->>'reference_number', ''), NULLIF(v_p->>'transfer_to_account', ''), NULLIF(v_p->>'received_by_name', ''),
      COALESCE((v_p->>'fee_amount')::numeric, 0), NULLIF(v_p->>'fee_type', ''), false, 'out',
      NULLIF(v_p->>'transfer_from_account', ''), NULLIF(p_header->>'invoice_date', '')::date);
  END LOOP;

  RETURN v_res || jsonb_build_object('payment_plan_id', v_plan, 'credit_applied', v_applied, 'paid_with_invoice', v_paid);
END $function$;

CREATE OR REPLACE FUNCTION public.opening_balances_reconciliation()
RETURNS TABLE(contact_id uuid, contact_name text, contact_type text, side text, opening_in_contact numeric, opening_in_ledger numeric, old_prepaid_credit numeric, ledger_advance_now numeric, status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_t uuid;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'مطابقة الأرصدة الافتتاحية للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH sides AS (
    SELECT c.id, c.name, c.type, s.side FROM contacts c
     CROSS JOIN LATERAL (SELECT unnest(CASE c.type WHEN 'customer' THEN ARRAY['customer'] WHEN 'supplier' THEN ARRAY['supplier']
                                                   ELSE ARRAY['customer', 'supplier'] END) AS side) s
     WHERE c.tenant_id = v_t AND c.merged_into IS NULL           -- 0274: a merged-away account lives in its kept account
  ),
  mv AS (
    SELECT m.contact_id, m.side, sum(CASE WHEN m.effect = 'charge' THEN m.amount ELSE -m.amount END) AS amt
      FROM money_movements m WHERE m.tenant_id = v_t AND m.kind = 'opening' AND m.status = 'active' GROUP BY 1, 2
  ),
  x AS (
    SELECT s.*, round(public.contact_opening_side(s.id, s.side), 2) AS want,   -- 0274: the whole merge chain, like the ledger
           round(COALESCE(mv.amt, 0), 2) AS got, snap.old_credit_balance AS old_cb,
           public.ledger_side_advance(s.id, s.side) AS adv
      FROM sides s
      LEFT JOIN mv ON mv.contact_id = s.id AND mv.side = s.side
      LEFT JOIN ledger_credit_balance_snapshot snap ON snap.contact_id = s.id
  )
  SELECT x.id, x.name, x.type, x.side, x.want, x.got, x.old_cb, x.adv,
         CASE WHEN abs(x.want - x.got) > 0.005 THEN 'ledger_differs'
              WHEN x.old_cb IS NOT NULL AND x.side = CASE WHEN x.type = 'supplier' THEN 'supplier' ELSE 'customer' END
                   AND abs(CASE WHEN x.type = 'supplier' THEN x.old_cb ELSE -x.old_cb END - x.adv) > 0.005 THEN 'old_credit_differed'
              ELSE 'ok' END
    FROM x
   WHERE x.want <> 0 OR x.got <> 0 OR x.old_cb IS NOT NULL;
END
$function$;
