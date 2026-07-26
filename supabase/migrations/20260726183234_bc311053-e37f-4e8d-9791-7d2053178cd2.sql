-- STEP A: Backfill journal_entries.branch_id from source tables so v_treasury_balances shows per-branch totals

-- Vouchers
UPDATE public.journal_entries je SET branch_id = v.branch_id
  FROM public.vouchers v
 WHERE je.source_type='voucher' AND je.source_id=v.id AND je.branch_id IS NULL AND v.branch_id IS NOT NULL;

-- Invoices
UPDATE public.journal_entries je SET branch_id = i.branch_id
  FROM public.invoices i
 WHERE je.source_type='invoice' AND je.source_id=i.id AND je.branch_id IS NULL AND i.branch_id IS NOT NULL;

-- Invoice payments (via invoice)
UPDATE public.journal_entries je SET branch_id = i.branch_id
  FROM public.invoice_payments ip
  JOIN public.invoices i ON i.id = ip.invoice_id
 WHERE je.source_type='invoice_payment' AND je.source_id=ip.id AND je.branch_id IS NULL AND i.branch_id IS NOT NULL;

-- Shipments
UPDATE public.journal_entries je SET branch_id = s.branch_id
  FROM public.shipments s
 WHERE je.source_type='shipment' AND je.source_id=s.id AND je.branch_id IS NULL AND s.branch_id IS NOT NULL;

-- Partner-related entries → PARTNER-CASH branch (per tenant)
UPDATE public.journal_entries je SET branch_id = b.id
  FROM public.branches b
 WHERE b.code = 'PARTNER-CASH' AND b.tenant_id = je.tenant_id
   AND je.branch_id IS NULL
   AND je.source_type IN ('partner_transaction','partner_advance','partner_advance_payment','partner_withdrawal','profit_distribution');

-- STEP A.2: Post missing partner_transaction journals (contribution/drawing only; profit_share handled by distribute_profits)
DO $$
DECLARE
  r RECORD;
  v_lines JSONB;
  v_je UUID;
  v_branch UUID;
BEGIN
  FOR r IN
    SELECT pt.*
      FROM public.partner_transactions pt
     WHERE pt.is_void = FALSE
       AND pt.transaction_type IN ('contribution','drawing')
       AND NOT EXISTS (
         SELECT 1 FROM public.journal_entries je
          WHERE je.source_type='partner_transaction' AND je.source_id=pt.id AND je.status='posted'
       )
  LOOP
    IF r.transaction_type = 'contribution' THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code','1100','debit',r.amount,'credit',0,'description','Partner contribution'),
        jsonb_build_object('account_code','3100','debit',0,'credit',r.amount,'description',COALESCE(r.description,'Contribution'))
      );
    ELSE
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code','3200','debit',r.amount,'credit',0,'description',COALESCE(r.description,'Drawing')),
        jsonb_build_object('account_code','1100','debit',0,'credit',r.amount,'description','Partner drawing')
      );
    END IF;

    v_je := public.post_journal(r.tenant_id, r.created_at::date,
              'Partner '||r.transaction_type||' (backfill)', 'partner_transaction', r.id, v_lines);

    IF v_je IS NOT NULL THEN
      SELECT id INTO v_branch FROM public.branches WHERE code='PARTNER-CASH' AND tenant_id=r.tenant_id LIMIT 1;
      UPDATE public.journal_entries SET branch_id = v_branch WHERE id = v_je;
    END IF;
  END LOOP;
END $$;