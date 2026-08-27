CREATE OR REPLACE FUNCTION public.is_viewer(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user_id, 'viewer'::app_role)
$function$;

CREATE POLICY "viewer_read" ON public.equity_partners FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.partner_transactions FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.partner_advances FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.partner_advance_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.partner_advances pa WHERE pa.id = partner_advance_payments.advance_id AND pa.tenant_id = current_tenant_id()) AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.partner_advance_installments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.partner_advances pa WHERE pa.id = partner_advance_installments.advance_id AND pa.tenant_id = current_tenant_id()) AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.partner_share_history FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.profit_distributions FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.profit_distribution_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profit_distributions pd WHERE pd.id = profit_distribution_lines.distribution_id AND pd.tenant_id = current_tenant_id()) AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.cashier_shifts FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.bank_accounts FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.budgets FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.fixed_assets FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.depreciation_entries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.fixed_assets fa WHERE fa.id = depreciation_entries.asset_id AND fa.tenant_id = current_tenant_id()) AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.fiscal_periods FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.audit_log FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.inventory_reservations FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.profiles FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.user_roles FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.branch_users FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));

CREATE POLICY "viewer_read" ON public.approval_requests FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND is_viewer(auth.uid()));