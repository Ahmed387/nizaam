-- 0248 — `vessel_account_balances` (0244) called assert_company_access(uuid), which doesn't exist (its argument is a
-- permission text): company check first, then branch access when a branch is given.
DO $m$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.vessel_account_balances(uuid)'::regprocedure);
  n := replace(d, $a$  v_t := public.assert_company_access(p_branch);$a$, $b$  v_t := public.assert_company_access(NULL);
  IF p_branch IS NOT NULL THEN
    PERFORM public.assert_access(p_branch, NULL);
    IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch AND tenant_id = v_t) THEN RAISE EXCEPTION 'الفرع مش موجود'; END IF;
  END IF;$b$);
  IF n = d THEN RAISE EXCEPTION '0248: anchor'; END IF;
  EXECUTE n;
END $m$;
