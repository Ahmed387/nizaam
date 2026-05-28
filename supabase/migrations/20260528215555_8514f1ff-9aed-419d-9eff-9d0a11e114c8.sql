ALTER TABLE public.transfer_fees DROP CONSTRAINT IF EXISTS transfer_fees_payment_method_check;
ALTER TABLE public.transfer_fees ADD COLUMN IF NOT EXISTS label text;