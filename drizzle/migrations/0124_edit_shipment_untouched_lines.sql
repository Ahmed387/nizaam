-- 0124: editing a purchase invoice never fails on the stock of a line (owner «صلح» + «نفذ», 2026-10-28)
--
-- edit_shipment checked «current stock + (new qty − old qty) ≥ 0» on EVERY line, also the ones nobody touched.
-- A product whose stock is already below zero (36 products, e.g. غسالة فريش جراند in سكة تلة = −4) made every edit of
-- every invoice holding it fail — even changing the notes or the shipping: 114 active purchase invoices could not be
-- edited (3 failed saves on 2026-10-27 «لا يمكن تقليل كمية غسالة فريش جراند…: المخزون (-4) لا يكفي»).
-- Now:
--   • a line whose quantity is unchanged does not touch the product's stock and passes;
--   • a line that goes UP adds the pieces;
--   • a line that goes DOWN is accepted even when the stock goes (more) below zero — owner 2026-10-28 «نفذ»:
--     بوتاجاز فريش سمايل جلاكسي −2, one piece less on the invoice → −3; PO00492 تكييف فريش 2 → 1: stock −15 → −16,
--     the invoice 32,500 → 16,250 (supplier side and the purchase entry follow). The sales already made keep their cost.
--     Negative stock is the normal «waiting for goods» state (integrity S2 info) until a purchase or a count fixes it.
-- Deleting a whole line keeps its own checks (pieces of its batch already sold / stock below its quantity).

DO $mig$
DECLARE
  d text := pg_get_functiondef('public.edit_shipment(uuid,jsonb,jsonb)'::regprocedure);
  old_part text := $o$        v_new_qty := v_cur_qty + (v_qty - v_old.quantity);
        IF v_new_qty < 0 THEN
          RAISE EXCEPTION 'لا يمكن تقليل كمية %: المخزون (%) لا يكفي', v_old.product_name, v_cur_qty;
        END IF;
        UPDATE products SET quantity = v_new_qty WHERE id = v_old.product_id;$o$;
  new_part text := $n$        v_new_qty := v_cur_qty + (v_qty - v_old.quantity);
        -- 0124: no stock refusal on a line — an untouched line leaves the stock alone, a lowered one may take the
        -- stock below zero (owner 2026-10-28)
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
