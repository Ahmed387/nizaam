
-- ============================================================
-- Phase 1: Price List redesign
-- ============================================================

-- 1. Drop old price_list table (data discarded as agreed)
DROP TABLE IF EXISTS public.price_list CASCADE;

-- 2. Suppliers (sources) of price lists
CREATE TABLE public.price_list_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  supplier_name text NOT NULL,
  last_updated timestamptz,
  updated_by_id uuid,
  updated_by_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, supplier_name)
);

ALTER TABLE public.price_list_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY pls_read ON public.price_list_sources FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));

CREATE POLICY pls_write ON public.price_list_sources FOR ALL
  USING (((tenant_id = current_tenant_id()) AND is_admin(auth.uid())) OR is_super_admin(auth.uid()))
  WITH CHECK (((tenant_id = current_tenant_id()) AND is_admin(auth.uid())) OR is_super_admin(auth.uid()));

CREATE POLICY pls_suspended ON public.price_list_sources AS RESTRICTIVE FOR ALL
  USING (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended()))
  WITH CHECK (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended()));

-- 3. Price list items
CREATE TABLE public.price_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES public.price_list_sources(id) ON DELETE RESTRICT,
  category text,
  product_name text NOT NULL,
  model_code text,
  cost_price numeric NOT NULL DEFAULT 0,
  suggested_sell_price numeric NOT NULL DEFAULT 0,
  display_price numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pli_tenant_source ON public.price_list_items(tenant_id, source_id);
CREATE INDEX idx_pli_search ON public.price_list_items(tenant_id) WHERE is_active = true;

ALTER TABLE public.price_list_items ENABLE ROW LEVEL SECURITY;

-- SELECT: admin + accountant see full row (incl. cost_price)
CREATE POLICY pli_read_admin ON public.price_list_items FOR SELECT
  USING (
    is_super_admin(auth.uid())
    OR (tenant_id = current_tenant_id() AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'accountant'::app_role)))
  );

-- WRITE: admin only
CREATE POLICY pli_write ON public.price_list_items FOR ALL
  USING (((tenant_id = current_tenant_id()) AND is_admin(auth.uid())) OR is_super_admin(auth.uid()))
  WITH CHECK (((tenant_id = current_tenant_id()) AND is_admin(auth.uid())) OR is_super_admin(auth.uid()));

CREATE POLICY pli_suspended ON public.price_list_items AS RESTRICTIVE FOR ALL
  USING (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended()))
  WITH CHECK (is_super_admin(auth.uid()) OR (NOT current_tenant_is_suspended()));

-- 4. Public view (no cost / no suggested sell) for cashier + branch_manager + warehouse
CREATE OR REPLACE VIEW public.price_list_items_public
WITH (security_invoker = false) AS
SELECT
  i.id,
  i.tenant_id,
  i.source_id,
  s.supplier_name,
  i.category,
  i.product_name,
  i.model_code,
  i.display_price,
  i.is_active,
  i.updated_at
FROM public.price_list_items i
JOIN public.price_list_sources s ON s.id = i.source_id
WHERE i.is_active = true
  AND s.is_active = true
  AND (i.tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));

GRANT SELECT ON public.price_list_items_public TO authenticated;

-- 5. updated_at trigger
CREATE TRIGGER tg_pli_touch BEFORE UPDATE ON public.price_list_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6. Audit triggers
CREATE TRIGGER tg_pls_audit AFTER INSERT OR UPDATE OR DELETE ON public.price_list_sources
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER tg_pli_audit AFTER INSERT OR UPDATE OR DELETE ON public.price_list_items
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- 7. invoice_items: add price_list_cost snapshot + off-stock flag
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS price_list_cost numeric,
  ADD COLUMN IF NOT EXISTS is_off_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_list_item_id uuid;

-- 8. Seed default suppliers for every existing tenant
INSERT INTO public.price_list_sources (tenant_id, supplier_name)
SELECT t.id, s.name
FROM public.tenants t
CROSS JOIN (VALUES
  ('Fresh'), ('LG'), ('Kiriazi'), ('Unionaire'),
  ('ATA'), ('Bosch'), ('Toshiba'), ('Midea'), ('Sieltal')
) AS s(name)
ON CONFLICT (tenant_id, supplier_name) DO NOTHING;

-- 9. Auto-seed suppliers for new tenants
CREATE OR REPLACE FUNCTION public.seed_default_price_list_sources()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.price_list_sources (tenant_id, supplier_name)
  VALUES
    (NEW.id, 'Fresh'), (NEW.id, 'LG'), (NEW.id, 'Kiriazi'),
    (NEW.id, 'Unionaire'), (NEW.id, 'ATA'), (NEW.id, 'Bosch'),
    (NEW.id, 'Toshiba'), (NEW.id, 'Midea'), (NEW.id, 'Sieltal')
  ON CONFLICT (tenant_id, supplier_name) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_tenant_seed_pls AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_price_list_sources();

-- 10. RPC: apply price list update (atomic upsert + snapshot old prices for changes)
CREATE OR REPLACE FUNCTION public.apply_price_list_update(
  p_source_id uuid,
  p_items jsonb  -- [{product_name, model_code, category, cost_price, suggested_sell_price, display_price}]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_user_name text;
  v_item jsonb;
  v_existing record;
  v_inserted int := 0;
  v_updated int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT (is_admin(v_user) OR is_super_admin(v_user)) THEN
    RAISE EXCEPTION 'صلاحية المدير العام فقط';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.price_list_sources WHERE id = p_source_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'مورد غير موجود'; END IF;
  IF NOT is_super_admin(v_user) AND v_tenant <> current_tenant_id() THEN
    RAISE EXCEPTION 'مورد ليس ضمن شركتك';
  END IF;

  SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    -- Match by (source, product_name, model_code) — model_code may be null
    SELECT * INTO v_existing FROM public.price_list_items
     WHERE source_id = p_source_id
       AND product_name = (v_item->>'product_name')
       AND COALESCE(model_code,'') = COALESCE(v_item->>'model_code','')
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      UPDATE public.price_list_items SET
        category = COALESCE(v_item->>'category', category),
        cost_price = COALESCE((v_item->>'cost_price')::numeric, cost_price),
        suggested_sell_price = COALESCE((v_item->>'suggested_sell_price')::numeric, suggested_sell_price),
        -- only auto-update display_price on first import; admin controls afterwards
        display_price = CASE WHEN COALESCE(v_existing.display_price,0) = 0
                             THEN COALESCE((v_item->>'display_price')::numeric, (v_item->>'suggested_sell_price')::numeric, display_price)
                             ELSE display_price END,
        updated_at = now()
      WHERE id = v_existing.id;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO public.price_list_items(
        tenant_id, source_id, category, product_name, model_code,
        cost_price, suggested_sell_price, display_price
      ) VALUES (
        v_tenant, p_source_id,
        v_item->>'category',
        v_item->>'product_name',
        v_item->>'model_code',
        COALESCE((v_item->>'cost_price')::numeric, 0),
        COALESCE((v_item->>'suggested_sell_price')::numeric, 0),
        COALESCE((v_item->>'display_price')::numeric, (v_item->>'suggested_sell_price')::numeric, 0)
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  UPDATE public.price_list_sources
     SET last_updated = now(),
         updated_by_id = v_user,
         updated_by_name = COALESCE(v_user_name, 'admin')
   WHERE id = p_source_id;

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
END;
$$;
