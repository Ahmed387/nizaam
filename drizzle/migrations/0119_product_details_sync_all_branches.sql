-- 0119 — one product = one row per branch with the same code (SKU); its details follow it to every branch
-- (owner decisions 2026-10-25: «كل فرع ليه سعره», details from the latest product row, missing branches get it with 0).
-- Before: a change reached the other branches only for name / brand / model / image / category; colour, type,
-- capacity, size, low-stock alert, min level stayed in one branch, and changing the code cut the link (the other
-- branches kept the old code, then nothing reached them any more). Integration test:
-- drizzle/tests/product_branch_sync_checks.sql (8 checks).
-- Never synced: quantity, selling / market / cost price, average cost (each branch its own) — no money / stock moves.

CREATE OR REPLACE FUNCTION public.trg_sync_product_identity_across_branches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.tenant_id IS NULL OR NEW.archived_at IS NOT NULL THEN RETURN NEW; END IF;

  IF (OLD.name IS DISTINCT FROM NEW.name OR OLD.brand IS DISTINCT FROM NEW.brand OR OLD.model IS DISTINCT FROM NEW.model
      OR OLD.image IS DISTINCT FROM NEW.image OR OLD.category_id IS DISTINCT FROM NEW.category_id
      OR OLD.color IS DISTINCT FROM NEW.color OR OLD.product_type IS DISTINCT FROM NEW.product_type
      OR OLD.capacity IS DISTINCT FROM NEW.capacity OR OLD.size IS DISTINCT FROM NEW.size
      OR OLD.low_stock_alert IS DISTINCT FROM NEW.low_stock_alert OR OLD.min_stock_level IS DISTINCT FROM NEW.min_stock_level
      OR OLD.sku IS DISTINCT FROM NEW.sku) THEN

    UPDATE public.products p
       SET name = NEW.name, brand = NEW.brand, model = NEW.model, image = NEW.image, category_id = NEW.category_id,
           color = NEW.color, product_type = NEW.product_type, capacity = NEW.capacity, size = NEW.size,
           low_stock_alert = NEW.low_stock_alert, min_stock_level = NEW.min_stock_level, sku = NEW.sku
     WHERE p.tenant_id = NEW.tenant_id
       AND p.sku = OLD.sku                       -- the OLD code: a code change reaches the other branches too
       AND p.id <> NEW.id
       AND p.archived_at IS NULL
       -- that branch already has another product with the new code / the same name + variant: leave it alone
       AND NOT EXISTS (SELECT 1 FROM public.products q
                        WHERE q.tenant_id = NEW.tenant_id AND q.branch_id = p.branch_id AND q.id <> p.id
                          AND (q.sku = NEW.sku
                               OR (q.archived_at IS NULL
                                   AND lower(btrim(q.name)) = lower(btrim(NEW.name))
                                   AND COALESCE(lower(btrim(q.brand)), '') = COALESCE(lower(btrim(NEW.brand)), '')
                                   AND COALESCE(lower(btrim(q.model)), '') = COALESCE(lower(btrim(NEW.model)), '')
                                   AND COALESCE(lower(btrim(q.color)), '') = COALESCE(lower(btrim(NEW.color)), '')
                                   AND COALESCE(lower(btrim(q.capacity)), '') = COALESCE(lower(btrim(NEW.capacity)), '')
                                   AND COALESCE(lower(btrim(q.size)), '') = COALESCE(lower(btrim(NEW.size)), ''))));
  END IF;
  RETURN NEW;
END $function$;

-- Data 1: products whose branches disagree on a detail take, per detail, the value of the LATEST product row that
-- has one (owner: «اختار تفاصيل اخر منتج داخل على السيستم»). Text details only; prices / quantity untouched.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['color', 'product_type', 'capacity', 'size'] LOOP
    EXECUTE format($q$
      WITH latest AS (
        SELECT DISTINCT ON (tenant_id, sku) tenant_id, sku, %1$I AS v
          FROM public.products
         WHERE archived_at IS NULL AND NULLIF(btrim(%1$I), '') IS NOT NULL
         ORDER BY tenant_id, sku, created_at DESC, id DESC)
      UPDATE public.products p SET %1$I = l.v
        FROM latest l
       WHERE p.tenant_id = l.tenant_id AND p.sku = l.sku AND p.archived_at IS NULL
         AND p.%1$I IS DISTINCT FROM l.v
         AND NOT EXISTS (SELECT 1 FROM public.products q                       -- never break the variant index
                          WHERE q.tenant_id = p.tenant_id AND q.branch_id = p.branch_id AND q.id <> p.id AND q.archived_at IS NULL
                            AND lower(btrim(q.name)) = lower(btrim(p.name))
                            AND COALESCE(lower(btrim(q.brand)), '') = COALESCE(lower(btrim(p.brand)), '')
                            AND COALESCE(lower(btrim(q.model)), '') = COALESCE(lower(btrim(p.model)), '')
                            AND COALESCE(lower(btrim(q.color)), '') = COALESCE(lower(btrim(CASE WHEN %1$L = 'color' THEN l.v ELSE p.color END)), '')
                            AND COALESCE(lower(btrim(q.capacity)), '') = COALESCE(lower(btrim(CASE WHEN %1$L = 'capacity' THEN l.v ELSE p.capacity END)), '')
                            AND COALESCE(lower(btrim(q.size)), '') = COALESCE(lower(btrim(CASE WHEN %1$L = 'size' THEN l.v ELSE p.size END)), ''))
    $q$, f);
  END LOOP;
END $$;

-- Data 2: a product missing in a branch of its company is added there with quantity 0, copied from its latest
-- row (same code, details, image and that row's prices, like a new product). Quantity 0 = no stock movement,
-- no batch, no journal entry.
INSERT INTO public.products (tenant_id, branch_id, name, sku, brand, model, color, product_type, capacity, size, image,
                             category_id, cost_price, selling_price, market_price, low_stock_alert, min_stock_level,
                             quantity, is_migrated)
SELECT s.tenant_id, b.id, s.name, s.sku, s.brand, s.model, s.color, s.product_type, s.capacity, s.size, s.image,
       s.category_id, s.cost_price, s.selling_price, s.market_price, s.low_stock_alert, s.min_stock_level,
       0, COALESCE(s.is_migrated, false) OR s.brand IS NULL OR s.model IS NULL
  FROM (SELECT DISTINCT ON (tenant_id, sku) * FROM public.products
         WHERE archived_at IS NULL ORDER BY tenant_id, sku, created_at DESC, id DESC) s
  JOIN public.branches b ON b.tenant_id = s.tenant_id AND NOT COALESCE(b.is_system, false)
 WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.tenant_id = s.tenant_id AND p.branch_id = b.id AND p.sku = s.sku)
   AND NOT EXISTS (SELECT 1 FROM public.products p
                    WHERE p.tenant_id = s.tenant_id AND p.branch_id = b.id AND p.archived_at IS NULL
                      AND lower(btrim(p.name)) = lower(btrim(s.name))
                      AND COALESCE(lower(btrim(p.brand)), '') = COALESCE(lower(btrim(s.brand)), '')
                      AND COALESCE(lower(btrim(p.model)), '') = COALESCE(lower(btrim(s.model)), '')
                      AND COALESCE(lower(btrim(p.color)), '') = COALESCE(lower(btrim(s.color)), '')
                      AND COALESCE(lower(btrim(p.capacity)), '') = COALESCE(lower(btrim(s.capacity)), '')
                      AND COALESCE(lower(btrim(p.size)), '') = COALESCE(lower(btrim(s.size)), ''));
