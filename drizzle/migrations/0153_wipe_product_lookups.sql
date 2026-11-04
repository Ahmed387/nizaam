-- 0153: after the go-live wipe (0150 / 0151) the owner also removes the old product look-ups (owner 2026-11-04 «امسح
-- الماركات»: brands, categories, colors, sizes, capacities, product types). The products are already empty (0150), so the
-- only link (products.category_id → categories, ON DELETE SET NULL) is dropped for the TRUNCATE and put back unchanged.
-- Voucher categories (`voucher_categories`) are a different table and stay. New look-ups start from empty.
DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products) THEN
    RAISE EXCEPTION '0153: products are not empty — the look-ups are still in use';
  END IF;
END
$mig$;

ALTER TABLE public.products DROP CONSTRAINT products_category_id_fkey;
TRUNCATE public.brands, public.categories, public.colors, public.sizes, public.capacities, public.product_types;
ALTER TABLE public.products ADD CONSTRAINT products_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;
