SET session_replication_role = replica;

TRUNCATE
  public.journal_entry_lines, public.journal_entries,
  public.invoice_items, public.invoice_payments, public.payment_transactions, public.invoices,
  public.return_items, public.returns, public.purchase_return_items, public.purchase_returns,
  public.quote_items, public.quotes,
  public.shipment_items, public.shipments,
  public.stock_adjustment_items, public.stock_adjustments, public.stock_transfers,
  public.inventory_session_items, public.inventory_sessions, public.inventory_count_batch_moves,
  public.inventory_adjustments, public.inventory_reservations,
  public.product_batches, public.products,
  public.voucher_attachments, public.vouchers, public.voucher_sequences,
  public.treasury, public.treasury_transfers,
  public.partner_advance_payments, public.partner_advance_installments, public.partner_advances,
  public.profit_distribution_lines, public.profit_distributions, public.partner_transactions,
  public.partner_share_history,
  public.attendance, public.cashier_shifts, public.salaries, public.advances,
  public.advance_payments, public.advance_requests,
  public.expenses, public.owner_personal_expenses,
  public.pre_order_transactions, public.pre_orders,
  public.payment_installments, public.payment_plans,
  public.customer_credit_log, public.price_audit_log,
  public.branch_capital_allocations,
  public.audit_log, public.notifications, public.attachments,
  public.contacts
CASCADE;

SET session_replication_role = DEFAULT;