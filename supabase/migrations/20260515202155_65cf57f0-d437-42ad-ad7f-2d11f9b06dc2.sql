
-- Status enum
CREATE TYPE public.pre_order_status AS ENUM ('pending','received','completed','cancelled');
CREATE TYPE public.pre_order_tx_type AS ENUM ('deposit_received','deposit_refunded','final_payment');

-- Sequence for order numbers
CREATE SEQUENCE IF NOT EXISTS public.pre_order_seq;

CREATE OR REPLACE FUNCTION public.next_pre_order_number()
RETURNS text LANGUAGE sql SET search_path TO 'public' AS $$
  SELECT 'PO-' || EXTRACT(YEAR FROM now())::TEXT || '-' || LPAD(nextval('public.pre_order_seq')::TEXT, 5, '0')
$$;

-- Main table
CREATE TABLE public.pre_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  order_number text NOT NULL UNIQUE DEFAULT public.next_pre_order_number(),
  customer_id uuid,
  customer_name text NOT NULL,
  customer_phone text,
  price_list_item_id uuid,
  product_name text NOT NULL,
  model_code text,
  quantity int NOT NULL CHECK (quantity > 0),
  expected_price numeric NOT NULL DEFAULT 0,
  deposit_amount numeric NOT NULL DEFAULT 0,
  status public.pre_order_status NOT NULL DEFAULT 'pending',
  deposit_refunded boolean NOT NULL DEFAULT false,
  notes text,
  invoice_id uuid,
  created_by uuid NOT NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pre_orders_branch_status ON public.pre_orders(branch_id, status);
CREATE INDEX idx_pre_orders_pli ON public.pre_orders(price_list_item_id);
CREATE INDEX idx_pre_orders_product_name ON public.pre_orders(branch_id, lower(product_name));

CREATE TRIGGER touch_pre_orders BEFORE UPDATE ON public.pre_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.pre_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY po_read ON public.pre_orders FOR SELECT
  USING (((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));

CREATE POLICY po_insert ON public.pre_orders FOR INSERT
  WITH CHECK ((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id));

CREATE POLICY po_update ON public.pre_orders FOR UPDATE
  USING (((tenant_id = current_tenant_id()) AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(),'branch_manager')))) OR is_super_admin(auth.uid()));

CREATE POLICY po_suspended ON public.pre_orders AS RESTRICTIVE FOR ALL
  USING (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended()))
  WITH CHECK (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended()));

-- Transactions
CREATE TABLE public.pre_order_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_order_id uuid NOT NULL REFERENCES public.pre_orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  type public.pre_order_tx_type NOT NULL,
  amount numeric NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash',
  treasury_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pot_po ON public.pre_order_transactions(pre_order_id);

ALTER TABLE public.pre_order_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY pot_read ON public.pre_order_transactions FOR SELECT
  USING (((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));

-- Audit triggers
CREATE TRIGGER audit_pre_orders AFTER INSERT OR UPDATE OR DELETE ON public.pre_orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_pot AFTER INSERT OR UPDATE OR DELETE ON public.pre_order_transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- RPC: create_pre_order
CREATE OR REPLACE FUNCTION public.create_pre_order(
  p_branch_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_price_list_item_id uuid,
  p_product_name text,
  p_model_code text,
  p_quantity int,
  p_expected_price numeric,
  p_deposit_amount numeric,
  p_payment_method text,
  p_notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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
      pre_order_id, tenant_id, branch_id, type, amount, payment_method, treasury_id, created_by
    ) VALUES (v_id, v_tenant, p_branch_id, 'deposit_received', p_deposit_amount,
              COALESCE(p_payment_method,'cash'), v_treasury_id, v_user);
  END IF;

  -- Notify admins of tenant
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

-- RPC: complete_pre_order_sale
CREATE OR REPLACE FUNCTION public.complete_pre_order_sale(
  p_pre_order_id uuid,
  p_payment_method text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_po public.pre_orders%ROWTYPE;
  v_tenant uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_pid uuid;
  v_current int;
  v_qty_sell int;
  v_unit_price numeric;
  v_subtotal numeric;
  v_remaining numeric;
  v_cost numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  SELECT * INTO v_po FROM public.pre_orders WHERE id = p_pre_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحجز غير موجود'; END IF;
  IF v_po.status NOT IN ('pending','received') THEN RAISE EXCEPTION 'لا يمكن إتمام هذا الحجز (حالته: %)', v_po.status; END IF;
  IF NOT (is_admin(v_user) OR (has_role(v_user,'branch_manager') AND user_in_branch(v_user, v_po.branch_id)) OR user_in_branch(v_user, v_po.branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية';
  END IF;

  v_tenant := v_po.tenant_id;

  -- Find product in branch by name (case-insensitive)
  SELECT id, quantity, COALESCE(cost_price,0), COALESCE(selling_price,0)
    INTO v_pid, v_current, v_cost, v_unit_price
    FROM public.products
    WHERE branch_id = v_po.branch_id
      AND lower(name) = lower(v_po.product_name)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;

  IF v_pid IS NULL OR v_current IS NULL OR v_current <= 0 THEN
    RAISE EXCEPTION 'المنتج غير متاح في المخزون حالياً';
  END IF;

  -- Sell only what's available, capped by ordered quantity
  v_qty_sell := LEAST(v_current, v_po.quantity);
  v_unit_price := COALESCE(NULLIF(v_po.expected_price,0), v_unit_price);
  v_subtotal := v_unit_price * v_qty_sell;

  -- Remaining the customer pays now = subtotal - already paid deposit
  v_remaining := GREATEST(0, v_subtotal - COALESCE(v_po.deposit_amount,0));

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.invoices(
    invoice_number, branch_id, customer_id, cashier_id,
    subtotal, discount_amount, discount_percent, discount_reason,
    total, payment_method, tenant_id
  ) VALUES (
    v_invoice_number, v_po.branch_id, v_po.customer_id, v_user,
    v_subtotal, COALESCE(v_po.deposit_amount,0), 0,
    'خصم عربون حجز ' || v_po.order_number,
    v_remaining, COALESCE(p_payment_method,'cash'), v_tenant
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items(
    invoice_id, product_id, product_name, quantity,
    cost_price, selling_price, market_price, total, tenant_id,
    is_off_stock, price_list_item_id, price_list_cost
  ) VALUES (
    v_invoice_id, v_pid, v_po.product_name, v_qty_sell,
    v_cost, v_unit_price, 0,
    v_subtotal, v_tenant,
    false, v_po.price_list_item_id, NULL
  );

  UPDATE public.products SET quantity = quantity - v_qty_sell WHERE id = v_pid;

  -- Treasury: only the remaining amount enters now
  IF v_remaining > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id)
    VALUES (v_po.branch_id, 'income', 'sales', v_remaining,
            'فاتورة ' || v_invoice_number || ' — متبقي حجز ' || v_po.order_number,
            v_invoice_id, v_user, v_tenant);
  END IF;

  INSERT INTO public.pre_order_transactions(
    pre_order_id, tenant_id, branch_id, type, amount, payment_method, treasury_id, created_by
  ) VALUES (
    p_pre_order_id, v_tenant, v_po.branch_id, 'final_payment', v_remaining,
    COALESCE(p_payment_method,'cash'), NULL, v_user
  );

  -- Update pre-order status
  IF v_qty_sell >= v_po.quantity THEN
    UPDATE public.pre_orders
       SET status = 'completed', invoice_id = v_invoice_id, updated_at = now()
     WHERE id = p_pre_order_id;
  ELSE
    -- Partial: reduce remaining quantity, keep pending
    UPDATE public.pre_orders
       SET quantity = quantity - v_qty_sell,
           deposit_amount = 0, -- deposit already consumed
           updated_at = now()
     WHERE id = p_pre_order_id;
  END IF;

  RETURN v_invoice_id;
END;
$$;

-- RPC: cancel_pre_order
CREATE OR REPLACE FUNCTION public.cancel_pre_order(
  p_pre_order_id uuid,
  p_refund boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_po public.pre_orders%ROWTYPE;
  v_treasury_id uuid;
  v_balance numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO v_po FROM public.pre_orders WHERE id = p_pre_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحجز غير موجود'; END IF;
  IF v_po.status NOT IN ('pending','received') THEN RAISE EXCEPTION 'لا يمكن إلغاء هذا الحجز'; END IF;
  IF NOT (is_admin(v_user) OR (has_role(v_user,'branch_manager') AND user_in_branch(v_user, v_po.branch_id))) THEN
    RAISE EXCEPTION 'صلاحية المدير أو مدير الفرع فقط';
  END IF;

  IF p_refund AND COALESCE(v_po.deposit_amount,0) > 0 AND NOT v_po.deposit_refunded THEN
    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_balance FROM public.treasury WHERE branch_id = v_po.branch_id;
    IF v_balance < v_po.deposit_amount THEN
      RAISE EXCEPTION 'رصيد الخزنة غير كافٍ لاسترداد العربون (الرصيد: %)', v_balance;
    END IF;

    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id)
    VALUES (v_po.branch_id, 'expense', 'pre_order_refund', v_po.deposit_amount,
            'استرداد عربون حجز ' || v_po.order_number, p_pre_order_id, v_user, v_po.tenant_id)
    RETURNING id INTO v_treasury_id;

    INSERT INTO public.pre_order_transactions(
      pre_order_id, tenant_id, branch_id, type, amount, payment_method, treasury_id, created_by
    ) VALUES (
      p_pre_order_id, v_po.tenant_id, v_po.branch_id, 'deposit_refunded',
      v_po.deposit_amount, 'cash', v_treasury_id, v_user
    );

    UPDATE public.pre_orders SET deposit_refunded = true WHERE id = p_pre_order_id;
  END IF;

  UPDATE public.pre_orders SET status = 'cancelled', updated_at = now() WHERE id = p_pre_order_id;
END;
$$;

-- Trigger: notify on shipment item arrival
CREATE OR REPLACE FUNCTION public.notify_pre_orders_on_shipment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_branch uuid;
  v_tenant uuid;
  v_product_name text;
  po record;
  v_recipient uuid;
  v_pending_count int;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT branch_id, tenant_id, name INTO v_branch, v_tenant, v_product_name
    FROM public.products WHERE id = NEW.product_id;
  IF v_product_name IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_pending_count
    FROM public.pre_orders
    WHERE branch_id = v_branch
      AND status = 'pending'
      AND lower(product_name) = lower(v_product_name);

  IF v_pending_count = 0 THEN RETURN NEW; END IF;

  -- Mark pending → received & notify cashiers/branch_managers per pre-order
  FOR po IN
    SELECT * FROM public.pre_orders
    WHERE branch_id = v_branch
      AND status = 'pending'
      AND lower(product_name) = lower(v_product_name)
    ORDER BY created_at ASC
  LOOP
    UPDATE public.pre_orders SET status = 'received', updated_at = now() WHERE id = po.id;

    FOR v_recipient IN
      SELECT bu.user_id FROM public.branch_users bu
      JOIN public.user_roles ur ON ur.user_id = bu.user_id
      WHERE bu.branch_id = v_branch
        AND ur.role IN ('cashier','branch_manager')
    LOOP
      INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
      VALUES (
        v_recipient, v_tenant,
        '🔔 منتج محجوز وصل',
        po.product_name || E'\n' ||
        'العميل: ' || po.customer_name || COALESCE(' — ' || po.customer_phone, '') || E'\n' ||
        'حجز: ' || po.order_number || ' — عربون: ' || COALESCE(po.deposit_amount,0)::text || ' — متبقي: ' || GREATEST(0, COALESCE(po.expected_price,0) * po.quantity - COALESCE(po.deposit_amount,0))::text,
        'pre_order_arrived', 'pre_order', po.id,
        '/branch/' || v_branch || '/pre-orders?focus=' || po.id::text
      );
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_pre_orders_on_shipment_trg
AFTER INSERT ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.notify_pre_orders_on_shipment();
