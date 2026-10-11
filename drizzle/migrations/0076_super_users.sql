-- 0076 — «كل مستخدمي المنصة» for the platform owner.
--
-- Why: the page asked PostgREST for profiles + user_roles(role) as an embedded join, but profiles and
-- user_roles are not linked by a foreign key (both point at auth.users), so every call failed with
-- 400 and the page showed «0 مستخدم». It also never showed the real login email, the last sign-in,
-- or accounts that exist in Auth without a profile.
--
-- super_list_users(): one row per Auth account — login email, visible username, company, roles,
-- active flag, confirmed, last sign-in, and whether the profile / company link is missing.
-- Super admin only; read-only.

CREATE OR REPLACE FUNCTION public.super_list_users()
RETURNS TABLE(id uuid, email text, username text, name text, tenant_id uuid, tenant_name text,
              roles text[], is_active boolean, email_confirmed boolean, last_sign_in_at timestamptz,
              created_at timestamptz, has_profile boolean, is_partner_login boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح — صاحب المنصة بس';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, p.username::text, coalesce(p.name, u.raw_user_meta_data->>'name')::text,
         p.tenant_id, t.name::text,
         coalesce((SELECT array_agg(r.role::text ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id = u.id), '{}'),
         coalesce(p.is_active, false) AND (u.banned_until IS NULL OR u.banned_until < now()),
         u.email_confirmed_at IS NOT NULL, u.last_sign_in_at, u.created_at,
         p.id IS NOT NULL, u.email LIKE '%@partners.local'
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.tenants t ON t.id = p.tenant_id
   WHERE u.deleted_at IS NULL
   ORDER BY t.name NULLS FIRST, u.created_at;
END $$;

REVOKE ALL ON FUNCTION public.super_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_list_users() TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('super_list_users', '0076', 'super admin only: every Auth account with its company and roles')
ON CONFLICT DO NOTHING;
