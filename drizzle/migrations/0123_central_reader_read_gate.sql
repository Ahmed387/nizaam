-- 0123 — a viewer / partner («قارئ مركزي») reads every branch of his company on the server too, read only
-- (owner «نفذ (أ)» 2026-10-25).
--
-- The root cause (الحاج ناصر audit, 2026-10-25): the app treats a viewer / partner as a central reader of every branch,
-- but every server read gate asked «is he in branch_users of this branch?» (user_in_branch). A viewer / partner is in
-- no branch, so the customers list, a contact's statement, aging, the treasury wallets, a product's available
-- quantity, the shift schedule… all failed with «غير مصرح: ليس لديك صلاحية على هذا الفرع» while his permissions
-- (customers.view, treasury.view…) were open.
--
-- The fix keeps reading and writing apart:
--   * user_reads_branch(uid, branch)  = user_in_branch  OR  (viewer / partner AND the branch is of his company AND not paused)
--   * assert_read_access(branch, perm) = assert_access with user_reads_branch; a write key goes to assert_access unchanged
--   * only the READ gates use them: guard_read_branch / guard_read_product / guard_read_shift, ledger_read_scope,
--     get_branch_wallet_balances. Every write (sale, voucher, edit, restore_product…) still calls assert_access →
--     user_in_branch, so a viewer / partner still writes nothing.
--   * the company-wide reports (owner «أ»): open read only to a viewer / partner when the page / box that shows them
--     is open for him — closing that page in his permissions closes the report on the server too:
--       owner_business_snapshot  ← part.admin_home.business_snapshot.view OR admin_reports_profitability.view
--       branch_stock_report      ← admin_reports_profitability.view
--       ledger_position(all)     ← admin_main_treasury.view
--       opening_balances_summary ← admin_main_treasury.view
--     The audit tools (system_integrity_summary, generate_alerts, reconciliations, health checks, flexible
--     distribution / fiscal closing) stay admin only.
-- Admins: every gate answers exactly as before (can_read_company_report is true for admin / owner / super admin).

CREATE OR REPLACE FUNCTION public.is_central_reader(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND (public.has_role(_uid, 'viewer'::app_role) OR public.has_role(_uid, 'partner'::app_role))
$$;
REVOKE ALL ON FUNCTION public.is_central_reader(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.user_reads_branch(_uid uuid, _branch uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.user_in_branch(_uid, _branch)
      OR (_branch IS NOT NULL AND public.is_central_reader(_uid)
          AND EXISTS (SELECT 1 FROM public.branches b
                       WHERE b.id = _branch AND NOT b.platform_paused
                         AND b.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = _uid)))
$$;
REVOKE ALL ON FUNCTION public.user_reads_branch(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_read_access(p_branch_id uuid, p_permission text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_branch_tenant uuid;
  v_paused boolean;
BEGIN
  -- a write key never takes the read path
  IF p_permission IS NOT NULL AND coalesce((regexp_match(p_permission, '\.([a-z_]+)$'))[1] NOT IN ('view', 'read'), true) THEN
    PERFORM public.assert_access(p_branch_id, p_permission);
    RETURN;
  END IF;
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
    IF NOT public.user_reads_branch(v_uid, p_branch_id) THEN
      RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
    END IF;
    IF p_permission IS NOT NULL AND NOT public.perm_resolve(v_uid, p_permission, p_branch_id) THEN
      RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية «%»', p_permission USING ERRCODE = '42501';
    END IF;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.assert_read_access(uuid, text) FROM PUBLIC, anon, authenticated;

-- admin / owner / super admin → true (as before); a viewer / partner → true when one of the keys is open for him
CREATE OR REPLACE FUNCTION public.can_read_company_report(p_keys text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
       public.is_admin(auth.uid()) OR public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid())
    OR (public.is_central_reader(auth.uid()) AND NOT public.current_tenant_is_suspended()
        AND EXISTS (SELECT 1 FROM unnest(p_keys) k WHERE public.effective_permission(auth.uid(), k))))
$$;
REVOKE ALL ON FUNCTION public.can_read_company_report(text[]) FROM PUBLIC, anon, authenticated;

-- Patch the gate line only (each pattern must match exactly once, else the migration stops); CREATE OR REPLACE keeps
-- every grant as it is.
CREATE OR REPLACE FUNCTION pg_temp.patch_gate(p_fn text, p_pattern text, p_repl text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_oid oid; v_def text; v_n int;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_fn;
  v_def := pg_get_functiondef(v_oid);
  SELECT count(*) INTO v_n FROM regexp_matches(v_def, p_pattern, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0123: % — the gate matched % times (expected 1)', p_fn, v_n;
  END IF;
  EXECUTE regexp_replace(v_def, p_pattern, p_repl);
END $$;

SELECT pg_temp.patch_gate('guard_read_branch',  'public\.assert_access\(', 'public.assert_read_access(');
SELECT pg_temp.patch_gate('guard_read_product', 'public\.assert_access\(', 'public.assert_read_access(');
SELECT pg_temp.patch_gate('guard_read_shift',   'public\.assert_access\(', 'public.assert_read_access(');
SELECT pg_temp.patch_gate('get_branch_wallet_balances', 'public\.assert_access\(p_branch_id, NULL\)', 'public.assert_read_access(p_branch_id, NULL)');
SELECT pg_temp.patch_gate('ledger_read_scope', 'public\.user_in_branch\(v_uid, p_branch\)', 'public.user_reads_branch(v_uid, p_branch)');
SELECT pg_temp.patch_gate('owner_business_snapshot',
  'NOT \(public\.is_admin\(auth\.uid\(\)\) OR public\.is_super_admin\(auth\.uid\(\)\)\)',
  'NOT public.can_read_company_report(ARRAY[''part.admin_home.business_snapshot.view'', ''admin_reports_profitability.view''])');
SELECT pg_temp.patch_gate('branch_stock_report',
  'NOT \(public\.is_admin\(auth\.uid\(\)\) OR public\.is_super_admin\(auth\.uid\(\)\)\)',
  'NOT public.can_read_company_report(ARRAY[''admin_reports_profitability.view''])');
SELECT pg_temp.patch_gate('ledger_position',
  'p_branch_id IS NULL AND NOT \(public\.is_admin\(auth\.uid\(\)\) OR public\.is_super_admin\(auth\.uid\(\)\)\)',
  'p_branch_id IS NULL AND NOT public.can_read_company_report(ARRAY[''admin_main_treasury.view''])');
SELECT pg_temp.patch_gate('opening_balances_summary',
  'NOT \(public\.is_admin\(auth\.uid\(\)\) OR public\.is_owner\(auth\.uid\(\)\) OR public\.is_super_admin\(auth\.uid\(\)\)\)',
  'NOT public.can_read_company_report(ARRAY[''admin_main_treasury.view''])');
