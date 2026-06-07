
-- Restore viewer read-only access on sensitive tables
CREATE POLICY viewer_read ON public.employees FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'viewer'::public.app_role));

CREATE POLICY viewer_read ON public.advances FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'viewer'::public.app_role));

CREATE POLICY viewer_read ON public.advance_payments FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'viewer'::public.app_role));

CREATE POLICY viewer_read ON public.advance_requests FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'viewer'::public.app_role));

CREATE POLICY viewer_read ON public.salaries FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'viewer'::public.app_role));
