-- 0194: owner 2026-11-10/11 «عايز عمودين مدين ودائن زي سهل (سابق وحالي لأي تاريخ) في صفحة الحسابات». `contacts_debit_credit(branch,
-- prev_date, cur_date)` = the «أرصدة الحسابات بتاريخ سابق» report of «سهل»: one row per account with its NET balance (customer
-- side − supplier side, the two never allocated against each other here) at the end of each of the two dates, split into
-- مدين (عليه, net > 0) and دائن (له, net < 0). Balance of a side at a date = its documents and charges dated up to it
-- (`ledger_debt_rows`) − its active settling movements dated up to it — the same lines `ledger_contact_statement` lists, so the
-- figure equals the last balance of `contact_net_statement` to that date. Read-only; all branches for admins only.
CREATE OR REPLACE FUNCTION public.contacts_debit_credit(p_branch_id uuid DEFAULT NULL, p_prev date DEFAULT NULL, p_cur date DEFAULT NULL)
RETURNS TABLE(contact_id uuid, name text, type text, prev_debit numeric, prev_credit numeric, cur_debit numeric, cur_credit numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid; v_cur date := coalesce(p_cur, (now() AT TIME ZONE 'Africa/Cairo')::date); v_prev date := coalesce(p_prev, date_trunc('year', v_cur)::date - 1);
BEGIN
  v_tenant := public.ledger_read_scope(p_branch_id, 'customer');
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'أرصدة كل الفروع للإدارة فقط — اختار فرعك' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH ev AS (
    -- the opening balance is the balance at the END of the day before the books start (31/12), so it counts from that day
    SELECT dr.contact_id,
           CASE WHEN dr.debt_type = 'movement' AND EXISTS (SELECT 1 FROM money_movements om WHERE om.id = dr.debt_id AND om.kind = 'opening')
                THEN dr.doc_date - 1 ELSE dr.doc_date END AS d,
           CASE WHEN dr.side = 'customer' THEN dr.amount ELSE -dr.amount END AS v
      FROM public.ledger_debt_rows(v_tenant, NULL) dr
     WHERE dr.contact_id IS NOT NULL AND (p_branch_id IS NULL OR dr.branch_id = p_branch_id)
    UNION ALL
    SELECT m.contact_id, CASE WHEN m.kind = 'opening' THEN m.movement_date - 1 ELSE m.movement_date END,
           CASE WHEN m.side = 'customer' THEN -m.amount ELSE m.amount END
      FROM money_movements m
     WHERE m.tenant_id = v_tenant AND m.contact_id IS NOT NULL AND m.status = 'active' AND m.effect = 'settle'
       AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)
  ), b AS (
    SELECT ev.contact_id, round(coalesce(sum(ev.v) FILTER (WHERE ev.d <= v_prev), 0), 2) AS pv, round(coalesce(sum(ev.v) FILTER (WHERE ev.d <= v_cur), 0), 2) AS cv
      FROM ev GROUP BY 1
  )
  SELECT c.id, c.name, c.type, greatest(b.pv, 0), greatest(-b.pv, 0), greatest(b.cv, 0), greatest(-b.cv, 0)
    FROM b JOIN contacts c ON c.id = b.contact_id
   WHERE b.pv <> 0 OR b.cv <> 0
   ORDER BY c.name;
END
$fn$;
REVOKE ALL ON FUNCTION public.contacts_debit_credit(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts_debit_credit(uuid, date, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
