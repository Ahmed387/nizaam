
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.process_sale(
  p_branch_id uuid, p_customer_id uuid, p_subtotal numeric,
  p_discount_amount numeric, p_discount_percent numeric, p_discount_reason text,
  p_total numeric, p_payment_method text, p_items jsonb,
  p_payments jsonb DEFAULT NULL::jsonb,
  p_vat_rate numeric DEFAULT 0, p_vat_amount numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_user_name text;
  v_tenant uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_item jsonb;
  v_pay jsonb;
  v_pid uuid;
  v_qty int;
  v_current int;
  v_sp numeric;
  v_cp numeric;
  v_ld numeric;
  v_eff_unit numeric;
  v_pay_sum numeric := 0;
  v_line_total numeric;
  v_fee numeric;
  v_fee_on_cust boolean;
  v_pm text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_total < 0 OR p_subtotal < 0 THEN RAISE EXCEPTION 'مبالغ غير صحيحة'; END IF;
  IF NOT public.user_in_branch(v_user, p_branch_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;
  SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    v_pid := (v_item->>'product_id')::uuid;
    IF v_pid IS NULL THEN RAISE EXCEPTION 'منتج غير محدد'; END IF;
    v_sp := COALESCE((v_item->>'selling_price')::numeric, 0);
    v_cp := COALESCE((v_item->>'cost_price')::numeric, 0);
    v_ld := COALESCE((v_item->>'line_discount')::numeric, 0);
    IF v_ld < 0 THEN RAISE EXCEPTION 'خصم غير صحيح'; END IF;

    SELECT quantity INTO v_current FROM public.products WHERE id = v_pid AND branch_id = p_branch_id FOR UPDATE;
    IF v_current IS NULL THEN RAISE EXCEPTION 'منتج غير موجود في هذا الفرع'; END IF;
    IF v_current < v_qty THEN RAISE EXCEPTION 'الكمية المتاحة غير كافية (متاح: %)', v_current; END IF;

    v_line_total := v_qty * v_sp - v_ld;
    IF v_line_total < 0 THEN RAISE EXCEPTION 'إجمالي السطر سالب'; END IF;
    IF v_cp > 0 THEN
      v_eff_unit := v_line_total / v_qty;
      IF v_eff_unit < v_cp THEN
        RAISE EXCEPTION 'لا يمكن البيع بأقل من سعر التكلفة للمنتج: %', v_item->>'product_name';
      END IF;
    END IF;
  END LOOP;

  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      v_pay_sum := v_pay_sum + COALESCE((v_pay->>'amount')::numeric, 0);
      v_pm := COALESCE(v_pay->>'payment_method', 'cash');
      IF v_pm <> 'cash' AND v_pm <> 'credit_balance' THEN
        IF COALESCE(NULLIF(v_pay->>'reference_number',''), '') = '' THEN
          RAISE EXCEPTION 'رقم العملية مطلوب للتحويلات الإلكترونية';
        END IF;
        IF COALESCE(NULLIF(v_pay->>'transfer_from_account',''), '') = '' THEN
          RAISE EXCEPTION 'رقم الحساب المحول منه مطلوب للتحويلات الإلكترونية';
        END IF;
        IF COALESCE(NULLIF(v_pay->>'transfer_to_account',''), '') = '' THEN
          RAISE EXCEPTION 'رقم الحساب المحول إليه مطلوب للتحويلات الإلكترونية';
        END IF;
      END IF;
    END LOOP;
    IF v_pay_sum > p_total + 0.01 THEN
      RAISE EXCEPTION 'مجموع طرق الدفع (%) أكبر من إجمالي الفاتورة (%)', v_pay_sum, p_total;
    END IF;
  END IF;

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.invoices(
    invoice_number, branch_id, contact_id, cashier_id,
    subtotal, discount_amount, discount_percent, discount_reason,
    total, payment_method, tenant_id, vat_rate, vat_amount
  ) VALUES (
    v_invoice_number, p_branch_id, p_customer_id, v_user,
    p_subtotal, p_discount_amount, p_discount_percent, p_discount_reason,
    p_total, COALESCE(p_payment_method, 'cash'), v_tenant,
    COALESCE(p_vat_rate, 0), COALESCE(p_vat_amount, 0)
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    v_pid := (v_item->>'product_id')::uuid;
    v_sp := COALESCE((v_item->>'selling_price')::numeric, 0);
    v_ld := COALESCE((v_item->>'line_discount')::numeric, 0);

    INSERT INTO public.invoice_items(
      invoice_id, product_id, product_name, quantity,
      cost_price, selling_price, market_price, total, tenant_id,
      price_list_item_id, price_list_cost, line_discount
    ) VALUES (
      v_invoice_id, v_pid, v_item->>'product_name', v_qty,
      COALESCE((v_item->>'cost_price')::numeric, 0), v_sp,
      COALESCE((v_item->>'market_price')::numeric, 0),
      v_qty * v_sp - v_ld, v_tenant,
      NULLIF(v_item->>'price_list_item_id','')::uuid, NULL, v_ld
    );
    UPDATE public.products SET quantity = quantity - v_qty WHERE id = v_pid;
  END LOOP;

  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      v_pm := COALESCE(v_pay->>'payment_method', 'cash');
      v_fee := COALESCE((v_pay->>'fee_amount')::numeric, 0);
      v_fee_on_cust := COALESCE((v_pay->>'fee_on_customer')::boolean, false);

      INSERT INTO public.invoice_payments(
        invoice_id, tenant_id, branch_id,
        payment_method, amount, reference_number, received_by_name,
        transfer_to_account, transfer_from_account,
        fee_amount, fee_on_customer
      ) VALUES (
        v_invoice_id, v_tenant, p_branch_id,
        v_pm, (v_pay->>'amount')::numeric,
        NULLIF(v_pay->>'reference_number',''),
        COALESCE(NULLIF(v_pay->>'received_by_name',''), v_user_name),
        NULLIF(v_pay->>'transfer_to_account',''),
        NULLIF(v_pay->>'transfer_from_account',''),
        v_fee, v_fee_on_cust
      );

      IF v_fee > 0 AND NOT v_fee_on_cust THEN
        INSERT INTO public.expenses(
          branch_id, type, amount, description, date,
          payment_method, reference_number, is_fee, created_by, tenant_id
        ) VALUES (
          p_branch_id, 'عمولة تحويل', v_fee,
          'عمولة ' || v_pm || ' — فاتورة ' || v_invoice_number,
          CURRENT_DATE, v_pm, NULLIF(v_pay->>'reference_number',''),
          true, v_user, v_tenant
        );
      END IF;
    END LOOP;
  END IF;

  IF v_pay_sum > 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      reference_id, created_by, tenant_id
    ) VALUES (
      p_branch_id, 'income', 'sales', v_pay_sum,
      'فاتورة ' || v_invoice_number, v_invoice_id, v_user, v_tenant
    );
  ELSIF p_payments IS NULL AND p_total > 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      reference_id, created_by, tenant_id
    ) VALUES (
      p_branch_id, 'income', 'sales', p_total,
      'فاتورة ' || v_invoice_number, v_invoice_id, v_user, v_tenant
    );
  END IF;

  RETURN v_invoice_id;
END;
$function$;
