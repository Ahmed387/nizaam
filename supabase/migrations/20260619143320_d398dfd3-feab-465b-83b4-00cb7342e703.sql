CREATE POLICY prod_read_via_transfer ON public.products
FOR SELECT
USING (
  tenant_id = current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM public.stock_transfers st
    WHERE st.product_id = products.id
      AND (
        public.user_in_branch(auth.uid(), st.from_branch_id)
        OR public.user_in_branch(auth.uid(), st.to_branch_id)
      )
  )
);