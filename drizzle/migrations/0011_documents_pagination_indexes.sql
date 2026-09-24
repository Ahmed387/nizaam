CREATE INDEX IF NOT EXISTS idx_invoices_perf ON public.invoices (branch_id, invoice_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_perf ON public.shipments (branch_id, invoice_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_perf ON public.returns (branch_id, invoice_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_perf ON public.purchase_returns (branch_id, invoice_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vouchers_perf ON public.vouchers (branch_id, type, status, voucher_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_from_perf ON public.stock_transfers (from_branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_to_perf ON public.stock_transfers (to_branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_perf ON public.quotes (branch_id, created_at DESC);