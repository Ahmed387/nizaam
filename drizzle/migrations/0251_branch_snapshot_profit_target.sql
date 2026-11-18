-- 0251 (owner 2026-11-18): «رؤية صافي الربح» turned on for the branch manager, but «الرئيسية» showed «غير مصرح» and 0 everywhere.
-- Cause: owner_business_snapshot only answered the owner / admin / viewer / partner (can_read_company_report); a branch manager
-- was refused whatever his permissions. Now:
--   * company readers: unchanged (all branches, the statement's own total);
--   * anyone else with the page part (part.admin_home.business_snapshot.view) gets the branches he works in only; the total is
--     the statement total when he has every branch, else the sum of his branches;
--   * net profit / operating profit are NULL (screen shows «غير مصرح») for a non-company reader without net_profit.view.
-- Also «هدف صافي الربح الشهري»: branches.monthly_net_profit_target (the sales target stays) + branch_month_net_profit(branch, from, to)
-- for the branch dashboard (NULL when the user may not see net profit).

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS monthly_net_profit_target numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION pg_temp.rep(src text, a text, b text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(a IN src) = 0 THEN RAISE EXCEPTION 'anchor not found: %', left(a, 80); END IF;
  RETURN replace(src, a, b);
END $$;

DO $mig$
DECLARE d text := pg_get_functiondef('public.owner_business_snapshot(date,date,uuid)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$v_rows jsonb; v_ps jsonb;$a$,
    $b$v_rows jsonb; v_ps jsonb;
  v_company boolean; v_np boolean; v_all boolean; v_total jsonb;$b$);
  d := pg_temp.rep(d,
    $a$IF NOT v_service AND (auth.uid() IS NULL OR NOT public.can_read_company_report(ARRAY['part.admin_home.business_snapshot.view', 'admin_reports_profitability.view'])) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;$a$,
    $b$v_company := v_service OR (auth.uid() IS NOT NULL AND public.can_read_company_report(ARRAY['part.admin_home.business_snapshot.view', 'admin_reports_profitability.view']));
  -- 0251: a branch user with the page part sees the branches he works in
  IF NOT v_company AND (auth.uid() IS NULL OR public.current_tenant_is_suspended()
       OR NOT public.effective_permission(auth.uid(), 'part.admin_home.business_snapshot.view')
       OR NOT EXISTS (SELECT 1 FROM public.branches x WHERE x.tenant_id = v_t AND coalesce(x.is_system, false) = false AND public.user_in_branch(auth.uid(), x.id))) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  v_np := v_company OR public.effective_permission(auth.uid(), 'net_profit.view');
  v_all := v_company OR NOT EXISTS (SELECT 1 FROM public.branches x WHERE x.tenant_id = v_t AND coalesce(x.is_system, false) = false AND NOT public.user_in_branch(auth.uid(), x.id));$b$);
  d := pg_temp.rep(d,
    $a$WITH b AS (SELECT id, name FROM public.branches WHERE tenant_id = v_t AND coalesce(is_system, false) = false),$a$,
    $b$WITH b AS (SELECT id, name FROM public.branches WHERE tenant_id = v_t AND coalesce(is_system, false) = false
                 AND (v_company OR public.user_in_branch(auth.uid(), id))),$b$);
  d := pg_temp.rep(d,
    $a$  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'source', 'books', 'branches', coalesce(v_rows, '[]'::jsonb),
    -- the profit lines of the total are the statement's own total (same number as the income statement / distribution)
    'total', (v_ps->'total') - 'revenue_total' - 'expense_total' || (SELECT jsonb_build_object($a$,
    $b$  -- 0251: profit lines of the total = the statement's own total when every branch is shown, else the sum of the shown branches
  v_total := CASE WHEN v_all THEN (v_ps->'total') - 'revenue_total' - 'expense_total'
    ELSE (SELECT jsonb_build_object('sales', coalesce(sum((x->>'sales')::numeric), 0), 'returns', coalesce(sum((x->>'returns')::numeric), 0),
            'net_sales', coalesce(sum((x->>'net_sales')::numeric), 0), 'cogs', coalesce(sum((x->>'cogs')::numeric), 0),
            'gross_profit', coalesce(sum((x->>'gross_profit')::numeric), 0), 'expenses', coalesce(sum((x->>'expenses')::numeric), 0),
            'operating_profit', coalesce(sum((x->>'operating_profit')::numeric), 0), 'other_income', coalesce(sum((x->>'other_income')::numeric), 0),
            'count_diff', coalesce(sum((x->>'count_diff')::numeric), 0), 'net_profit', coalesce(sum((x->>'net_profit')::numeric), 0))
          FROM jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) x) END;
  IF NOT v_np THEN
    v_total := v_total || jsonb_build_object('net_profit', NULL, 'operating_profit', NULL);
    SELECT jsonb_agg(x || jsonb_build_object('net_profit', NULL, 'operating_profit', NULL)) INTO v_rows FROM jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) x;
  END IF;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'source', 'books', 'branches', coalesce(v_rows, '[]'::jsonb), 'net_profit_hidden', NOT v_np,
    'total', v_total || (SELECT jsonb_build_object($b$);
  EXECUTE d;
END $mig$;

-- the branch dashboard's net-profit target: this branch's net profit from the books (same as the income statement)
CREATE OR REPLACE FUNCTION public.branch_month_net_profit(p_branch uuid, p_from date, p_to date)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ps jsonb;
BEGIN
  PERFORM public.assert_access(p_branch, NULL);
  IF NOT (public.is_admin(auth.uid()) OR public.is_owner(auth.uid()) OR public.effective_permission(auth.uid(), 'net_profit.view')) THEN
    RETURN NULL;
  END IF;
  v_ps := public.profit_statement_core(public.current_tenant_id(), p_from, p_to, p_branch);
  RETURN coalesce((v_ps->'total'->>'net_profit')::numeric, 0);
END $$;
REVOKE ALL ON FUNCTION public.branch_month_net_profit(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_month_net_profit(uuid, date, date) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES ('branch_month_net_profit', '0251', 'branch dashboard net-profit target') ON CONFLICT DO NOTHING;
