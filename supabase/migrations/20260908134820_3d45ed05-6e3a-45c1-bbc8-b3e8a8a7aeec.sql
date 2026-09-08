DROP POLICY IF EXISTS "brands_update_tenant" ON public.brands;
DROP POLICY IF EXISTS "colors tenant update" ON public.colors;
DROP POLICY IF EXISTS "sizes tenant update" ON public.sizes;
DROP POLICY IF EXISTS "capacities tenant update" ON public.capacities;
DROP POLICY IF EXISTS "product_types tenant update" ON public.product_types;

CREATE POLICY "brands_update_admin" ON public.brands FOR UPDATE TO authenticated
USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role)))
WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role)));

CREATE POLICY "colors_update_admin" ON public.colors FOR UPDATE TO authenticated
USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role)))
WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role)));

CREATE POLICY "sizes_update_admin" ON public.sizes FOR UPDATE TO authenticated
USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role)))
WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role)));

CREATE POLICY "capacities_update_admin" ON public.capacities FOR UPDATE TO authenticated
USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role)))
WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role)));

CREATE POLICY "product_types_update_admin" ON public.product_types FOR UPDATE TO authenticated
USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role)))
WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role)));