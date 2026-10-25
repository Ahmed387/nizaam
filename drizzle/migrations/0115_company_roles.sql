-- 0115: company roles + hide / rename the ready roles (owner decisions 2026-10-24: «(أ)» + «1 و 2 مع بعض»).
--  * A company role («دور الشركة», e.g. «مندوب مبيعات») = a permission_templates row (name + ready role it is built on +
--    its own differences). It is LINKED to its employees (user_company_roles): change the role once and every employee
--    on it follows. One employee may still differ (his own user_permissions win over the role).
--  * Resolver order (perm_resolve): super admin / company owner → his own override (branch, then every branch) →
--    manager → HIS COMPANY ROLE → ready-role rows → part follows its page → role defaults.
--  * A ready role can be hidden for one company (nobody can be put on it, also not by the server) only when nobody is
--    on it and no company role is built on it; «مراقب» is never hidden (partners need it). It can be renamed for one
--    company (label only; its server rules stay the same).
--  * A company role is deleted only through delete_company_role, which first moves its employees to another role.

-- 1) who is on which company role
CREATE TABLE IF NOT EXISTS public.user_company_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.permission_templates(id) ON DELETE RESTRICT,
  assigned_by uuid DEFAULT auth.uid(),
  assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_company_roles_template_idx ON public.user_company_roles (template_id);
ALTER TABLE public.user_company_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ucr_read ON public.user_company_roles;
CREATE POLICY ucr_read ON public.user_company_roles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         OR (tenant_id = (SELECT public.current_tenant_id())
             AND ((SELECT public.is_admin((SELECT auth.uid()))) OR (SELECT public.is_owner((SELECT auth.uid()))))));
REVOKE ALL ON public.user_company_roles FROM anon, authenticated;
GRANT SELECT ON public.user_company_roles TO authenticated;

-- an employee reads the company role he is on (the app needs its differences to show him the right screens)
DROP POLICY IF EXISTS ptpl_read_own ON public.permission_templates;
CREATE POLICY ptpl_read_own ON public.permission_templates FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_roles u WHERE u.template_id = permission_templates.id AND u.user_id = (SELECT auth.uid())));

-- 2) ready roles per company: hidden / own name
CREATE TABLE IF NOT EXISTS public.tenant_role_settings (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer')),
  hidden boolean NOT NULL DEFAULT false,
  label text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 40),
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role),
  CHECK (NOT (hidden AND role = 'viewer'))
);
ALTER TABLE public.tenant_role_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trs_read ON public.tenant_role_settings;
CREATE POLICY trs_read ON public.tenant_role_settings FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON public.tenant_role_settings FROM anon, authenticated;
GRANT SELECT ON public.tenant_role_settings TO authenticated;

-- 3) nobody is put on a hidden role (any path: screens, edge functions, copy, company roles)
CREATE OR REPLACE FUNCTION public.guard_hidden_role()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := coalesce(NEW.tenant_id, (SELECT tenant_id FROM public.profiles WHERE id = NEW.user_id));
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_role_settings s WHERE s.tenant_id = v_tenant AND s.role = NEW.role::text AND s.hidden) THEN
    RAISE EXCEPTION 'الدور «%» مخفي في الشركة — أظهره الأول من الإعدادات ← القوالب (الأدوار)', coalesce(
      (SELECT label FROM public.tenant_role_settings s WHERE s.tenant_id = v_tenant AND s.role = NEW.role::text), NEW.role::text)
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS a0_guard_hidden_role ON public.user_roles;
CREATE TRIGGER a0_guard_hidden_role BEFORE INSERT OR UPDATE OF role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_hidden_role();

-- a company role cannot be built on a hidden ready role
CREATE OR REPLACE FUNCTION public.guard_template_base_role()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_role_settings s WHERE s.tenant_id = NEW.tenant_id AND s.role = NEW.base_role AND s.hidden) THEN
    RAISE EXCEPTION 'الدور اللي الدور الجديد مبني عليه مخفي في الشركة' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS a0_guard_template_base_role ON public.permission_templates;
CREATE TRIGGER a0_guard_template_base_role BEFORE INSERT OR UPDATE OF base_role ON public.permission_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_template_base_role();

-- the employees of a company role always carry its ready role (the server rules of «كاشير» etc. need it)
CREATE OR REPLACE FUNCTION public.sync_company_role_base()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.base_role IS DISTINCT FROM OLD.base_role THEN
    DELETE FROM public.user_roles ur
     USING public.user_company_roles u
     WHERE u.template_id = NEW.id AND ur.user_id = u.user_id
       AND ur.role::text IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer');
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    SELECT u.user_id, NEW.base_role::app_role, NEW.tenant_id FROM public.user_company_roles u WHERE u.template_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS zz_sync_company_role_base ON public.permission_templates;
CREATE TRIGGER zz_sync_company_role_base AFTER UPDATE OF base_role ON public.permission_templates
  FOR EACH ROW EXECUTE FUNCTION public.sync_company_role_base();

-- putting someone on another ready role (old screens, employee file) takes him off his company role
CREATE OR REPLACE FUNCTION public.drop_company_role_on_role_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role::text IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer') THEN
    DELETE FROM public.user_company_roles u
     USING public.permission_templates t
     WHERE u.user_id = NEW.user_id AND t.id = u.template_id AND t.base_role <> NEW.role::text;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS zz_drop_company_role_on_role_change ON public.user_roles;
CREATE TRIGGER zz_drop_company_role_on_role_change AFTER INSERT OR UPDATE OF role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.drop_company_role_on_role_change();

-- 4) the resolver: the company role sits between the manager check and the ready-role rows
CREATE OR REPLACE FUNCTION public.perm_resolve(_uid uuid, _key text, _branch uuid DEFAULT NULL)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
  IF public.is_admin(_uid) THEN RETURN true; END IF;
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

-- 5) the owner / manager actions
CREATE OR REPLACE FUNCTION public.perm_assert_company_admin()
 RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'لازم تسجل دخول' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_admin(v_uid) OR public.is_owner(v_uid) OR EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant AND owner_user_id = v_uid)) THEN
    RAISE EXCEPTION 'الأدوار لصاحب الشركة أو المدير بس' USING ERRCODE = '42501';
  END IF;
  IF public.current_tenant_is_suspended() THEN RAISE EXCEPTION 'الشركة موقوفة' USING ERRCODE = '42501'; END IF;
  RETURN v_tenant;
END;
$function$;

-- put one employee on a company role (or take him off it: p_template NULL keeps his ready role)
CREATE OR REPLACE FUNCTION public.set_user_company_role(p_user uuid, p_template uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.perm_assert_manageable(p_user);
  v_base text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role::text IN ('admin', 'partner')) THEN
    RAISE EXCEPTION 'المدير العام والشريك مش بيتحطوا على دور — بيتظبطوا من شاشتهم' USING ERRCODE = '22023';
  END IF;
  IF p_template IS NULL THEN
    DELETE FROM public.user_company_roles WHERE user_id = p_user;
    RETURN jsonb_build_object('template', null);
  END IF;
  SELECT base_role INTO v_base FROM public.permission_templates WHERE id = p_template AND tenant_id = v_tenant;
  IF v_base IS NULL THEN RAISE EXCEPTION 'الدور ده مش موجود في شركتك' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role::text = v_base) THEN
    DELETE FROM public.user_roles WHERE user_id = p_user
      AND role::text IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer');
    INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES (p_user, v_base::app_role, v_tenant);
  END IF;
  INSERT INTO public.user_company_roles (user_id, tenant_id, template_id) VALUES (p_user, v_tenant, p_template)
  ON CONFLICT (user_id) DO UPDATE SET template_id = excluded.template_id, tenant_id = excluded.tenant_id,
    assigned_by = auth.uid(), assigned_at = now();
  RETURN jsonb_build_object('template', p_template, 'base_role', v_base);
END;
$function$;

-- delete a company role; its employees first move to another company role or a ready role
CREATE OR REPLACE FUNCTION public.delete_company_role(p_template uuid, p_move_to_template uuid DEFAULT NULL, p_move_to_role text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.perm_assert_company_admin();
  v_n integer;
  v_base text;
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.permission_templates WHERE id = p_template AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'الدور ده مش موجود في شركتك' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_n FROM public.user_company_roles WHERE template_id = p_template;
  IF v_n > 0 THEN
    IF p_move_to_template IS NOT NULL THEN
      IF p_move_to_template = p_template THEN RAISE EXCEPTION 'اختار دور تاني' USING ERRCODE = '22023'; END IF;
      SELECT base_role INTO v_base FROM public.permission_templates WHERE id = p_move_to_template AND tenant_id = v_tenant;
      IF v_base IS NULL THEN RAISE EXCEPTION 'الدور اللي هتنقلهم عليه مش موجود' USING ERRCODE = '22023'; END IF;
      FOR r IN SELECT user_id FROM public.user_company_roles WHERE template_id = p_template LOOP
        IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = r.user_id AND role::text = v_base) THEN
          DELETE FROM public.user_roles WHERE user_id = r.user_id
            AND role::text IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer');
          INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES (r.user_id, v_base::app_role, v_tenant);
        END IF;
        INSERT INTO public.user_company_roles (user_id, tenant_id, template_id) VALUES (r.user_id, v_tenant, p_move_to_template)
        ON CONFLICT (user_id) DO UPDATE SET template_id = excluded.template_id, assigned_by = auth.uid(), assigned_at = now();
      END LOOP;
    ELSIF p_move_to_role IS NOT NULL THEN
      IF p_move_to_role NOT IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer') THEN
        RAISE EXCEPTION 'دور مش معروف' USING ERRCODE = '22023';
      END IF;
      FOR r IN SELECT user_id FROM public.user_company_roles WHERE template_id = p_template LOOP
        DELETE FROM public.user_company_roles WHERE user_id = r.user_id;
        DELETE FROM public.user_roles WHERE user_id = r.user_id
          AND role::text IN ('branch_manager','accountant','cashier','warehouse','supervisor','worker','driver','viewer');
        INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES (r.user_id, p_move_to_role::app_role, v_tenant);
      END LOOP;
    ELSE
      RAISE EXCEPTION 'الدور ده عليه % موظف — اختار تنقلهم على أنهي دور الأول', v_n USING ERRCODE = '22023';
    END IF;
  END IF;
  DELETE FROM public.permission_templates WHERE id = p_template;
  RETURN jsonb_build_object('moved', v_n);
END;
$function$;

-- hide / show / rename a ready role for this company
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

-- 6) copy also copies the company role
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
    INSERT INTO public.branch_users (user_id, branch_id, tenant_id, access_level)
    SELECT p_to, branch_id, v_tenant, access_level FROM public.branch_users WHERE user_id = p_from;
  END IF;
  RETURN jsonb_build_object('overrides', v_n, 'role', v_role);
END;
$function$;

-- privileges
REVOKE ALL ON FUNCTION public.guard_hidden_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_template_base_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_company_role_base() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drop_company_role_on_role_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.perm_resolve(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.perm_assert_company_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_user_company_role(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_company_role(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_role_setting(text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.copy_user_permissions(uuid, uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_company_role(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_company_role(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_role_setting(text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copy_user_permissions(uuid, uuid, boolean, boolean) TO authenticated;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
SELECT v, '0115', 'company roles: assign / delete (with move) / hide-rename ready roles — owner or manager, own company'
  FROM unnest(ARRAY['set_user_company_role', 'delete_company_role', 'set_role_setting']) v
 WHERE NOT EXISTS (SELECT 1 FROM public.security_rpc_allowlist a WHERE a.function_name = v);
