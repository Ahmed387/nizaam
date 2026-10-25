-- 0122 — every branch of an employee has its own level and its own template (owner decisions 2026-10-25:
-- «إدارة كاملة = كل حاجة في الفرع»، «إدارة جزئية = صلاحيات في فرع وصلاحيات تانية في فرع تاني»، «عرض = رؤية بس»،
-- «قالب لكل فرع تمام»).
--   branch_users.access_level 'read'                       → «عرض فقط»: nothing that writes, in that branch
--   branch_users.full_access = true (access_level 'manage') → «إدارة كاملة»: every branch permission, in that branch
--   otherwise                                              → «إدارة جزئية»: his role — or the template chosen for
--                                                             that branch (branch_role = a ready role, or
--                                                             branch_template = a company role) — plus his own changes
-- Resolver (perm_resolve, mirrored by checkPermission in src/lib/roles.ts — keep identical):
--   super admin / company owner → true
--   «عرض فقط» branch + a write key → false (nothing opens a write in a view-only branch)
--   his override for this branch («key@branch»)
--   «إدارة كاملة» branch + any key that is not a company page (admin_…) → true
--   his override for every branch
--   manager (admin) → true
--   the branch template (company role: its own value, then its ready role) / branch ready role → role rows
--   → a part follows its page → role defaults
--   no branch template → his company role → his ready role → … (as in 0115)
-- RLS still uses his main ready role (user_roles); a branch template changes what the screens and the guarded
-- RPCs (assert_access → perm_resolve with the branch) allow.

ALTER TABLE public.branch_users
  ADD COLUMN IF NOT EXISTS full_access boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS branch_role text,
  ADD COLUMN IF NOT EXISTS branch_template uuid REFERENCES public.permission_templates(id) ON DELETE SET NULL;
ALTER TABLE public.branch_users DROP CONSTRAINT IF EXISTS branch_users_role_check;
ALTER TABLE public.branch_users ADD CONSTRAINT branch_users_role_check CHECK (
  (branch_role IS NULL OR branch_role IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer'))
  AND NOT (branch_role IS NOT NULL AND branch_template IS NOT NULL)
  AND NOT (full_access AND (access_level = 'read' OR branch_role IS NOT NULL OR branch_template IS NOT NULL))
  AND NOT (access_level = 'read' AND (branch_role IS NOT NULL OR branch_template IS NOT NULL)));

-- the branch template belongs to the same company and is not built on / is not a hidden ready role
CREATE OR REPLACE FUNCTION public.guard_branch_user_template()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := NEW.tenant_id; v_base text;
BEGIN
  IF NEW.branch_template IS NOT NULL THEN
    SELECT base_role INTO v_base FROM public.permission_templates WHERE id = NEW.branch_template AND tenant_id = v_tenant;
    IF v_base IS NULL THEN RAISE EXCEPTION 'الدور ده مش موجود في شركتك' USING ERRCODE = '42501'; END IF;
  END IF;
  IF coalesce(NEW.branch_role, v_base) IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.tenant_role_settings s WHERE s.tenant_id = v_tenant AND s.role = coalesce(NEW.branch_role, v_base) AND s.hidden) THEN
    RAISE EXCEPTION 'الدور ده مخفي في الشركة — أظهره الأول من الإعدادات ← القوالب (الأدوار)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS a1_guard_branch_user_template ON public.branch_users;
CREATE TRIGGER a1_guard_branch_user_template BEFORE INSERT OR UPDATE OF branch_role, branch_template ON public.branch_users
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_user_template();
REVOKE ALL ON FUNCTION public.guard_branch_user_template() FROM PUBLIC, anon, authenticated;

-- branch_users was readable by every signed-in user of every company (policy USING true): own company only
DROP POLICY IF EXISTS allow_read_own_branches ON public.branch_users;
CREATE POLICY allow_read_own_branches ON public.branch_users FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()));

-- an employee reads the company roles he is on: his main one (0115) and the ones of his branches
DROP POLICY IF EXISTS ptpl_read_own ON public.permission_templates;
CREATE POLICY ptpl_read_own ON public.permission_templates FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_roles u WHERE u.template_id = permission_templates.id AND u.user_id = (SELECT auth.uid()))
         OR EXISTS (SELECT 1 FROM public.branch_users b WHERE b.branch_template = permission_templates.id AND b.user_id = (SELECT auth.uid())));

-- the resolver
CREATE OR REPLACE FUNCTION public.perm_resolve(_uid uuid, _key text, _branch uuid DEFAULT NULL)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v boolean;
  v_has_rows boolean;
  v_level text; v_full boolean := false; v_brole text; v_btpl uuid; v_role text;
  v_write boolean := (regexp_match(_key, '\.([a-z_]+)$'))[1] NOT IN ('view', 'read');
BEGIN
  IF _uid IS NULL OR _key IS NULL THEN RETURN false; END IF;
  IF public.is_super_admin(_uid) THEN RETURN true; END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = _uid;
  IF v_tenant IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_tenant AND t.owner_user_id = _uid)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'owner') THEN
    RETURN true;
  END IF;
  IF _branch IS NOT NULL THEN
    SELECT coalesce(bu.access_level, 'manage'), bu.full_access, bu.branch_role, bu.branch_template
      INTO v_level, v_full, v_brole, v_btpl
      FROM public.branch_users bu WHERE bu.user_id = _uid AND bu.branch_id = _branch;
    IF v_level = 'read' AND coalesce(v_write, true) THEN RETURN false; END IF;
    SELECT up.allowed INTO v FROM public.user_permissions up
     WHERE up.user_id = _uid AND up.tenant_id = v_tenant AND up.permission_key = _key AND up.branch_id = _branch LIMIT 1;
    IF v IS NOT NULL THEN RETURN v; END IF;
    IF coalesce(v_full, false) AND _key !~ '^(part\.)?admin_' THEN RETURN true; END IF;
  END IF;
  SELECT up.allowed INTO v FROM public.user_permissions up
   WHERE up.user_id = _uid AND up.tenant_id = v_tenant AND up.permission_key = _key AND up.branch_id IS NULL LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF public.is_admin(_uid) THEN RETURN true; END IF;

  -- the template of this branch (0122)
  IF v_btpl IS NOT NULL OR v_brole IS NOT NULL THEN
    IF v_btpl IS NOT NULL THEN
      SELECT (t.perms ->> _key)::boolean, t.base_role INTO v, v_role FROM public.permission_templates t
       WHERE t.id = v_btpl AND (NOT (t.perms ? _key) OR jsonb_typeof(t.perms -> _key) = 'boolean');
      IF v IS NOT NULL THEN RETURN v; END IF;
      IF v_role IS NULL THEN SELECT base_role INTO v_role FROM public.permission_templates WHERE id = v_btpl; END IF;
    ELSE
      v_role := v_brole;
    END IF;
    SELECT bool_or(rp.allowed), count(*) > 0 INTO v, v_has_rows
      FROM public.role_permissions rp WHERE rp.tenant_id = v_tenant AND rp.role = v_role AND rp.permission_key = _key;
    IF v_has_rows THEN RETURN coalesce(v, false); END IF;
    IF _key ~ '^part\.[a-z0-9_]+\.[a-z0-9_]+\.view$' THEN
      RETURN public.perm_resolve(_uid, split_part(_key, '.', 2) || '.view', _branch);
    END IF;
    RETURN coalesce(public.role_permission_default(v_role, _key), false);
  END IF;

  -- his company role (0115)
  SELECT (t.perms ->> _key)::boolean INTO v
    FROM public.user_company_roles u JOIN public.permission_templates t ON t.id = u.template_id
   WHERE u.user_id = _uid AND u.tenant_id = v_tenant AND t.perms ? _key AND jsonb_typeof(t.perms -> _key) = 'boolean';
  IF v IS NOT NULL THEN RETURN v; END IF;
  SELECT bool_or(rp.allowed), count(*) > 0 INTO v, v_has_rows
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.tenant_id = v_tenant AND rp.role = ur.role::text AND rp.permission_key = _key
   WHERE ur.user_id = _uid AND ur.tenant_id = v_tenant;
  IF v_has_rows THEN RETURN coalesce(v, false); END IF;
  IF _key ~ '^part\.[a-z0-9_]+\.[a-z0-9_]+\.view$' THEN
    RETURN public.perm_resolve(_uid, split_part(_key, '.', 2) || '.view', _branch);
  END IF;
  RETURN coalesce((SELECT bool_or(public.role_permission_default(ur.role::text, _key))
                     FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.tenant_id = v_tenant), false);
END;
$function$;
REVOKE ALL ON FUNCTION public.perm_resolve(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- a ready role used as a branch template cannot be hidden
CREATE OR REPLACE FUNCTION public.set_role_setting(p_role text, p_hidden boolean, p_label text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.perm_assert_company_admin();
  v_n integer;
  v_t integer;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
BEGIN
  IF p_role NOT IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer') THEN
    RAISE EXCEPTION 'الدور ده مش من الأدوار الجاهزة' USING ERRCODE = '22023';
  END IF;
  IF p_hidden THEN
    IF p_role = 'viewer' THEN RAISE EXCEPTION 'دور «مراقب» مينفعش يتخفي — الشركاء بيستخدموه' USING ERRCODE = '22023'; END IF;
    SELECT count(DISTINCT user_id) INTO v_n FROM public.user_roles WHERE tenant_id = v_tenant AND role::text = p_role;
    SELECT v_n + count(DISTINCT user_id) INTO v_n FROM public.branch_users WHERE tenant_id = v_tenant AND branch_role = p_role;
    IF v_n > 0 THEN RAISE EXCEPTION 'الدور ده عليه % موظف — انقلهم لدور تاني الأول', v_n USING ERRCODE = '22023'; END IF;
    SELECT count(*) INTO v_t FROM public.permission_templates WHERE tenant_id = v_tenant AND base_role = p_role;
    IF v_t > 0 THEN RAISE EXCEPTION 'فيه % دور من أدوار الشركة مبني عليه — غيّرهم الأول', v_t USING ERRCODE = '22023'; END IF;
  END IF;
  IF v_label IS NOT NULL AND length(v_label) > 40 THEN RAISE EXCEPTION 'الاسم طويل (40 حرف بالكتير)' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.tenant_role_settings (tenant_id, role, hidden, label) VALUES (v_tenant, p_role, p_hidden, v_label)
  ON CONFLICT (tenant_id, role) DO UPDATE SET hidden = excluded.hidden, label = excluded.label, updated_by = auth.uid(), updated_at = now();
  RETURN jsonb_build_object('role', p_role, 'hidden', p_hidden, 'label', v_label);
END;
$function$;

-- copying an employee also copies each branch's level and template
CREATE OR REPLACE FUNCTION public.copy_user_permissions(p_from uuid, p_to uuid, p_with_role boolean DEFAULT true, p_with_branches boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.perm_assert_manageable(p_to);
  v_role text;
  v_n integer;
  v_staff boolean;
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
  v_staff := NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_to AND role::text IN ('admin','partner'));
  IF p_with_role AND v_staff THEN
    SELECT role::text INTO v_role FROM public.user_roles
     WHERE user_id = p_from AND role::text IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer')
     LIMIT 1;
    IF v_role IS NOT NULL THEN
      DELETE FROM public.user_roles WHERE user_id = p_to
        AND role::text IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer');
      INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES (p_to, v_role::app_role, v_tenant);
    END IF;
    DELETE FROM public.user_company_roles WHERE user_id = p_to;
    INSERT INTO public.user_company_roles (user_id, tenant_id, template_id)
    SELECT p_to, v_tenant, template_id FROM public.user_company_roles WHERE user_id = p_from;
  END IF;
  IF p_with_branches THEN
    DELETE FROM public.branch_users WHERE user_id = p_to;
    INSERT INTO public.branch_users (user_id, branch_id, tenant_id, access_level, full_access, branch_role, branch_template)
    SELECT p_to, branch_id, v_tenant, access_level, full_access, branch_role, branch_template FROM public.branch_users WHERE user_id = p_from;
  END IF;
  RETURN jsonb_build_object('overrides', v_n, 'role', v_role);
END;
$function$;
