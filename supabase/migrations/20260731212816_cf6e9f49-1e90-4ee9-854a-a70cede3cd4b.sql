CREATE INDEX IF NOT EXISTS idx_invoices_contact ON public.invoices (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_date ON public.invoices (tenant_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_branch_date ON public.invoices (branch_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_returns_invoice ON public.returns (invoice_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_party ON public.vouchers (party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON public.invoice_items (product_id);
CREATE INDEX IF NOT EXISTS idx_treasury_branch_created ON public.treasury (branch_id, created_at DESC);