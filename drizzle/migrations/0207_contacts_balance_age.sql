-- 0207: owner 2026-11-14 («تقرير أعمار الديون … يعرض رصيد كل حساب مدين، وبقاله قد إيه مدين» — نفذ):
-- the aging report is per ACCOUNT (current account), not per open invoice. For each account in the branch (or all
-- branches): its net balance (+ = مدين لنا عنده, − = دائن علينا له, like `contacts_page`) as of a day, the day it became
-- that way (start of the run of days with the same sign up to the day), how many days, the last money from / to him
-- and his last movement. Built from the same lines as the balance: active sale invoices (+), active purchase invoices
-- (−) and every active ledger money movement (customer charge +, customer settle −, supplier charge −, supplier
-- settle +, opening included on its branch). Read only.
CREATE OR REPLACE FUNCTION public.contacts_balance_age(p_branch_id uuid DEFAULT NULL, p_as_of date DEFAULT NULL)
RETURNS TABLE(contact_id uuid, account_no integer, contact_name text, contact_type text, balance numeric, since date,
              days integer, last_money date, last_move date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid; v_day date := COALESCE(p_as_of, public.cairo_today());
BEGIN
  v_tenant := public.ledger_read_scope(p_branch_id, 'any');
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'عرض كل الفروع للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH l AS (
    SELECT i.contact_id AS cid, public.ledger_day(i.invoice_date) AS d, i.total AS amt, false AS money
      FROM invoices i
     WHERE i.tenant_id = v_tenant AND i.contact_id IS NOT NULL AND i.status = 'active' AND i.total > 0
       AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff() AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
    UNION ALL
    SELECT s.contact_id, public.ledger_day(COALESCE(s.invoice_date, s.created_at)), -s.total_cost, false
      FROM shipments s
     WHERE s.tenant_id = v_tenant AND s.contact_id IS NOT NULL AND s.status = 'active' AND s.total_cost > 0
       AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= public.ledger_cutoff()
       AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    UNION ALL
    SELECT m.contact_id, m.movement_date,
           (CASE WHEN m.side = 'customer' THEN 1 ELSE -1 END) * (CASE WHEN m.effect = 'charge' THEN 1 ELSE -1 END) * m.amount,
           m.kind IN ('payment', 'deposit', 'refund')
      FROM money_movements m
     WHERE m.tenant_id = v_tenant AND m.status = 'active' AND m.contact_id IS NOT NULL
       AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)
  ),
  dd AS (
    SELECT l.cid, l.d, sum(l.amt) AS amt, bool_or(l.money) AS money FROM l WHERE l.d <= v_day GROUP BY 1, 2
  ),
  run AS (
    SELECT dd.cid, dd.d, dd.money, sum(dd.amt) OVER (PARTITION BY dd.cid ORDER BY dd.d) AS bal FROM dd
  ),
  fin AS (
    SELECT DISTINCT ON (run.cid) run.cid, round(run.bal, 2) AS bal FROM run ORDER BY run.cid, run.d DESC
  ),
  brk AS (  -- the last day the running balance had another sign (or was 0)
    SELECT run.cid, max(run.d) AS d FROM run JOIN fin ON fin.cid = run.cid
     WHERE sign(round(run.bal, 2)) <> sign(fin.bal) GROUP BY 1
  )
  SELECT c.id, c.account_no, c.name, c.type::text, fin.bal,
         (SELECT min(r.d) FROM run r WHERE r.cid = fin.cid AND (brk.d IS NULL OR r.d > brk.d)),
         (v_day - (SELECT min(r.d) FROM run r WHERE r.cid = fin.cid AND (brk.d IS NULL OR r.d > brk.d)))::int,
         (SELECT max(r.d) FROM run r WHERE r.cid = fin.cid AND r.money),
         (SELECT max(r.d) FROM run r WHERE r.cid = fin.cid)
    FROM fin JOIN contacts c ON c.id = fin.cid
    LEFT JOIN brk ON brk.cid = fin.cid
   WHERE abs(fin.bal) > 0.005
   ORDER BY abs(fin.bal) DESC;
END
$fn$;
REVOKE ALL ON FUNCTION public.contacts_balance_age(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts_balance_age(uuid, date) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('contacts_balance_age', '0207', 'aging per account (current account)') ON CONFLICT DO NOTHING;
NOTIFY pgrst, 'reload schema';
