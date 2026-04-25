
CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS TEXT LANGUAGE SQL VOLATILE SET search_path = public AS $$
  SELECT 'INV-' || EXTRACT(YEAR FROM now())::TEXT || '-' || LPAD(nextval('public.invoice_seq')::TEXT, 5, '0')
$$;

CREATE OR REPLACE FUNCTION public.next_branch_code()
RETURNS TEXT LANGUAGE SQL VOLATILE SET search_path = public AS $$
  SELECT 'FR-' || LPAD(nextval('public.branch_seq')::TEXT, 3, '0')
$$;

CREATE OR REPLACE FUNCTION public.next_sku()
RETURNS TEXT LANGUAGE SQL VOLATILE SET search_path = public AS $$
  SELECT 'SKU-' || nextval('public.sku_seq')::TEXT
$$;

DROP POLICY IF EXISTS "audit_insert" ON public.audit_log;
CREATE POLICY "audit_insert" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
