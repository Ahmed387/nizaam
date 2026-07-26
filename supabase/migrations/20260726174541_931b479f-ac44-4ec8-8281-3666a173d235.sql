
DROP VIEW IF EXISTS public.v_contact_balances CASCADE;

CREATE VIEW public.v_contact_balances
WITH (security_invoker=true) AS
SELECT
  c.id            AS contact_id,
  c.tenant_id,
  c.name,
  c.type,
  COALESCE(c.credit_balance, 0) AS credit_balance,

  -- Customer side
  COALESCE(inv.total_invoiced,        0) AS total_invoiced,
  COALESCE(ret.total_returned,        0) AS total_returned,
  COALESCE(pay.total_paid,            0) AS total_paid,

  -- Supplier side
  COALESCE(ship.total_shipments,          0) AS total_shipments,
  COALESCE(pur_ret.total_purchase_returns, 0) AS total_purchase_returns,
  COALESCE(sup_pay.total_supplier_paid,    0) AS total_supplier_paid,

  -- Manual vouchers (scoped to customer/supplier parties only)
  COALESCE(vouch_receipt.total_receipts, 0) AS total_voucher_receipts,
  COALESCE(vouch_payment.total_payments, 0) AS total_voucher_payments,

  -- Unified ledger (sign convention: +ve = they owe us, -ve = we owe them)
  (
      COALESCE(inv.total_invoiced, 0)
    - COALESCE(ret.total_returned, 0)
    - COALESCE(pay.total_paid,     0)
  )
  - (
      COALESCE(ship.total_shipments,          0)
    - COALESCE(pur_ret.total_purchase_returns, 0)
    - COALESCE(sup_pay.total_supplier_paid,    0)
  )
  - COALESCE(vouch_receipt.total_receipts, 0)
  + COALESCE(vouch_payment.total_payments, 0)
  AS ledger_balance,

  (
      COALESCE(inv.total_invoiced, 0)
    - COALESCE(ret.total_returned, 0)
    - COALESCE(pay.total_paid,     0)
  )
  - (
      COALESCE(ship.total_shipments,          0)
    - COALESCE(pur_ret.total_purchase_returns, 0)
    - COALESCE(sup_pay.total_supplier_paid,    0)
  )
  - COALESCE(vouch_receipt.total_receipts, 0)
  + COALESCE(vouch_payment.total_payments, 0)
  + COALESCE(c.credit_balance, 0)
  AS total_balance,

  COALESCE(overdue.total_overdue, 0) AS overdue_amount,

  GREATEST(
    inv.last_at, ret.last_at, pay.last_at,
    ship.last_at, pur_ret.last_at, sup_pay.last_at,
    vouch_receipt.last_at, vouch_payment.last_at
  ) AS last_transaction_date

FROM public.contacts c

-- Customer invoices
LEFT JOIN LATERAL (
  SELECT SUM(i.total) AS total_invoiced, MAX(i.created_at) AS last_at
  FROM public.invoices i
  WHERE i.contact_id = c.id
    AND i.tenant_id  = c.tenant_id
    AND i.status     = 'active'::invoice_status
) inv ON true

-- Customer returns
LEFT JOIN LATERAL (
  SELECT SUM(r.total_refund) AS total_returned, MAX(r.created_at) AS last_at
  FROM public.returns r
  JOIN public.invoices i ON i.id = r.invoice_id
  WHERE i.contact_id = c.id
    AND r.tenant_id  = c.tenant_id
) ret ON true

-- Customer invoice payments
LEFT JOIN LATERAL (
  SELECT SUM(ip.amount) AS total_paid, MAX(ip.created_at) AS last_at
  FROM public.invoice_payments ip
  JOIN public.invoices i ON i.id = ip.invoice_id
  WHERE i.contact_id  = c.id
    AND ip.tenant_id  = c.tenant_id
    AND ip.voided_at IS NULL
) pay ON true

-- Supplier shipments (purchases)
LEFT JOIN LATERAL (
  SELECT SUM(s.total_cost) AS total_shipments, MAX(s.created_at) AS last_at
  FROM public.shipments s
  WHERE s.contact_id = c.id
    AND s.tenant_id  = c.tenant_id
) ship ON true

-- Supplier purchase returns
LEFT JOIN LATERAL (
  SELECT SUM(pr.total_amount) AS total_purchase_returns, MAX(pr.created_at) AS last_at
  FROM public.purchase_returns pr
  WHERE pr.contact_id = c.id
    AND pr.tenant_id  = c.tenant_id
    AND pr.status     = 'active'
) pur_ret ON true

-- Supplier payments
LEFT JOIN LATERAL (
  SELECT SUM(sp.amount) AS total_supplier_paid, MAX(sp.created_at) AS last_at
  FROM public.supplier_payments sp
  WHERE sp.contact_id = c.id
    AND sp.tenant_id  = c.tenant_id
) sup_pay ON true

-- Manual voucher receipts (cash IN from customer/supplier)
LEFT JOIN LATERAL (
  SELECT SUM(v.amount) AS total_receipts, MAX(v.created_at) AS last_at
  FROM public.vouchers v
  WHERE v.party_id    = c.id
    AND v.tenant_id   = c.tenant_id
    AND v.type        = 'receipt'::voucher_type
    AND v.status      = 'active'::voucher_status
    AND v.party_type IN ('customer'::voucher_party_type, 'supplier'::voucher_party_type)
) vouch_receipt ON true

-- Manual voucher payments (cash OUT to customer/supplier)
LEFT JOIN LATERAL (
  SELECT SUM(v.amount) AS total_payments, MAX(v.created_at) AS last_at
  FROM public.vouchers v
  WHERE v.party_id    = c.id
    AND v.tenant_id   = c.tenant_id
    AND v.type        = 'payment'::voucher_type
    AND v.status      = 'active'::voucher_status
    AND v.party_type IN ('customer'::voucher_party_type, 'supplier'::voucher_party_type)
) vouch_payment ON true

-- Overdue installments
LEFT JOIN LATERAL (
  SELECT SUM(pi.amount) AS total_overdue
  FROM public.payment_installments pi
  JOIN public.payment_plans pp ON pp.id = pi.payment_plan_id
  JOIN public.invoices i
    ON i.id = pp.reference_id AND pp.reference_type = 'invoice'
  WHERE i.contact_id  = c.id
    AND pi.tenant_id  = c.tenant_id
    AND pi.due_date  < CURRENT_DATE
    AND pi.status    <> 'paid'
) overdue ON true;

GRANT SELECT ON public.v_contact_balances TO authenticated, anon;
