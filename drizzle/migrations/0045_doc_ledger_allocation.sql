CREATE OR REPLACE FUNCTION public.doc_ledger_allocation(p_kind text, p_branch_id uuid, p_contact_ids uuid[], p_as_of date DEFAULT NULL)
RETURNS TABLE(doc_id uuid, contact_id uuid, doc_date date, amount numeric, paid numeric, remaining numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  -- FIFO matching of each contact's branch ledger (same sources as contact_branch_balances):
  -- every settlement (direct payments, manual/linked vouchers, return credit, opening credit) is
  -- applied oldest-debt-first, opening balance first. Only movements dated <= p_as_of count.
  WITH c AS (
    SELECT ct.id, ct.branch_id, COALESCE(ct.opening_balance,0) AS ob
    FROM contacts ct WHERE ct.id = ANY(p_contact_ids) AND ct.tenant_id = public.current_tenant_id()
  ),
  d(cid) AS (SELECT (CASE WHEN p_as_of IS NULL THEN NULL::date ELSE p_as_of END)),
  debts AS (
    SELECT NULL::uuid AS doc_id, c.id AS cid, '0001-01-01'::date AS dd, NULL::timestamptz AS ts,
           CASE WHEN p_kind='sale' THEN GREATEST(c.ob,0) ELSE GREATEST(-c.ob,0) END AS amt
      FROM c WHERE c.branch_id = p_branch_id
    UNION ALL
    SELECT i.id, i.contact_id, (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date, i.created_at, i.total
      FROM invoices i JOIN c ON c.id=i.contact_id
     WHERE p_kind='sale' AND i.branch_id=p_branch_id AND i.status='active'
       AND (p_as_of IS NULL OR (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT s.id, s.contact_id, (COALESCE(s.invoice_date,s.created_at) AT TIME ZONE 'Africa/Cairo')::date, s.created_at, s.total_cost
      FROM shipments s JOIN c ON c.id=s.contact_id
     WHERE p_kind='purchase' AND s.branch_id=p_branch_id
       AND (p_as_of IS NULL OR (COALESCE(s.invoice_date,s.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
  ),
  credits AS (
    SELECT c.id AS cid, CASE WHEN p_kind='sale' THEN GREATEST(-c.ob,0) ELSE GREATEST(c.ob,0) END AS amt
      FROM c WHERE c.branch_id = p_branch_id
    UNION ALL
    SELECT i.contact_id, ip.amount FROM invoice_payments ip JOIN invoices i ON i.id=ip.invoice_id JOIN c ON c.id=i.contact_id
     WHERE p_kind='sale' AND i.branch_id=p_branch_id AND i.status='active' AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
       AND (p_as_of IS NULL OR (ip.created_at AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT i.contact_id, GREATEST(COALESCE(r.total_refund,0)-COALESCE(r.refund_cash_amount,0)-COALESCE(r.refund_transfer_amount,0),0)
      FROM returns r JOIN invoices i ON i.id=r.invoice_id JOIN c ON c.id=i.contact_id
     WHERE p_kind='sale' AND i.branch_id=p_branch_id AND COALESCE(r.status,'active') NOT IN ('draft','cancelled')
       AND (p_as_of IS NULL OR (COALESCE(r.invoice_date,r.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT sp.contact_id, sp.amount FROM supplier_payments sp JOIN c ON c.id=sp.contact_id
     WHERE p_kind='purchase' AND sp.branch_id=p_branch_id
       AND (p_as_of IS NULL OR (COALESCE(sp.paid_at,sp.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT pr.contact_id, GREATEST(COALESCE(pr.total_amount,0)-COALESCE(pr.refund_cash_amount,0)-COALESCE(pr.refund_transfer_amount,0),0)
      FROM purchase_returns pr JOIN c ON c.id=pr.contact_id
     WHERE p_kind='purchase' AND pr.branch_id=p_branch_id AND pr.status='active'
       AND (p_as_of IS NULL OR (COALESCE(pr.invoice_date,pr.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    -- Vouchers: settling side adds to the pool, the opposite side (refunds) reduces it.
    SELECT v.party_id,
           CASE WHEN (p_kind='sale' AND v.type='receipt') OR (p_kind='purchase' AND v.type='payment') THEN v.amount ELSE -v.amount END
      FROM vouchers v JOIN c ON c.id=v.party_id
     WHERE v.branch_id=p_branch_id AND v.status='active' AND v.party_type IN ('customer','supplier')
       AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)
  ),
  pool AS (SELECT cid, SUM(amt) AS amt FROM credits GROUP BY cid),
  ordered AS (
    SELECT dt.*, COALESCE(SUM(dt.amt) OVER (PARTITION BY dt.cid ORDER BY dt.dd, dt.ts NULLS FIRST, dt.doc_id NULLS FIRST
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS before
      FROM debts dt WHERE dt.amt > 0 OR dt.doc_id IS NOT NULL
  )
  SELECT o.doc_id, o.cid, o.dd, round(o.amt,2),
         round(LEAST(o.amt, GREATEST(0, COALESCE(p.amt,0) - o.before)),2),
         round(o.amt - LEAST(o.amt, GREATEST(0, COALESCE(p.amt,0) - o.before)),2)
    FROM ordered o LEFT JOIN pool p ON p.cid=o.cid;
$$;
GRANT EXECUTE ON FUNCTION public.doc_ledger_allocation(text, uuid, uuid[], date) TO authenticated;