-- 0111: only the company owner / admin may send the branch-request notification to the platform owner.
-- Why: the 0110 e2e test showed a cashier of the requesting company could add extra notifications
-- to the super admin while a request was pending.
CREATE OR REPLACE FUNCTION public.guard_notification_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    IF v_caller_tenant IS NULL OR (
         v_caller_tenant <> v_target_tenant
         AND NOT (
           public.is_super_admin(NEW.user_id)
           AND public.is_admin(v_caller)
           AND NEW.related_entity = 'branch_limit_requests'
           AND EXISTS (SELECT 1 FROM public.branch_limit_requests q
                        WHERE q.id = NEW.related_entity_id
                          AND q.tenant_id = v_caller_tenant
                          AND q.status = 'pending')
         )) THEN
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
$function$;
