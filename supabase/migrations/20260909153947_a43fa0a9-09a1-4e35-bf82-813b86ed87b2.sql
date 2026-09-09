
CREATE OR REPLACE FUNCTION public.trg_replicate_product_across_branches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE b RECORD;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.archived_at IS NOT NULL OR NEW.tenant_id IS NULL THEN RETURN NEW; END IF;

  FOR b IN
    SELECT id FROM public.branches
    WHERE tenant_id = NEW.tenant_id
      AND id <> NEW.branch_id
      AND COALESCE(is_system, false) = false
  LOOP
    INSERT INTO public.products (
      tenant_id, branch_id, name, sku, brand, model, color, product_type,
      capacity, size, image, category_id, initial_stock_date,
      cost_price, selling_price, market_price, low_stock_alert, min_stock_level,
      quantity
    )
    SELECT
      NEW.tenant_id, b.id, NEW.name, NEW.sku, NEW.brand, NEW.model, NEW.color, NEW.product_type,
      NEW.capacity, NEW.size, NEW.image, NEW.category_id, NEW.initial_stock_date,
      NEW.cost_price, NEW.selling_price, NEW.market_price, NEW.low_stock_alert, NEW.min_stock_level,
      0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.tenant_id = NEW.tenant_id
        AND p.branch_id = b.id
        AND p.archived_at IS NULL
        AND lower(btrim(p.name)) = lower(btrim(NEW.name))
        AND COALESCE(lower(btrim(p.brand)),'') = COALESCE(lower(btrim(NEW.brand)),'')
        AND COALESCE(lower(btrim(p.model)),'') = COALESCE(lower(btrim(NEW.model)),'')
        AND COALESCE(lower(btrim(p.color)),'') = COALESCE(lower(btrim(NEW.color)),'')
        AND COALESCE(lower(btrim(p.capacity)),'') = COALESCE(lower(btrim(NEW.capacity)),'')
        AND COALESCE(lower(btrim(p.size)),'') = COALESCE(lower(btrim(NEW.size)),'')
    )
    ON CONFLICT (tenant_id, branch_id, sku) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_replicate_product_across_branches ON public.products;
CREATE TRIGGER trg_replicate_product_across_branches
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.trg_replicate_product_across_branches();

CREATE OR REPLACE FUNCTION public.trg_sync_product_identity_across_branches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;

  IF (OLD.name IS DISTINCT FROM NEW.name
      OR OLD.brand IS DISTINCT FROM NEW.brand
      OR OLD.model IS DISTINCT FROM NEW.model
      OR OLD.image IS DISTINCT FROM NEW.image
      OR OLD.category_id IS DISTINCT FROM NEW.category_id) THEN

    UPDATE public.products p
    SET name = NEW.name,
        brand = NEW.brand,
        model = NEW.model,
        image = NEW.image,
        category_id = NEW.category_id
    WHERE p.tenant_id = NEW.tenant_id
      AND p.sku = NEW.sku
      AND p.id <> NEW.id
      AND p.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.products q
        WHERE q.tenant_id = NEW.tenant_id
          AND q.branch_id = p.branch_id
          AND q.id <> p.id
          AND q.archived_at IS NULL
          AND lower(btrim(q.name)) = lower(btrim(NEW.name))
          AND COALESCE(lower(btrim(q.brand)),'') = COALESCE(lower(btrim(NEW.brand)),'')
          AND COALESCE(lower(btrim(q.model)),'') = COALESCE(lower(btrim(NEW.model)),'')
          AND COALESCE(lower(btrim(q.color)),'') = COALESCE(lower(btrim(p.color)),'')
          AND COALESCE(lower(btrim(q.capacity)),'') = COALESCE(lower(btrim(p.capacity)),'')
          AND COALESCE(lower(btrim(q.size)),'') = COALESCE(lower(btrim(p.size)),'')
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_identity_across_branches ON public.products;
CREATE TRIGGER trg_sync_product_identity_across_branches
AFTER UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_product_identity_across_branches();

-- One-time safe backfill: replicate existing catalog to all non-system branches with zero stock
INSERT INTO public.products (
  tenant_id, branch_id, name, sku, brand, model, color, product_type,
  capacity, size, image, category_id, initial_stock_date,
  cost_price, selling_price, market_price, low_stock_alert, min_stock_level, quantity
)
SELECT src.tenant_id, b.id, src.name, src.sku, src.brand, src.model, src.color, src.product_type,
       src.capacity, src.size, src.image, src.category_id, src.initial_stock_date,
       src.cost_price, src.selling_price, src.market_price, src.low_stock_alert, src.min_stock_level, 0
FROM (
  SELECT DISTINCT ON (
    tenant_id,
    lower(btrim(name)),
    COALESCE(lower(btrim(brand)),''),
    COALESCE(lower(btrim(model)),''),
    COALESCE(lower(btrim(color)),''),
    COALESCE(lower(btrim(capacity)),''),
    COALESCE(lower(btrim(size)),'')
  ) *
  FROM public.products
  WHERE archived_at IS NULL AND tenant_id IS NOT NULL
  ORDER BY
    tenant_id,
    lower(btrim(name)),
    COALESCE(lower(btrim(brand)),''),
    COALESCE(lower(btrim(model)),''),
    COALESCE(lower(btrim(color)),''),
    COALESCE(lower(btrim(capacity)),''),
    COALESCE(lower(btrim(size)),''),
    created_at
) src
JOIN public.branches b
  ON b.tenant_id = src.tenant_id
 AND COALESCE(b.is_system, false) = false
 AND b.id <> src.branch_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p
  WHERE p.tenant_id = src.tenant_id AND p.branch_id = b.id AND p.sku = src.sku
)
AND NOT EXISTS (
  SELECT 1 FROM public.products p2
  WHERE p2.tenant_id = src.tenant_id
    AND p2.branch_id = b.id
    AND p2.archived_at IS NULL
    AND lower(btrim(p2.name)) = lower(btrim(src.name))
    AND COALESCE(lower(btrim(p2.brand)),'') = COALESCE(lower(btrim(src.brand)),'')
    AND COALESCE(lower(btrim(p2.model)),'') = COALESCE(lower(btrim(src.model)),'')
    AND COALESCE(lower(btrim(p2.color)),'') = COALESCE(lower(btrim(src.color)),'')
    AND COALESCE(lower(btrim(p2.capacity)),'') = COALESCE(lower(btrim(src.capacity)),'')
    AND COALESCE(lower(btrim(p2.size)),'') = COALESCE(lower(btrim(src.size)),'')
)
ON CONFLICT (tenant_id, branch_id, sku) DO NOTHING;
