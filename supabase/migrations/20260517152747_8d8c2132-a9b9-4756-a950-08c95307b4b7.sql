
-- 1. Pre-order transactions: payment reference fields
ALTER TABLE public.pre_order_transactions
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS transfer_to_account text,
  ADD COLUMN IF NOT EXISTS received_by_name text;

-- 2. Treasury transfers: acknowledgment
ALTER TABLE public.treasury_transfers
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS reference_number text;

-- 3. Acknowledge function
CREATE OR REPLACE FUNCTION public.acknowledge_treasury_transfer(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tr record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO v_tr FROM public.treasury_transfers WHERE id = p_transfer_id;
  IF v_tr IS NULL THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF NOT (is_admin(v_user) OR user_in_branch(v_user, v_tr.to_branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية تأكيد هذا التحويل';
  END IF;
  IF v_tr.acknowledged_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.treasury_transfers
    SET acknowledged_at = now(), acknowledged_by = v_user
    WHERE id = p_transfer_id;

  -- Notify sender branch manager(s)
  INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
  SELECT bu.user_id, v_tr.tenant_id,
         '✅ تأكيد استلام تحويل',
         'تم تأكيد استلام التحويل بقيمة ' || v_tr.amount || ' ج.م',
         'general', 'treasury_transfer', v_tr.id,
         '/branch/' || v_tr.from_branch_id || '/treasury'
  FROM public.branch_users bu
  JOIN public.user_roles ur ON ur.user_id = bu.user_id
  WHERE bu.branch_id = v_tr.from_branch_id AND ur.role = 'branch_manager';
END;
$$;

-- 4. Update create_pre_order to accept payment reference
CREATE OR REPLACE FUNCTION public.create_pre_order(
  p_branch_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text,
  p_price_list_item_id uuid, p_product_name text, p_model_code text,
  p_quantity integer, p_expected_price numeric, p_deposit_amount numeric,
  p_payment_method text, p_notes text,
  p_reference_number text DEFAULT NULL,
  p_transfer_to_account text DEFAULT NULL,
  p_received_by_name text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_name text;
  v_id uuid;
  v_treasury_id uuid;
  v_admin uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT user_in_branch(v_user, p_branch_id) THEN RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع'; END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
  IF COALESCE(p_deposit_amount,0) < 0 THEN RAISE EXCEPTION 'مبلغ عربون غير صحيح'; END IF;
  IF COALESCE(p_deposit_amount,0) > COALESCE(p_expected_price,0) * p_quantity THEN
    RAISE EXCEPTION 'العربون أكبر من السعر الإجمالي';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;
  SELECT name INTO v_name FROM public.profiles WHERE id = v_user;

  INSERT INTO public.pre_orders(
    tenant_id, branch_id, customer_id, customer_name, customer_phone,
    price_list_item_id, product_name, model_code, quantity, expected_price,
    deposit_amount, notes, created_by, created_by_name
  ) VALUES (
    v_tenant, p_branch_id, p_customer_id, p_customer_name, p_customer_phone,
    p_price_list_item_id, p_product_name, p_model_code, p_quantity, p_expected_price,
    COALESCE(p_deposit_amount,0), p_notes, v_user, COALESCE(v_name,'cashier')
  ) RETURNING id INTO v_id;

  IF COALESCE(p_deposit_amount,0) > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id)
    VALUES (p_branch_id, 'income', 'pre_order_deposit', p_deposit_amount,
            'عربون حجز ' || (SELECT order_number FROM public.pre_orders WHERE id = v_id),
            v_id, v_user, v_tenant)
    RETURNING id INTO v_treasury_id;

    INSERT INTO public.pre_order_transactions(
      pre_order_id, tenant_id, branch_id, type, amount, payment_method, treasury_id, created_by,
      reference_number, transfer_to_account, received_by_name
    ) VALUES (v_id, v_tenant, p_branch_id, 'deposit_received', p_deposit_amount,
              COALESCE(p_payment_method,'cash'), v_treasury_id, v_user,
              p_reference_number, p_transfer_to_account, p_received_by_name);
  END IF;

  FOR v_admin IN
    SELECT ur.user_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'admin' AND p.tenant_id = v_tenant
  LOOP
    INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
    VALUES (v_admin, v_tenant, '📝 حجز جديد',
            p_product_name || ' — ' || p_customer_name,
            'pre_order_new', 'pre_order', v_id,
            '/branch/' || p_branch_id || '/pre-orders');
  END LOOP;

  RETURN v_id;
END;
$$;
