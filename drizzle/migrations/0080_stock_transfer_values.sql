-- 0080 — Value of stock transfers (owner request): every transfer is valued at the SENDER's moving average
-- at the moment it left (the same cost the receiving branch books it at, 0071).
--   sent_value     = quantity sent × unit cost
--   received_value = quantity received × unit cost (confirmed transfers; a partial confirm sends the rest back)
--   rejected_value = quantity sent × unit cost (rejected transfers; all of it went back)
-- Read-only; the caller's company, branch staff only transfers of their branches.

CREATE OR REPLACE FUNCTION public.stock_transfer_values(p_ids uuid[])
RETURNS TABLE(transfer_id uuid, unit_cost numeric, sent_value numeric, received_value numeric, rejected_value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_tenant uuid; v_uid uuid := auth.uid(); v_all boolean;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF COALESCE(cardinality(p_ids), 0) > 2000 THEN RAISE EXCEPTION 'عدد تحويلات كبير في طلب واحد (الحد 2000)'; END IF;
  v_all := public.is_admin(v_uid) OR public.is_super_admin(v_uid);
  RETURN QUERY
  WITH t AS (
    SELECT st.id, st.product_id, st.status, st.quantity::numeric AS q, coalesce(st.received_quantity, st.quantity)::numeric AS rq,
           (coalesce(st.transfer_date, (st.created_at AT TIME ZONE 'Africa/Cairo')::date) + time '12:00') AT TIME ZONE 'Africa/Cairo' AS at
      FROM stock_transfers st
     WHERE st.id = ANY (p_ids) AND st.tenant_id = v_tenant
       AND (v_all OR st.from_branch_id = ANY ((SELECT public.my_branch_ids())::uuid[])
                  OR st.to_branch_id = ANY ((SELECT public.my_branch_ids())::uuid[]))
  ),
  c AS (SELECT t.*, public.product_avg_cost(t.product_id, t.at - interval '1 microsecond') AS uc FROM t)
  SELECT c.id, round(c.uc, 2), round(c.q * c.uc, 2),
         CASE WHEN c.status = 'confirmed' THEN round(c.rq * c.uc, 2) ELSE 0 END,
         CASE WHEN c.status = 'rejected' THEN round(c.q * c.uc, 2) ELSE 0 END
    FROM c;
END $$;
REVOKE ALL ON FUNCTION public.stock_transfer_values(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_transfer_values(uuid[]) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('stock_transfer_values', '0080', 'read: value of stock transfers at the sender''s moving average')
ON CONFLICT DO NOTHING;
