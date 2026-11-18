-- 0254 (owner 2026-11-18 «اعمل تسوية للقروش دي كلها»): the 141.76 left in عبدالمنعم's profit reconciliation was SR00006 (6/1,
-- IN00039): a sale return worth 0 (a piece back with no money), cost 141.67. `sync_sale_return_journal` returned early when
-- total_refund <= 0, so a zero-value return never booked its cost back (Dr 1300 / Cr 5100) although the piece went back to stock.
-- Now: only a non-active return is skipped; the 4100 / money lines only when there is a refund; the cost-back lines whenever the
-- cost > 0; nothing posted when there is no line. Then SR00006 is re-synced (its own day). Tills / accounts do not move.

CREATE OR REPLACE FUNCTION pg_temp.rep(src text, a text, b text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(a IN src) = 0 THEN RAISE EXCEPTION 'anchor not found: %', left(a, 80); END IF;
  RETURN replace(src, a, b);
END $$;

DO $m$
DECLARE d text := pg_get_functiondef('public.sync_sale_return_journal(uuid)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$IF r.status IS DISTINCT FROM 'active' OR COALESCE(r.total_refund,0) <= 0 THEN RETURN; END IF;$a$,
    $b$IF r.status IS DISTINCT FROM 'active' THEN RETURN; END IF;  -- 0254: a zero-value return still brings its cost back$b$);
  d := pg_temp.rep(d, $a$v_lines := jsonb_build_array(jsonb_build_object('account_code','4100','debit',r.total_refund,'credit',0,'description','مرتجع مبيعات '||r.return_number));$a$,
    $b$v_lines := CASE WHEN COALESCE(r.total_refund,0) > 0
                 THEN jsonb_build_array(jsonb_build_object('account_code','4100','debit',r.total_refund,'credit',0,'description','مرتجع مبيعات '||r.return_number))
                 ELSE '[]'::jsonb END;$b$);
  d := pg_temp.rep(d, $a$  PERFORM public.post_journal(r.tenant_id,$a$,
    $b$  IF jsonb_array_length(v_lines) = 0 THEN RETURN; END IF;
  PERFORM public.post_journal(r.tenant_id,$b$);
  EXECUTE d;
END $m$;

SELECT public.sync_sale_return_journal(r.id) FROM public.returns r
 WHERE r.status = 'active' AND coalesce(r.total_refund, 0) <= 0 AND public.sale_return_cost(r.id) > 0;
-- Result 2026-11-18: SR00006 cost back 141.67 on 6/1; profit_reconciliation cost 0.02 / 0.09 / 0.15 (rounding of 4-decimal line costs); tills = GL.
