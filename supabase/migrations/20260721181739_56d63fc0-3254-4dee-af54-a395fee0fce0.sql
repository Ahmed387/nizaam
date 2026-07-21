
CREATE OR REPLACE FUNCTION public.set_item_color_from_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.color IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT color INTO NEW.color FROM public.products WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_items_color ON public.invoice_items;
CREATE TRIGGER trg_invoice_items_color
BEFORE INSERT ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.set_item_color_from_product();

DROP TRIGGER IF EXISTS trg_shipment_items_color ON public.shipment_items;
CREATE TRIGGER trg_shipment_items_color
BEFORE INSERT ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.set_item_color_from_product();

DROP TRIGGER IF EXISTS trg_return_items_color ON public.return_items;
CREATE TRIGGER trg_return_items_color
BEFORE INSERT ON public.return_items
FOR EACH ROW EXECUTE FUNCTION public.set_item_color_from_product();

DROP TRIGGER IF EXISTS trg_purchase_return_items_color ON public.purchase_return_items;
CREATE TRIGGER trg_purchase_return_items_color
BEFORE INSERT ON public.purchase_return_items
FOR EACH ROW EXECUTE FUNCTION public.set_item_color_from_product();
