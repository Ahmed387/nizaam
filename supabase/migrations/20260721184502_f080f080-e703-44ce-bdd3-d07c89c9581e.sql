-- Backfill tenant_id from branches where missing
UPDATE public.inventory_reservations r
SET tenant_id = b.tenant_id
FROM public.branches b
WHERE r.branch_id = b.id AND r.tenant_id IS NULL;

-- Ensure tenant auto-set on insert
CREATE OR REPLACE FUNCTION public.inv_reservations_set_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.branches WHERE id = NEW.branch_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_reservations_set_tenant ON public.inventory_reservations;
CREATE TRIGGER trg_inv_reservations_set_tenant
BEFORE INSERT ON public.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION public.inv_reservations_set_tenant();

DROP POLICY IF EXISTS "auth read reservations" ON public.inventory_reservations;
DROP POLICY IF EXISTS "auth insert reservations" ON public.inventory_reservations;
DROP POLICY IF EXISTS "auth update reservations" ON public.inventory_reservations;
DROP POLICY IF EXISTS "auth delete reservations" ON public.inventory_reservations;

CREATE POLICY "tenant read reservations"
ON public.inventory_reservations FOR SELECT
TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND public.user_in_branch(auth.uid(), branch_id)
);

CREATE POLICY "tenant insert reservations"
ON public.inventory_reservations FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.user_in_branch(auth.uid(), branch_id)
);

CREATE POLICY "tenant update reservations"
ON public.inventory_reservations FOR UPDATE
TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND public.user_in_branch(auth.uid(), branch_id)
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.user_in_branch(auth.uid(), branch_id)
);

CREATE POLICY "tenant delete reservations"
ON public.inventory_reservations FOR DELETE
TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND public.user_in_branch(auth.uid(), branch_id)
);