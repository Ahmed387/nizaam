-- 1) Per-line discount on invoice items
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS line_discount numeric NOT NULL DEFAULT 0;

-- 2) Multi payments per invoice
CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  tenant_id uuid,
  branch_id uuid NOT NULL,
  payment_method text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  reference_number text,
  received_by_name text,
  transfer_to_account text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON public.invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_tenant ON public.invoice_payments(tenant_id);

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invpay_read ON public.invoice_payments;
CREATE POLICY invpay_read ON public.invoice_payments FOR SELECT
USING (
  ((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id))
  OR is_super_admin(auth.uid())
  OR ((tenant_id = current_tenant_id()) AND is_admin(auth.uid()))
);

DROP POLICY IF EXISTS invpay_write ON public.invoice_payments;
CREATE POLICY invpay_write ON public.invoice_payments FOR ALL
USING ((tenant_id = current_tenant_id()) OR is_super_admin(auth.uid()))
WITH CHECK ((tenant_id = current_tenant_id()) OR is_super_admin(auth.uid()));

DROP POLICY IF EXISTS invpay_suspended ON public.invoice_payments;
CREATE POLICY invpay_suspended ON public.invoice_payments AS RESTRICTIVE FOR ALL
USING (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended())
WITH CHECK (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended());

-- 3) Updated process_sale — adds line_discount per item, multi-payments, loss guard
DROP FUNCTION IF EXISTS public.process_sale(uuid, uuid, numeric, numeric, numeric, text, numeric, text, jsonb);

CREATE OR REPLACE FUNCTION public.process_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_percent numeric,
  p_discount_reason text,
  p_total numeric,
  p_payment_method text,
  p_items jsonb,
  p_payments jsonb DEFAULT NULL
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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_total < 0 OR p_subtotal < 0 THEN RAISE EXCEPTION 'مبالغ غير صحيحة'; END IF;
  IF NOT public.user_in_branch(v_user, p_branch_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;
  SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user;

  -- Validate stock + loss-guard
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    v_pid := (v_item->>'product_id')::uuid;
    IF v_pid IS NULL THEN RAISE EXCEPTION 'منتج غير محدد'; END IF;
    v_sp := COALESCE((v_item->>'selling_price')::numeric, 0);
    v_cp := COALESCE((v_item->>'cost_price')::numeric, 0);
    v_ld := COALESCE((v_item->>'line_discount')::numeric, 0);
    IF v_ld < 0 THEN RAISE EXCEPTION 'خصم غير صحيح'; END IF;

    SELECT quantity INTO v_current
      FROM public.products
      WHERE id = v_pid AND branch_id = p_branch_id
      FOR UPDATE;

    IF v_current IS NULL THEN RAISE EXCEPTION 'منتج غير موجود في هذا الفرع'; END IF;
    IF v_current < v_qty THEN RAISE EXCEPTION 'الكمية المتاحة غير كافية (متاح: %)', v_current; END IF;

    v_line_total := v_qty * v_sp - v_ld;
    IF v_line_total < 0 THEN RAISE EXCEPTION 'إجمالي السطر سالب'; END IF;

    -- Loss guard: effective unit price after line discount must be >= cost (when cost > 0)
    IF v_cp > 0 THEN
      v_eff_unit := v_line_total / v_qty;
      IF v_eff_unit < v_cp THEN
        RAISE EXCEPTION 'لا يمكن البيع بأقل من سعر التكلفة للمنتج: %', v_item->>'product_name';
      END IF;
    END IF;
  END LOOP;

  -- Validate payments sum (if provided)
  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      v_pay_sum := v_pay_sum + COALESCE((v_pay->>'amount')::numeric, 0);
    END LOOP;
    IF ABS(v_pay_sum - p_total) > 0.01 THEN
      RAISE EXCEPTION 'مجموع طرق الدفع (%) لا يساوي إجمالي الفاتورة (%)', v_pay_sum, p_total;
    END IF;
  END IF;

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.invoices(
    invoice_number, branch_id, customer_id, cashier_id,
    subtotal, discount_amount, discount_percent, discount_reason,
    total, payment_method, tenant_id
  ) VALUES (
    v_invoice_number, p_branch_id, p_customer_id, v_user,
    p_subtotal, p_discount_amount, p_discount_percent, p_discount_reason,
    p_total, COALESCE(p_payment_method, 'cash'), v_tenant
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
      COALESCE((v_item->>'cost_price')::numeric, 0),
      v_sp,
      COALESCE((v_item->>'market_price')::numeric, 0),
      v_qty * v_sp - v_ld,
      v_tenant,
      NULLIF(v_item->>'price_list_item_id','')::uuid,
      NULL,
      v_ld
    );

    UPDATE public.products SET quantity = quantity - v_qty WHERE id = v_pid;
  END LOOP;

  -- Multi-payments
  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      INSERT INTO public.invoice_payments(
        invoice_id, tenant_id, branch_id,
        payment_method, amount, reference_number, received_by_name, transfer_to_account
      ) VALUES (
        v_invoice_id, v_tenant, p_branch_id,
        COALESCE(v_pay->>'payment_method', 'cash'),
        (v_pay->>'amount')::numeric,
        NULLIF(v_pay->>'reference_number',''),
        COALESCE(NULLIF(v_pay->>'received_by_name',''), v_user_name),
        NULLIF(v_pay->>'transfer_to_account','')
      );
    END LOOP;
  END IF;

  IF p_total > 0 THEN
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