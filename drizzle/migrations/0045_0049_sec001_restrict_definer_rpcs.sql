-- SEC-001: see uploaded patch 0001 (applied verbatim)
DO $sec001$
DECLARE
  r record;
  v_internal text[] := ARRAY[
    '_audit_user_info', '_audit_write', '_void_payment_transaction_exec',
    'admin_reset_go_live_extras', 'apply_customer_credit', 'apply_return_batch_tracking',
    'apply_supplier_credit', 'assert_can_edit_invoice', 'assert_can_import_opening_debt',
    'assert_same_tenant', 'available_to_distribute', 'branch_cycle_count_status',
    'calculate_payment_fee', 'can_use_ask_me', 'clear_opening_treasury',
    'compute_net_profit_for_period', 'confirm_transfer_group', 'consume_product_batches',
    'consume_product_batches_json', 'contact_has_legacy_docs', 'current_tenant_active',
    'enforce_cycle_counts', 'ensure_account', 'ensure_count_variance_accounts',
    'expire_old_reservations', 'get_partner_net_balance', 'get_system_category', 'has_permission',
    'import_opening_debt', 'invoice_outstanding_debt', 'is_return_canceller',
    'mark_invoice_migrated', 'mark_partner_advance_installments_overdue', 'next_journal_number',
    'next_voucher_number', 'notify_tenant_admins', 'payment_plans_summary',
    'peek_product_fifo_cost', 'personal_identity', 'personal_ledger_owner_id', 'post_invoice_cogs',
    'post_journal', 'post_journal_lines', 'post_voucher_journal', 'purge_ai_ask_log',
    'purge_orphan_journal_entries', 'recalc_contact_balance', 'recompute_contact_credit',
    'repost_invoice_journal', 'restore_batches_from_item', 'restore_invoice_batches',
    'reverse_journal_for_source', 'reverse_profit_distribution', 'run_regression_checks',
    'run_shift_maintenance', 'seed_default_chart_of_accounts', 'seed_voucher_categories',
    'set_invoice_meta', 'set_transfer_group_date', 'shift_cash_movement', 'shift_planned_end',
    'stock_balance_as_of', 'stock_mv_ctx', 'supplier_outstanding_payable',
    'sync_invoice_cash_treasury', 'sync_purchase_return_journal', 'sync_sale_return_journal',
    'sync_shipment_journal', 'tenant_founder_admin', 'transfer_stock_atomic'
  ];
  v_service text[] := ARRAY[
    'restore_tenant_snapshot', 'backup_table_manifest', 'backup_table_ctid_check',
    'backup_fetch_page', 'backup_tenant_filter', 'verify_employee_password',
    'create_journal_entry', 'admin_reset_branch_data_impl'
  ];
  v_client_revoke text[] := ARRAY['process_sale'];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (v_internal || v_service || v_client_revoke)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$sec001$;

CREATE OR REPLACE FUNCTION public.security_exposed_definer_functions()
RETURNS TABLE(function_signature text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
  SELECT p.oid::regprocedure::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.prorettype <> 'trigger'::regtype
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT (p.proname = ANY (ARRAY[
    'acknowledge_treasury_transfer', 'add_invoice_payment', 'admin_cancel_all_invoices',
    'admin_clear_treasury', 'admin_reset_branch_data', 'admin_reset_price_audit',
    'admin_reset_vouchers', 'admin_set_product_quantity', 'allocate_capital_to_branch',
    'apply_price_list_update', 'approve_advance_request', 'approve_inventory_session',
    'archive_product', 'ask_me_access_level', 'ask_me_allowed_tables', 'ask_me_schema',
    'branch_handover_managers', 'can_access_employee_file', 'can_manage_attendance_for',
    'cancel_inventory_session', 'cancel_invoice_with_refund', 'cancel_partner_advance',
    'cancel_pre_order', 'cancel_purchase_return', 'cancel_sale_return', 'cancel_voucher',
    'close_cashier_shift', 'close_fiscal_period', 'complete_pre_order_sale',
    'create_contact_credit_deposit', 'create_inventory_session', 'create_manual_voucher',
    'create_partner_advance', 'create_partner_from_employee', 'create_pre_order',
    'create_product_with_opening_stock', 'current_shift_schedule', 'current_tenant_id',
    'current_tenant_is_suspended', 'decide_payment_void_request', 'delete_partner_transaction',
    'delete_voucher_admin', 'detect_anomalies', 'detect_orphaned_batches',
    'disburse_employee_advance', 'disburse_pending_advance', 'dispose_fixed_asset',
    'distribute_profits', 'doc_ledger_allocation', 'edit_invoice', 'edit_invoice_payment',
    'edit_partner_transaction', 'edit_payment_transaction', 'edit_shipment', 'edit_voucher',
    'expected_opening_cash', 'generate_alerts', 'get_available_quantity',
    'get_bank_reconciliation_summary', 'get_branch_financial_position',
    'get_branch_wallet_balances', 'get_budget_variance', 'get_financial_kpis', 'get_open_shift',
    'get_opening_balances', 'get_owner_expense_delegates', 'get_product_references_count',
    'hard_delete_invoice', 'has_central_access', 'has_role', 'hide_rejected_transfer',
    'historical_branch_id_for', 'historical_stock_at', 'is_admin', 'is_owner', 'is_partner_owner',
    'is_personal_owner', 'is_super_admin', 'is_viewer', 'manage_owner_expense_access',
    'mark_overdue_installments', 'open_cashier_shift', 'open_cashier_shift_secure',
    'override_shift_opening', 'partial_confirm_transfer', 'partner_withdraw_from_distribution',
    'pay_employee_salary', 'personal_access_level', 'personal_owner_info',
    'post_monthly_depreciation', 'post_opening_balances', 'preview_flexible_distribution',
    'process_sale_full', 'rebalance_partner_shares', 'record_contact_payment',
    'record_mid_shift_handover', 'record_partner_advance_payment', 'record_partner_transaction',
    'record_payment_transaction', 'record_shipment', 'record_shipment_with_credit',
    'redistribute_installments_after_return', 'register_sale_return_full', 'reject_transfer',
    'reject_transfer_group', 'reject_treasury_transfer', 'release_reservation',
    'release_reservations_for_draft', 'request_void_payment_transaction', 'reserve_stock',
    'restore_product', 'revoke_owner_expense_access', 'safe_delete_product',
    'set_document_annotations', 'set_partner_capital', 'set_scheduled_reports_cron',
    'settle_contact_invoices_sovereign', 'shift_cash_sales', 'shift_handovers',
    'shift_payment_breakdown', 'shift_sale_gate', 'system_health_check',
    'transfer_stock_multi_atomic', 'transfer_treasury_atomic', 'update_invoice_date_sovereign',
    'update_product_price_with_reason', 'update_return_sovereign', 'upsert_inventory_counts',
    'user_can_write_branch', 'user_in_branch', 'void_invoice_payment', 'void_payment_transaction'
  ]))
  ORDER BY 1;
$fn$;

REVOKE ALL ON FUNCTION public.security_exposed_definer_functions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_exposed_definer_functions() TO service_role;

DO $check$
DECLARE v_list text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'SEC-001: definer functions still executable by authenticated outside the allow-list: %', v_list;
  END IF;
END
$check$;