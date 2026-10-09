-- SEC-002: tenant isolation.
--
--  A. profiles.tenant_id is immutable for everyone except the super admin, service_role and migrations
--     (current_tenant_id() reads this column, so changing it used to move a user into another company).
--  B. Role helpers are scoped to the caller's own company: has_role, is_admin, is_owner,
--     has_central_access, user_in_branch, user_can_write_branch. An admin of company A no longer passes
--     checks for a branch of company B (25 app RPCs relied on user_in_branch/is_admin alone).
--  C. Historical archive tables get tenant_id + tenant-scoped RLS; log tables get tenant-scoped reads.
--  D. Companies are created only from the Super Admin dashboard:
--       - new auth users take their company from app_metadata (writable by service_role only),
--         never from user_metadata (writable by the user);
--       - a company with business documents can never be deleted (suspend instead);
--  E. RPC allow-list moves to a table, so each future migration can add its own RPC by name.
--  F. Super Admin net-profit card: RPC + platform flag; the flag stays OFF until the ledger fixes
--     (Phase 5) are complete, so no profit figure can be read before then, from the UI or the API.

-- ---------------------------------------------------------------------------------------------
-- 0. Data pre-check: role rows without a company take the company of the user's profile.
--    (guard_role_assignment already does this for new rows; this covers legacy rows.)
-- ---------------------------------------------------------------------------------------------
UPDATE public.user_roles ur
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = ur.user_id
   AND ur.tenant_id IS NULL
   AND p.tenant_id IS NOT NULL
   AND ur.role <> 'super_admin'::app_role;

DO $precheck$
DECLARE v_orphans int; v_mismatch int;
BEGIN
  SELECT count(*) INTO v_orphans FROM public.user_roles
   WHERE tenant_id IS NULL AND role <> 'super_admin'::app_role;
  SELECT count(*) INTO v_mismatch FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role <> 'super_admin'::app_role AND ur.tenant_id IS DISTINCT FROM p.tenant_id;
  RAISE NOTICE 'SEC-002 pre-check: % role rows without a company, % role rows whose company differs from the profile (these roles stop working after this migration)', v_orphans, v_mismatch;
END
$precheck$;

-- ---------------------------------------------------------------------------------------------
-- A. profiles.tenant_id immutable
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- service_role (edge functions), migrations/owner and the super admin may set any company.
  IF current_user NOT IN ('authenticated', 'anon') OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'لا يمكن تغيير الشركة التابع لها المستخدم' USING ERRCODE = '42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'لا يمكن تغيير معرّف المستخدم' USING ERRCODE = '42501';
    END IF;
  ELSE -- INSERT by a signed-in user: only into the caller's own company (an admin adding a profile)
    IF NEW.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM public.current_tenant_id() THEN
      RAISE EXCEPTION 'لا يمكن إنشاء مستخدم في شركة أخرى' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_guard_profile_tenant ON public.profiles;
CREATE TRIGGER trg_guard_profile_tenant
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_tenant();

-- New auth users: company comes from app_metadata only (service_role sets it in the edge functions).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := NULLIF(NEW.raw_app_meta_data->>'tenant_id', '')::uuid;
  INSERT INTO public.profiles (id, name, username, tenant_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    v_tenant_id
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- B. Role helpers scoped to the caller's company
--    super_admin is platform-wide; every other role counts only inside the user's own company.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = _user_id
       AND ur.role = _role
       AND (
             _role = 'super_admin'::app_role
          OR ur.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = _user_id)
       )
  )
$fn$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = _user_id
       AND (
             ur.role = 'super_admin'::app_role
          OR (ur.role IN ('admin'::app_role, 'owner'::app_role)
              AND ur.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = _user_id))
       )
  )
$fn$;

CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT public.has_role(_user_id, 'owner'::app_role)
      OR EXISTS (
           SELECT 1 FROM public.tenants t
            WHERE t.owner_user_id = _user_id
              AND t.id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = _user_id)
         )
$fn$;

CREATE OR REPLACE FUNCTION public.has_central_access(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = _uid
       AND (
             ur.role = 'super_admin'::app_role
          OR (ur.role IN ('admin'::app_role, 'owner'::app_role, 'accountant'::app_role,
                          'viewer'::app_role, 'partner'::app_role)
              AND ur.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = _uid))
       )
  )
$fn$;

-- A branch counts only if it belongs to the user's company (super admin: any branch).
-- NULL branch keeps the old meaning (admin-only), now tenant-scoped through is_admin.
CREATE OR REPLACE FUNCTION public.user_in_branch(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
            OR EXISTS (SELECT 1 FROM public.branch_users bu
                        WHERE bu.user_id = _user_id AND bu.branch_id = _branch_id)
         )
    )
  END
$fn$;

CREATE OR REPLACE FUNCTION public.user_can_write_branch(p_user_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN public.is_super_admin(p_user_id) THEN true
    -- a branch of another company is never writable
    WHEN p_branch_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.branches b
            WHERE b.id = p_branch_id
              AND b.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = p_user_id)
         ) THEN false
    -- owner / admin of this company
    WHEN public.is_admin(p_user_id) OR public.is_owner(p_user_id) THEN true
    WHEN p_branch_id IS NULL THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.branch_users bu
       WHERE bu.user_id = p_user_id
         AND bu.branch_id = p_branch_id
         AND COALESCE(bu.access_level, 'manage') = 'manage'
    )
  END
$fn$;

-- branch_users rows may only link a user to a branch of the user's own company.
CREATE OR REPLACE FUNCTION public.guard_branch_user_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_branch_tenant uuid; v_user_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_branch_tenant FROM public.branches WHERE id = NEW.branch_id;
  SELECT tenant_id INTO v_user_tenant FROM public.profiles WHERE id = NEW.user_id;
  IF v_branch_tenant IS DISTINCT FROM v_user_tenant AND NOT public.is_super_admin(NEW.user_id) THEN
    RAISE EXCEPTION 'لا يمكن ربط مستخدم بفرع من شركة أخرى' USING ERRCODE = '42501';
  END IF;
  NEW.tenant_id := v_branch_tenant;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_guard_branch_user_tenant ON public.branch_users;
CREATE TRIGGER trg_guard_branch_user_tenant
  BEFORE INSERT OR UPDATE OF user_id, branch_id ON public.branch_users
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_user_tenant();

DO $bu_check$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v
    FROM public.branch_users bu
    JOIN public.branches b ON b.id = bu.branch_id
    JOIN public.profiles p ON p.id = bu.user_id
   WHERE b.tenant_id IS DISTINCT FROM p.tenant_id;
  RAISE NOTICE 'SEC-002: % existing branch_users rows link a user to another company''s branch (inactive from now on; review them)', v;
END
$bu_check$;

-- ---------------------------------------------------------------------------------------------
-- C. Historical archive: tenant_id + tenant-scoped policies
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.historical_invoices      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.historical_invoice_items ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.historical_vouchers      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

UPDATE public.historical_invoices h      SET tenant_id = b.tenant_id FROM public.branches b WHERE b.id = h.branch_id AND h.tenant_id IS NULL;
UPDATE public.historical_invoice_items h SET tenant_id = b.tenant_id FROM public.branches b WHERE b.id = h.branch_id AND h.tenant_id IS NULL;
UPDATE public.historical_vouchers h      SET tenant_id = b.tenant_id FROM public.branches b WHERE b.id = h.branch_id AND h.tenant_id IS NULL;

DO $hist_report$
DECLARE a int; b int; c int;
BEGIN
  SELECT count(*) INTO a FROM public.historical_invoices      WHERE tenant_id IS NULL;
  SELECT count(*) INTO b FROM public.historical_invoice_items WHERE tenant_id IS NULL;
  SELECT count(*) INTO c FROM public.historical_vouchers      WHERE tenant_id IS NULL;
  RAISE NOTICE 'SEC-002 historical rows without a company (visible to the super admin only until assigned): invoices %, items %, vouchers %', a, b, c;
END
$hist_report$;

CREATE INDEX IF NOT EXISTS idx_hist_inv_tenant   ON public.historical_invoices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_hist_items_tenant ON public.historical_invoice_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_hist_vch_tenant   ON public.historical_vouchers (tenant_id);

-- Branch name lookup stays inside the caller's company.
CREATE OR REPLACE FUNCTION public.historical_branch_id_for(p_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT b.id FROM public.branches b
   WHERE b.is_system = false
     AND (public.current_tenant_id() IS NULL OR b.tenant_id = public.current_tenant_id())
     AND (    trim(b.name) = trim(p_name)
          OR (p_name ILIKE '%عبد المنعم%' AND b.name ILIKE '%عبدالمنعم%')
          OR (p_name ILIKE '%شلبي%' AND b.name ILIKE '%شلبى%'))
   ORDER BY (trim(b.name) = trim(p_name)) DESC
   LIMIT 1
$fn$;

-- Runs after trg_hist_*_branch (trigger names fire in alphabetical order): company from the branch,
-- else the caller's company.
CREATE OR REPLACE FUNCTION public.historical_set_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    SELECT b.tenant_id INTO NEW.tenant_id FROM public.branches b WHERE b.id = NEW.branch_id;
  END IF;
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM public.current_tenant_id()
     AND current_user IN ('authenticated', 'anon')
     AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'لا يمكن إضافة أرشيف لشركة أخرى' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;

DO $hist_policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['historical_invoices', 'historical_invoice_items', 'historical_vouchers'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_hist_set_tenant ON public.%I', t);
    EXECUTE format('CREATE TRIGGER zz_hist_set_tenant BEFORE INSERT OR UPDATE OF branch_id, branch_name, tenant_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.historical_set_tenant_id()', t);

    EXECUTE format('DROP POLICY IF EXISTS "Allow authenticated read/write %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS hist_select_scoped ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS hist_insert_admin ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS hist_update_owner ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS hist_delete_owner ON public.%I', t);

    EXECUTE format($p$CREATE POLICY hist_select_scoped ON public.%I FOR SELECT TO authenticated USING (
      public.is_super_admin(auth.uid())
      OR (tenant_id = public.current_tenant_id()
          AND (public.has_central_access(auth.uid())
               OR branch_id IN (SELECT bu.branch_id FROM public.branch_users bu WHERE bu.user_id = auth.uid()))))$p$, t);
    EXECUTE format($p$CREATE POLICY hist_insert_admin ON public.%I FOR INSERT TO authenticated WITH CHECK (
      public.is_super_admin(auth.uid())
      OR (tenant_id = public.current_tenant_id() AND public.is_admin(auth.uid())))$p$, t);
    EXECUTE format($p$CREATE POLICY hist_update_owner ON public.%I FOR UPDATE TO authenticated USING (
      public.is_super_admin(auth.uid())
      OR (tenant_id = public.current_tenant_id() AND public.is_owner(auth.uid())))
      WITH CHECK (
      public.is_super_admin(auth.uid())
      OR (tenant_id = public.current_tenant_id() AND public.is_owner(auth.uid())))$p$, t);
    EXECUTE format($p$CREATE POLICY hist_delete_owner ON public.%I FOR DELETE TO authenticated USING (
      public.is_super_admin(auth.uid())
      OR (tenant_id = public.current_tenant_id() AND public.is_owner(auth.uid())))$p$, t);
  END LOOP;
END
$hist_policies$;

-- Log tables: a company sees only its own rows; rows without a company are platform rows (super admin).
DROP POLICY IF EXISTS "admins read logs" ON public.ai_ask_log;
CREATE POLICY "admins read logs" ON public.ai_ask_log FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR public.is_super_admin(auth.uid())
  OR (tenant_id = public.current_tenant_id() AND public.is_admin(auth.uid()))
);

DROP POLICY IF EXISTS "admins view health runs" ON public.health_check_runs;
CREATE POLICY "admins view health runs" ON public.health_check_runs FOR SELECT TO authenticated USING (
  public.is_super_admin(auth.uid())
  OR (tenant_id = public.current_tenant_id() AND public.is_admin(auth.uid()))
);

-- ---------------------------------------------------------------------------------------------
-- D. Companies are never hard-deleted once they hold business documents (suspend instead).
--    A company with no documents can still be removed, which the Super Admin creation flow
--    (bootstrap-tenant) needs to roll back a half-created company.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_tenant_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoices         WHERE tenant_id = OLD.id)
  OR EXISTS (SELECT 1 FROM public.shipments        WHERE tenant_id = OLD.id)
  OR EXISTS (SELECT 1 FROM public.vouchers         WHERE tenant_id = OLD.id AND source = 'manual')
  OR EXISTS (SELECT 1 FROM public.returns          WHERE tenant_id = OLD.id)
  OR EXISTS (SELECT 1 FROM public.purchase_returns WHERE tenant_id = OLD.id)
  OR EXISTS (SELECT 1 FROM public.historical_invoices WHERE tenant_id = OLD.id) THEN
    RAISE EXCEPTION 'لا يمكن حذف شركة لها مستندات — استخدم الإيقاف، وبياناتها تبقى محفوظة'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END
$fn$;

DROP TRIGGER IF EXISTS trg_guard_tenant_delete ON public.tenants;
CREATE TRIGGER trg_guard_tenant_delete
  BEFORE DELETE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_delete();

-- ---------------------------------------------------------------------------------------------
-- E. RPC allow-list as a table (replaces the array inside security_exposed_definer_functions).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_rpc_allowlist (
  function_name text PRIMARY KEY,
  added_in      text NOT NULL,
  note          text
);
ALTER TABLE public.security_rpc_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_rpc_allowlist FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.security_rpc_allowlist TO service_role;

-- Seed from the list 0049 checked, then add this migration's new RPC.
INSERT INTO public.security_rpc_allowlist (function_name, added_in)
SELECT p.proname, '0049'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prosecdef
   AND p.prorettype <> 'trigger'::regtype
   AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
ON CONFLICT (function_name) DO NOTHING;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('super_tenants_monthly_profit', '0050', 'Super Admin net-profit card; guarded by is_super_admin + platform flag')
ON CONFLICT (function_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.security_exposed_definer_functions()
RETURNS TABLE(function_signature text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
  SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND p.prorettype <> 'trigger'::regtype
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM public.security_rpc_allowlist a WHERE a.function_name = p.proname)
   ORDER BY 1;
$fn$;
REVOKE ALL ON FUNCTION public.security_exposed_definer_functions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_exposed_definer_functions() TO service_role;

-- New functions in this migration that the browser must NOT call.
REVOKE ALL ON FUNCTION public.guard_profile_tenant()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_branch_user_tenant()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.historical_set_tenant_id()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_tenant_delete()        FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- F. Super Admin net-profit card (structure only; switched off until Phase 5 is complete)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_flags (
  key        text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.platform_flags ENABLE ROW LEVEL SECURITY;
-- No browser access at all: the flag is switched by the owner/DBA, and read only inside the RPC below.
REVOKE ALL ON public.platform_flags FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_flags TO service_role;

INSERT INTO public.platform_flags (key, enabled, note)
VALUES ('super_profit_card', false,
        'Enable only after Phase 5 (GL fixes FIN-003, FIN-008, DB-001, DB-002, DB-004, DB-005, CARD-009) is complete and reconciled.')
ON CONFLICT (key) DO NOTHING;

-- Per-company monthly P&L from the general ledger (the same source as fiscal closing).
-- Returns {"enabled": false} while the flag is off: no figure is computed or returned.
CREATE OR REPLACE FUNCTION public.super_tenants_monthly_profit(p_month date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_from date := date_trunc('month', COALESCE(p_month, (now() AT TIME ZONE 'Africa/Cairo')::date))::date;
  v_to   date;
  v_prev_from date;
  v_prev_to   date;
  v_rows jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'متاح للسوبر أدمن فقط' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE((SELECT enabled FROM public.platform_flags WHERE key = 'super_profit_card'), false) THEN
    RETURN jsonb_build_object('enabled', false, 'month', v_from);
  END IF;

  v_to        := (v_from + interval '1 month' - interval '1 day')::date;
  v_prev_from := (v_from - interval '1 month')::date;
  v_prev_to   := (v_from - interval '1 day')::date;

  WITH lines AS (
    SELECT je.tenant_id,
           je.entry_date,
           coa.account_type,
           coa.code,
           jel.debit,
           jel.credit
      FROM public.journal_entry_lines jel
      JOIN public.journal_entries je   ON je.id = jel.entry_id
      JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
     WHERE je.status = 'posted'
       AND je.entry_date BETWEEN v_prev_from AND v_to
       AND coa.account_type IN ('revenue', 'expense')
  ),
  agg AS (
    SELECT tenant_id,
           SUM(CASE WHEN entry_date >= v_from AND account_type = 'revenue' THEN credit - debit ELSE 0 END) AS revenue,
           SUM(CASE WHEN entry_date >= v_from AND account_type = 'expense' AND code = '5100' THEN debit - credit ELSE 0 END) AS cogs,
           SUM(CASE WHEN entry_date >= v_from AND account_type = 'expense' AND code <> '5100' THEN debit - credit ELSE 0 END) AS expenses,
           SUM(CASE WHEN entry_date <  v_from THEN
                 CASE WHEN account_type = 'revenue' THEN credit - debit ELSE -(debit - credit) END
               ELSE 0 END) AS prev_net
      FROM lines
     GROUP BY tenant_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'tenant_id',       t.id,
           'name',            t.name,
           'is_suspended',    t.is_suspended,
           'revenue',         round(COALESCE(a.revenue, 0), 2),
           'cogs',            round(COALESCE(a.cogs, 0), 2),
           'expenses',        round(COALESCE(a.expenses, 0), 2),
           'net_profit',      round(COALESCE(a.revenue, 0) - COALESCE(a.cogs, 0) - COALESCE(a.expenses, 0), 2),
           'prev_net_profit', round(COALESCE(a.prev_net, 0), 2)
         ) ORDER BY t.name), '[]'::jsonb)
    INTO v_rows
    FROM public.tenants t
    LEFT JOIN agg a ON a.tenant_id = t.id;

  RETURN jsonb_build_object('enabled', true, 'month', v_from, 'from', v_from, 'to', v_to, 'rows', v_rows);
END
$fn$;

REVOKE ALL ON FUNCTION public.super_tenants_monthly_profit(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_tenants_monthly_profit(date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Final check (same as 0049): nothing outside the allow-list is exposed.
-- ---------------------------------------------------------------------------------------------
DO $check$
DECLARE v_list text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'SEC-002: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
END
$check$;