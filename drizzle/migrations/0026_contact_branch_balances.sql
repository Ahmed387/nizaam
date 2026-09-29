CREATE OR REPLACE FUNCTION public.contact_branch_balances(p_branch_id uuid)
RETURNS TABLE(contact_id uuid, balance numeric, overdue numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT c.id,
    (CASE WHEN c.branch_id = p_branch_id THEN COALESCE(c.opening_balance,0) ELSE 0 END)
    + COALESCE((SELECT sum(i.total) FROM invoices i WHERE i.contact_id=c.id AND i.branch_id=p_branch_id AND i.status='active'),0)
    - COALESCE((SELECT sum(GREATEST(COALESCE(r.total_refund,0)-COALESCE(r.refund_cash_amount,0)-COALESCE(r.refund_transfer_amount,0),0)) FROM returns r JOIN invoices i ON i.id=r.invoice_id WHERE i.contact_id=c.id AND i.branch_id=p_branch_id AND COALESCE(r.status,'active') NOT IN ('draft','cancelled')),0)
    - COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip JOIN invoices i ON i.id=ip.invoice_id WHERE i.contact_id=c.id AND i.branch_id=p_branch_id AND ip.payment_method<>'settlement' AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL),0)
    - ( COALESCE((SELECT sum(s.total_cost) FROM shipments s WHERE s.contact_id=c.id AND s.branch_id=p_branch_id),0)
      - COALESCE((SELECT sum(GREATEST(COALESCE(pr.total_amount,0)-COALESCE(pr.refund_cash_amount,0)-COALESCE(pr.refund_transfer_amount,0),0)) FROM purchase_returns pr WHERE pr.contact_id=c.id AND pr.branch_id=p_branch_id AND pr.status='active'),0)
      - COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp WHERE sp.contact_id=c.id AND sp.branch_id=p_branch_id),0) )
    - COALESCE((SELECT sum(v.amount) FROM vouchers v WHERE v.party_id=c.id AND v.branch_id=p_branch_id AND v.type='receipt' AND v.status='active' AND v.party_type IN ('customer','supplier')),0)
    + COALESCE((SELECT sum(v.amount) FROM vouchers v WHERE v.party_id=c.id AND v.branch_id=p_branch_id AND v.type='payment' AND v.status='active' AND v.party_type IN ('customer','supplier')),0)
    AS balance,
    COALESCE((SELECT sum(GREATEST(pi.amount-COALESCE(pi.paid_amount,0),0)) FROM payment_installments pi JOIN payment_plans pp ON pp.id=pi.payment_plan_id JOIN invoices i ON i.id=pp.reference_id AND pp.reference_type='invoice' WHERE i.contact_id=c.id AND i.branch_id=p_branch_id AND pi.due_date < public.cairo_today() AND pi.status<>'paid' AND pi.cancelled_at IS NULL),0) AS overdue
  FROM contacts c
  WHERE c.tenant_id = public.current_tenant_id() AND c.is_archived = false;
$$;
GRANT EXECUTE ON FUNCTION public.contact_branch_balances(uuid) TO authenticated;