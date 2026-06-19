
-- Cleanup temp diagnostic functions
DROP FUNCTION IF EXISTS public._whoami_invoker();
DROP FUNCTION IF EXISTS public._whoami_definer();

-- Root-level structural protection on products.quantity
CREATE OR REPLACE FUNCTION public.guard_products_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    -- Allow only when running inside a SECURITY DEFINER function owned by postgres.
    -- Direct client API calls run as anon/authenticated/service_role → blocked.
    IF current_user = 'postgres' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'لا يمكن تعديل الكمية مباشرة — يجب أن تمر العملية عبر نظام الدفعات (FIFO)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_quantity_guard ON public.products;
CREATE TRIGGER products_quantity_guard
BEFORE UPDATE OF quantity ON public.products
FOR EACH ROW EXECUTE FUNCTION public.guard_products_quantity();

COMMENT ON FUNCTION public.guard_products_quantity() IS
'Structural guard: blocks any direct UPDATE of products.quantity from API clients (anon/authenticated/service_role). Only SECURITY DEFINER functions owned by postgres can mutate quantity, ensuring all changes go through batch-aware (FIFO) mechanisms.';
