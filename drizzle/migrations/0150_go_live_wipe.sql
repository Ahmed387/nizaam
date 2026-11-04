-- 0150: go-live wipe of the old data (owner 2026-11-04 «امسح الداتا القديمة … حتي النسخة الاحتياطية … ومترفعش الداتا الجديده
-- غير لما اقولك», then «امسح اي داتا قديمة سواء منتجات عملاء او موردين او اصناف او صور», «موافق، امسح»; no new backup — the
-- old backup files stay). One time, A & N only (the database holds one company). TRUNCATE (no row triggers, the disk space
-- comes back at once): every 2026 document, money row, journal entry, ledger row, stock row, their caches / logs, AND the
-- products and the contacts (customers / suppliers). Kept: the company, branches, users, roles, permissions, employees and
-- attendance, the partner, settings, vessels, voucher categories, chart of accounts, catalogue look-ups (brands, categories,
-- colours, sizes, capacities, types), price lists, the audit log, the historical archive and the owner's personal ledger
-- (owner rule). Product photos and document attachments are files in storage: removed by the one-time edge function
-- `purge-old-files` (storage refuses SQL deletes). Document numbers start again from 1. The new data is NOT loaded here.
DO $wipe$
DECLARE
  v_t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  v_list text[] := ARRAY[
    -- documents
    'invoices','invoice_items','invoice_payments','invoice_settlement','returns','return_items','purchase_returns','purchase_return_items',
    'shipments','shipment_items','shipment_settlement','prior_year_returns','contact_settlements','quotes','quote_items','pre_orders',
    'pre_order_transactions','sale_requests','approval_requests','discount_approval_requests',
    -- money
    'vouchers','voucher_attachments','treasury','treasury_transfers','vessel_transfers','payment_plans','payment_installments',
    'payment_transactions','customer_credit_log','supplier_payments','expenses','cashier_shifts','shift_cash_handovers',
    -- books and ledger
    'journal_entries','journal_entry_lines','fiscal_periods','budgets','bank_statements','bank_statement_lines','depreciation_entries',
    'money_movements','payment_allocations','ledger_gl_links','ledger_credit_balance_snapshot','ledger_sync_errors','ledger_gl_skipped',
    -- stock
    'product_batches','stock_movements','stock_adjustments','stock_adjustment_items','stock_transfers','stock_shortages',
    'inventory_reservations','inventory_sessions','inventory_session_items','inventory_adjustments','inventory_count_batch_moves',
    -- partners / payroll money (all empty today) and profit splits
    'partner_transactions','partner_advances','partner_advance_payments','partner_advance_installments','profit_distributions',
    'profit_distribution_lines','salaries','advances','advance_payments','advance_requests','employee_adjustments',
    -- logs and caches of the old documents
    'document_events','notifications','attachments','price_audit_log','system_integrity_cache','branch_closures','branch_capital_allocations',
    -- master data of the old system (owner: products, customers, suppliers too)
    'products','contacts','customers','suppliers'];
  v_have text[];
  v_seq text;
BEGIN
  IF (SELECT count(*) FROM public.tenants) <> 1 OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_t) THEN
    RAISE EXCEPTION '0150: the database is expected to hold A & N only';
  END IF;
  SELECT array_agg(t) INTO v_have FROM unnest(v_list) t WHERE to_regclass('public.' || t) IS NOT NULL;
  EXECUTE 'TRUNCATE ' || (SELECT string_agg(format('public.%I', t), ', ') FROM unnest(v_have) t);

  -- numbers start again from 1
  UPDATE public.voucher_sequences SET last_number = 0 WHERE tenant_id = v_t;
  FOREACH v_seq IN ARRAY ARRAY['invoice_seq','shipment_seq','sale_return_seq','purchase_return_seq','pre_order_seq',
                               'contact_settlement_seq','prior_year_return_seq'] LOOP
    IF to_regclass('public.' || v_seq) IS NOT NULL THEN PERFORM setval(format('public.%I', v_seq), 1, false); END IF;
  END LOOP;

  INSERT INTO public.audit_log (tenant_id, user_id, user_name, action, entity, entity_id, details)
  VALUES (v_t, '85c76e60-3d27-4a99-8cd7-c8f8b39d914a', 'المالك (مسح الداتا القديمة)', 'RESET', 'go_live_wipe', v_t::text,
          jsonb_build_object('migration', '0150', 'tables', v_have,
                             'kept', 'users, roles, permissions, employees, attendance, partner, settings, vessels, chart of accounts, look-ups, price lists, audit log, archive, personal ledger'));
END
$wipe$;
