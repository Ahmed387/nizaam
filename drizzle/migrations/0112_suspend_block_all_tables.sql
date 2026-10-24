-- 0112: a suspended company is locked in the database on every table, not only on the screen.
-- Why: owner decision 2026-10-24. Before this only 23 tables had suspended_block_write; 64 more
-- (customers, suppliers, inventory, shifts, ...) were protected only by the /suspended redirect.
-- Same RESTRICTIVE policy as the existing 23: the super admin passes; anyone whose company
-- (current_tenant_id) is suspended can neither read nor write. Service role / cron are not affected.
-- Not added: user_presence (heartbeat), tenants (only the super admin writes it).
-- historical_* / owner_personal_* are outside the sales system and untouched (owner rule).
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'ai_ask_log','approval_requests','attachments','attendance','backup_settings','bank_accounts',
    'bank_statement_lines','bank_statements','branch_capital_allocations','branch_closures',
    'branch_schedules','branch_users','brands','budgets','capacities','cashier_shifts',
    'chart_of_accounts','colors','customers','depreciation_entries','discount_approval_requests',
    'equity_partners','fiscal_periods','fixed_assets','health_check_runs','inventory_adjustments',
    'inventory_count_batch_moves','inventory_reservations','inventory_session_items',
    'inventory_sessions','migration_batches','notifications','onboarding_progress',
    'owner_expenses_access','partner_share_history','partner_users','pre_order_transactions',
    'pre_orders','price_audit_log','price_list','price_list_items','price_list_sources',
    'product_types','profiles','profit_distribution_lines','profit_distributions','quote_items',
    'role_permissions','scheduled_reports','shift_cash_handovers','shift_schedules','sizes',
    'stock_adjustment_items','suppliers','system_backups','system_cron_tokens','transfer_fees',
    'user_permissions','user_roles','voucher_attachments','voucher_categories','voucher_sequences'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'suspended_block_write') THEN
      EXECUTE format($p$CREATE POLICY suspended_block_write ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
        USING ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()))
        WITH CHECK ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()))$p$, t);
    END IF;
  END LOOP;
END $$;
