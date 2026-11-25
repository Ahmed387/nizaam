-- 0282 «مخفي خالص» also leaves the balances (owner 2026-11-25 «مش هيعرف إن فيه 50,000 في إنستاباي»): the two balance readers
-- the screens use (`get_branch_wallet_balances`, `vessel_account_balances`, both SECURITY DEFINER so RLS does not apply)
-- skip the till rows hidden from the caller — the same test as policy `hidden_vessel_rows` (0281). The owner sees all.
-- The caller's hidden lists are read ONCE into variables (a per-row function call made the wallet card take 4 s).

DO $p$
DECLARE d text := pg_get_functiondef('public.get_branch_wallet_balances(uuid)'::regprocedure);
  old_ text := $o$      FROM public.treasury tr WHERE tr.branch_id = p_branch_id$o$;
  new_ text := $n$      FROM public.treasury tr WHERE tr.branch_id = p_branch_id
       AND NOT (coalesce(tr.vessel_account_id = ANY (v_ha), false)
                OR (coalesce(nullif(tr.payment_method, ''), 'cash') = ANY (v_hm) AND NOT coalesce(tr.vessel_account_id = ANY (v_oa), false)))$n$;
BEGIN
  IF position(old_ in d) = 0 THEN RAISE EXCEPTION '0282: get_branch_wallet_balances text not found'; END IF;
  d := replace(d, old_, new_);
  d := replace(d, E'AS $function$\nBEGIN', E'AS $function$\nDECLARE v_hm text[] := public.my_hidden_methods(); v_ha uuid[] := public.my_hidden_accounts(); v_oa uuid[] := public.my_open_accounts();\nBEGIN');
  IF position('v_hm text[]' in d) = 0 THEN RAISE EXCEPTION '0282: get_branch_wallet_balances header not found'; END IF;
  EXECUTE d;
END $p$;

DO $p$
DECLARE d text := pg_get_functiondef('public.vessel_account_balances(uuid)'::regprocedure);
  old_ text := $o$       AND (p_branch IS NULL OR t.branch_id = p_branch)$o$;
  new_ text := $n$       AND (p_branch IS NULL OR t.branch_id = p_branch)
       AND NOT (coalesce(t.vessel_account_id = ANY (v_ha), false)
                OR (t.payment_method = ANY (v_hm) AND NOT coalesce(t.vessel_account_id = ANY (v_oa), false)))$n$;
  old2 text := $o$   WHERE a.id IS NOT NULL OR m.acc IS NULL$o$;
  new2 text := $n$   WHERE (a.id IS NOT NULL OR m.acc IS NULL)
     AND NOT (coalesce(coalesce(a.id, m.acc) = ANY (v_ha), false)
              OR (coalesce(a.payment_method, m.pm) = ANY (v_hm) AND NOT coalesce(coalesce(a.id, m.acc) = ANY (v_oa), false)))$n$;
  old3 text := 'DECLARE v_t uuid;';
  new3 text := 'DECLARE v_t uuid; v_hm text[] := public.my_hidden_methods(); v_ha uuid[] := public.my_hidden_accounts(); v_oa uuid[] := public.my_open_accounts();';
BEGIN
  IF position(old_ in d) = 0 OR position(old2 in d) = 0 OR position(old3 in d) = 0 THEN RAISE EXCEPTION '0282: vessel_account_balances text not found'; END IF;
  EXECUTE replace(replace(replace(d, old_, new_), old2, new2), old3, new3);
END $p$;
