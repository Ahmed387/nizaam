-- 1) منع تكرار نفس المنتج بنفس الخصائص داخل نفس الفرع
CREATE UNIQUE INDEX IF NOT EXISTS products_variant_uniq
ON public.products (
  tenant_id,
  branch_id,
  lower(btrim(name)),
  coalesce(lower(btrim(brand)), ''),
  coalesce(lower(btrim(model)), ''),
  coalesce(lower(btrim(color)), ''),
  coalesce(lower(btrim(capacity)), ''),
  coalesce(lower(btrim(size)), '')
)
WHERE archived_at IS NULL;

-- 2) إلزام الماركة والموديل عند إضافة منتج جديد
CREATE OR REPLACE FUNCTION public.enforce_product_variant_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.brand := nullif(btrim(NEW.brand), '');
  NEW.model := nullif(btrim(NEW.model), '');
  NEW.color := nullif(btrim(NEW.color), '');
  NEW.capacity := nullif(btrim(NEW.capacity), '');
  NEW.size := nullif(btrim(NEW.size), '');

  IF TG_OP = 'INSERT' AND COALESCE(NEW.is_migrated, false) = false THEN
    IF NEW.brand IS NULL THEN
      RAISE EXCEPTION 'يجب إدخال الماركة للمنتج الجديد (%)', NEW.name
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.model IS NULL THEN
      RAISE EXCEPTION 'يجب إدخال الموديل للمنتج الجديد (%)', NEW.name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_product_variant_fields ON public.products;
CREATE TRIGGER trg_enforce_product_variant_fields
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.enforce_product_variant_fields();