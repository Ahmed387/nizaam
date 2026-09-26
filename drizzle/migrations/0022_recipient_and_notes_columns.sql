ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS recipient_name text;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS recipient_name text;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS recipient_name text;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS recipient_name text;
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS recipient_name text;
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS notes text;