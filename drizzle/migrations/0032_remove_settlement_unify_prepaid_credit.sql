DO $mig$
DECLARE d text; n text;
BEGIN
  -- 1) process_sale: remove phantom-cash branch
  d := pg_get_functiondef('public.process_sale'::regproc);
  n := regexp_replace(d, '  ELSIF p_payments IS NULL AND v_calc_total > 0.*?v_ts\s*\);\s*\n', '  -- phantom-cash branch removed: treasury rows only for real payments' || chr(10), '');
  IF n = d THEN RAISE EXCEPTION 'process_sale pattern not found'; END IF;
  EXECUTE n;

  -- 2) record_contact_payment: settlement path removed
  d := pg_get_functiondef('public.record_contact_payment'::regproc);
  n := replace(d, 'v_is_settlement boolean := (p_payment_method = ''settlement'');', 'v_is_settlement boolean := false;');
  n := replace(n, '  IF v_uid IS NULL THEN RAISE EXCEPTION ''unauthorized''; END IF;',
    '  IF v_uid IS NULL THEN RAISE EXCEPTION ''unauthorized''; END IF;
  IF p_payment_method IN (''settlement'',''credit_balance'',''credit_applied'') THEN
    RAISE EXCEPTION ''المقاصة أُلغيت — الخصم من الرصيد المسبق يتم من شاشة البيع فقط'';
  END IF;');
  IF n = d THEN RAISE EXCEPTION 'record_contact_payment pattern not found'; END IF;
  EXECUTE n;

  -- 3) contact_branch_balances: no settlement special-case
  d := pg_get_functiondef('public.contact_branch_balances'::regproc);
  n := replace(d, 'ip.payment_method<>''settlement'' AND ', '');
  EXECUTE n;
END $mig$;

DROP FUNCTION IF EXISTS public.process_sale_full(uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb,numeric,numeric,date,text,text,numeric,numeric,text);

CREATE OR REPLACE FUNCTION public.process_sale_full(p_branch_id uuid, p_customer_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_percent numeric, p_discount_reason text, p_total numeric, p_payment_method text, p_items jsonb, p_payments jsonb, p_vat_rate numeric, p_vat_amount numeric, p_invoice_date date, p_recipient text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_credit_to_apply numeric DEFAULT 0, p_received_by_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv uuid; v_uid uuid := auth.uid(); v_gate record; v_credit numeric; v_tenant uuid;
  v_admin boolean := is_admin(auth.uid()) OR is_super_admin(auth.uid());
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_payments IS NULL THEN RAISE EXCEPTION 'قائمة الدفعات مطلوبة (أرسل [] للآجل)'; END IF;

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
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'الخصم من الرصيد المسبق يحتاج عميل'; END IF;
    SELECT COALESCE(credit_balance,0), tenant_id INTO v_credit, v_tenant FROM contacts WHERE id = p_customer_id FOR UPDATE;
    -- credit_balance < 0 means prepaid credit available to the customer
    IF p_credit_to_apply > GREATEST(-v_credit,0) + 0.005 THEN
      RAISE EXCEPTION 'الرصيد المسبق المتاح للعميل (%) أقل من المطلوب خصمه (%)', GREATEST(-v_credit,0), p_credit_to_apply;
    END IF;
    IF p_credit_to_apply > public.invoice_outstanding_debt(v_inv, NULL) + 0.005 THEN
      RAISE EXCEPTION 'الخصم من الرصيد أكبر من المتبقي على الفاتورة';
    END IF;
    INSERT INTO invoice_payments (invoice_id, tenant_id, branch_id, payment_method, amount, received_by_name)
    VALUES (v_inv, v_tenant, p_branch_id, 'credit_balance', p_credit_to_apply, COALESCE(p_received_by_name,'رصيد مسبق'));
    UPDATE contacts SET credit_balance = LEAST(0, v_credit + p_credit_to_apply),
           refund_status = CASE WHEN LEAST(0, v_credit + p_credit_to_apply) = 0 THEN 'credit_used' ELSE 'credit_added' END
     WHERE id = p_customer_id;
    INSERT INTO customer_credit_log (contact_id, invoice_id, amount, type, notes, created_by)
    VALUES (p_customer_id, v_inv, p_credit_to_apply, 'credit_used', 'خصم من الرصيد المسبق في فاتورة بيع', v_uid);
  END IF;

  RETURN v_inv;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.process_sale_full(uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb,numeric,numeric,date,text,text,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.treasury_block_non_cash_methods()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF LOWER(COALESCE(NEW.payment_method,'')) IN ('settlement','credit_balance','credit_applied','credit') THEN
    RAISE EXCEPTION 'الخزينة تقبل المال الحقيقي فقط (طريقة % مرفوضة)', NEW.payment_method;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_treasury_block_non_cash ON public.treasury;
CREATE TRIGGER trg_treasury_block_non_cash BEFORE INSERT OR UPDATE OF payment_method ON public.treasury
FOR EACH ROW EXECUTE FUNCTION public.treasury_block_non_cash_methods();