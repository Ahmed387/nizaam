CREATE OR REPLACE FUNCTION public.trg_reverse_returned_qty_on_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE it record; ii record; remaining numeric; take numeric;
BEGIN
  IF COALESCE(OLD.status,'active') = 'active' AND NEW.status = 'cancelled' AND NEW.invoice_id IS NOT NULL THEN
    FOR it IN SELECT product_id, quantity FROM public.return_items WHERE return_id = NEW.id AND product_id IS NOT NULL LOOP
      remaining := it.quantity;
      FOR ii IN SELECT id, COALESCE(returned_quantity,0) AS rq FROM public.invoice_items
                 WHERE invoice_id = NEW.invoice_id AND product_id = it.product_id AND COALESCE(returned_quantity,0) > 0
                 ORDER BY id DESC FOR UPDATE LOOP
        EXIT WHEN remaining <= 0;
        take := LEAST(ii.rq, remaining);
        UPDATE public.invoice_items
           SET returned_quantity = ii.rq - take, fully_returned = false
         WHERE id = ii.id;
        remaining := remaining - take;
      END LOOP;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_returns_reverse_returned_qty ON public.returns;
CREATE TRIGGER trg_returns_reverse_returned_qty AFTER UPDATE OF status ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.trg_reverse_returned_qty_on_cancel();