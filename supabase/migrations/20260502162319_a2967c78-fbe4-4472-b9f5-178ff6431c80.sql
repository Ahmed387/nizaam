ALTER TABLE public.price_list ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS idx_price_list_source ON public.price_list(source);