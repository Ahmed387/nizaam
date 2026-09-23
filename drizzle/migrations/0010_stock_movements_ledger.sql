CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  branch_id uuid,
  product_id uuid NOT NULL,
  movement_type text NOT NULL,
  quantity integer NOT NULL,
  balance_before integer,
  balance_after integer NOT NULL,
  reference_type text,
  reference_id uuid,
  movement_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);
GRANT SELECT ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_movements_select_scoped" ON public.stock_movements FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id() AND (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid()) OR public.user_in_branch(auth.uid(), branch_id)));
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_date ON public.stock_movements(product_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_branch_date ON public.stock_movements(tenant_id, branch_id, movement_date DESC);

-- Immutability: rows may never be edited
CREATE OR REPLACE FUNCTION public.stock_movements_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is immutable';
END $$;
CREATE TRIGGER trg_stock_movements_immutable BEFORE UPDATE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.stock_movements_immutable();

-- Context setter: document triggers stamp the transaction with the movement source
CREATE OR REPLACE FUNCTION public.stock_mv_set_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_type text; v_ref_type text; v_ref uuid; v_date timestamptz; v_prod uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  CASE TG_TABLE_NAME
    WHEN 'invoice_items' THEN v_type:='sale'; v_ref_type:='invoice'; v_ref:=r.invoice_id; v_prod:=r.product_id;
      SELECT invoice_date INTO v_date FROM invoices WHERE id=r.invoice_id;
    WHEN 'return_items' THEN v_type:='return_in'; v_ref_type:='sale_return'; v_ref:=r.return_id; v_prod:=r.product_id;
      SELECT invoice_date INTO v_date FROM returns WHERE id=r.return_id;
    WHEN 'shipment_items' THEN v_type:='purchase'; v_ref_type:='shipment'; v_ref:=r.shipment_id; v_prod:=r.product_id;
      SELECT invoice_date INTO v_date FROM shipments WHERE id=r.shipment_id;
    WHEN 'purchase_return_items' THEN v_type:='return_out'; v_ref_type:='purchase_return'; v_ref:=r.purchase_return_id; v_prod:=r.product_id;
      SELECT invoice_date INTO v_date FROM purchase_returns WHERE id=r.purchase_return_id;
    WHEN 'stock_adjustment_items' THEN v_type:='adjustment'; v_ref_type:='stock_adjustment'; v_ref:=r.adjustment_id; v_prod:=r.product_id;
    WHEN 'inventory_adjustments' THEN v_type:='adjustment'; v_ref_type:='inventory_session'; v_ref:=r.session_id; v_prod:=r.product_id;
    WHEN 'stock_transfers' THEN v_type:='transfer'; v_ref_type:='stock_transfer'; v_ref:=r.id; v_prod:=NULL;
    WHEN 'invoices' THEN v_type:='sale'; v_ref_type:='invoice'; v_ref:=r.id; v_prod:=NULL; v_date:=r.invoice_date;
    ELSE RETURN r;
  END CASE;
  PERFORM set_config('nizam.mv_type', v_type, true);
  PERFORM set_config('nizam.mv_ref_type', v_ref_type, true);
  PERFORM set_config('nizam.mv_ref', COALESCE(v_ref::text,''), true);
  PERFORM set_config('nizam.mv_prod', COALESCE(v_prod::text,''), true);
  PERFORM set_config('nizam.mv_date', COALESCE(v_date::text,''), true);
  RETURN r;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_items','return_items','shipment_items','purchase_return_items','stock_adjustment_items','inventory_adjustments','stock_transfers','invoices'] LOOP
    EXECUTE format('CREATE TRIGGER a0_stock_mv_context BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.stock_mv_set_context()', t);
  END LOOP;
END $$;

-- Single source of truth: every quantity change on a branch product row is logged atomically
CREATE OR REPLACE FUNCTION public.stock_mv_log_product_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old int; v_delta int; v_type text; v_ref_type text; v_ref text; v_prod text; v_date text;
BEGIN
  IF TG_OP = 'INSERT' THEN v_old := 0; ELSE v_old := COALESCE(OLD.quantity,0); END IF;
  v_delta := COALESCE(NEW.quantity,0) - v_old;
  IF v_delta = 0 THEN RETURN NEW; END IF;
  v_type := NULLIF(current_setting('nizam.mv_type', true),'');
  v_ref_type := NULLIF(current_setting('nizam.mv_ref_type', true),'');
  v_ref := NULLIF(current_setting('nizam.mv_ref', true),'');
  v_prod := NULLIF(current_setting('nizam.mv_prod', true),'');
  v_date := NULLIF(current_setting('nizam.mv_date', true),'');
  -- context belongs to another product -> not trustworthy
  IF v_prod IS NOT NULL AND v_prod <> NEW.id::text THEN v_type := NULL; END IF;
  IF v_type IS NULL THEN
    v_type := CASE WHEN TG_OP='INSERT' THEN 'opening' ELSE 'adjustment' END;
    v_ref_type := CASE WHEN TG_OP='INSERT' THEN 'opening_stock' ELSE 'system' END;
    v_ref := NULL; v_date := NULL;
  END IF;
  INSERT INTO stock_movements(tenant_id, branch_id, product_id, movement_type, quantity, balance_before, balance_after, reference_type, reference_id, movement_date)
  VALUES (NEW.tenant_id, NEW.branch_id, NEW.id, v_type, v_delta, v_old, COALESCE(NEW.quantity,0), v_ref_type, v_ref::uuid, COALESCE(v_date::timestamptz, now()));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_stock_mv_log_product_change AFTER INSERT OR UPDATE OF quantity ON public.products
FOR EACH ROW EXECUTE FUNCTION public.stock_mv_log_product_change();

-- Baseline: one opening row per product that already holds stock
INSERT INTO public.stock_movements(tenant_id, branch_id, product_id, movement_type, quantity, balance_before, balance_after, reference_type, movement_date)
SELECT tenant_id, branch_id, id, 'opening', quantity, 0, quantity, 'baseline', now()
FROM public.products WHERE COALESCE(quantity,0) <> 0;

REVOKE EXECUTE ON FUNCTION public.stock_mv_log_product_change() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.stock_mv_set_context() FROM PUBLIC, anon;