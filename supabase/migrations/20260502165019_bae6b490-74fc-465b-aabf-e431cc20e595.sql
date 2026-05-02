
-- =========================================================
-- 1) تفعيل pgcrypto وتشفير كلمات مرور الموظفين
-- =========================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigger: hash login_password قبل أي insert/update
CREATE OR REPLACE FUNCTION public.hash_employee_password()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- لو فيه قيمة، وليست بالفعل bcrypt hash ($2a$ / $2b$ / $2y$)
  IF NEW.login_password IS NOT NULL
     AND length(NEW.login_password) > 0
     AND NEW.login_password !~ '^\$2[aby]\$'
  THEN
    NEW.login_password := crypt(NEW.login_password, gen_salt('bf', 10));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hash_employee_password ON public.employees;
CREATE TRIGGER trg_hash_employee_password
  BEFORE INSERT OR UPDATE OF login_password ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.hash_employee_password();

-- One-time: hash كل الكلمات الموجودة بـ plaintext
UPDATE public.employees
SET login_password = crypt(login_password, gen_salt('bf', 10))
WHERE login_password IS NOT NULL
  AND length(login_password) > 0
  AND login_password !~ '^\$2[aby]\$';

-- دالة تحقق آمنة للاستخدام من edge function (service role)
CREATE OR REPLACE FUNCTION public.verify_employee_password(_employee_id uuid, _password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT login_password INTO v_hash FROM public.employees WHERE id = _employee_id;
  IF v_hash IS NULL THEN RETURN false; END IF;
  RETURN crypt(_password, v_hash) = v_hash;
END;
$$;

-- منع المستخدمين العاديين من استدعاء دالة التحقق
REVOKE EXECUTE ON FUNCTION public.verify_employee_password(uuid, text) FROM public, anon, authenticated;

-- =========================================================
-- 2) Trigger إشعار نفاد المخزون من أي مصدر
-- =========================================================
CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient uuid;
BEGIN
  -- لما الكمية تنزل لحد التنبيه أو أقل (وقبل كده كانت أعلى)
  IF NEW.quantity <= NEW.low_stock_alert
     AND (OLD.quantity IS NULL OR OLD.quantity > NEW.low_stock_alert)
  THEN
    -- إشعار لمديري الفرع
    FOR v_recipient IN
      SELECT bu.user_id FROM public.branch_users bu
      JOIN public.user_roles ur ON ur.user_id = bu.user_id
      WHERE bu.branch_id = NEW.branch_id
        AND ur.role = 'branch_manager'
    LOOP
      INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
      VALUES (
        v_recipient, NEW.tenant_id,
        '⚠️ تنبيه نفاد مخزون',
        NEW.name || ' — الكمية المتبقية: ' || NEW.quantity,
        'low_stock', 'product', NEW.id,
        '/branch/' || NEW.branch_id || '/inventory'
      );
    END LOOP;

    -- إشعار للمدير العام للشركة
    FOR v_recipient IN
      SELECT ur.user_id FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.role = 'admin' AND p.tenant_id = NEW.tenant_id
    LOOP
      INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
      VALUES (
        v_recipient, NEW.tenant_id,
        '⚠️ تنبيه نفاد مخزون',
        NEW.name || ' — الكمية المتبقية: ' || NEW.quantity,
        'low_stock', 'product', NEW.id,
        '/admin/inventory'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_low_stock ON public.products;
CREATE TRIGGER trg_notify_low_stock
  AFTER UPDATE OF quantity ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_low_stock();
