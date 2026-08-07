-- 1) Block privileged role escalation at the database level
CREATE OR REPLACE FUNCTION public.guard_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_tenant uuid;
  v_caller uuid := auth.uid();
BEGIN
  -- super_admin can only ever be granted by an existing super_admin (or by a
  -- direct DB migration run as a database superuser). Service-role edge
  -- functions have auth.uid() = NULL and are therefore rejected.
  IF NEW.role = 'super_admin'::app_role THEN
    IF NOT (current_user IN ('postgres', 'supabase_admin') OR public.is_super_admin(v_caller)) THEN
      RAISE EXCEPTION 'ممنوع: دور "سوبر أدمن" لا يمكن منحه من هذه الشاشة أو من واجهة إنشاء الموظفين'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A role row must stay inside the target user's own tenant.
  SELECT tenant_id INTO v_target_tenant FROM public.profiles WHERE id = NEW.user_id;
  IF v_target_tenant IS NOT NULL AND NEW.tenant_id IS NOT NULL
     AND v_target_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'ممنوع: لا يمكن منح دور لمستخدم في شركة أخرى' USING ERRCODE = '42501';
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_target_tenant;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_role_assignment ON public.user_roles;
CREATE TRIGGER trg_guard_role_assignment
BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.guard_role_assignment();

-- 2) Notifications: recipient must live in the sender's tenant, tenant_id is
--    always derived server-side, and non-admin senders may not craft external links.
CREATE OR REPLACE FUNCTION public.guard_notification_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_tenant uuid;
  v_target_tenant uuid;
BEGIN
  -- Service role / internal jobs (no JWT) keep working.
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id INTO v_caller_tenant FROM public.profiles WHERE id = v_caller;
  SELECT tenant_id INTO v_target_tenant FROM public.profiles WHERE id = NEW.user_id;

  IF v_target_tenant IS NULL THEN
    RAISE EXCEPTION 'المستخدم المستلم غير موجود' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin(v_caller) THEN
    IF v_caller_tenant IS NULL OR v_caller_tenant <> v_target_tenant THEN
      RAISE EXCEPTION 'ممنوع: لا يمكن إرسال إشعار لمستخدم في شركة أخرى' USING ERRCODE = '42501';
    END IF;
    -- Always trust the server, never the client payload.
    NEW.tenant_id := v_caller_tenant;

    -- Ordinary staff may only emit in-app (relative) links — blocks phishing URLs.
    IF NOT public.is_admin(v_caller)
       AND NEW.link IS NOT NULL
       AND left(NEW.link, 1) <> '/' THEN
      RAISE EXCEPTION 'ممنوع: الروابط الخارجية غير مسموحة في الإشعارات' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_notification_insert ON public.notifications;
CREATE TRIGGER trg_guard_notification_insert
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.guard_notification_insert();

-- Tighten the INSERT policy as a second layer.
DROP POLICY IF EXISTS notif_insert ON public.notifications;
CREATE POLICY notif_insert ON public.notifications
FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = notifications.user_id
        AND p.tenant_id = public.current_tenant_id()
    )
  )
);