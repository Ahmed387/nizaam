-- إضافة طريقة الدفع للتحويل ومستلمه
ALTER TABLE public.treasury_transfers
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS received_by TEXT;

-- Trigger: إشعار عند إنشاء تحويل مخزون pending للفرع المستلم
CREATE OR REPLACE FUNCTION public.notify_stock_transfer_recipient()
RETURNS TRIGGER
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
    SELECT bu.user_id FROM public.branch_users bu
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

  -- وإشعار للأدمن أيضاً
  FOR v_recipient IN
    SELECT ur.user_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'admin' AND p.tenant_id = NEW.tenant_id
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

DROP TRIGGER IF EXISTS trg_notify_stock_transfer ON public.stock_transfers;
CREATE TRIGGER trg_notify_stock_transfer
  AFTER INSERT ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.notify_stock_transfer_recipient();

-- Trigger: إشعار عند تحويل خزنة للأدمن وللفرع المستلم
CREATE OR REPLACE FUNCTION public.notify_treasury_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient UUID;
  v_from_name TEXT;
  v_to_name TEXT;
BEGIN
  SELECT name INTO v_from_name FROM public.branches WHERE id = NEW.from_branch_id;
  SELECT name INTO v_to_name FROM public.branches WHERE id = NEW.to_branch_id;

  -- إشعار لمدير الفرع المستلم والمحاسب
  FOR v_recipient IN
    SELECT bu.user_id FROM public.branch_users bu
    JOIN public.user_roles ur ON ur.user_id = bu.user_id
    WHERE bu.branch_id = NEW.to_branch_id
      AND ur.role IN ('branch_manager','accountant')
  LOOP
    INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
    VALUES (
      v_recipient, NEW.tenant_id,
      '💰 تحويل خزنة وارد',
      'من ' || COALESCE(v_from_name,'فرع') || ' — مبلغ: ' || NEW.amount::text || COALESCE(' — ' || NEW.reason, ''),
      'treasury_transfer_in', 'treasury_transfer', NEW.id,
      '/branch/' || NEW.to_branch_id || '/treasury'
    );
  END LOOP;

  -- إشعار للأدمن
  FOR v_recipient IN
    SELECT ur.user_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'admin' AND p.tenant_id = NEW.tenant_id
  LOOP
    INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
    VALUES (
      v_recipient, NEW.tenant_id,
      '💰 تحويل خزنة بين فروع',
      COALESCE(v_from_name,'؟') || ' → ' || COALESCE(v_to_name,'؟') || ' — ' || NEW.amount::text,
      'treasury_transfer', 'treasury_transfer', NEW.id,
      '/admin/dashboard'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_treasury_transfer ON public.treasury_transfers;
CREATE TRIGGER trg_notify_treasury_transfer
  AFTER INSERT ON public.treasury_transfers
  FOR EACH ROW EXECUTE FUNCTION public.notify_treasury_transfer();