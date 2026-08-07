
-- 1) tenant auto-fill
ALTER TABLE public.categories ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
UPDATE public.categories SET tenant_id = public.current_tenant_id() WHERE tenant_id IS NULL;
ALTER TABLE public.categories ALTER COLUMN tenant_id SET NOT NULL;

-- 2) ordering
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- 3) no duplicate names under same parent
CREATE UNIQUE INDEX IF NOT EXISTS categories_unique_name_per_parent
  ON public.categories (tenant_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- 4) parent FK must restrict deletes when children exist
DO $$
DECLARE fk text;
BEGIN
  SELECT conname INTO fk FROM pg_constraint
   WHERE conrelid = 'public.categories'::regclass AND contype = 'f'
     AND confrelid = 'public.categories'::regclass;
  IF fk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.categories DROP CONSTRAINT %I', fk);
  END IF;
END $$;

ALTER TABLE public.categories
  ADD CONSTRAINT categories_parent_fk FOREIGN KEY (parent_id)
  REFERENCES public.categories(id) ON DELETE RESTRICT;

-- 5) guards: max 2 levels + clear delete error
CREATE OR REPLACE FUNCTION public.categories_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE has_kids boolean; has_prods boolean; grandparent uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT EXISTS(SELECT 1 FROM public.categories WHERE parent_id = OLD.id) INTO has_kids;
    IF has_kids THEN
      RAISE EXCEPTION 'مينفعش تمسح التصنيف "%" لأن تحته تصنيفات فرعية — امسح الفرعية الأول', OLD.name;
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.products WHERE category_id = OLD.id) INTO has_prods;
    IF has_prods THEN
      RAISE EXCEPTION 'مينفعش تمسح التصنيف "%" لأن فيه منتجات مربوطة بيه', OLD.name;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'التصنيف مينفعش يكون أب لنفسه';
    END IF;
    SELECT parent_id INTO grandparent FROM public.categories WHERE id = NEW.parent_id;
    IF grandparent IS NOT NULL THEN
      RAISE EXCEPTION 'الشجرة مستويين بس: تصنيف رئيسي وتحته تصنيفات فرعية';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id AND NEW.parent_id IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.categories WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'مينفعش تنقل تصنيف رئيسي تحت تصنيف تاني وهو لسه تحته تصنيفات فرعية';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_guard ON public.categories;
CREATE TRIGGER trg_categories_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.categories_guard();
