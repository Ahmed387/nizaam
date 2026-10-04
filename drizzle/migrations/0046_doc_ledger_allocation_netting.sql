CREATE OR REPLACE FUNCTION public.doc_ledger_allocation(p_kind text, p_branch_id uuid, p_contact_ids uuid[], p_as_of date DEFAULT NULL)
RETURNS TABLE(doc_id uuid, contact_id uuid, doc_date date, amount numeric, paid numeric, remaining numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  -- FIFO matching of each contact's branch statement (same sources as contact_branch_balances).
  -- Sides: 's' = customer side (they owe us), 'p' = supplier side (we owe them).
  -- Pool for the requested side = its own settlements + the net of the opposite side (a contact that is
  -- both customer and supplier is netted exactly like the statement). Applied oldest debt first,
  -- opening balance first. Only movements dated <= p_as_of are counted.
  WITH c AS (
    SELECT ct.id, ct.branch_id, COALESCE(ct.opening_balance,0) AS ob
    FROM contacts ct WHERE ct.id = ANY(p_contact_ids) AND ct.tenant_id = public.current_tenant_id()
  ),
  debts AS (
    SELECT 's'::text AS side, NULL::uuid AS doc_id, c.id AS cid, '0001-01-01'::date AS dd, NULL::timestamptz AS ts, GREATEST(c.ob,0) AS amt
      FROM c WHERE c.branch_id = p_branch_id
    UNION ALL
    SELECT 'p', NULL::uuid, c.id, '0001-01-01'::date, NULL::timestamptz, GREATEST(-c.ob,0)
      FROM c WHERE c.branch_id = p_branch_id
    UNION ALL
    SELECT 's', i.id, i.contact_id, (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date, i.created_at, i.total
      FROM invoices i JOIN c ON c.id=i.contact_id
     WHERE i.branch_id=p_branch_id AND i.status='active'
       AND (p_as_of IS NULL OR (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 'p', s.id, s.contact_id, (COALESCE(s.invoice_date,s.created_at) AT TIME ZONE 'Africa/Cairo')::date, s.created_at, s.total_cost
      FROM shipments s JOIN c ON c.id=s.contact_id
     WHERE s.branch_id=p_branch_id
       AND (p_as_of IS NULL OR (COALESCE(s.invoice_date,s.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
  ),
  credits AS (
    SELECT 's'::text AS side, i.contact_id AS cid, ip.amount AS amt
      FROM invoice_payments ip JOIN invoices i ON i.id=ip.invoice_id JOIN c ON c.id=i.contact_id
     WHERE i.branch_id=p_branch_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
       AND (p_as_of IS NULL OR (ip.created_at AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 's', i.contact_id, GREATEST(COALESCE(r.total_refund,0)-COALESCE(r.refund_cash_amount,0)-COALESCE(r.refund_transfer_amount,0),0)
      FROM returns r JOIN invoices i ON i.id=r.invoice_id JOIN c ON c.id=i.contact_id
     WHERE i.branch_id=p_branch_id AND COALESCE(r.status,'active') NOT IN ('draft','cancelled')
       AND (p_as_of IS NULL OR (COALESCE(r.invoice_date,r.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 'p', sp.contact_id, sp.amount FROM supplier_payments sp JOIN c ON c.id=sp.contact_id
     WHERE sp.branch_id=p_branch_id
       AND (p_as_of IS NULL OR (COALESCE(sp.paid_at,sp.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    SELECT 'p', pr.contact_id, GREATEST(COALESCE(pr.total_amount,0)-COALESCE(pr.refund_cash_amount,0)-COALESCE(pr.refund_transfer_amount,0),0)
      FROM purchase_returns pr JOIN c ON c.id=pr.contact_id
     WHERE pr.branch_id=p_branch_id AND pr.status='active'
       AND (p_as_of IS NULL OR (COALESCE(pr.invoice_date,pr.created_at) AT TIME ZONE 'Africa/Cairo')::date <= p_as_of)
    UNION ALL
    -- Receipt vouchers settle the customer side; payment vouchers settle the supplier side.
    SELECT CASE WHEN v.type='receipt' THEN 's' ELSE 'p' END, v.party_id, v.amount
      FROM vouchers v JOIN c ON c.id=v.party_id
     WHERE v.branch_id=p_branch_id AND v.status='active' AND v.party_type IN ('customer','supplier')
       AND (p_as_of IS NULL OR v.voucher_date <= p_as_of)
  ),
  net AS (
    SELECT cid, side, SUM(amt) AS amt FROM (
      SELECT cid, side, amt FROM debts UNION ALL SELECT cid, side, -amt FROM credits
    ) x GROUP BY cid, side
  ),
  own AS (SELECT cid, SUM(amt) AS amt FROM credits WHERE side = CASE WHEN p_kind='sale' THEN 's' ELSE 'p' END GROUP BY cid),
  pool AS (
    SELECT c.id AS cid,
           COALESCE((SELECT amt FROM own WHERE own.cid=c.id),0)
         + COALESCE((SELECT amt FROM net WHERE net.cid=c.id AND net.side = CASE WHEN p_kind='sale' THEN 'p' ELSE 's' END),0) AS amt
      FROM c
  ),
  ordered AS (
    SELECT dt.*, COALESCE(SUM(dt.amt) OVER (PARTITION BY dt.cid ORDER BY dt.dd, dt.ts NULLS FIRST, dt.doc_id NULLS FIRST
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS before
      FROM debts dt
     WHERE dt.side = CASE WHEN p_kind='sale' THEN 's' ELSE 'p' END AND (dt.amt > 0 OR dt.doc_id IS NOT NULL)
  )
  SELECT o.doc_id, o.cid, o.dd, round(o.amt,2),
         round(LEAST(o.amt, GREATEST(0, COALESCE(p.amt,0) - o.before)),2),
         round(o.amt - LEAST(o.amt, GREATEST(0, COALESCE(p.amt,0) - o.before)),2)
    FROM ordered o LEFT JOIN pool p ON p.cid=o.cid;
$$;
GRANT EXECUTE ON FUNCTION public.doc_ledger_allocation(text, uuid, uuid[], date) TO authenticated;