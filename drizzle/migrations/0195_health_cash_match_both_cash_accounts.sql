-- 0195: owner 2026-11-11 (screenshot «3. مطابقة الكاش … فيه فرق 795,555.16»). The health page compared ALL the tills
-- (cash drawer + vodafone + instapay + safe …, 1,397,135.34) with account 1100 only (601,580.18). The books keep money on TWO
-- accounts: 1100 «Cash / Treasury» and 1110 «Bank» (wallets / transfers) — 795,555.16 is exactly the balance of 1110. The
-- check now sums both, like `ledger_gl_reconciliation` does per branch. After: books 1,397,135.34 = tills 1,397,135.34.
DO $m$
DECLARE v_def text := pg_get_functiondef('public.system_health_check()'::regprocedure);
BEGIN
  IF position($o$WHERE je.status = 'posted' AND a.code = '1100'$o$ in v_def) > 0 THEN
    EXECUTE replace(v_def, $o$WHERE je.status = 'posted' AND a.code = '1100'$o$, $n$WHERE je.status = 'posted' AND a.code IN ('1100', '1110')$n$);
  END IF;
END $m$;
