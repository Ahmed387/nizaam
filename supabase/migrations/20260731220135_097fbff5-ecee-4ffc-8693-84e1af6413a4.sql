-- 1) Opening Balance Equity account
INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system, is_active)
SELECT DISTINCT c.tenant_id, '3950', 'Opening Balance Equity', 'رصيد افتتاحي', 'equity'::account_type, 'credit'::normal_balance, true, true
FROM public.chart_of_accounts c
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 2) Contacts opening balance
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS opening_balance numeric(14,2) NOT NULL DEFAULT 0;

-- 3) Include opening_balance in contact balances view
CREATE OR REPLACE VIEW public.v_contact_balances AS
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
    COALESCE(c.opening_balance, 0::numeric) AS opening_balance
   FROM contacts c
     LEFT JOIN LATERAL ( SELECT sum(i.total) AS total_invoiced, max(i.created_at) AS last_at
           FROM invoices i
          WHERE i.contact_id = c.id AND i.tenant_id = c.tenant_id AND i.status = 'active'::invoice_status) inv ON true
     LEFT JOIN LATERAL ( SELECT sum(r.total_refund) AS total_returned, max(r.created_at) AS last_at
           FROM returns r JOIN invoices i ON i.id = r.invoice_id
          WHERE i.contact_id = c.id AND r.tenant_id = c.tenant_id) ret ON true
     LEFT JOIN LATERAL ( SELECT sum(ip.amount) AS total_paid, max(ip.created_at) AS last_at
           FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
          WHERE i.contact_id = c.id AND ip.tenant_id = c.tenant_id AND ip.voided_at IS NULL) pay ON true
     LEFT JOIN LATERAL ( SELECT sum(s.total_cost) AS total_shipments, max(s.created_at) AS last_at
           FROM shipments s WHERE s.contact_id = c.id AND s.tenant_id = c.tenant_id) ship ON true
     LEFT JOIN LATERAL ( SELECT sum(pr.total_amount) AS total_purchase_returns, max(pr.created_at) AS last_at
           FROM purchase_returns pr WHERE pr.contact_id = c.id AND pr.tenant_id = c.tenant_id AND pr.status = 'active'::text) pur_ret ON true
     LEFT JOIN LATERAL ( SELECT sum(sp.amount) AS total_supplier_paid, max(sp.created_at) AS last_at
           FROM supplier_payments sp WHERE sp.contact_id = c.id AND sp.tenant_id = c.tenant_id) sup_pay ON true
     LEFT JOIN LATERAL ( SELECT sum(v.amount) AS total_receipts, max(v.created_at) AS last_at
           FROM vouchers v
          WHERE v.party_id = c.id AND v.tenant_id = c.tenant_id AND v.type = 'receipt'::voucher_type AND v.status = 'active'::voucher_status AND (v.party_type = ANY (ARRAY['customer'::voucher_party_type, 'supplier'::voucher_party_type]))) vouch_receipt ON true
     LEFT JOIN LATERAL ( SELECT sum(v.amount) AS total_payments, max(v.created_at) AS last_at
           FROM vouchers v
          WHERE v.party_id = c.id AND v.tenant_id = c.tenant_id AND v.type = 'payment'::voucher_type AND v.status = 'active'::voucher_status AND (v.party_type = ANY (ARRAY['customer'::voucher_party_type, 'supplier'::voucher_party_type]))) vouch_payment ON true
     LEFT JOIN LATERAL ( SELECT sum(pi.amount) AS total_overdue
           FROM payment_installments pi
             JOIN payment_plans pp ON pp.id = pi.payment_plan_id
             JOIN invoices i ON i.id = pp.reference_id AND pp.reference_type = 'invoice'::text
          WHERE i.contact_id = c.id AND pi.tenant_id = c.tenant_id AND pi.due_date < CURRENT_DATE AND pi.status <> 'paid'::text) overdue ON true;

-- 4) Opening balances posting RPC
CREATE OR REPLACE FUNCTION public.post_opening_balances(
  p_date date,
  p_cash jsonb DEFAULT '[]'::jsonb,
  p_contacts jsonb DEFAULT '[]'::jsonb,
  p_inventory jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_branch uuid;
  v_amount numeric;
  v_entry uuid;
  v_ar numeric := 0;
  v_ap numeric := 0;
  v_lines jsonb;
  v_inv_total numeric := 0;
  v_cash_total numeric := 0;
  v_entries int := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;
  IF NOT (public.is_owner(v_uid) OR public.is_admin(v_uid)) THEN
    RAISE EXCEPTION 'غير مصرح — الأرصدة الافتتاحية للمالك أو المدير فقط';
  END IF;

  -- wipe previous opening postings
  DELETE FROM public.journal_entry_lines
   WHERE entry_id IN (SELECT id FROM public.journal_entries WHERE tenant_id = v_tenant AND source_type = 'opening_balance');
  DELETE FROM public.journal_entries WHERE tenant_id = v_tenant AND source_type = 'opening_balance';
  DELETE FROM public.product_batches WHERE tenant_id = v_tenant AND batch_type = 'opening';
  UPDATE public.contacts SET opening_balance = 0 WHERE tenant_id = v_tenant AND opening_balance <> 0;

  -- CASH per branch
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_cash, '[]'::jsonb)) LOOP
    v_branch := (v_row->>'branch_id')::uuid;
    v_amount := ROUND(COALESCE((v_row->>'amount')::numeric, 0), 2);
    CONTINUE WHEN v_amount = 0 OR v_branch IS NULL;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1100','debit',v_amount,'credit',0,'description','رصيد افتتاحي - نقدية'),
      jsonb_build_object('account_code','3950','debit',0,'credit',v_amount,'description','رصيد افتتاحي - نقدية')
    );
    v_entry := public.post_journal(v_tenant, p_date, 'رصيد افتتاحي — نقدية الخزنة', 'opening_balance', NULL, v_lines);
    IF v_entry IS NOT NULL THEN
      UPDATE public.journal_entries SET branch_id = v_branch, created_by = v_uid WHERE id = v_entry;
      v_entries := v_entries + 1;
      v_cash_total := v_cash_total + v_amount;
    END IF;
  END LOOP;

  -- CONTACTS
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb)) LOOP
    v_amount := ROUND(COALESCE((v_row->>'amount')::numeric, 0), 2);
    CONTINUE WHEN v_amount = 0;
    UPDATE public.contacts SET opening_balance = v_amount
     WHERE id = (v_row->>'contact_id')::uuid AND tenant_id = v_tenant;
    IF v_amount > 0 THEN v_ar := v_ar + v_amount; ELSE v_ap := v_ap + (-v_amount); END IF;
  END LOOP;

  IF v_ar <> 0 OR v_ap <> 0 THEN
    v_lines := '[]'::jsonb;
    IF v_ar > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code','1200','debit',v_ar,'credit',0,'description','رصيد افتتاحي - عملاء');
    END IF;
    IF v_ap > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code','2100','debit',0,'credit',v_ap,'description','رصيد افتتاحي - موردين');
    END IF;
    IF (v_ar - v_ap) > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code','3950','debit',0,'credit',(v_ar - v_ap),'description','رصيد افتتاحي');
    ELSIF (v_ar - v_ap) < 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code','3950','debit',(v_ap - v_ar),'credit',0,'description','رصيد افتتاحي');
    END IF;
    v_entry := public.post_journal(v_tenant, p_date, 'رصيد افتتاحي — أرصدة العملاء والموردين', 'opening_balance', NULL, v_lines);
    IF v_entry IS NOT NULL THEN
      UPDATE public.journal_entries SET created_by = v_uid WHERE id = v_entry;
      v_entries := v_entries + 1;
    END IF;
  END IF;

  -- INVENTORY (per product), grouped per branch for the GL entry
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_inventory, '[]'::jsonb)) LOOP
    DECLARE
      v_pid uuid := (v_row->>'product_id')::uuid;
      v_qty numeric := COALESCE((v_row->>'quantity')::numeric, 0);
      v_cost numeric := ROUND(COALESCE((v_row->>'cost_price')::numeric, 0), 2);
      v_pbranch uuid;
    BEGIN
      SELECT branch_id INTO v_pbranch FROM public.products WHERE id = v_pid AND tenant_id = v_tenant;
      CONTINUE WHEN v_pbranch IS NULL;
      UPDATE public.products
         SET quantity = v_qty::int,
             cost_price = CASE WHEN v_cost > 0 THEN v_cost ELSE cost_price END
       WHERE id = v_pid AND tenant_id = v_tenant;
      IF v_qty > 0 THEN
        INSERT INTO public.product_batches(tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
                                           cost_price, base_purchase_price, shipping_cost_per_unit, true_unit_cost, batch_type)
        VALUES (v_tenant, v_pbranch, v_pid, v_qty, v_qty, v_cost, v_cost, 0, v_cost, 'opening');
        v_inv_total := v_inv_total + (v_qty * v_cost);
      END IF;
    END;
  END LOOP;

  IF v_inv_total > 0 THEN
    v_inv_total := ROUND(v_inv_total, 2);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1300','debit',v_inv_total,'credit',0,'description','رصيد افتتاحي - مخزون'),
      jsonb_build_object('account_code','3950','debit',0,'credit',v_inv_total,'description','رصيد افتتاحي - مخزون')
    );
    v_entry := public.post_journal(v_tenant, p_date, 'رصيد افتتاحي — المخزون', 'opening_balance', NULL, v_lines);
    IF v_entry IS NOT NULL THEN
      UPDATE public.journal_entries SET created_by = v_uid WHERE id = v_entry;
      v_entries := v_entries + 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'entries', v_entries,
    'cash_total', v_cash_total,
    'receivables_total', v_ar,
    'payables_total', v_ap,
    'inventory_total', v_inv_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.post_opening_balances(date, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_opening_balances(date, jsonb, jsonb, jsonb) TO authenticated;

-- helper: current opening balances snapshot
CREATE OR REPLACE FUNCTION public.get_opening_balances()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
BEGIN
  IF v_tenant IS NULL OR NOT (public.is_owner(v_uid) OR public.is_admin(v_uid)) THEN
    RETURN jsonb_build_object('cash','[]'::jsonb,'contacts','[]'::jsonb,'inventory','[]'::jsonb,'posted_at',NULL);
  END IF;
  RETURN jsonb_build_object(
    'posted_at', (SELECT max(created_at) FROM public.journal_entries WHERE tenant_id = v_tenant AND source_type = 'opening_balance'),
    'opening_date', (SELECT max(entry_date) FROM public.journal_entries WHERE tenant_id = v_tenant AND source_type = 'opening_balance'),
    'cash', COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id', je.branch_id, 'amount', l.debit))
                        FROM public.journal_entries je
                        JOIN public.journal_entry_lines l ON l.entry_id = je.id
                        JOIN public.chart_of_accounts a ON a.id = l.account_id AND a.code = '1100'
                       WHERE je.tenant_id = v_tenant AND je.source_type = 'opening_balance' AND l.debit > 0), '[]'::jsonb),
    'contacts', COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', id, 'amount', opening_balance))
                            FROM public.contacts WHERE tenant_id = v_tenant AND opening_balance <> 0), '[]'::jsonb),
    'inventory', COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity_purchased, 'cost_price', cost_price))
                             FROM public.product_batches WHERE tenant_id = v_tenant AND batch_type = 'opening'), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_opening_balances() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_opening_balances() TO authenticated;