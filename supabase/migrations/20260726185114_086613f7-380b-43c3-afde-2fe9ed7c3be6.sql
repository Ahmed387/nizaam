
-- ISSUE 1: Realtime for GL
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.journal_entries;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.journal_entry_lines;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

ALTER TABLE public.journal_entries REPLICA IDENTITY FULL;
ALTER TABLE public.journal_entry_lines REPLICA IDENTITY FULL;

-- ISSUE 2: v_supplier_ledger unified view
CREATE OR REPLACE VIEW public.v_supplier_ledger
WITH (security_invoker=true) AS
SELECT
  sp.id,
  sp.contact_id,
  sp.tenant_id,
  sp.branch_id,
  b.name AS branch_name,
  sp.paid_at,
  sp.amount,
  'out'::text AS direction,
  sp.notes,
  p.name AS received_by_name,
  NULL::text AS payment_method,
  NULL::text AS reference_number,
  'supplier_payment'::text AS source
FROM public.supplier_payments sp
LEFT JOIN public.branches b ON b.id = sp.branch_id
LEFT JOIN public.profiles p ON p.id = sp.paid_by

UNION ALL

SELECT
  pt.id,
  pt.contact_id,
  pt.tenant_id,
  pt.branch_id,
  b.name AS branch_name,
  pt.created_at AS paid_at,
  pt.amount,
  pt.direction,
  NULL::text AS notes,
  pt.received_by_name,
  pt.payment_method,
  pt.reference_number,
  'payment_transaction'::text AS source
FROM public.payment_transactions pt
LEFT JOIN public.branches b ON b.id = pt.branch_id
WHERE pt.voided_at IS NULL;

GRANT SELECT ON public.v_supplier_ledger TO authenticated, service_role;
