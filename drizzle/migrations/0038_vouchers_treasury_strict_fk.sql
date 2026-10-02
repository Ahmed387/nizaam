ALTER TABLE public.vouchers ALTER COLUMN treasury_id SET NOT NULL;
ALTER TABLE public.vouchers
  ADD CONSTRAINT vouchers_treasury_id_fkey
  FOREIGN KEY (treasury_id) REFERENCES public.treasury(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_vouchers_treasury_id ON public.vouchers(treasury_id);