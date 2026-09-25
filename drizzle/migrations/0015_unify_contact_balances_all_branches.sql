CREATE OR REPLACE VIEW public.v_contact_balances WITH (security_invoker = false) AS
 SELECT c.id AS contact_id,
    c.tenant_id,
    c.name,
    c.type,
    COALESCE(c.credit_balance, 0::numeric) AS credit_balance,
    COALESCE(inv.total_invoiced, 0::numeric) AS total_invoiced,
    COALESCE(ret.total_returned, 0::numeric) AS total_returned,
    COALESCE(pay.total_paid, 0::numeric) AS total_paid,
    COALESCE(ship.total_shipments, 0::numeric) AS total_shipments,
    COALESCE(pur_ret.total_purchase_returns, 0::numeric) AS total_purchase_returns,
    COALESCE(sup_pay.total_supplier_paid, 0::numeric) AS total_supplier_paid,
    COALESCE(vouch_receipt.total_receipts, 0::numeric) AS total_voucher_receipts,
    COALESCE(vouch_payment.total_payments, 0::numeric) AS total_voucher_payments,
    COALESCE(c.opening_balance, 0::numeric) + COALESCE(inv.total_invoiced, 0::numeric) - COALESCE(ret.total_returned, 0::numeric) - COALESCE(pay.total_paid, 0::numeric) - (COALESCE(ship.total_shipments, 0::numeric) - COALESCE(pur_ret.total_purchase_returns, 0::numeric) - COALESCE(sup_pay.total_supplier_paid, 0::numeric)) - COALESCE(vouch_receipt.total_receipts, 0::numeric) + COALESCE(vouch_payment.total_payments, 0::numeric) AS ledger_balance,
    COALESCE(c.opening_balance, 0::numeric) + COALESCE(inv.total_invoiced, 0::numeric) - COALESCE(ret.total_returned, 0::numeric) - COALESCE(pay.total_paid, 0::numeric) - (COALESCE(ship.total_shipments, 0::numeric) - COALESCE(pur_ret.total_purchase_returns, 0::numeric) - COALESCE(sup_pay.total_supplier_paid, 0::numeric)) - COALESCE(vouch_receipt.total_receipts, 0::numeric) + COALESCE(vouch_payment.total_payments, 0::numeric) + COALESCE(c.credit_balance, 0::numeric) AS total_balance,
    COALESCE(overdue.total_overdue, 0::numeric) AS overdue_amount,
    GREATEST(inv.last_at, ret.last_at, pay.last_at, ship.last_at, pur_ret.last_at, sup_pay.last_at, vouch_receipt.last_at, vouch_payment.last_at) AS last_transaction_date,
    COALESCE(c.opening_balance, 0::numeric) AS opening_balance,
    COALESCE(pay.total_settlement, 0::numeric) AS total_settlement
   FROM contacts c
     LEFT JOIN LATERAL ( SELECT sum(i.total) AS total_invoiced,
            max(i.created_at) AS last_at
           FROM invoices i
          WHERE i.contact_id = c.id AND i.tenant_id = c.tenant_id AND i.status = 'active'::invoice_status) inv ON true
     LEFT JOIN LATERAL ( SELECT sum(GREATEST(COALESCE(r.total_refund, 0::numeric) - COALESCE(r.refund_cash_amount, 0::numeric) - COALESCE(r.refund_transfer_amount, 0::numeric), 0::numeric)) AS total_returned,
            max(r.created_at) AS last_at
           FROM returns r
             JOIN invoices i ON i.id = r.invoice_id
          WHERE i.contact_id = c.id AND r.tenant_id = c.tenant_id AND (COALESCE(r.status, 'active'::text) <> ALL (ARRAY['draft'::text, 'cancelled'::text]))) ret ON true
     LEFT JOIN LATERAL ( SELECT sum(ip.amount) FILTER (WHERE ip.payment_method <> 'settlement'::text) AS total_paid,
            sum(ip.amount) FILTER (WHERE ip.payment_method = 'settlement'::text) AS total_settlement,
            max(ip.created_at) AS last_at
           FROM invoice_payments ip
             JOIN invoices i ON i.id = ip.invoice_id
          WHERE i.contact_id = c.id AND ip.tenant_id = c.tenant_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL) pay ON true
     LEFT JOIN LATERAL ( SELECT sum(s.total_cost) AS total_shipments,
            max(s.created_at) AS last_at
           FROM shipments s
          WHERE s.contact_id = c.id AND s.tenant_id = c.tenant_id) ship ON true
     LEFT JOIN LATERAL ( SELECT sum(GREATEST(COALESCE(pr.total_amount, 0::numeric) - COALESCE(pr.refund_cash_amount, 0::numeric) - COALESCE(pr.refund_transfer_amount, 0::numeric), 0::numeric)) AS total_purchase_returns,
            max(pr.created_at) AS last_at
           FROM purchase_returns pr
          WHERE pr.contact_id = c.id AND pr.tenant_id = c.tenant_id AND pr.status = 'active'::text) pur_ret ON true
     LEFT JOIN LATERAL ( SELECT sum(sp.amount) AS total_supplier_paid,
            max(sp.created_at) AS last_at
           FROM supplier_payments sp
          WHERE sp.contact_id = c.id AND sp.tenant_id = c.tenant_id) sup_pay ON true
     LEFT JOIN LATERAL ( SELECT sum(v.amount) AS total_receipts,
            max(v.created_at) AS last_at
           FROM vouchers v
          WHERE v.party_id = c.id AND v.tenant_id = c.tenant_id AND v.type = 'receipt'::voucher_type AND v.status = 'active'::voucher_status AND (v.party_type = ANY (ARRAY['customer'::voucher_party_type, 'supplier'::voucher_party_type]))) vouch_receipt ON true
     LEFT JOIN LATERAL ( SELECT sum(v.amount) AS total_payments,
            max(v.created_at) AS last_at
           FROM vouchers v
          WHERE v.party_id = c.id AND v.tenant_id = c.tenant_id AND v.type = 'payment'::voucher_type AND v.status = 'active'::voucher_status AND (v.party_type = ANY (ARRAY['customer'::voucher_party_type, 'supplier'::voucher_party_type]))) vouch_payment ON true
     LEFT JOIN LATERAL ( SELECT sum(pi.amount) AS total_overdue
           FROM payment_installments pi
             JOIN payment_plans pp ON pp.id = pi.payment_plan_id
             JOIN invoices i ON i.id = pp.reference_id AND pp.reference_type = 'invoice'::text
          WHERE i.contact_id = c.id AND pi.tenant_id = c.tenant_id AND pi.due_date < CURRENT_DATE AND pi.status <> 'paid'::text) overdue ON true
  WHERE c.tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()) OR auth.role() = 'service_role';
REVOKE ALL ON public.v_contact_balances FROM anon;
GRANT SELECT ON public.v_contact_balances TO authenticated, service_role;