-- 0114: permissions redesign (owner decisions 2026-10-24).
--  * One screen per employee, grouped like the sidebar; every box of a page can be shown / hidden.
--  * Permissions can differ PER BRANCH (e.g. sells in سكة تلة, only views + receipts in عبدالمنعم الغربى).
--  * The company owner is always full; managers (admin) and partners can now be restricted like anyone else.
--
-- 1) user_permissions.branch_id: NULL = every branch (the employee's base), a branch = only there.
-- 2) perm_resolve(user, key, branch) — the ONE answer used by has_permission, effective_permission and
--    assert_access:
--      super admin / company owner → true
--      override for (key, branch) → override for (key, all branches)
--      manager (admin role) → true (full unless something above took it away)
--      role rows of the company → role defaults (role_permission_default)
--      a part «part.<page>.<part>.view» with no rule → its page «<page>.view» (same branch)
-- 3) save_user_permissions(p_user, p_rows) replaces ALL overrides of one person in ONE transaction
--    (rows: {key, allowed, branch?}); copy_user_permissions copies them; permission_templates = own templates.
--    Only the owner may change a manager or a partner; nobody changes the owner, a super admin or himself.

-- 1) per-branch overrides
ALTER TABLE public.user_permissions ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE;
-- drop the old one-row-per-key uniqueness, whatever its name (constraint or bare unique index)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname FROM pg_constraint c
     WHERE c.conrelid = 'public.user_permissions'::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['permission_key', 'tenant_id', 'user_id']
  LOOP
    EXECUTE format('ALTER TABLE public.user_permissions DROP CONSTRAINT %I', r.conname);
  END LOOP;
  FOR r IN
    SELECT i.indexrelid::regclass::text AS idx FROM pg_index i
     WHERE i.indrelid = 'public.user_permissions'::regclass AND i.indisunique AND NOT i.indisprimary
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['permission_key', 'tenant_id', 'user_id']
  LOOP
    EXECUTE format('DROP INDEX %s', r.idx);
  END LOOP;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_permissions_user_key_branch_key') THEN
    ALTER TABLE public.user_permissions
      ADD CONSTRAINT user_permissions_user_key_branch_key UNIQUE NULLS NOT DISTINCT (tenant_id, user_id, permission_key, branch_id);
  END IF;
END $$;

-- 2) the one resolver
CREATE OR REPLACE FUNCTION public.perm_resolve(_uid uuid, _key text, _branch uuid DEFAULT NULL)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v boolean;
  v_has_rows boolean;
BEGIN
  IF _uid IS NULL OR _key IS NULL THEN RETURN false; END IF;
  IF public.is_super_admin(_uid) THEN RETURN true; END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = _uid;
  IF v_tenant IS NULL THEN RETURN false; END IF;
  -- the company owner is never restricted
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_tenant AND t.owner_user_id = _uid)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'owner') THEN
    RETURN true;
  END IF;

  IF _branch IS NOT NULL THEN
    SELECT up.allowed INTO v FROM public.user_permissions up
     WHERE up.user_id = _uid AND up.tenant_id = v_tenant AND up.permission_key = _key AND up.branch_id = _branch LIMIT 1;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;
  SELECT up.allowed INTO v FROM public.user_permissions up
   WHERE up.user_id = _uid AND up.tenant_id = v_tenant AND up.permission_key = _key AND up.branch_id IS NULL LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;

  -- a manager has everything the owner did not take away
  IF public.is_admin(_uid) THEN RETURN true; END IF;

  SELECT bool_or(rp.allowed), count(*) > 0 INTO v, v_has_rows
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.tenant_id = v_tenant AND rp.role = ur.role::text AND rp.permission_key = _key
   WHERE ur.user_id = _uid AND ur.tenant_id = v_tenant;
  IF v_has_rows THEN RETURN coalesce(v, false); END IF;

  -- a part with no rule of its own follows its page
  IF _key ~ '^part\.[a-z0-9_]+\.[a-z0-9_]+\.view$' THEN
    RETURN public.perm_resolve(_uid, split_part(_key, '.', 2) || '.view', _branch);
  END IF;

  RETURN coalesce((SELECT bool_or(public.role_permission_default(ur.role::text, _key))
                     FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.tenant_id = v_tenant), false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT public.perm_resolve(_user_id, _key, NULL) $function$;

CREATE OR REPLACE FUNCTION public.effective_permission(_uid uuid, _key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT public.perm_resolve(_uid, _key, NULL) $function$;

-- assert_access: same checks as before; the permission is now asked FOR THAT BRANCH
CREATE OR REPLACE FUNCTION public.assert_access(p_branch_id uuid, p_permission text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
    IF p_permission IS NOT NULL AND NOT public.perm_resolve(v_uid, p_permission, p_branch_id) THEN
      RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية «%»', p_permission USING ERRCODE = '42501';
    END IF;
  END IF;
END
$function$;

-- 3) who may change whom
CREATE OR REPLACE FUNCTION public.perm_assert_manageable(p_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_target_tenant uuid;
  v_caller_owner boolean;
BEGIN
  IF v_caller IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'لازم تسجل دخول' USING ERRCODE = '42501';
  END IF;
  v_caller_owner := public.is_owner(v_caller) OR EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant AND owner_user_id = v_caller);
  IF NOT (public.is_admin(v_caller) OR v_caller_owner) THEN
    RAISE EXCEPTION 'صلاحيات الموظفين لصاحب الشركة أو المدير بس' USING ERRCODE = '42501';
  END IF;
  IF p_user = v_caller THEN
    RAISE EXCEPTION 'مينفعش تغيّر صلاحياتك انت' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO v_target_tenant FROM public.profiles WHERE id = p_user;
  IF v_target_tenant IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'الموظف ده مش في شركتك' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role::text IN ('owner', 'super_admin'))
     OR EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant AND owner_user_id = p_user) THEN
    RAISE EXCEPTION 'صاحب الشركة دايماً عنده كل حاجة — مش بيتظبط من هنا' USING ERRCODE = '42501';
  END IF;
  IF NOT v_caller_owner AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role::text IN ('admin', 'partner')) THEN
    RAISE EXCEPTION 'صلاحيات المديرين والشركاء بيغيّرها صاحب الشركة بس' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_user_permissions(p_user uuid, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.perm_assert_manageable(p_user);
  v_n integer;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'الصلاحيات لازم تتبعت كقايمة' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r
              WHERE coalesce(r->>'key', '') !~ '^[a-z0-9_]+(\.[a-z0-9_]+){1,3}$'
                 OR jsonb_typeof(r->'allowed') <> 'boolean'
                 OR (nullif(r->>'branch', '') IS NOT NULL AND nullif(r->>'branch', '') !~ '^[0-9a-f-]{36}$')) THEN
    RAISE EXCEPTION 'صلاحية مكتوبة غلط' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r
              WHERE nullif(r->>'branch', '') IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = (r->>'branch')::uuid AND b.tenant_id = v_tenant)) THEN
    RAISE EXCEPTION 'فرع مش تبع شركتك' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.user_permissions WHERE user_id = p_user AND tenant_id = v_tenant;
  INSERT INTO public.user_permissions (tenant_id, user_id, permission_key, allowed, branch_id)
  SELECT DISTINCT ON (r->>'key', nullif(r->>'branch', '')) v_tenant, p_user, r->>'key', (r->>'allowed')::boolean, nullif(r->>'branch', '')::uuid
    FROM jsonb_array_elements(p_rows) r;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.copy_user_permissions(p_from uuid, p_to uuid, p_with_role boolean DEFAULT true, p_with_branches boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.perm_assert_manageable(p_to);
  v_role text;
  v_n integer;
BEGIN
  IF p_from = p_to THEN RAISE EXCEPTION 'اختار موظف تاني' USING ERRCODE = '22023'; END IF;
  IF (SELECT tenant_id FROM public.profiles WHERE id = p_from) IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'الموظف ده مش في شركتك' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.user_permissions WHERE user_id = p_to AND tenant_id = v_tenant;
  INSERT INTO public.user_permissions (tenant_id, user_id, permission_key, allowed, branch_id)
  SELECT v_tenant, p_to, permission_key, allowed, branch_id FROM public.user_permissions
   WHERE user_id = p_from AND tenant_id = v_tenant;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF p_with_role THEN
    SELECT role::text INTO v_role FROM public.user_roles
     WHERE user_id = p_from AND role::text IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer')
     LIMIT 1;
    IF v_role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_to AND role::text IN ('admin','partner')) THEN
      DELETE FROM public.user_roles WHERE user_id = p_to
        AND role::text IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer');
      INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES (p_to, v_role::app_role, v_tenant);
    END IF;
  END IF;

  IF p_with_branches THEN
    DELETE FROM public.branch_users WHERE user_id = p_to;
    INSERT INTO public.branch_users (user_id, branch_id, tenant_id, access_level)
    SELECT p_to, branch_id, v_tenant, access_level FROM public.branch_users WHERE user_id = p_from;
  END IF;

  RETURN jsonb_build_object('overrides', v_n, 'role', v_role);
END;
$function$;

-- 4) own templates
CREATE TABLE IF NOT EXISTS public.permission_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  base_role text NOT NULL CHECK (base_role IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer')),
  perms jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(perms) = 'object'),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE public.permission_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ptpl_read ON public.permission_templates;
DROP POLICY IF EXISTS ptpl_write ON public.permission_templates;
DROP POLICY IF EXISTS suspended_block_write ON public.permission_templates;
CREATE POLICY ptpl_read ON public.permission_templates FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND ((SELECT public.is_admin((SELECT auth.uid()))) OR (SELECT public.is_owner((SELECT auth.uid())))));
CREATE POLICY ptpl_write ON public.permission_templates FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND ((SELECT public.is_admin((SELECT auth.uid()))) OR (SELECT public.is_owner((SELECT auth.uid())))))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id())
         AND ((SELECT public.is_admin((SELECT auth.uid()))) OR (SELECT public.is_owner((SELECT auth.uid())))));
CREATE POLICY suspended_block_write ON public.permission_templates AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()))
  WITH CHECK ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permission_templates TO authenticated;

-- privileges
REVOKE ALL ON FUNCTION public.perm_resolve(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.perm_assert_manageable(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_user_permissions(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.copy_user_permissions(uuid, uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_user_permissions(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copy_user_permissions(uuid, uuid, boolean, boolean) TO authenticated;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
SELECT v, '0114', 'permissions redesign: atomic overrides save / copy (owner or manager, own company; managers and partners by the owner only)'
  FROM unnest(ARRAY['save_user_permissions', 'copy_user_permissions']) v
 WHERE NOT EXISTS (SELECT 1 FROM public.security_rpc_allowlist a WHERE a.function_name = v);
