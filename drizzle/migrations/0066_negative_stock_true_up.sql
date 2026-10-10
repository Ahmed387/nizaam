-- 0066 — Selling out of stock (negative stock) with automatic cost true-up.
-- A branch may sell a product it does not have yet (borrowed from a neighbouring supplier until its own
-- goods arrive). The quantity goes negative, the missing part is costed at the LAST PURCHASE PRICE of the
-- product, and an open "shortage" is recorded. When goods arrive (any new batch: purchase, transfer,
-- opening stock) the shortage is settled FIFO from that batch and the sale line's cost is corrected to the
-- real purchase cost — the COGS journal of the invoice re-posts itself from invoice_items.
-- Per-branch switch: branches.allow_negative_stock (default ON, owner's decision).

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS allow_negative_stock boolean NOT NULL DEFAULT true;

-- products.quantity >= 0 was a CHECK constraint; it becomes a per-branch rule.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS chk_products_qty_nonneg;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_quantity_non_negative;
CREATE OR REPLACE FUNCTION public.guard_product_negative_qty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.quantity < 0 AND NOT coalesce((SELECT allow_negative_stock FROM public.branches WHERE id = NEW.branch_id), false) THEN
    RAISE EXCEPTION 'رصيد % لا يمكن أن يكون بالسالب في هذا الفرع', NEW.name USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_product_negative_qty() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_product_negative_qty ON public.products;
CREATE TRIGGER trg_guard_product_negative_qty BEFORE INSERT OR UPDATE OF quantity ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.guard_product_negative_qty();

CREATE TABLE IF NOT EXISTS public.stock_shortages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE SET NULL,
  qty numeric NOT NULL CHECK (qty > 0),
  qty_settled numeric NOT NULL DEFAULT 0,
  provisional_unit_cost numeric NOT NULL DEFAULT 0,
  settled_cost numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS stock_shortages_open_idx ON public.stock_shortages(product_id, branch_id, created_at) WHERE status = 'open';
ALTER TABLE public.stock_shortages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_shortages_read ON public.stock_shortages;
CREATE POLICY stock_shortages_read ON public.stock_shortages FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (public.is_admin(auth.uid()) OR public.user_in_branch(auth.uid(), branch_id)));
REVOKE ALL ON public.stock_shortages FROM anon, authenticated;
GRANT SELECT ON public.stock_shortages TO authenticated;
GRANT ALL ON public.stock_shortages TO service_role;

CREATE OR REPLACE FUNCTION public.branch_allows_negative_stock(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT allow_negative_stock FROM public.branches WHERE id = p_branch_id), false);
$$;

/** Last purchase price of a product in a branch (latest batch with a cost), else the product's cost. */
CREATE OR REPLACE FUNCTION public.last_purchase_cost(p_product_id uuid, p_branch_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT pb.cost_price FROM public.product_batches pb
      WHERE pb.product_id = p_product_id AND pb.branch_id = p_branch_id AND coalesce(pb.cost_price, 0) > 0
      ORDER BY pb.effective_at DESC NULLS LAST, pb.created_at DESC LIMIT 1),
    (SELECT nullif(cost_price, 0) FROM public.products WHERE id = p_product_id), 0);
$$;

CREATE OR REPLACE FUNCTION public.open_shortage_qty(p_product_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(qty - qty_settled), 0) FROM public.stock_shortages WHERE product_id = p_product_id AND status = 'open';
$$;

CREATE OR REPLACE FUNCTION public.record_stock_shortage(p_invoice_id uuid, p_product_id uuid, p_branch_id uuid, p_unfilled numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item uuid; v_tenant uuid;
BEGIN
  IF coalesce(p_unfilled, 0) <= 0 THEN RETURN; END IF;
  SELECT ii.id, ii.tenant_id INTO v_item, v_tenant FROM public.invoice_items ii
   WHERE ii.invoice_id = p_invoice_id AND ii.product_id = p_product_id
     AND NOT EXISTS (SELECT 1 FROM public.stock_shortages ss WHERE ss.invoice_item_id = ii.id)
   LIMIT 1;
  INSERT INTO public.stock_shortages(tenant_id, branch_id, product_id, invoice_id, invoice_item_id, qty, provisional_unit_cost)
  VALUES (coalesce(v_tenant, (SELECT tenant_id FROM public.branches WHERE id = p_branch_id)), p_branch_id, p_product_id,
          p_invoice_id, v_item, p_unfilled, public.last_purchase_cost(p_product_id, p_branch_id));
END $$;

/** A new batch arrives → settle open shortages of that product/branch, oldest first, and true-up the sale cost. */
CREATE OR REPLACE FUNCTION public.settle_stock_shortages_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; v_avail numeric; v_take numeric; v_item record; v_new_unit numeric;
BEGIN
  IF coalesce(NEW.quantity_remaining, 0) <= 0 THEN RETURN NEW; END IF;
  v_avail := NEW.quantity_remaining;
  FOR s IN SELECT * FROM public.stock_shortages
            WHERE product_id = NEW.product_id AND branch_id = NEW.branch_id AND status = 'open'
            ORDER BY created_at, id FOR UPDATE LOOP
    EXIT WHEN v_avail <= 0;
    v_take := least(v_avail, s.qty - s.qty_settled);
    CONTINUE WHEN v_take <= 0;
    v_avail := v_avail - v_take;

    UPDATE public.stock_shortages
       SET qty_settled = qty_settled + v_take,
           settled_cost = settled_cost + v_take * coalesce(NEW.cost_price, 0),
           status = CASE WHEN qty_settled + v_take >= qty - 0.0001 THEN 'settled' ELSE 'open' END,
           settled_at = CASE WHEN qty_settled + v_take >= qty - 0.0001 THEN now() ELSE settled_at END
     WHERE id = s.id;

    -- true-up of the sale line: replace the provisional cost of the settled quantity by the real one
    SELECT id, quantity, coalesce(nullif(unit_cost_at_sale, 0), cost_price, 0) AS unit, batches_consumed
      INTO v_item FROM public.invoice_items WHERE id = s.invoice_item_id FOR UPDATE;
    IF FOUND AND coalesce(v_item.quantity, 0) > 0 THEN
      v_new_unit := round(v_item.unit + v_take * (coalesce(NEW.cost_price, 0) - s.provisional_unit_cost) / v_item.quantity, 4);
      UPDATE public.invoice_items
         SET unit_cost_at_sale = v_new_unit,
             cost_price = v_new_unit,
             batches_consumed = coalesce(batches_consumed, '[]'::jsonb)
               || jsonb_build_object('batch_id', NEW.id, 'qty_taken', v_take, 'cost_price', NEW.cost_price, 'settles_shortage', s.id)
       WHERE id = v_item.id;
    END IF;
  END LOOP;

  IF v_avail < NEW.quantity_remaining THEN
    UPDATE public.product_batches SET quantity_remaining = v_avail WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_settle_stock_shortages ON public.product_batches;
CREATE TRIGGER zz_settle_stock_shortages AFTER INSERT ON public.product_batches
  FOR EACH ROW EXECUTE FUNCTION public.settle_stock_shortages_trg();

/** Cancelling a sale closes its open shortages (the quantity goes back to the product). */
CREATE OR REPLACE FUNCTION public.cancel_stock_shortages_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status::text = 'cancelled' AND OLD.status::text <> 'cancelled' THEN
    UPDATE public.stock_shortages SET status = 'cancelled' WHERE invoice_id = NEW.id AND status = 'open';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_cancel_stock_shortages ON public.invoices;
CREATE TRIGGER zz_cancel_stock_shortages AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.cancel_stock_shortages_trg();

REVOKE ALL ON FUNCTION public.branch_allows_negative_stock(uuid), public.last_purchase_cost(uuid, uuid),
  public.open_shortage_qty(uuid), public.record_stock_shortage(uuid, uuid, uuid, numeric),
  public.settle_stock_shortages_trg(), public.cancel_stock_shortages_trg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.branch_allows_negative_stock(uuid), public.last_purchase_cost(uuid, uuid),
  public.open_shortage_qty(uuid), public.record_stock_shortage(uuid, uuid, uuid, numeric) TO service_role;

-- Patch the existing functions in place (exact text replacement, refused if the text is not found).
DO $$
DECLARE d text; n text;
  PROCEDURE_NAMES text[] := ARRAY['consume_product_batches_json','consume_product_batches','peek_product_fifo_cost'];
  fn text;
BEGIN
  -- 1) the sale may go below zero when the branch allows it, and records the shortage
  d := pg_get_functiondef('public.process_sale'::regproc);
  n := replace(d,
    $x$IF v_current < v_qty THEN RAISE EXCEPTION 'الكمية المتاحة غير كافية (متاح: %)', v_current; END IF;$x$,
    $x$IF v_current < v_qty AND NOT public.branch_allows_negative_stock(p_branch_id) THEN RAISE EXCEPTION 'الكمية المتاحة غير كافية (متاح: %)', v_current; END IF;$x$);
  n := replace(n,
    $x$UPDATE public.products SET quantity = quantity - v_qty WHERE id = v_pid;$x$,
    $x$UPDATE public.products SET quantity = quantity - v_qty WHERE id = v_pid;
    PERFORM public.record_stock_shortage(v_invoice_id, v_pid, p_branch_id, COALESCE((v_fifo->>'unfilled')::numeric, 0));$x$);
  IF n = d OR position('record_stock_shortage' IN n) = 0 OR position('branch_allows_negative_stock' IN n) = 0 THEN
    RAISE EXCEPTION 'process_sale: expected text not found — not patched';
  END IF;
  EXECUTE n;

  -- 1b) the sale screen may reserve more than the stock when the branch allows it
  d := pg_get_functiondef('public.reserve_stock'::regproc);
  n := replace(d, $x$IF p_quantity > v_available_for_me THEN$x$,
                  $x$IF p_quantity > v_available_for_me AND NOT public.branch_allows_negative_stock(p_branch_id) THEN$x$);
  n := replace(n, $x$'available_for_me', v_available_for_me - p_quantity + COALESCE(v_my_current,0),$x$,
                  $x$'available_for_me', v_available_for_me - p_quantity + COALESCE(v_my_current,0),
    'negative', p_quantity > v_available_for_me,$x$);
  IF n = d OR position('negative' IN n) = 0 THEN RAISE EXCEPTION 'reserve_stock: expected text not found — not patched'; END IF;
  EXECUTE n;

  -- 2) the missing quantity is costed at the last purchase price
  FOREACH fn IN ARRAY PROCEDURE_NAMES LOOP
    d := pg_get_functiondef(('public.' || fn)::regproc);
    n := replace(d, $x$SELECT cost_price INTO fallback_cost FROM public.products WHERE id = _product_id;$x$,
                    $x$fallback_cost := public.last_purchase_cost(_product_id, _branch_id);$x$);
    IF n = d THEN RAISE EXCEPTION '%: expected text not found — not patched', fn; END IF;
    EXECUTE n;
  END LOOP;

  -- 3) integrity audit: an allowed negative balance waiting for goods is not an error
  d := pg_get_functiondef('public.system_integrity_audit'::regproc);
  n := replace(d,
    $x$SELECT COALESCE(sum(pb.quantity_remaining), 0) AS rem, count(*) AS n FROM product_batches pb WHERE pb.product_id = p.id) x ON x.n > 0$x$,
    $x$SELECT COALESCE(sum(pb.quantity_remaining), 0) - public.open_shortage_qty(p.id) AS rem, count(*) AS n FROM product_batches pb WHERE pb.product_id = p.id) x ON x.n > 0$x$);
  n := replace(n,
    $x$SELECT 'S2', 'error', 'stock', 'رصيد صنف بالسالب'$x$,
    $x$SELECT 'S2', CASE WHEN public.open_shortage_qty(p.id) >= -p.quantity - 0.0001 THEN 'info' ELSE 'error' END, 'stock',
         CASE WHEN public.open_shortage_qty(p.id) >= -p.quantity - 0.0001 THEN 'رصيد بالسالب مسموح — مستني وصول بضاعة' ELSE 'رصيد صنف بالسالب' END$x$);
  IF n = d THEN RAISE EXCEPTION 'system_integrity_audit: expected text not found — not patched'; END IF;
  EXECUTE n;
END $$;
