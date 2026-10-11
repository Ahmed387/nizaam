-- 0079 — Owner cards on the sale / purchase screens: «نقدي» (fully paid today) vs «آجل» (still open
-- today), each split by HOW it was paid (cash / InstaPay / wallet / bank) — from the unified ledger.
--
-- ledger_document_paid_by_method(doc_type, ids): one row per document and payment method with the money
-- the ledger allocated to it (every movement that settled it: payment at sale, collection from the
-- contact file, plan instalment, deposit used FIFO …). Return credit comes as method 'return_credit'
-- (not money). Same access rule as ledger_document_status: the caller's company, and branch staff only
-- their branches. Read-only.

CREATE OR REPLACE FUNCTION public.ledger_document_paid_by_method(p_doc_type text, p_ids uuid[])
RETURNS TABLE(doc_id uuid, method text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_tenant uuid; v_uid uuid := auth.uid(); v_all boolean;
BEGIN
  IF p_doc_type NOT IN ('invoice', 'shipment') THEN RAISE EXCEPTION 'نوع المستند غير صحيح'; END IF;
  v_tenant := public.assert_company_access(NULL);
  IF COALESCE(cardinality(p_ids), 0) > 5000 THEN RAISE EXCEPTION 'عدد مستندات كبير في طلب واحد (الحد 5000)'; END IF;
  v_all := public.is_admin(v_uid) OR public.is_super_admin(v_uid);
  RETURN QUERY
  WITH docs AS (
    SELECT i.id, i.tenant_id, i.branch_id FROM invoices i WHERE p_doc_type = 'invoice' AND i.id = ANY (p_ids)
    UNION ALL
    SELECT s.id, s.tenant_id, s.branch_id FROM shipments s WHERE p_doc_type = 'shipment' AND s.id = ANY (p_ids)
  ),
  ok AS (SELECT docs.id FROM docs WHERE docs.tenant_id = v_tenant AND (v_all OR docs.branch_id = ANY ((SELECT public.my_branch_ids())::uuid[])))
  SELECT pa.debt_id,
         CASE WHEN mv.kind = 'return_credit' THEN 'return_credit' ELSE COALESCE(mv.method, 'cash') END,
         round(sum(pa.amount), 2)
    FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
   WHERE pa.status = 'active' AND pa.debt_type = p_doc_type AND pa.debt_id IN (SELECT ok.id FROM ok)
   GROUP BY 1, 2;
END $$;

REVOKE ALL ON FUNCTION public.ledger_document_paid_by_method(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_document_paid_by_method(text, uuid[]) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('ledger_document_paid_by_method', '0079', 'read: money allocated to sale / purchase invoices, by payment method')
ON CONFLICT DO NOTHING;
