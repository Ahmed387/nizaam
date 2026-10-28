-- 0124: editing a purchase invoice — only a line whose quantity goes DOWN needs the stock (owner «صلح», 2026-10-28)
--
-- edit_shipment checked «current stock + (new qty − old qty) ≥ 0» on EVERY line, also the ones nobody touched.
-- A product whose stock is already below zero (36 products, e.g. غسالة فريش جراند in سكة تلة = −4) made every edit of
-- every invoice holding it fail — even changing the notes or the shipping: 114 active purchase invoices could not be
-- edited (3 failed saves on 2026-10-27 «لا يمكن تقليل كمية غسالة فريش جراند…: المخزون (-4) لا يكفي»).
-- Now: a line whose quantity is unchanged or goes UP passes and does not touch the product's stock; a line that goes
-- DOWN is still refused when the stock can't give the pieces back. Nothing else in the function changes.

DO $mig$
DECLARE
  d text := pg_get_functiondef('public.edit_shipment(uuid,jsonb,jsonb)'::regprocedure);
  old_part text := $o$        v_new_qty := v_cur_qty + (v_qty - v_old.quantity);
        IF v_new_qty < 0 THEN
          RAISE EXCEPTION 'لا يمكن تقليل كمية %: المخزون (%) لا يكفي', v_old.product_name, v_cur_qty;
        END IF;
        UPDATE products SET quantity = v_new_qty WHERE id = v_old.product_id;$o$;
  new_part text := $n$        v_new_qty := v_cur_qty + (v_qty - v_old.quantity);
        -- 0124: only a line whose quantity goes DOWN needs the stock; an untouched line passes even when the
        -- product's stock is already below zero (it blocked every edit of the invoice)
        IF v_qty < v_old.quantity AND v_new_qty < 0 THEN
          RAISE EXCEPTION 'لا يمكن تقليل كمية %: المخزون (%) لا يكفي', v_old.product_name, v_cur_qty;
        END IF;
        IF v_qty <> v_old.quantity THEN
          UPDATE products SET quantity = v_new_qty WHERE id = v_old.product_id;
        END IF;$n$;
BEGIN
  IF position(new_part IN d) > 0 THEN
    RETURN; -- already applied
  END IF;
  IF position(old_part IN d) = 0 THEN
    RAISE EXCEPTION '0124: edit_shipment is not the expected version — nothing changed';
  END IF;
  EXECUTE replace(d, old_part, new_part);
END
$mig$;
