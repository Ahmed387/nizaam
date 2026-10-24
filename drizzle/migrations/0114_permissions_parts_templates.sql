-- 0114: permissions redesign (owner decision 2026-10-24) — one screen per employee, grouped like the sidebar,
-- with every card / box of a page switchable on its own.
--
-- 1) Part keys «part.<page>.<part>.view» (a card, a box, a column, a dialog inside a page).
--    has_permission: user override → role rows → for a part key with no rule, the page's own «<page>.view».
--    A part never opens a page that is closed; it only hides a piece of a page that is open.
-- 2) save_user_permissions(p_user, p_rows): replaces ALL overrides of one employee in ONE transaction.
--    Why: the screen used to delete every override and then insert the new ones in two requests — a failure in
--    between left the employee with no overrides at all.
-- 3) copy_user_permissions(p_from, p_to, p_with_role, p_with_branches): «انسخ من موظف تاني».
-- 4) permission_templates: owner-made templates (name + base role + overrides) besides the 8 fixed roles.
-- Guards: caller is admin / owner of the company; both employees in the caller's company; owners, admins,
-- super admins and partners are never managed here (they hold full company access).

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v boolean;
BEGIN
  IF public.is_super_admin(_user_id) OR public.is_admin(_user_id) THEN
    RETURN true;
  END IF;

  SELECT up.allowed INTO v
    FROM public.user_permissions up
    JOIN public.profiles p ON p.id = up.user_id AND p.tenant_id = up.tenant_id
   WHERE up.user_id = _user_id AND up.permission_key = _key
   LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;

  SELECT bool_or(rp.allowed) INTO v
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    JOIN public.role_permissions rp
      ON rp.tenant_id = p.tenant_id AND rp.role = ur.role::text AND rp.permission_key = _key
   WHERE ur.user_id = _user_id;
  IF v IS NOT NULL THEN RETURN v; END IF;

  -- a part with no rule of its own follows its page
  IF _key ~ '^part\.[a-z0-9_]+\.[a-z0-9_]+\.view$' THEN
    RETURN public.has_permission(_user_id, split_part(_key, '.', 2) || '.view');
  END IF;

  RETURN false;
END;
$function$;

-- Can the caller manage this employee's access? (same company, caller admin / owner, target not full-access)
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
BEGIN
  IF v_caller IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'لازم تسجل دخول' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_admin(v_caller) OR public.is_owner(v_caller)) THEN
    RAISE EXCEPTION 'صلاحيات الموظفين لصاحب الشركة أو المدير بس' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO v_target_tenant FROM public.profiles WHERE id = p_user;
  IF v_target_tenant IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'الموظف ده مش في شركتك' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user
               AND role::text IN ('owner', 'admin', 'super_admin', 'partner')) THEN
    RAISE EXCEPTION 'المالك والمدير والشركاء عندهم كل الصلاحيات — مش بتتظبط من هنا' USING ERRCODE = '42501';
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
                 OR jsonb_typeof(r->'allowed') <> 'boolean') THEN
    RAISE EXCEPTION 'صلاحية مكتوبة غلط' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.user_permissions WHERE user_id = p_user AND tenant_id = v_tenant;
  INSERT INTO public.user_permissions (tenant_id, user_id, permission_key, allowed)
  SELECT DISTINCT ON (r->>'key') v_tenant, p_user, r->>'key', (r->>'allowed')::boolean
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
  PERFORM public.perm_assert_manageable(p_from);
  IF p_from = p_to THEN RAISE EXCEPTION 'اختار موظف تاني' USING ERRCODE = '22023'; END IF;

  DELETE FROM public.user_permissions WHERE user_id = p_to AND tenant_id = v_tenant;
  INSERT INTO public.user_permissions (tenant_id, user_id, permission_key, allowed)
  SELECT v_tenant, p_to, permission_key, allowed FROM public.user_permissions
   WHERE user_id = p_from AND tenant_id = v_tenant;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF p_with_role THEN
    SELECT role::text INTO v_role FROM public.user_roles
     WHERE user_id = p_from AND role::text IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer')
     LIMIT 1;
    IF v_role IS NOT NULL THEN
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

REVOKE ALL ON FUNCTION public.perm_assert_manageable(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_user_permissions(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.copy_user_permissions(uuid, uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_user_permissions(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copy_user_permissions(uuid, uuid, boolean, boolean) TO authenticated;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
SELECT v, '0114', 'permissions redesign: atomic overrides save / copy from another employee (admin or owner, own company)'
  FROM unnest(ARRAY['save_user_permissions', 'copy_user_permissions']) v
 WHERE NOT EXISTS (SELECT 1 FROM public.security_rpc_allowlist a WHERE a.function_name = v);
