-- 1) Return refund cap: real money back only up to real money actually paid
CREATE OR REPLACE FUNCTION public.allocate_sale_return_settlement()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := COALESCE(NEW.total_refund, 0);
  v_debt numeric := 0;
  v_bal numeric := 0;
  v_excess numeric := 0;
  v_money_cap numeric := 0;
  v_paid_money numeric := 0;
  v_prior_money numeric := 0;
  v_has_nonmoney boolean := false;
  v_method text := COALESCE(NULLIF(NEW.refund_method,''), 'cash');
  v_contact uuid;
  v_inv_method text;
BEGIN
  IF COALESCE(NEW.status, 'active') = 'draft' THEN NEW.status := 'active'; END IF;
  IF COALESCE(NEW.status, 'active') <> 'active' THEN RETURN NEW; END IF;
  NEW.status := 'active';

  SELECT i.contact_id, i.payment_method INTO v_contact, v_inv_method FROM public.invoices i WHERE i.id = NEW.invoice_id;

  IF v_contact IS NOT NULL THEN
    v_debt := public.invoice_outstanding_debt(NEW.invoice_id, NEW.id);
  END IF;

  v_bal := LEAST(v_total, v_debt);
  v_excess := GREATEST(v_total - v_bal, 0);

  SELECT COALESCE(SUM(ip.amount) FILTER (WHERE ip.payment_method NOT IN ('settlement','credit_balance')), 0),
         COALESCE(bool_or(ip.payment_method IN ('settlement','credit_balance')), false)
    INTO v_paid_money, v_has_nonmoney
    FROM public.invoice_payments ip
   WHERE ip.invoice_id = NEW.invoice_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL;

  IF v_paid_money = 0 AND NOT v_has_nonmoney
     AND NOT EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = NEW.invoice_id)
     AND COALESCE(v_inv_method,'cash') NOT IN ('settlement','credit_balance','credit') THEN
    SELECT total INTO v_paid_money FROM public.invoices WHERE id = NEW.invoice_id;
  END IF;

  SELECT COALESCE(SUM(COALESCE(r.refund_cash_amount,0) + COALESCE(r.refund_transfer_amount,0)), 0)
    INTO v_prior_money FROM public.returns r
   WHERE r.invoice_id = NEW.invoice_id AND r.id <> NEW.id AND COALESCE(r.status,'active') = 'active';

  v_money_cap := GREATEST(COALESCE(v_paid_money,0) - v_prior_money, 0);

  IF v_contact IS NOT NULL AND v_excess > v_money_cap THEN
    v_bal := v_bal + (v_excess - v_money_cap);
    v_excess := v_money_cap;
  END IF;

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

CREATE OR REPLACE FUNCTION public.check_treasury_balance()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_balance numeric; v_method_balance numeric;
  v_pm text := COALESCE(NULLIF(NEW.payment_method, ''), 'cash');
  v_label text;
BEGIN
  IF NEW.category = 'تصحيح قيد عكسي'
     AND COALESCE(current_setting('app.treasury_correction_override', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.category = 'إلغاء سند'
     AND COALESCE(current_setting('app.voucher_cancel_reversal', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.type = 'expense' THEN
    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_balance FROM public.treasury WHERE branch_id = NEW.branch_id;
    IF v_balance < NEW.amount THEN
      RAISE EXCEPTION 'رصيد الخزنة غير كافٍ — الرصيد الحالي: % جنيه', v_balance USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_method_balance FROM public.treasury
      WHERE branch_id = NEW.branch_id AND COALESCE(NULLIF(payment_method, ''), 'cash') = v_pm;
    IF v_method_balance < NEW.amount THEN
      v_label := CASE v_pm
        WHEN 'cash' THEN 'النقدي' WHEN 'instapay' THEN 'انستاباي' WHEN 'bank' THEN 'الحساب البنكي'
        WHEN 'bank_transfer' THEN 'التحويل البنكي' WHEN 'vodafone' THEN 'فودافون كاش' WHEN 'wallet' THEN 'المحفظة'
        ELSE v_pm END;
      RAISE EXCEPTION 'رصيد % مش كفاية — المتاح % جنيه والمطلوب % جنيه. اختار وسيلة دفع تانية أو حوّل رصيد للوسيلة دي الأول.',
        v_label, v_method_balance, NEW.amount USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.cancel_voucher(p_voucher_id uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v vouchers%ROWTYPE;
  t treasury%ROWTYPE;
  uname TEXT; v_cat_key TEXT; v_advance_id UUID; v_paid_count INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO v FROM vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF v.status = 'cancelled' THEN RAISE EXCEPTION 'السند ملغي بالفعل'; END IF;

  IF NOT is_super_admin(auth.uid()) THEN
    IF v.tenant_id IS DISTINCT FROM current_tenant_id() THEN RAISE EXCEPTION 'غير مصرح: السند يخص شركة أخرى'; END IF;
    IF NOT (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), v.branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))) THEN
      RAISE EXCEPTION 'ليس لديك صلاحية لإلغاء السند';
    END IF;
  END IF;
  IF v.source = 'system' AND v.source_type <> 'treasury' THEN
    RAISE EXCEPTION 'السند مرتبط بـ % — قم بإلغاء المصدر أولاً', v.source_type;
  END IF;
  IF v.source = 'system' AND NOT is_admin(auth.uid()) AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'السندات التلقائية لا تُلغى إلا من قبل المدير العام';
  END IF;
  IF COALESCE(NULLIF(trim(p_reason),''), NULL) IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;

  SELECT system_key INTO v_cat_key FROM voucher_categories WHERE id = v.category_id;
  IF v_cat_key = 'advance' AND v.treasury_id IS NOT NULL THEN
    SELECT reference_id INTO v_advance_id FROM treasury WHERE id = v.treasury_id;
    IF v_advance_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_paid_count FROM advance_payments WHERE advance_id = v_advance_id;
      IF v_paid_count > 0 THEN RAISE EXCEPTION 'لا يمكن إلغاء سند سلفة تم سداد % قسط/أقساط منها', v_paid_count; END IF;
      UPDATE advance_requests SET status = 'rejected'::advance_request_status,
             admin_note = COALESCE(admin_note,'') || ' [تم إلغاء سند السلفة: ' || p_reason || ']', updated_at = now()
       WHERE resulting_advance_id = v_advance_id;
      DELETE FROM advances WHERE id = v_advance_id;
    END IF;
  END IF;

  IF v.treasury_id IS NOT NULL THEN
    SELECT * INTO t FROM treasury WHERE id = v.treasury_id;
    IF FOUND THEN
      PERFORM set_config('app.skip_treasury_voucher','1', true);
      PERFORM set_config('app.voucher_cancel_reversal','1', true);
      INSERT INTO treasury (branch_id, tenant_id, type, category, amount, description, reference_id,
                            created_by, payment_method, reference_number, is_fee)
      VALUES (t.branch_id, t.tenant_id,
              CASE WHEN t.type = 'income' THEN 'expense'::treasury_type ELSE 'income'::treasury_type END,
              'إلغاء سند', t.amount,
              'حركة عكسية لإلغاء السند ' || v.voucher_number || ' — ' || p_reason,
              v.id, auth.uid(), t.payment_method, v.voucher_number, COALESCE(t.is_fee,false));
      PERFORM set_config('app.voucher_cancel_reversal','0', true);
      PERFORM set_config('app.skip_treasury_voucher','0', true);
    END IF;
  END IF;

  UPDATE vouchers SET status='cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = p_reason
   WHERE id = p_voucher_id;

  SELECT name INTO uname FROM profiles WHERE id = auth.uid();
  INSERT INTO audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), COALESCE(uname,'?'), v.tenant_id, v.branch_id, 'CANCEL', 'voucher', v.id::text,
          jsonb_build_object('voucher_number', v.voucher_number, 'reason', p_reason, 'treasury_reversed', v.treasury_id IS NOT NULL));
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_sale_full(
  p_branch_id uuid, p_customer_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_percent numeric,
  p_discount_reason text, p_total numeric, p_payment_method text, p_items jsonb, p_payments jsonb,
  p_vat_rate numeric, p_vat_amount numeric, p_invoice_date date,
  p_recipient text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_credit_to_apply numeric DEFAULT 0, p_settlement_amount numeric DEFAULT 0, p_received_by_name text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_inv uuid; v_uid uuid := auth.uid(); v_gate record; v_credit numeric; v_tenant uuid;
  v_admin boolean := is_admin(auth.uid()) OR is_super_admin(auth.uid());
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  IF NOT v_admin THEN
    SELECT * INTO v_gate FROM shift_sale_gate(p_branch_id) LIMIT 1;
    IF v_gate IS NULL OR NOT COALESCE(v_gate.allowed, false) THEN
      RAISE EXCEPTION 'لازم تفتح وردية برصيد بداية الدرج قبل البيع (%)', COALESCE(v_gate.reason, 'no_shift');
    END IF;
    IF p_invoice_date IS NOT NULL AND p_invoice_date <> cairo_today() THEN
      RAISE EXCEPTION 'تغيير تاريخ الفاتورة متاح لمدير النظام فقط';
    END IF;
  END IF;

  v_inv := process_sale(p_branch_id, p_customer_id, p_subtotal, p_discount_amount, p_discount_percent,
                        p_discount_reason, p_total, p_payment_method, p_items, p_payments,
                        p_vat_rate, p_vat_amount, p_invoice_date);

  IF NULLIF(trim(COALESCE(p_recipient,'')),'') IS NOT NULL OR NULLIF(trim(COALESCE(p_notes,'')),'') IS NOT NULL THEN
    PERFORM set_document_annotations('invoice', v_inv, p_recipient, p_notes);
  END IF;
  IF NULLIF(trim(COALESCE(p_notes,'')),'') IS NOT NULL THEN
    PERFORM set_invoice_meta(v_inv, NULL, trim(p_notes));
  END IF;

  IF COALESCE(p_credit_to_apply,0) > 0 THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'استخدام الرصيد السابق يحتاج عميل'; END IF;
    SELECT COALESCE(credit_balance,0), tenant_id INTO v_credit, v_tenant FROM contacts WHERE id = p_customer_id FOR UPDATE;
    IF p_credit_to_apply > v_credit + 0.005 THEN
      RAISE EXCEPTION 'الرصيد السابق للعميل (%) أقل من المطلوب استخدامه (%)', v_credit, p_credit_to_apply;
    END IF;
    INSERT INTO invoice_payments (invoice_id, tenant_id, branch_id, payment_method, amount, received_by_name)
    VALUES (v_inv, v_tenant, p_branch_id, 'credit_balance', p_credit_to_apply, COALESCE(p_received_by_name,'رصيد سابق'));
    UPDATE contacts SET credit_balance = GREATEST(0, v_credit - p_credit_to_apply),
           refund_status = CASE WHEN GREATEST(0, v_credit - p_credit_to_apply) = 0 THEN 'credit_used' ELSE 'credit_added' END
     WHERE id = p_customer_id;
    INSERT INTO customer_credit_log (contact_id, invoice_id, amount, type, notes, created_by)
    VALUES (p_customer_id, v_inv, p_credit_to_apply, 'credit_used', 'استخدام رصيد سابق في فاتورة جديدة', v_uid);
  END IF;

  IF COALESCE(p_settlement_amount,0) > 0 THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'المقاصة تحتاج عميل'; END IF;
    PERFORM record_contact_payment(p_customer_id, p_branch_id, 'in', p_settlement_amount, 'settlement',
      NULL, NULL, COALESCE(p_received_by_name,'مقاصة'), 0, NULL, false,
      'مقاصة على فاتورة ' || v_inv::text, NULL, v_inv);
  END IF;

  RETURN v_inv;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_sale_full(uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb,numeric,numeric,date,text,text,numeric,numeric,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_sale_full(uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb,numeric,numeric,date,text,text,numeric,numeric,text) TO authenticated, service_role;