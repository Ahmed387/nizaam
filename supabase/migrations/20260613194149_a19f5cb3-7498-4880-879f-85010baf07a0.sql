DO $$
DECLARE
  s text;
  old_notifications text;
  new_notifications text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO s
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_reset_branch_data'
  LIMIT 1;

  IF s IS NULL THEN
    RAISE EXCEPTION 'admin_reset_branch_data function not found';
  END IF;

  s := replace(
    s,
    E'\n    DELETE FROM public.payment_installments\n    WHERE payment_plan_id IN (SELECT id FROM public.payment_plans WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches))\n       OR payment_transaction_id IN (SELECT id FROM public.payment_transactions WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));\n',
    E'\n    DELETE FROM public.payment_installments\n    WHERE payment_plan_id IN (SELECT id FROM public.payment_plans WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));\n'
  );

  old_notifications := $old$
  IF COALESCE((p_options->>'notifications')::boolean, false) THEN
    IF p_branch_id IS NULL THEN
      DELETE FROM public.notifications WHERE tenant_id = v_tenant;
    ELSE
      DELETE FROM public.notifications
      WHERE tenant_id = v_tenant
        AND (branch_id = ANY(v_branches)
          OR data->>'branch_id' = ANY(SELECT unnest(v_branches)::text));
    END IF;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('notifications_deleted', v_n);
  END IF;
$old$;

  new_notifications := $new$
  IF COALESCE((p_options->>'notifications')::boolean, false) THEN
    IF p_branch_id IS NULL THEN
      DELETE FROM public.notifications WHERE tenant_id = v_tenant;
    ELSE
      DELETE FROM public.notifications n
      WHERE n.tenant_id = v_tenant
        AND (
          EXISTS (
            SELECT 1 FROM unnest(v_branches) AS b(branch_id)
            WHERE n.link LIKE ('%/branch/' || b.branch_id::text || '/%')
          )
          OR (n.related_entity = 'invoice' AND n.related_entity_id IN (SELECT id FROM public.invoices WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)))
          OR (n.related_entity = 'product' AND n.related_entity_id IN (SELECT id FROM public.products WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)))
          OR (n.related_entity = 'shipment' AND n.related_entity_id IN (SELECT id FROM public.shipments WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)))
          OR (n.related_entity = 'pre_order' AND n.related_entity_id IN (SELECT id FROM public.pre_orders WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)))
          OR (n.related_entity = 'stock_transfer' AND n.related_entity_id IN (SELECT id FROM public.stock_transfers WHERE tenant_id = v_tenant AND (from_branch_id = ANY(v_branches) OR to_branch_id = ANY(v_branches))))
          OR (n.related_entity = 'treasury_transfer' AND n.related_entity_id IN (SELECT id FROM public.treasury_transfers WHERE tenant_id = v_tenant AND (from_branch_id = ANY(v_branches) OR to_branch_id = ANY(v_branches))))
          OR (n.related_entity = 'approval_request' AND n.related_entity_id IN (SELECT id FROM public.approval_requests WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)))
          OR (n.related_entity = 'discount_approval' AND n.related_entity_id IN (SELECT id FROM public.discount_approval_requests WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)))
          OR (n.related_entity = 'payment_installment' AND n.related_entity_id IN (
            SELECT pi.id FROM public.payment_installments pi
            JOIN public.payment_plans pp ON pp.id = pi.payment_plan_id
            WHERE pp.tenant_id = v_tenant AND pp.branch_id = ANY(v_branches)
          ))
        );
    END IF;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('notifications_deleted', v_n);
  END IF;
$new$;

  IF position(old_notifications in s) = 0 THEN
    RAISE EXCEPTION 'notifications block not found for patching';
  END IF;

  s := replace(s, old_notifications, new_notifications);
  EXECUTE s;
END $$;

REVOKE ALL ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) TO service_role;