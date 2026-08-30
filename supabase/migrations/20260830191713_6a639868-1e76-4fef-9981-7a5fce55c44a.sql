CREATE TABLE IF NOT EXISTS public.historical_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_name TEXT NOT NULL CHECK (branch_name IN ('معرض عبد المنعم', 'مخزن شلبي', 'معرض شلبي اللي اتقفل')),
    doc_type TEXT NOT NULL CHECK (doc_type IN ('sales', 'purchases', 'sales_returns', 'purchase_returns')),
    invoice_no TEXT,
    returned_invoice_no TEXT,
    date DATE NOT NULL,
    year INT NOT NULL,
    month INT NOT NULL,
    party_name TEXT,
    payment_method TEXT,
    total_qty NUMERIC DEFAULT 0,
    discount NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    profit NUMERIC DEFAULT 0,
    paid_cash NUMERIC DEFAULT 0,
    credit NUMERIC DEFAULT 0,
    due NUMERIC DEFAULT 0,
    warehouse_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_historical_invoice UNIQUE (branch_name, doc_type, invoice_no, date)
);

CREATE TABLE IF NOT EXISTS public.historical_invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES public.historical_invoices(id) ON DELETE CASCADE,
    branch_name TEXT NOT NULL CHECK (branch_name IN ('معرض عبد المنعم', 'مخزن شلبي', 'معرض شلبي اللي اتقفل')),
    date DATE NOT NULL,
    year INT NOT NULL,
    item_code TEXT,
    item_name TEXT NOT NULL,
    unit TEXT,
    qty NUMERIC DEFAULT 0,
    price NUMERIC DEFAULT 0,
    discount NUMERIC DEFAULT 0,
    profit NUMERIC DEFAULT 0,
    total NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.historical_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_name TEXT NOT NULL CHECK (branch_name IN ('معرض عبد المنعم', 'مخزن شلبي', 'معرض شلبي اللي اتقفل')),
    voucher_type TEXT NOT NULL CHECK (voucher_type IN ('expense', 'receipt')),
    movement_name TEXT,
    voucher_no TEXT,
    date DATE NOT NULL,
    year INT NOT NULL,
    month INT NOT NULL,
    amount NUMERIC DEFAULT 0,
    category TEXT,
    party_name TEXT,
    treasury_name TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_historical_voucher UNIQUE (branch_name, voucher_type, voucher_no, date, amount)
);

CREATE INDEX IF NOT EXISTS idx_hist_inv_filter ON public.historical_invoices (branch_name, year, doc_type, date);
CREATE INDEX IF NOT EXISTS idx_hist_items_invoice ON public.historical_invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_hist_items_filter ON public.historical_invoice_items (branch_name, year, item_name);
CREATE INDEX IF NOT EXISTS idx_hist_vouch_filter ON public.historical_vouchers (branch_name, year, voucher_type, category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.historical_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.historical_invoice_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.historical_vouchers TO authenticated;
GRANT ALL ON public.historical_invoices TO service_role;
GRANT ALL ON public.historical_invoice_items TO service_role;
GRANT ALL ON public.historical_vouchers TO service_role;

ALTER TABLE public.historical_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read/write historical_invoices" ON public.historical_invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated read/write historical_invoice_items" ON public.historical_invoice_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated read/write historical_vouchers" ON public.historical_vouchers FOR ALL TO authenticated USING (true) WITH CHECK (true);