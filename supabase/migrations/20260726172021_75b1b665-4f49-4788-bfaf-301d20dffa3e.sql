CREATE OR REPLACE VIEW public.v_contact_balances
WITH (security_invoker=true) AS
SELECT
  c.id AS contact_id,
  c.tenant_id,
  c.name,
  c.type,
  COALESCE(c.credit_balance, 0) AS credit_balance,
  COALESCE(inv.total_invoiced, 0)
    - COALESCE(ret.total_returned, 0)
    - COALESCE(pay.total_paid, 0)
    - COALESCE(sup_pay.total_supplier_paid, 0) AS ledger_balance,
  COALESCE(inv.total_invoiced, 0)
    - COALESCE(ret.total_returned, 0)
    - COALESCE(pay.total_paid, 0)
    - COALESCE(sup_pay.total_supplier_paid, 0)
    + COALESCE(c.credit_balance, 0) AS total_balance,
  COALESCE(overdue.total_overdue, 0) AS overdue_amount,
  GREATEST(inv.last_at, pay.last_at, ret.last_at, sup_pay.last_at) AS last_transaction_date
FROM public.contacts c
LEFT JOIN LATERAL (
  SELECT SUM(total) AS total_invoiced, MAX(created_at) AS last_at
  FROM public.invoices
  WHERE contact_id = c.id AND tenant_id = c.tenant_id AND status = 'active'
) inv ON true
LEFT JOIN LATERAL (
  SELECT SUM(r.total_refund) AS total_returned, MAX(r.created_at) AS last_at
  FROM public.returns r
  JOIN public.invoices i ON i.id = r.invoice_id
  WHERE i.contact_id = c.id AND r.tenant_id = c.tenant_id
) ret ON true
LEFT JOIN LATERAL (
  SELECT SUM(ip.amount) AS total_paid, MAX(ip.created_at) AS last_at
  FROM public.invoice_payments ip
  JOIN public.invoices i ON i.id = ip.invoice_id
  WHERE i.contact_id = c.id AND ip.tenant_id = c.tenant_id AND ip.voided_at IS NULL
) pay ON true
LEFT JOIN LATERAL (
  SELECT SUM(sp.amount) AS total_supplier_paid, MAX(sp.created_at) AS last_at
  FROM public.supplier_payments sp
  WHERE sp.contact_id = c.id AND sp.tenant_id = c.tenant_id
) sup_pay ON true
LEFT JOIN LATERAL (
  SELECT SUM(pi.amount) AS total_overdue
  FROM public.payment_installments pi
  JOIN public.payment_plans pp ON pp.id = pi.payment_plan_id
  JOIN public.invoices i ON i.id = pp.reference_id AND pp.reference_type = 'invoice'
  WHERE i.contact_id = c.id AND pi.tenant_id = c.tenant_id
    AND pi.due_date < CURRENT_DATE AND pi.status != 'paid'
) overdue ON true;

GRANT SELECT ON public.v_contact_balances TO authenticated, anon;