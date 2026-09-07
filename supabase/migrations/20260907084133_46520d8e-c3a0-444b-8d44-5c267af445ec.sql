-- brands: split ALL policy into non-delete write + owner/admin-only delete
DROP POLICY IF EXISTS "brands_write_tenant" ON public.brands;
CREATE POLICY "brands_insert_tenant" ON public.brands FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "brands_update_tenant" ON public.brands FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "brands_delete_admin" ON public.brands FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND (
    public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  ));

-- colors
DROP POLICY IF EXISTS "colors tenant write" ON public.colors;
CREATE POLICY "colors tenant insert" ON public.colors FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "colors tenant update" ON public.colors FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "colors tenant delete" ON public.colors FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND (
    public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  ));

-- sizes / capacities / product_types: tighten existing delete policies
DROP POLICY IF EXISTS "sizes tenant delete" ON public.sizes;
CREATE POLICY "sizes tenant delete" ON public.sizes FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND (
    public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  ));

DROP POLICY IF EXISTS "capacities tenant delete" ON public.capacities;
CREATE POLICY "capacities tenant delete" ON public.capacities FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND (
    public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  ));

DROP POLICY IF EXISTS "product_types tenant delete" ON public.product_types;
CREATE POLICY "product_types tenant delete" ON public.product_types FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND (
    public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  ));