ALTER TABLE public.stock_transfers
ADD COLUMN IF NOT EXISTS cost_price_at_transfer numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_value_at_transfer numeric DEFAULT 0;

-- Backfill: uses current products.cost_price as an approximation for historical rows.
-- NOTE: values are approximate for pre-existing transfers (not historical FIFO cost).
UPDATE public.stock_transfers st
SET
  cost_price_at_transfer = COALESCE(
    (SELECT p.cost_price FROM public.products p WHERE p.id = st.product_id LIMIT 1), 0),
  total_value_at_transfer = st.quantity * COALESCE(
    (SELECT p.cost_price FROM public.products p WHERE p.id = st.product_id LIMIT 1), 0)
WHERE COALESCE(cost_price_at_transfer, 0) = 0;