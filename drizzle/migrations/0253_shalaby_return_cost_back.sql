-- 0253 (owner 2026-11-18 «صلحه»): 12 شلبى sale returns of the November «سهل» loads (29/10 → 15/11) had no «cost back»
-- (Dr 1300 / Cr 5100) in the books — saved in import mode before their line cost existed, the same gap 0170 fixed after the
-- first import (the load2 / load3 / load4 runs did not re-sync). profit_reconciliation showed شلبى cost 111,798.14 too high
-- (October 5,377.99, November 106,420.03); per-invoice sale costs were all equal to the books.
-- Fix: `sync_sale_return_journal` for every active شلبى / سكة / عبدالمنعم sale return dated ≥ 29/10 whose 5100 credit ≠
-- sale_return_cost (idempotent; the entry stays on the return's own day). Tills, stock, accounts do not move.
-- Every load of «سهل» returns must end with this re-sync (AGENTS.md).

DO $m$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT x.id FROM public.returns x
     WHERE x.tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71' AND coalesce(x.status, 'active') = 'active'
       AND (x.invoice_date AT TIME ZONE 'Africa/Cairo')::date >= DATE '2026-10-29'
       AND abs(public.sale_return_cost(x.id) - coalesce((
             SELECT sum(l.credit - l.debit) FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id
               JOIN public.chart_of_accounts a ON a.id = l.account_id
              WHERE e.source_id::text = x.id::text AND e.status = 'posted' AND a.code = '5100'), 0)) > 0.01
  LOOP
    PERFORM public.sync_sale_return_journal(r.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'returns re-synced: %', n;
END $m$;
-- Result 2026-11-18: 12 returns re-synced (SR09370–SR09385 + SR09381), شلبى net profit 2026 −836,554.26 → −724,756.27 (+111,797.99); profit_reconciliation cost 0.02 / 141.76 / 0.15; tills = GL in all branches.
