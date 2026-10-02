CREATE INDEX IF NOT EXISTS idx_invoices_branch_date_status ON public.invoices (branch_id, invoice_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_vouchers_branch_date_type_status ON public.vouchers (branch_id, voucher_date DESC, type, status);
CREATE INDEX IF NOT EXISTS idx_stock_mv_branch_product_date ON public.stock_movements (branch_id, product_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_hist_inv_branch_date ON public.historical_invoices (branch_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_hist_vch_branch_date ON public.historical_vouchers (branch_id, date DESC);
ANALYZE public.invoices; ANALYZE public.vouchers; ANALYZE public.stock_movements; ANALYZE public.historical_invoices; ANALYZE public.historical_vouchers;