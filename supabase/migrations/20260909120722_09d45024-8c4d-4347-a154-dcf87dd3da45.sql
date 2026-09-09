ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS rejection_reason text NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz NULL;

-- backfill confirmed_at for already-decided rows so history sorting works
UPDATE public.stock_transfers
   SET confirmed_at = created_at
 WHERE confirmed_at IS NULL AND status <> 'pending';

-- ============ reject_transfer (single) ============
DROP FUNCTION IF EXISTS public.reject_transfer(uuid);
CREATE OR REPLACE FUNCTION public.reject_transfer(p_transfer_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  t public.stock_transfers%ROWTYPE;
  v_cost numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF t.status <> 'pending' THEN RAISE EXCEPTION 'transfer_not_pending'; END IF;

  PERFORM public.assert_same_tenant(t.tenant_id);

  -- Owner immunity: owner / admin / super_admin bypass branch check
  IF NOT (public.is_super_admin(v_user) OR public.is_admin(v_user)
          OR public.has_role(v_user, 'owner')
          OR public.user_in_branch(v_user, t.to_branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المستلم';
  END IF;

  SELECT COALESCE(cost_price, 0) INTO v_cost FROM public.products WHERE id = t.product_id;

  UPDATE public.products
     SET quantity = COALESCE(quantity, 0) + t.quantity
   WHERE id = t.product_id;

  INSERT INTO public.product_batches (
    product_id, branch_id, quantity_purchased, quantity_remaining,
    cost_price, base_purchase_price, batch_type, tenant_id
  ) VALUES (
    t.product_id, t.from_branch_id, t.quantity, t.quantity,
    COALESCE(v_cost, 0), COALESCE(v_cost, 0), 'transfer_return', t.tenant_id
  );

  UPDATE public.stock_transfers
     SET status = 'rejected',
         confirmed_by = v_user,
         received_quantity = 0,
         rejection_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         confirmed_at = now()
   WHERE id = t.id;

  RETURN jsonb_build_object('returned', t.quantity, 'transfer_id', t.id);
END;
$$;

-- ============ reject_transfer_group (reason support) ============
CREATE OR REPLACE FUNCTION public.reject_transfer_group(p_group uuid, p_reason text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_count int := 0;
  t record;
  v_cost numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  FOR t IN SELECT * FROM public.stock_transfers
           WHERE group_id = p_group AND status = 'pending'
           ORDER BY created_at
  LOOP
    PERFORM public.assert_same_tenant(t.tenant_id);
    IF NOT (public.is_super_admin(v_user) OR public.is_admin(v_user)
            OR public.has_role(v_user,'owner')
            OR public.user_in_branch(v_user, t.to_branch_id)) THEN
      RAISE EXCEPTION 'لا تملك صلاحية على فرع المستلم';
    END IF;

    SELECT COALESCE(cost_price, 0) INTO v_cost FROM public.products WHERE id = t.product_id;

    UPDATE public.products SET quantity = COALESCE(quantity,0) + t.quantity
      WHERE id = t.product_id;

    INSERT INTO public.product_batches (
      product_id, branch_id, quantity_purchased, quantity_remaining,
      cost_price, base_purchase_price, batch_type, tenant_id
    ) VALUES (
      t.product_id, t.from_branch_id, t.quantity, t.quantity,
      COALESCE(v_cost,0), COALESCE(v_cost,0), 'transfer_return', t.tenant_id
    );

    UPDATE public.stock_transfers
      SET status = 'rejected', confirmed_by = v_user, received_quantity = 0,
          rejection_reason = NULLIF(btrim(COALESCE(p_reason,'')), ''),
          confirmed_at = now()
      WHERE id = t.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END
$$;

-- ============ stamp confirmed_at on confirmation ============
CREATE OR REPLACE FUNCTION public.stamp_transfer_confirmed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'pending' AND OLD.status = 'pending' AND NEW.confirmed_at IS NULL THEN
    NEW.confirmed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_transfer_confirmed_at ON public.stock_transfers;
CREATE TRIGGER trg_stamp_transfer_confirmed_at
BEFORE UPDATE ON public.stock_transfers
FOR EACH ROW EXECUTE FUNCTION public.stamp_transfer_confirmed_at();

-- ============ notifications on create (owner + admins + receiving branch) ============
CREATE OR REPLACE FUNCTION public.notify_stock_transfer_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient UUID;
  v_product_name TEXT;
  v_from_branch_name TEXT;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT name INTO v_product_name FROM public.products WHERE id = NEW.product_id;
  SELECT name INTO v_from_branch_name FROM public.branches WHERE id = NEW.from_branch_id;

  FOR v_recipient IN
    SELECT DISTINCT bu.user_id FROM public.branch_users bu
    JOIN public.user_roles ur ON ur.user_id = bu.user_id
    WHERE bu.branch_id = NEW.to_branch_id
      AND ur.role IN ('branch_manager','warehouse')
  LOOP
    INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
    VALUES (
      v_recipient, NEW.tenant_id,
      '📦 تحويل مخزون وارد',
      COALESCE(v_from_branch_name,'فرع آخر') || ' → ' || COALESCE(v_product_name,'منتج') || ' (' || NEW.quantity || ')',
      'stock_transfer_incoming', 'stock_transfer', NEW.id,
      '/branch/' || NEW.to_branch_id || '/transfers'
    );
  END LOOP;

  -- المالك والمدير العام والأدمن دائماً
  FOR v_recipient IN
    SELECT DISTINCT ur.user_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role IN ('owner','admin','super_admin') AND p.tenant_id = NEW.tenant_id
  LOOP
    INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
    VALUES (
      v_recipient, NEW.tenant_id,
      '📦 تحويل مخزون جديد',
      COALESCE(v_from_branch_name,'فرع') || ' → ' || COALESCE(v_product_name,'منتج') || ' (' || NEW.quantity || ')',
      'stock_transfer_admin', 'stock_transfer', NEW.id,
      '/admin/inventory'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- ============ reverse notification to owner/admins on decision ============
CREATE OR REPLACE FUNCTION public.notify_stock_transfer_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient uuid;
  v_product_name text;
  v_to_branch_name text;
  v_from_branch_name text;
  v_actor text;
  v_title text;
  v_body text;
BEGIN
  IF NEW.status = OLD.status OR OLD.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT name INTO v_product_name FROM public.products WHERE id = NEW.product_id;
  SELECT name INTO v_to_branch_name FROM public.branches WHERE id = NEW.to_branch_id;
  SELECT name INTO v_from_branch_name FROM public.branches WHERE id = NEW.from_branch_id;
  SELECT name INTO v_actor FROM public.profiles WHERE id = NEW.confirmed_by;

  IF NEW.status = 'rejected' THEN
    v_title := '❌ رفض تحويل مخزون';
    v_body := COALESCE(v_to_branch_name,'الفرع المستلم') || ' رفض ' || COALESCE(v_product_name,'منتج')
              || ' (' || NEW.quantity || ') من ' || COALESCE(v_from_branch_name,'فرع')
              || COALESCE(' — بواسطة ' || v_actor, '')
              || COALESCE(' — السبب: ' || NEW.rejection_reason, '');
  ELSE
    v_title := '✅ استلام تحويل مخزون';
    v_body := COALESCE(v_to_branch_name,'الفرع المستلم') || ' استلم ' || COALESCE(NEW.received_quantity, NEW.quantity)
              || ' من ' || COALESCE(v_product_name,'منتج') || ' (المرسل ' || NEW.quantity || ')'
              || COALESCE(' — بواسطة ' || v_actor, '');
  END IF;

  FOR v_recipient IN
    SELECT DISTINCT ur.user_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role IN ('owner','admin','super_admin') AND p.tenant_id = NEW.tenant_id
  LOOP
    INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
    VALUES (v_recipient, NEW.tenant_id, v_title, v_body, 'stock_transfer_admin', 'stock_transfer', NEW.id,
            '/branch/' || NEW.from_branch_id || '/transfers');
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_stock_transfer_decision ON public.stock_transfers;
CREATE TRIGGER trg_notify_stock_transfer_decision
AFTER UPDATE ON public.stock_transfers
FOR EACH ROW EXECUTE FUNCTION public.notify_stock_transfer_decision();