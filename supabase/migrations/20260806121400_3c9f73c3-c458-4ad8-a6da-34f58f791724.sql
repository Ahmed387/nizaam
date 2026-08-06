CREATE OR REPLACE FUNCTION public.purge_orphan_journal_entries(p_tenant uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_tenant IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.journal_entries j
  WHERE j.tenant_id = p_tenant
    AND (
      (j.source_type IN ('invoice','invoice_cogs')
        AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = j.source_id))
      OR (j.source_type = 'invoice_payment'
        AND NOT EXISTS (SELECT 1 FROM public.invoice_payments p WHERE p.id = j.source_id))
      OR (j.source_type = 'shipment'
        AND NOT EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = j.source_id))
      OR (j.source_type IN ('voucher','voucher_reversal')
        AND NOT EXISTS (SELECT 1 FROM public.vouchers v WHERE v.id = j.source_id))
      OR (j.source_type = 'return'
        AND NOT EXISTS (SELECT 1 FROM public.returns r WHERE r.id = j.source_id))
      OR (j.source_type = 'purchase_return'
        AND NOT EXISTS (SELECT 1 FROM public.purchase_returns pr WHERE pr.id = j.source_id))
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_orphan_journal_entries(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_orphan_journal_entries(uuid) TO authenticated, service_role;

ALTER FUNCTION public.admin_reset_branch_data(uuid, jsonb) RENAME TO admin_reset_branch_data_impl;

CREATE OR REPLACE FUNCTION public.admin_reset_branch_data(p_branch_id uuid, p_options jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_summary jsonb;
  v_tenant uuid := public.current_tenant_id();
  v_purged integer := 0;
BEGIN
  v_summary := public.admin_reset_branch_data_impl(p_branch_id, p_options);
  v_purged := public.purge_orphan_journal_entries(v_tenant);
  RETURN COALESCE(v_summary, '{}'::jsonb) || jsonb_build_object('journal_entries_purged', v_purged);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_reset_branch_data_impl(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_branch_data_impl(uuid, jsonb) TO service_role;