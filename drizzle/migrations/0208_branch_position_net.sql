-- 0208: owner 2026-11-14 «نقفل حوار الفواتير المفتوحة والمغلقة»: the branch financial position reads the accounts' ONE
-- net balance in the branch (current account), never open invoices + advances. receivables = Σ accounts مدين (لنا عندهم),
-- payables = Σ accounts دائن (علينا ليهم); the two advance figures are 0 (an advance is just a دائن / مدين balance).
DO $mig$
DECLARE d text;
  a text := $a$  SELECT COALESCE(SUM(sb.open_remaining) FILTER (WHERE sb.side = 'customer'), 0), COALESCE(SUM(sb.open_remaining) FILTER (WHERE sb.side = 'supplier'), 0),
         COALESCE(SUM(sb.advance) FILTER (WHERE sb.side = 'supplier'), 0), COALESCE(SUM(sb.advance) FILTER (WHERE sb.side = 'customer'), 0)
    INTO _receivables, _payables, _sup_adv, _cus_adv
    FROM public.ledger_side_balances(_tenant, _branch_id, NULL) sb;$a$;
  b text := $b$  SELECT COALESCE(SUM(x.net) FILTER (WHERE x.net > 0), 0), COALESCE(-SUM(x.net) FILTER (WHERE x.net < 0), 0), 0, 0
    INTO _receivables, _payables, _sup_adv, _cus_adv
    FROM (SELECT sb.contact_id, SUM(CASE WHEN sb.side = 'customer' THEN sb.balance ELSE -sb.balance END) AS net
            FROM public.ledger_side_balances(_tenant, _branch_id, NULL) sb WHERE sb.contact_id IS NOT NULL GROUP BY 1) x;$b$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_branch_financial_position';
  IF position(b in d) > 0 THEN RETURN; END IF;
  IF position(a in d) = 0 THEN RAISE EXCEPTION '0208: anchor not found'; END IF;
  EXECUTE replace(d, a, b);
END
$mig$;
