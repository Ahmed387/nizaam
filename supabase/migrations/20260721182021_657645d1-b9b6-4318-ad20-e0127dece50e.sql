
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.inventory_session_items ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.stock_adjustment_items ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.pre_orders ADD COLUMN IF NOT EXISTS color TEXT;

DROP TRIGGER IF EXISTS trg_quote_items_color ON public.quote_items;
CREATE TRIGGER trg_quote_items_color
BEFORE INSERT ON public.quote_items
FOR EACH ROW EXECUTE FUNCTION public.set_item_color_from_product();

DROP TRIGGER IF EXISTS trg_inventory_session_items_color ON public.inventory_session_items;
CREATE TRIGGER trg_inventory_session_items_color
BEFORE INSERT ON public.inventory_session_items
FOR EACH ROW EXECUTE FUNCTION public.set_item_color_from_product();

DROP TRIGGER IF EXISTS trg_stock_adjustment_items_color ON public.stock_adjustment_items;
CREATE TRIGGER trg_stock_adjustment_items_color
BEFORE INSERT ON public.stock_adjustment_items
FOR EACH ROW EXECUTE FUNCTION public.set_item_color_from_product();

DROP TRIGGER IF EXISTS trg_stock_transfers_color ON public.stock_transfers;
CREATE TRIGGER trg_stock_transfers_color
BEFORE INSERT ON public.stock_transfers
FOR EACH ROW EXECUTE FUNCTION public.set_item_color_from_product();

DROP TRIGGER IF EXISTS trg_inventory_reservations_color ON public.inventory_reservations;
CREATE TRIGGER trg_inventory_reservations_color
BEFORE INSERT ON public.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION public.set_item_color_from_product();
