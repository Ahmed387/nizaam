
-- Purchase Returns (مرتجع شراء من مورد)
CREATE TABLE public.purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  return_number text NOT NULL,
  reason text NOT NULL,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.purchase_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_return_id uuid NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  quantity integer NOT NULL,
  unit_cost numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL
);

-- Quotes (عرض أسعار)
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  quote_number text NOT NULL,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  valid_until date,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL
);

-- Stock Adjustments (تسوية المخزن)
CREATE TABLE public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  adjustment_number text NOT NULL,
  reason text NOT NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stock_adjustment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id uuid NOT NULL REFERENCES public.stock_adjustments(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  system_quantity integer NOT NULL,
  actual_quantity integer NOT NULL,
  difference integer NOT NULL,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0
);

-- Enable RLS
ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustment_items ENABLE ROW LEVEL SECURITY;

-- Tenant trigger + audit
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.purchase_returns FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_user();
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_user();
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.stock_adjustments FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_user();

-- RLS Policies (following existing pattern)
CREATE POLICY "pr_read" ON public.purchase_returns FOR SELECT USING (((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY "pr_write" ON public.purchase_returns FOR ALL USING (((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid())) WITH CHECK (((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY "viewer_read" ON public.purchase_returns FOR SELECT USING ((tenant_id = current_tenant_id()) AND has_role(auth.uid(), 'viewer'::app_role));
CREATE POLICY "suspended_block_write" ON public.purchase_returns AS RESTRICTIVE USING (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended())) WITH CHECK (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended()));

CREATE POLICY "pri_read" ON public.purchase_return_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.purchase_returns r WHERE r.id = purchase_return_id AND ((r.tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), r.branch_id)) OR is_super_admin(auth.uid()) OR has_role(auth.uid(), 'viewer'::app_role))));
CREATE POLICY "pri_write" ON public.purchase_return_items FOR ALL USING (EXISTS (SELECT 1 FROM public.purchase_returns r WHERE r.id = purchase_return_id AND ((r.tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), r.branch_id)) OR is_super_admin(auth.uid())))) WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_returns r WHERE r.id = purchase_return_id AND ((r.tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), r.branch_id)) OR is_super_admin(auth.uid()))));

CREATE POLICY "q_read" ON public.quotes FOR SELECT USING (((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY "q_write" ON public.quotes FOR ALL USING (((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid())) WITH CHECK (((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY "viewer_read" ON public.quotes FOR SELECT USING ((tenant_id = current_tenant_id()) AND has_role(auth.uid(), 'viewer'::app_role));
CREATE POLICY "suspended_block_write" ON public.quotes AS RESTRICTIVE USING (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended())) WITH CHECK (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended()));

CREATE POLICY "qi_read" ON public.quote_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND ((q.tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), q.branch_id)) OR is_super_admin(auth.uid()) OR has_role(auth.uid(), 'viewer'::app_role))));
CREATE POLICY "qi_write" ON public.quote_items FOR ALL USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND ((q.tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), q.branch_id)) OR is_super_admin(auth.uid())))) WITH CHECK (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND ((q.tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), q.branch_id)) OR is_super_admin(auth.uid()))));

CREATE POLICY "sa_read" ON public.stock_adjustments FOR SELECT USING (((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY "sa_write" ON public.stock_adjustments FOR ALL USING (((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid())) WITH CHECK (((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id)) OR is_super_admin(auth.uid()));
CREATE POLICY "viewer_read" ON public.stock_adjustments FOR SELECT USING ((tenant_id = current_tenant_id()) AND has_role(auth.uid(), 'viewer'::app_role));
CREATE POLICY "suspended_block_write" ON public.stock_adjustments AS RESTRICTIVE USING (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended())) WITH CHECK (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended()));

CREATE POLICY "sai_read" ON public.stock_adjustment_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.stock_adjustments a WHERE a.id = adjustment_id AND ((a.tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), a.branch_id)) OR is_super_admin(auth.uid()) OR has_role(auth.uid(), 'viewer'::app_role))));
CREATE POLICY "sai_write" ON public.stock_adjustment_items FOR ALL USING (EXISTS (SELECT 1 FROM public.stock_adjustments a WHERE a.id = adjustment_id AND ((a.tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), a.branch_id)) OR is_super_admin(auth.uid())))) WITH CHECK (EXISTS (SELECT 1 FROM public.stock_adjustments a WHERE a.id = adjustment_id AND ((a.tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), a.branch_id)) OR is_super_admin(auth.uid()))));

-- Trigger: when purchase return is inserted, decrease product stock
CREATE OR REPLACE FUNCTION public.process_purchase_return()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it record;
BEGIN
  FOR it IN SELECT * FROM public.purchase_return_items WHERE purchase_return_id = NEW.id LOOP
    UPDATE public.products SET quantity = GREATEST(0, quantity - it.quantity) WHERE id = it.product_id;
  END LOOP;
  RETURN NEW;
END; $$;

-- Trigger fires AFTER items are inserted: use deferred approach via items trigger instead
CREATE OR REPLACE FUNCTION public.apply_purchase_return_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.products SET quantity = GREATEST(0, quantity - NEW.quantity) WHERE id = NEW.product_id;
  UPDATE public.purchase_returns SET total_amount = total_amount + NEW.total WHERE id = NEW.purchase_return_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_apply_pr_item AFTER INSERT ON public.purchase_return_items FOR EACH ROW EXECUTE FUNCTION public.apply_purchase_return_item();

-- Stock adjustment: apply difference to product quantity
CREATE OR REPLACE FUNCTION public.apply_stock_adjustment_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.products SET quantity = NEW.actual_quantity WHERE id = NEW.product_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_apply_sa_item AFTER INSERT ON public.stock_adjustment_items FOR EACH ROW EXECUTE FUNCTION public.apply_stock_adjustment_item();
