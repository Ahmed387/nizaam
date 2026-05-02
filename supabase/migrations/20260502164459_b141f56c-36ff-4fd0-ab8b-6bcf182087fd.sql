
-- =========================================================
-- 1) CHECK CONSTRAINTS - منع القيم السالبة
-- =========================================================

-- منع الكميات السالبة في المنتجات
ALTER TABLE public.products
  ADD CONSTRAINT products_quantity_non_negative CHECK (quantity >= 0);

-- منع الفواتير بمبالغ سالبة
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_total_non_negative CHECK (total >= 0),
  ADD CONSTRAINT invoices_subtotal_non_negative CHECK (subtotal >= 0),
  ADD CONSTRAINT invoices_discount_non_negative CHECK (discount_amount >= 0);

-- عناصر الفاتورة
ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_qty_positive CHECK (quantity > 0),
  ADD CONSTRAINT invoice_items_total_non_negative CHECK (total >= 0),
  ADD CONSTRAINT invoice_items_prices_non_negative CHECK (selling_price >= 0 AND cost_price >= 0);

-- الخزينة
ALTER TABLE public.treasury
  ADD CONSTRAINT treasury_amount_positive CHECK (amount > 0);

ALTER TABLE public.treasury_transfers
  ADD CONSTRAINT treasury_transfers_amount_positive CHECK (amount > 0);

ALTER TABLE public.stock_transfers
  ADD CONSTRAINT stock_transfers_qty_positive CHECK (quantity > 0);

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0);

ALTER TABLE public.shipment_items
  ADD CONSTRAINT shipment_items_qty_positive CHECK (quantity > 0);

-- =========================================================
-- 2) RPC: process_sale - بيع ذرّي بقفل المخزون
-- =========================================================
CREATE OR REPLACE FUNCTION public.process_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_percent numeric,
  p_discount_reason text,
  p_total numeric,
  p_payment_method text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_item jsonb;
  v_pid uuid;
  v_qty int;
  v_current int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_total < 0 OR p_subtotal < 0 THEN RAISE EXCEPTION 'مبالغ غير صحيحة'; END IF;

  -- صلاحية الفرع
  IF NOT public.user_in_branch(v_user, p_branch_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;

  -- قفل صفوف المنتجات لمنع race condition
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;

    SELECT quantity INTO v_current
      FROM public.products
      WHERE id = v_pid AND branch_id = p_branch_id
      FOR UPDATE;

    IF v_current IS NULL THEN
      RAISE EXCEPTION 'منتج غير موجود في هذا الفرع';
    END IF;
    IF v_current < v_qty THEN
      RAISE EXCEPTION 'الكمية المتاحة غير كافية (متاح: %)', v_current;
    END IF;
  END LOOP;

  -- رقم الفاتورة
  v_invoice_number := public.next_invoice_number();

  -- إنشاء الفاتورة
  INSERT INTO public.invoices(
    invoice_number, branch_id, customer_id, cashier_id,
    subtotal, discount_amount, discount_percent, discount_reason,
    total, payment_method, tenant_id
  ) VALUES (
    v_invoice_number, p_branch_id, p_customer_id, v_user,
    p_subtotal, p_discount_amount, p_discount_percent, p_discount_reason,
    p_total, COALESCE(p_payment_method, 'cash'), v_tenant
  ) RETURNING id INTO v_invoice_id;

  -- إدخال العناصر + خصم المخزون
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;

    INSERT INTO public.invoice_items(
      invoice_id, product_id, product_name, quantity,
      cost_price, selling_price, market_price, total, tenant_id
    ) VALUES (
      v_invoice_id, v_pid, v_item->>'product_name', v_qty,
      COALESCE((v_item->>'cost_price')::numeric, 0),
      COALESCE((v_item->>'selling_price')::numeric, 0),
      COALESCE((v_item->>'market_price')::numeric, 0),
      v_qty * COALESCE((v_item->>'selling_price')::numeric, 0),
      v_tenant
    );

    UPDATE public.products
       SET quantity = quantity - v_qty
     WHERE id = v_pid;
  END LOOP;

  -- إيراد الخزينة
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
$$;

-- =========================================================
-- 3) RPC: transfer_stock_atomic
-- =========================================================
CREATE OR REPLACE FUNCTION public.transfer_stock_atomic(
  p_from_branch uuid,
  p_to_branch uuid,
  p_product_id uuid,
  p_quantity int,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_current int;
  v_transfer_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
  IF NOT public.user_in_branch(v_user, p_from_branch) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المرسل';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_from_branch;

  -- قفل المنتج وخصم الكمية
  SELECT quantity INTO v_current
    FROM public.products
    WHERE id = p_product_id AND branch_id = p_from_branch
    FOR UPDATE;

  IF v_current IS NULL THEN RAISE EXCEPTION 'المنتج غير موجود'; END IF;
  IF v_current < p_quantity THEN
    RAISE EXCEPTION 'الكمية المتاحة غير كافية (متاح: %)', v_current;
  END IF;

  UPDATE public.products SET quantity = quantity - p_quantity WHERE id = p_product_id;

  INSERT INTO public.stock_transfers(
    from_branch_id, to_branch_id, product_id, quantity, reason, transferred_by, status, tenant_id
  ) VALUES (
    p_from_branch, p_to_branch, p_product_id, p_quantity, p_reason, v_user, 'pending', v_tenant
  ) RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;

-- =========================================================
-- 4) RPC: transfer_treasury_atomic
-- =========================================================
CREATE OR REPLACE FUNCTION public.transfer_treasury_atomic(
  p_from_branch uuid,
  p_to_branch uuid,
  p_amount numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_transfer_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'مبلغ غير صحيح'; END IF;
  IF NOT public.user_in_branch(v_user, p_from_branch) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المرسل';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_from_branch;

  INSERT INTO public.treasury_transfers(
    from_branch_id, to_branch_id, amount, reason, transferred_by, tenant_id
  ) VALUES (
    p_from_branch, p_to_branch, p_amount, p_reason, v_user, v_tenant
  ) RETURNING id INTO v_transfer_id;

  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id)
  VALUES
    (p_from_branch, 'expense', 'transfer', p_amount, 'تحويل لفرع: ' || COALESCE(p_reason, ''), v_user, v_tenant),
    (p_to_branch,   'income',  'transfer', p_amount, 'تحويل وارد: '  || COALESCE(p_reason, ''), v_user, v_tenant);

  RETURN v_transfer_id;
END;
$$;

-- =========================================================
-- 5) إلغاء جلسة الموظف فور حذفه
-- =========================================================
CREATE OR REPLACE FUNCTION public.revoke_employee_auth_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.user_id IS NOT NULL THEN
    -- حذف كل جلسات المستخدم — يبطل JWT فوراً
    DELETE FROM auth.sessions WHERE user_id = OLD.user_id;
    DELETE FROM auth.refresh_tokens WHERE user_id::uuid = OLD.user_id;
  END IF;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- لا نمنع حذف الموظف لو فشل إلغاء الجلسة
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_revoke_employee_session ON public.employees;
CREATE TRIGGER trg_revoke_employee_session
  AFTER DELETE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.revoke_employee_auth_on_delete();
