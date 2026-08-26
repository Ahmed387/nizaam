CREATE POLICY "ep_partner_read_tenant_shares"
ON public.equity_partners
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.partner_users pu
    WHERE pu.user_id = auth.uid()
      AND pu.tenant_id = equity_partners.tenant_id
  )
);