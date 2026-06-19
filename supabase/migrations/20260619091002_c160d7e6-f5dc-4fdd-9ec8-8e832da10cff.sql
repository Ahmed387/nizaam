
CREATE OR REPLACE FUNCTION public.apply_purchase_return_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_shipment_id uuid;
  v_remaining numeric := NEW.quantity;
  v_take numeric;
  b record;
BEGIN
  -- Read parent status and linked shipment
  SELECT status, shipment_id INTO v_status, v_shipment_id
  FROM public.purchase_returns WHERE id = NEW.purchase_return_id;

  -- Skip drafts entirely (inventory not yet committed)
  IF v_status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- 1) Reduce batches LIFO. Prefer the shipment this return references.
  IF v_shipment_id IS NOT NULL THEN
    FOR b IN
      SELECT id, quantity_remaining
      FROM public.product_batches
      WHERE product_id = NEW.product_id
        AND shipment_id = v_shipment_id
        AND quantity_remaining > 0
      ORDER BY created_at DESC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(b.quantity_remaining, v_remaining);
      UPDATE public.product_batches
         SET quantity_remaining = quantity_remaining - v_take
       WHERE id = b.id;
      v_remaining := v_remaining - v_take;
    END LOOP;
  END IF;

  -- Fallback: any remaining quantity drains from newest purchase batches (LIFO)
  IF v_remaining > 0 THEN
    FOR b IN
      SELECT id, quantity_remaining
      FROM public.product_batches
      WHERE product_id = NEW.product_id
        AND batch_type = 'purchase'
        AND quantity_remaining > 0
      ORDER BY created_at DESC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(b.quantity_remaining, v_remaining);
      UPDATE public.product_batches
         SET quantity_remaining = quantity_remaining - v_take
       WHERE id = b.id;
      v_remaining := v_remaining - v_take;
    END LOOP;
  END IF;

  -- 2) Mirror onto products.quantity (guard allows: current_user=postgres here)
  UPDATE public.products
     SET quantity = GREATEST(0, quantity - NEW.quantity)
   WHERE id = NEW.product_id;

  -- 3) Aggregate total on parent
  UPDATE public.purchase_returns
     SET total_amount = total_amount + NEW.total
   WHERE id = NEW.purchase_return_id;

  RETURN NEW;
END;
$function$;
