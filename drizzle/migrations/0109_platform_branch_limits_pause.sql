-- 0109 — Platform owner: branch limit per company, branch-increase requests, pausing branches,
--        deleting only EMPTY branches / companies, company type, test companies. (owner request 2026-10-24)
--
-- 1. Leak closed: policy allow_read_branches (USING true) let any logged-in user of ANY company read every
--    company's branch names / codes. branches_read (own company or super admin) stays.
-- 2. tenants.max_branches is the limit (was hard-coded 3 in enforce_branch_limit). Existing companies keep 3.
--    tenants.business_type (free text, picked from a list or typed), tenants.is_test (hidden test company).
-- 3. branch_limit_requests + request_branch_increase (company owner / admin, only when at the limit, one pending
--    at a time; notifies every super admin) + super_decide_branch_request (approve = limit + 1 or a chosen number).
-- 4. branches.platform_paused: set ONLY by the super admin (super_set_branch_paused; a trigger refuses anyone
--    else). A paused branch drops out of my_branch_ids / user_in_branch for its employees (they cannot open it)
--    and out of my_write_branch_ids for everyone but the super admin; assert_access refuses work in it.
--    Owners / admins still read it. Company pause = the existing tenants.is_suspended (unchanged).
-- 5. super_delete_branch / super_delete_tenant delete ONLY when nothing references the branch / company
--    except setup rows (owner rule: no hard delete of history; tenants cascade to every document!).
-- No business row is changed by this migration.

-- ---------------------------------------------------------------- 1. leak
DROP POLICY IF EXISTS allow_read_branches ON public.branches;

-- ---------------------------------------------------------------- 2. company columns
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT 'أجهزة كهربائية — بيع وشراء';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
UPDATE public.tenants SET max_branches = 3 WHERE max_branches IS NULL;
ALTER TABLE public.tenants ALTER COLUMN max_branches SET DEFAULT 3;

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS platform_paused boolean NOT NULL DEFAULT false;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS platform_paused_at timestamptz;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS platform_paused_reason text;

CREATE OR REPLACE FUNCTION public.guard_branch_platform_pause()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_super_admin(auth.uid()) THEN RETURN NEW; END IF;  -- server / platform owner
  IF TG_OP = 'INSERT' THEN
    NEW.platform_paused := false; NEW.platform_paused_at := NULL; NEW.platform_paused_reason := NULL;
  ELSIF NEW.platform_paused IS DISTINCT FROM OLD.platform_paused
     OR NEW.platform_paused_at IS DISTINCT FROM OLD.platform_paused_at
     OR NEW.platform_paused_reason IS DISTINCT FROM OLD.platform_paused_reason THEN
    RAISE EXCEPTION 'إيقاف الفرع من إدارة المنصة بس' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a0_guard_branch_platform_pause ON public.branches;
CREATE TRIGGER a0_guard_branch_platform_pause BEFORE INSERT OR UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_platform_pause();

-- ---------------------------------------------------------------- limit from the company row
CREATE OR REPLACE FUNCTION public.enforce_branch_limit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count integer; v_limit integer;
BEGIN
  IF NEW.tenant_id IS NULL OR COALESCE(NEW.is_system, false) THEN RETURN NEW; END IF;
  IF public.is_super_admin(auth.uid()) THEN RETURN NEW; END IF;
  SELECT COALESCE(max_branches, 3) INTO v_limit FROM public.tenants WHERE id = NEW.tenant_id;
  SELECT count(*) INTO v_count FROM public.branches
   WHERE tenant_id = NEW.tenant_id AND COALESCE(is_system, false) = false;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'وصلت للحد المسموح من الفروع (% من %). تواصل مع صاحب المنصة لمناقشة طلبك.', v_count, v_limit
      USING ERRCODE = 'check_violation', HINT = 'branch_limit';
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------- paused branches drop out of access
CREATE OR REPLACE FUNCTION public.my_branch_ids()
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH u AS (SELECT auth.uid() AS id)
  SELECT CASE
    WHEN (SELECT id FROM u) IS NULL THEN '{}'::uuid[]
    WHEN public.is_super_admin((SELECT id FROM u)) THEN
      array_append(ARRAY(SELECT b.id FROM public.branches b), '00000000-0000-0000-0000-000000000000'::uuid)
    WHEN public.is_admin((SELECT id FROM u)) THEN
      array_append(ARRAY(SELECT b.id FROM public.branches b
                          WHERE b.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (SELECT id FROM u))),
                   '00000000-0000-0000-0000-000000000000'::uuid)
    ELSE ARRAY(SELECT b.id FROM public.branches b JOIN public.branch_users bu ON bu.branch_id = b.id
                WHERE bu.user_id = (SELECT id FROM u) AND NOT b.platform_paused
                  AND b.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (SELECT id FROM u)))
  END
$function$;

CREATE OR REPLACE FUNCTION public.my_write_branch_ids()
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH u AS (SELECT auth.uid() AS id)
  SELECT CASE
    WHEN (SELECT id FROM u) IS NULL THEN '{}'::uuid[]
    WHEN public.is_super_admin((SELECT id FROM u)) THEN
      array_append(ARRAY(SELECT b.id FROM public.branches b), '00000000-0000-0000-0000-000000000000'::uuid)
    WHEN public.is_admin((SELECT id FROM u)) OR public.is_owner((SELECT id FROM u)) THEN
      array_append(ARRAY(SELECT b.id FROM public.branches b
                          WHERE NOT b.platform_paused
                            AND b.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (SELECT id FROM u))),
                   '00000000-0000-0000-0000-000000000000'::uuid)
    ELSE array_append(ARRAY(SELECT b.id FROM public.branches b JOIN public.branch_users bu ON bu.branch_id = b.id
                             WHERE bu.user_id = (SELECT id FROM u) AND coalesce(bu.access_level, 'manage') = 'manage'
                               AND NOT b.platform_paused
                               AND b.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (SELECT id FROM u))),
                      '00000000-0000-0000-0000-000000000000'::uuid)
  END
$function$;

CREATE OR REPLACE FUNCTION public.user_in_branch(_user_id uuid, _branch_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    WHEN public.is_super_admin(_user_id) THEN true
    WHEN _branch_id IS NULL THEN public.is_admin(_user_id)
    ELSE EXISTS (
      SELECT 1
        FROM public.branches b
       WHERE b.id = _branch_id
         AND b.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = _user_id)
         AND (
               public.is_admin(_user_id)
            OR (NOT b.platform_paused
                AND EXISTS (SELECT 1 FROM public.branch_users bu
                             WHERE bu.user_id = _user_id AND bu.branch_id = _branch_id))
         )
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.assert_access(p_branch_id uuid, p_permission text)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_branch_tenant uuid;
  v_paused boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'المستند غير موجود' USING ERRCODE = 'P0002';
  END IF;

  SELECT tenant_id, platform_paused INTO v_branch_tenant, v_paused FROM public.branches WHERE id = p_branch_id;
  IF v_branch_tenant IS NULL THEN
    RAISE EXCEPTION 'الفرع غير موجود' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_super_admin(v_uid) THEN
    IF v_branch_tenant IS DISTINCT FROM public.current_tenant_id() THEN
      RAISE EXCEPTION 'غير مصرح: المستند يخص شركة أخرى' USING ERRCODE = '42501';
    END IF;
    IF public.current_tenant_is_suspended() THEN
      RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية' USING ERRCODE = '42501';
    END IF;
    IF v_paused THEN
      RAISE EXCEPTION 'الفرع موقوف مؤقتاً من إدارة المنصة — لا يمكن تنفيذ العملية' USING ERRCODE = '42501';
    END IF;
    IF NOT public.user_in_branch(v_uid, p_branch_id) THEN
      RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
    END IF;
    IF p_permission IS NOT NULL AND NOT public.effective_permission(v_uid, p_permission) THEN
      RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية «%»', p_permission USING ERRCODE = '42501';
    END IF;
  END IF;
END
$function$;

-- ---------------------------------------------------------------- 3. requests
CREATE TABLE IF NOT EXISTS public.branch_limit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by uuid,
  requested_by_name text,
  branch_name text,
  note text,
  limit_at_request integer NOT NULL,
  branches_at_request integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by uuid,
  decided_at timestamptz,
  new_limit integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS branch_limit_requests_one_pending ON public.branch_limit_requests (tenant_id) WHERE status = 'pending';
ALTER TABLE public.branch_limit_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_limit_requests_read ON public.branch_limit_requests;
CREATE POLICY branch_limit_requests_read ON public.branch_limit_requests FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin((SELECT auth.uid())))
         OR (tenant_id = (SELECT public.current_tenant_id())
             AND ((SELECT public.is_admin((SELECT auth.uid()))) OR (SELECT public.is_owner((SELECT auth.uid()))))));
REVOKE ALL ON public.branch_limit_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.branch_limit_requests TO authenticated;
GRANT ALL ON public.branch_limit_requests TO service_role;

CREATE OR REPLACE FUNCTION public.branch_limit_status()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_t uuid := public.current_tenant_id(); v_limit int; v_used int; v_req record;
BEGIN
  IF auth.uid() IS NULL OR v_t IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(max_branches, 3) INTO v_limit FROM tenants WHERE id = v_t;
  SELECT count(*) INTO v_used FROM branches WHERE tenant_id = v_t AND NOT COALESCE(is_system, false);
  SELECT id, branch_name, created_at INTO v_req FROM branch_limit_requests WHERE tenant_id = v_t AND status = 'pending';
  RETURN jsonb_build_object('limit', v_limit, 'used', v_used, 'at_limit', v_used >= v_limit,
    'pending', CASE WHEN v_req.id IS NULL THEN NULL
                    ELSE jsonb_build_object('id', v_req.id, 'branch_name', v_req.branch_name, 'created_at', v_req.created_at) END);
END $$;

CREATE OR REPLACE FUNCTION public.request_branch_increase(p_branch_name text, p_note text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_t uuid := public.current_tenant_id(); v_limit int; v_used int; v_id uuid;
        v_name text; v_tname text;
BEGIN
  IF v_uid IS NULL OR v_t IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_admin(v_uid) OR public.is_owner(v_uid)) THEN
    RAISE EXCEPTION 'طلب فرع زيادة لصاحب الشركة بس' USING ERRCODE = '42501';
  END IF;
  IF public.current_tenant_is_suspended() THEN RAISE EXCEPTION 'الشركة موقوفة' USING ERRCODE = '42501'; END IF;
  IF COALESCE(btrim(p_branch_name), '') = '' THEN RAISE EXCEPTION 'اكتب اسم الفرع اللي عاوز تضيفه'; END IF;
  SELECT COALESCE(max_branches, 3), name INTO v_limit, v_tname FROM tenants WHERE id = v_t;
  SELECT count(*) INTO v_used FROM branches WHERE tenant_id = v_t AND NOT COALESCE(is_system, false);
  IF v_used < v_limit THEN RAISE EXCEPTION 'لسه عندك مكان لفرع جديد — ضيفه على طول'; END IF;
  IF EXISTS (SELECT 1 FROM branch_limit_requests WHERE tenant_id = v_t AND status = 'pending') THEN
    RAISE EXCEPTION 'عندك طلب لسه مستني رد صاحب المنصة';
  END IF;
  SELECT name INTO v_name FROM profiles WHERE id = v_uid;
  INSERT INTO branch_limit_requests (tenant_id, requested_by, requested_by_name, branch_name, note, limit_at_request, branches_at_request)
  VALUES (v_t, v_uid, v_name, btrim(p_branch_name), NULLIF(btrim(COALESCE(p_note, '')), ''), v_limit, v_used)
  RETURNING id INTO v_id;
  INSERT INTO notifications (user_id, tenant_id, title, body, type, link, related_entity, related_entity_id)
  SELECT DISTINCT ur.user_id, v_t, 'طلب فرع زيادة — ' || v_tname,
         format('%s طالب فرع «%s» (الشركة عندها %s من %s).', COALESCE(v_name, 'صاحب الشركة'), btrim(p_branch_name), v_used, v_limit),
         'general', '/super/branch-requests', 'branch_limit_requests', v_id
    FROM user_roles ur WHERE ur.role = 'super_admin';
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.super_decide_branch_request(p_request uuid, p_approve boolean, p_new_limit int DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); r record; v_used int; v_limit int;
BEGIN
  IF NOT public.is_super_admin(v_uid) THEN RAISE EXCEPTION 'لصاحب المنصة بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM branch_limit_requests WHERE id = p_request FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'الطلب مش موجود'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'الطلب اترد عليه قبل كده'; END IF;
  IF p_approve THEN
    SELECT count(*) INTO v_used FROM branches WHERE tenant_id = r.tenant_id AND NOT COALESCE(is_system, false);
    SELECT COALESCE(p_new_limit, COALESCE(max_branches, 3) + 1) INTO v_limit FROM tenants WHERE id = r.tenant_id;
    IF v_limit <= v_used THEN RAISE EXCEPTION 'العدد لازم يكون أكبر من الفروع الموجودة (%)', v_used; END IF;
    UPDATE tenants SET max_branches = v_limit WHERE id = r.tenant_id;
  END IF;
  UPDATE branch_limit_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_by = v_uid, decided_at = now(), new_limit = CASE WHEN p_approve THEN v_limit END
   WHERE id = p_request;
  IF r.requested_by IS NOT NULL THEN
    INSERT INTO notifications (user_id, tenant_id, title, body, type, link, related_entity, related_entity_id)
    VALUES (r.requested_by, r.tenant_id,
            CASE WHEN p_approve THEN 'اتوافق على طلب الفرع' ELSE 'اترفض طلب الفرع' END,
            CASE WHEN p_approve THEN format('تقدر تضيف فرع «%s» دلوقتي. الحد بقى %s فروع.', r.branch_name, v_limit)
                 ELSE format('صاحب المنصة رفض طلب فرع «%s».', r.branch_name) END,
            'general', '/admin/branches', 'branch_limit_requests', r.id);
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, 'new_limit', v_limit);
END $$;

-- ---------------------------------------------------------------- company settings (platform owner)
CREATE OR REPLACE FUNCTION public.super_update_tenant(p_tenant uuid, p_name text, p_business_type text, p_max_branches int)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_used int;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لصاحب المنصة بس' USING ERRCODE = '42501'; END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'اسم الشركة مطلوب'; END IF;
  IF COALESCE(btrim(p_business_type), '') = '' THEN RAISE EXCEPTION 'نوع الشركة مطلوب'; END IF;
  IF p_max_branches IS NULL OR p_max_branches < 1 THEN RAISE EXCEPTION 'عدد الفروع لازم يكون 1 أو أكتر'; END IF;
  SELECT count(*) INTO v_used FROM branches WHERE tenant_id = p_tenant AND NOT COALESCE(is_system, false);
  IF p_max_branches < v_used THEN
    RAISE EXCEPTION 'الشركة عندها % فروع — العدد ماينفعش يبقى أقل من كده', v_used;
  END IF;
  UPDATE tenants SET name = btrim(p_name), business_type = btrim(p_business_type), max_branches = p_max_branches,
                     updated_at = now()
   WHERE id = p_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشركة مش موجودة'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.super_set_branch_paused(p_branch uuid, p_paused boolean, p_reason text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لصاحب المنصة بس' USING ERRCODE = '42501'; END IF;
  UPDATE branches SET platform_paused = p_paused,
                      platform_paused_at = CASE WHEN p_paused THEN now() END,
                      platform_paused_reason = CASE WHEN p_paused THEN NULLIF(btrim(COALESCE(p_reason, '')), '') END
   WHERE id = p_branch AND NOT COALESCE(is_system, false);
  IF NOT FOUND THEN RAISE EXCEPTION 'الفرع مش موجود'; END IF;
END $$;

-- What still references a branch / company (anything not in the setup list blocks a delete).
CREATE OR REPLACE FUNCTION public.platform_usage(p_kind text, p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; n bigint; v_out jsonb := '{}'::jsonb;
        v_setup text[] := ARRAY['branch_users', 'branch_schedules', 'shift_schedules', 'branches', 'settings',
                                'voucher_categories', 'voucher_sequences', 'user_roles', 'profiles', 'audit_log',
                                'system_integrity_cache', 'backup_cron_runs', 'system_backups', 'categories',
                                'branch_limit_requests', 'chart_of_accounts', 'backup_settings', 'notifications',
                                'role_permission_overrides', 'user_permissions'];
BEGIN
  IF NOT public.is_super_admin(auth.uid()) AND auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'لصاحب المنصة بس' USING ERRCODE = '42501'; END IF;
  FOR r IN
    SELECT DISTINCT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
       AND c.confrelid = CASE WHEN p_kind = 'branch' THEN 'public.branches'::regclass ELSE 'public.tenants'::regclass END
  LOOP
    CONTINUE WHEN split_part(r.tbl::text, '.', array_length(string_to_array(r.tbl::text, '.'), 1)) = ANY (v_setup);
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.tbl, r.col) INTO n USING p_id;
    IF n > 0 THEN v_out := v_out || jsonb_build_object(r.tbl::text || '.' || r.col, n); END IF;
  END LOOP;
  IF p_kind = 'tenant' THEN
    -- every operational branch of the company must itself be empty
    FOR r IN SELECT id, name FROM branches WHERE tenant_id = p_id AND NOT COALESCE(is_system, false) LOOP
      IF public.platform_usage('branch', r.id) <> '{}'::jsonb THEN
        v_out := v_out || jsonb_build_object('branch:' || r.name, public.platform_usage('branch', r.id));
      END IF;
    END LOOP;
  END IF;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.super_delete_branch(p_branch uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_use jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لصاحب المنصة بس' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM branches WHERE id = p_branch AND COALESCE(is_system, false)) THEN
    RAISE EXCEPTION 'ده وعاء مالي للنظام — ماينفعش يتحذف';
  END IF;
  v_use := public.platform_usage('branch', p_branch);
  IF v_use <> '{}'::jsonb THEN
    RAISE EXCEPTION 'الفرع فيه شغل (فواتير أو فلوس أو موظفين) — ينفع يتوقف بس، مش يتحذف' USING DETAIL = v_use::text;
  END IF;
  DELETE FROM branches WHERE id = p_branch;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفرع مش موجود'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.super_delete_tenant(p_tenant uuid, p_confirm_name text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_use jsonb; v_name text;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لصاحب المنصة بس' USING ERRCODE = '42501'; END IF;
  SELECT name INTO v_name FROM tenants WHERE id = p_tenant;
  IF v_name IS NULL THEN RAISE EXCEPTION 'الشركة مش موجودة'; END IF;
  IF btrim(COALESCE(p_confirm_name, '')) <> v_name THEN RAISE EXCEPTION 'اكتب اسم الشركة بالظبط عشان تأكد الحذف'; END IF;
  IF p_tenant = public.current_tenant_id() THEN RAISE EXCEPTION 'ماينفعش تحذف الشركة اللي إنت داخل عليها'; END IF;
  v_use := public.platform_usage('tenant', p_tenant);
  IF v_use <> '{}'::jsonb THEN
    RAISE EXCEPTION 'الشركة فيها شغل (فواتير أو فلوس أو موظفين) — تنفع تتوقف بس، مش تتحذف' USING DETAIL = v_use::text;
  END IF;
  DELETE FROM tenants WHERE id = p_tenant;
END $$;

-- ---------------------------------------------------------------- grants (SEC-001)
DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.branch_limit_status()', 'public.request_branch_increase(text,text)',
    'public.super_decide_branch_request(uuid,boolean,integer)', 'public.super_update_tenant(uuid,text,text,integer)',
    'public.super_set_branch_paused(uuid,boolean,text)', 'public.platform_usage(text,uuid)',
    'public.super_delete_branch(uuid)', 'public.super_delete_tenant(uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.guard_branch_platform_pause() FROM PUBLIC, anon, authenticated;
END $g$;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
SELECT v, '0109', 'platform owner: branch limits / pause / delete-if-empty'
  FROM unnest(ARRAY['branch_limit_status', 'request_branch_increase', 'super_decide_branch_request', 'super_update_tenant',
                    'super_set_branch_paused', 'platform_usage', 'super_delete_branch', 'super_delete_tenant']) v
 WHERE NOT EXISTS (SELECT 1 FROM public.security_rpc_allowlist a WHERE a.function_name = v);

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN
    RAISE EXCEPTION '0109: definer function exposed outside the allow-list';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'branches' AND policyname = 'allow_read_branches') THEN
    RAISE EXCEPTION '0109: leak policy still there';
  END IF;
  IF (SELECT max_branches FROM public.tenants WHERE slug = 'a-n') <> 3 THEN
    RAISE EXCEPTION '0109: A & N must keep 3 branches';
  END IF;
END $check$;
