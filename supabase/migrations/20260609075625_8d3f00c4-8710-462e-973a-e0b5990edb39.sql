
CREATE TABLE public.product_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  quantity_purchased numeric NOT NULL DEFAULT 0,
  quantity_remaining numeric NOT NULL DEFAULT 0,
  cost_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_batches_fifo ON public.product_batches(product_id, branch_id, created_at) WHERE quantity_remaining > 0;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_batches TO authenticated;
GRANT ALL ON public.product_batches TO service_role;
ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access batches" ON public.product_batches FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS unit_cost_at_sale numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_price numeric,
  ADD COLUMN IF NOT EXISTS final_price numeric,
  ADD COLUMN IF NOT EXISTS discount_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS discount_approval_note text;

CREATE TABLE public.discount_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL,
  cashier_name text NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  original_price numeric NOT NULL,
  requested_price numeric NOT NULL,
  discount_percent numeric NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  decided_by uuid,
  decided_at timestamptz,
  admin_note text,
  draft_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_discount_requests_status ON public.discount_approval_requests(branch_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discount_approval_requests TO authenticated;
GRANT ALL ON public.discount_approval_requests TO service_role;
ALTER TABLE public.discount_approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access discount approvals" ON public.discount_approval_requests FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE OR REPLACE FUNCTION public.consume_product_batches(_product_id uuid, _branch_id uuid, _quantity numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE remaining numeric := _quantity; total_cost numeric := 0; take numeric; b RECORD; fallback_cost numeric;
BEGIN
  FOR b IN SELECT id, quantity_remaining, cost_price FROM public.product_batches
    WHERE product_id = _product_id AND branch_id = _branch_id AND quantity_remaining > 0
    ORDER BY created_at ASC, id ASC FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(b.quantity_remaining, remaining);
    UPDATE public.product_batches SET quantity_remaining = quantity_remaining - take WHERE id = b.id;
    total_cost := total_cost + take * b.cost_price;
    remaining := remaining - take;
  END LOOP;
  IF remaining > 0 THEN
    SELECT cost_price INTO fallback_cost FROM public.products WHERE id = _product_id;
    total_cost := total_cost + remaining * COALESCE(fallback_cost, 0);
  END IF;
  IF _quantity = 0 THEN RETURN 0; END IF;
  RETURN total_cost / _quantity;
END; $$;
GRANT EXECUTE ON FUNCTION public.consume_product_batches(uuid, uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.peek_product_fifo_cost(_product_id uuid, _branch_id uuid, _quantity numeric)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE remaining numeric := _quantity; total_cost numeric := 0; take numeric; b RECORD; fallback_cost numeric;
BEGIN
  FOR b IN SELECT quantity_remaining, cost_price FROM public.product_batches
    WHERE product_id = _product_id AND branch_id = _branch_id AND quantity_remaining > 0
    ORDER BY created_at ASC, id ASC
  LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(b.quantity_remaining, remaining);
    total_cost := total_cost + take * b.cost_price;
    remaining := remaining - take;
  END LOOP;
  IF remaining > 0 THEN
    SELECT cost_price INTO fallback_cost FROM public.products WHERE id = _product_id;
    total_cost := total_cost + remaining * COALESCE(fallback_cost, 0);
  END IF;
  IF _quantity = 0 THEN RETURN 0; END IF;
  RETURN total_cost / _quantity;
END; $$;
GRANT EXECUTE ON FUNCTION public.peek_product_fifo_cost(uuid, uuid, numeric) TO authenticated;

-- Backfill batches from existing shipments
INSERT INTO public.product_batches (tenant_id, branch_id, product_id, shipment_id, quantity_purchased, quantity_remaining, cost_price, created_at)
SELECT s.tenant_id, s.branch_id, si.product_id, si.shipment_id, si.quantity, si.quantity, si.cost_price, s.created_at
FROM public.shipment_items si JOIN public.shipments s ON s.id = si.shipment_id
WHERE si.product_id IS NOT NULL;

-- Approximate consume historic sales (status = 'active' means completed in this schema)
DO $$
DECLARE r RECORD; remaining numeric; take numeric; b RECORD;
BEGIN
  FOR r IN
    SELECT ii.product_id, i.branch_id, SUM(ii.quantity)::numeric AS sold
    FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.product_id IS NOT NULL AND i.status = 'active'
    GROUP BY ii.product_id, i.branch_id
  LOOP
    remaining := r.sold;
    FOR b IN SELECT id, quantity_remaining FROM public.product_batches
      WHERE product_id = r.product_id AND branch_id = r.branch_id AND quantity_remaining > 0
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(b.quantity_remaining, remaining);
      UPDATE public.product_batches SET quantity_remaining = quantity_remaining - take WHERE id = b.id;
      remaining := remaining - take;
    END LOOP;
  END LOOP;
END $$;
