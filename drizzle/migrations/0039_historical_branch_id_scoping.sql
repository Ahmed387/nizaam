ALTER TABLE public.historical_invoices ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.historical_invoice_items ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.historical_vouchers ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.historical_branch_id_for(p_name text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id FROM public.branches b
  WHERE b.is_system = false AND (
        trim(b.name) = trim(p_name)
     OR (p_name ILIKE '%عبد المنعم%' AND b.name ILIKE '%عبدالمنعم%')
     OR (p_name ILIKE '%شلبي%' AND b.name ILIKE '%شلبى%'))
  ORDER BY (trim(b.name) = trim(p_name)) DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.historical_set_branch_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.branch_id IS NULL AND NEW.branch_name IS NOT NULL THEN
    NEW.branch_id := public.historical_branch_id_for(NEW.branch_name);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_hist_inv_branch BEFORE INSERT OR UPDATE OF branch_name ON public.historical_invoices FOR EACH ROW EXECUTE FUNCTION public.historical_set_branch_id();
CREATE TRIGGER trg_hist_items_branch BEFORE INSERT OR UPDATE OF branch_name ON public.historical_invoice_items FOR EACH ROW EXECUTE FUNCTION public.historical_set_branch_id();
CREATE TRIGGER trg_hist_vch_branch BEFORE INSERT OR UPDATE OF branch_name ON public.historical_vouchers FOR EACH ROW EXECUTE FUNCTION public.historical_set_branch_id();

UPDATE public.historical_invoices SET branch_id = public.historical_branch_id_for(branch_name) WHERE branch_id IS NULL;
UPDATE public.historical_invoice_items SET branch_id = public.historical_branch_id_for(branch_name) WHERE branch_id IS NULL;
UPDATE public.historical_vouchers SET branch_id = public.historical_branch_id_for(branch_name) WHERE branch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_hist_inv_branch ON public.historical_invoices(branch_id);
CREATE INDEX IF NOT EXISTS idx_hist_items_branch ON public.historical_invoice_items(branch_id);
CREATE INDEX IF NOT EXISTS idx_hist_vch_branch ON public.historical_vouchers(branch_id);

CREATE OR REPLACE FUNCTION public.has_central_access(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid
    AND role IN ('admin','owner','super_admin','accountant','viewer','partner'))
$$;

DROP POLICY IF EXISTS hist_select_scoped ON public.historical_invoices;
DROP POLICY IF EXISTS hist_select_scoped ON public.historical_invoice_items;
DROP POLICY IF EXISTS hist_select_scoped ON public.historical_vouchers;
CREATE POLICY hist_select_scoped ON public.historical_invoices FOR SELECT TO authenticated
  USING (public.has_central_access(auth.uid()) OR branch_id IN (SELECT bu.branch_id FROM public.branch_users bu WHERE bu.user_id = auth.uid()));
CREATE POLICY hist_select_scoped ON public.historical_invoice_items FOR SELECT TO authenticated
  USING (public.has_central_access(auth.uid()) OR branch_id IN (SELECT bu.branch_id FROM public.branch_users bu WHERE bu.user_id = auth.uid()));
CREATE POLICY hist_select_scoped ON public.historical_vouchers FOR SELECT TO authenticated
  USING (public.has_central_access(auth.uid()) OR branch_id IN (SELECT bu.branch_id FROM public.branch_users bu WHERE bu.user_id = auth.uid()));
COMMENT ON COLUMN public.historical_invoices.branch_name IS 'Display only; access scoping uses branch_id';