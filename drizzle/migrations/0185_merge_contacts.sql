-- 0185: owner 2026-11-10 «دمج بين حسابين: المالك يختار الحسابين … ويظهر بعد الدمج ايه اللي هيحصل … نفذ».
-- `merge_contacts(p_from, p_into, p_apply)` — owner only. Every document of the account that goes away (p_from) is repointed
-- to the account that stays (p_into): invoices, shipments, purchase returns, prior-year returns, vouchers (party), payment
-- transactions, supplier payments, quotes, pre-orders, settlements, credit log. The ledger of both is then rebuilt from the
-- documents (`ledger_sync_contact`), the old account is archived with `merged_into` (never deleted) and one row is written to
-- `contact_merges` with the ids that moved (so a merge can be traced and undone by hand).
-- The PREVIEW (p_apply = false) runs the very same steps inside a sub-transaction and rolls it back, so what the owner sees
-- is exactly what «تأكيد» does. No money moves: tills, stock, profit and the journal are not touched; the balance of the kept
-- account after = the two balances before (checked per side; a difference refuses the merge).
-- Refused: same account, another tenant, archived, a branch's own account (internal_branch_id), two different branches,
-- and an account that goes away carrying an opening balance (the owner keeps THAT one instead).
-- Dry-run on شلبى «منتجات شركة فريش (بوتاجاز…)» → «شركة فريش (بوتاجاز…)»: 3 shipments (295,643.64) + 2 purchase returns move;
-- supplier balance 274,239.64 and −241,508.20 before → 32,731.44 after.
CREATE TABLE IF NOT EXISTS public.contact_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  from_contact_id uuid NOT NULL REFERENCES public.contacts(id),
  into_contact_id uuid NOT NULL REFERENCES public.contacts(id),
  summary jsonb NOT NULL,
  moved jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contact_merges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_merges FROM anon, authenticated;
GRANT SELECT ON public.contact_merges TO authenticated;
DROP POLICY IF EXISTS cm_read ON public.contact_merges;
CREATE POLICY cm_read ON public.contact_merges FOR SELECT USING (
  (SELECT public.is_super_admin((SELECT auth.uid())))
  OR (tenant_id = (SELECT public.current_tenant_id()) AND ((SELECT public.is_admin((SELECT auth.uid()))) OR (SELECT public.is_owner((SELECT auth.uid()))))));

CREATE OR REPLACE FUNCTION public.merge_contacts(p_from uuid, p_into uuid, p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_t uuid := public.current_tenant_id();
  f public.contacts%ROWTYPE; t public.contacts%ROWTYPE;
  bf record; bt record; af record;
  v_moved jsonb := '{}'::jsonb; v_docs jsonb := '[]'::jsonb; v_ids uuid[]; v_tot numeric; v_res jsonb; v_type text; v_cnt int;
  v_c_before numeric; v_s_before numeric; v_c_after numeric; v_s_after numeric;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'دمج الحسابات للمالك بس' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_into IS NULL OR p_from = p_into THEN RAISE EXCEPTION 'اختار حسابين مختلفين'; END IF;
  SELECT * INTO f FROM public.contacts WHERE id = p_from AND tenant_id = v_t FOR UPDATE;
  SELECT * INTO t FROM public.contacts WHERE id = p_into AND tenant_id = v_t FOR UPDATE;
  IF f.id IS NULL OR t.id IS NULL THEN RAISE EXCEPTION 'الحساب مش موجود'; END IF;
  IF f.is_archived OR t.is_archived THEN RAISE EXCEPTION 'مينفعش دمج حساب مؤرشف'; END IF;
  IF f.internal_branch_id IS NOT NULL OR t.internal_branch_id IS NOT NULL THEN RAISE EXCEPTION 'حساب الفرع الداخلي مينفعش يتدمج'; END IF;
  IF f.branch_id IS DISTINCT FROM t.branch_id THEN RAISE EXCEPTION 'الحسابين في فرعين مختلفين — الدمج جوه الفرع الواحد بس'; END IF;
  IF coalesce(f.opening_balance, 0) <> 0 THEN
    RAISE EXCEPTION 'الحساب «%» عليه رصيد افتتاحي (%). خليه هو الحساب الباقي وادمج التاني فيه.', f.name, f.opening_balance;
  END IF;

  SELECT * INTO bf FROM public.contact_side_balances(ARRAY[p_from], NULL);
  SELECT * INTO bt FROM public.contact_side_balances(ARRAY[p_into], NULL);
  v_c_before := coalesce(bf.customer_balance, 0) + coalesce(bt.customer_balance, 0);
  v_s_before := coalesce(bf.supplier_balance, 0) + coalesce(bt.supplier_balance, 0);

  BEGIN  -- sub-transaction: rolled back for the preview
    WITH u AS (UPDATE public.invoices SET contact_id = p_into WHERE contact_id = p_from RETURNING id, total, status)
      SELECT array_agg(id), coalesce(sum(total) FILTER (WHERE status = 'active'), 0) INTO v_ids, v_tot FROM u;
    v_moved := v_moved || jsonb_build_object('invoices', coalesce(to_jsonb(v_ids), '[]'::jsonb));
    v_docs := v_docs || jsonb_build_object('key', 'invoices', 'label', 'فواتير بيع', 'count', coalesce(array_length(v_ids, 1), 0), 'total', v_tot);

    WITH u AS (UPDATE public.shipments SET contact_id = p_into WHERE contact_id = p_from RETURNING id, total_cost, status)
      SELECT array_agg(id), coalesce(sum(total_cost) FILTER (WHERE status = 'active'), 0) INTO v_ids, v_tot FROM u;
    v_moved := v_moved || jsonb_build_object('shipments', coalesce(to_jsonb(v_ids), '[]'::jsonb));
    v_docs := v_docs || jsonb_build_object('key', 'shipments', 'label', 'فواتير شراء', 'count', coalesce(array_length(v_ids, 1), 0), 'total', v_tot);

    WITH u AS (UPDATE public.purchase_returns SET contact_id = p_into WHERE contact_id = p_from RETURNING id, total_amount, status)
      SELECT array_agg(id), coalesce(sum(total_amount) FILTER (WHERE status = 'active'), 0) INTO v_ids, v_tot FROM u;
    v_moved := v_moved || jsonb_build_object('purchase_returns', coalesce(to_jsonb(v_ids), '[]'::jsonb));
    v_docs := v_docs || jsonb_build_object('key', 'purchase_returns', 'label', 'مرتجعات شراء', 'count', coalesce(array_length(v_ids, 1), 0), 'total', v_tot);

    SELECT count(*), coalesce(sum(r.total_refund), 0) INTO v_cnt, v_tot FROM public.returns r
     WHERE r.status = 'active' AND r.invoice_id IN (SELECT (jsonb_array_elements_text(v_moved->'invoices'))::uuid);
    v_docs := v_docs || jsonb_build_object('key', 'returns', 'label', 'مرتجعات بيع (بتتنقل مع فواتيرها)', 'count', v_cnt, 'total', v_tot);

    WITH u AS (UPDATE public.prior_year_returns SET contact_id = p_into WHERE contact_id = p_from RETURNING id, total_price)
      SELECT array_agg(id), coalesce(sum(total_price), 0) INTO v_ids, v_tot FROM u;
    v_moved := v_moved || jsonb_build_object('prior_year_returns', coalesce(to_jsonb(v_ids), '[]'::jsonb));
    v_docs := v_docs || jsonb_build_object('key', 'prior_year_returns', 'label', 'مرتجعات فواتير سنين فاتت', 'count', coalesce(array_length(v_ids, 1), 0), 'total', v_tot);

    WITH u AS (UPDATE public.vouchers SET party_id = p_into, party_name = CASE WHEN party_name = f.name THEN t.name ELSE party_name END WHERE party_id = p_from RETURNING id, amount, status)
      SELECT array_agg(id), coalesce(sum(amount) FILTER (WHERE status IS DISTINCT FROM 'cancelled'), 0) INTO v_ids, v_tot FROM u;
    v_moved := v_moved || jsonb_build_object('vouchers', coalesce(to_jsonb(v_ids), '[]'::jsonb));
    v_docs := v_docs || jsonb_build_object('key', 'vouchers', 'label', 'سندات قبض وصرف', 'count', coalesce(array_length(v_ids, 1), 0), 'total', v_tot);

    WITH u AS (UPDATE public.payment_transactions SET contact_id = p_into WHERE contact_id = p_from RETURNING id, amount)
      SELECT array_agg(id), coalesce(sum(amount), 0) INTO v_ids, v_tot FROM u;
    v_moved := v_moved || jsonb_build_object('payment_transactions', coalesce(to_jsonb(v_ids), '[]'::jsonb));
    v_docs := v_docs || jsonb_build_object('key', 'payment_transactions', 'label', 'دفعات على الحساب', 'count', coalesce(array_length(v_ids, 1), 0), 'total', v_tot);

    WITH u AS (UPDATE public.supplier_payments SET contact_id = p_into WHERE contact_id = p_from RETURNING id, amount)
      SELECT array_agg(id), coalesce(sum(amount), 0) INTO v_ids, v_tot FROM u;
    v_moved := v_moved || jsonb_build_object('supplier_payments', coalesce(to_jsonb(v_ids), '[]'::jsonb));
    v_docs := v_docs || jsonb_build_object('key', 'supplier_payments', 'label', 'سداد موردين', 'count', coalesce(array_length(v_ids, 1), 0), 'total', v_tot);

    WITH u AS (UPDATE public.contact_settlements SET contact_id = p_into WHERE contact_id = p_from RETURNING id, amount, status)
      SELECT array_agg(id), coalesce(sum(amount) FILTER (WHERE status IS DISTINCT FROM 'cancelled'), 0) INTO v_ids, v_tot FROM u;
    v_moved := v_moved || jsonb_build_object('contact_settlements', coalesce(to_jsonb(v_ids), '[]'::jsonb));
    v_docs := v_docs || jsonb_build_object('key', 'contact_settlements', 'label', 'تسويات بدون فلوس', 'count', coalesce(array_length(v_ids, 1), 0), 'total', v_tot);

    WITH u AS (UPDATE public.quotes SET contact_id = p_into WHERE contact_id = p_from RETURNING id)
      SELECT array_agg(id) INTO v_ids FROM u;
    v_moved := v_moved || jsonb_build_object('quotes', coalesce(to_jsonb(v_ids), '[]'::jsonb));
    v_docs := v_docs || jsonb_build_object('key', 'quotes', 'label', 'عروض أسعار', 'count', coalesce(array_length(v_ids, 1), 0), 'total', NULL);

    WITH u AS (UPDATE public.pre_orders SET contact_id = p_into WHERE contact_id = p_from RETURNING id)
      SELECT array_agg(id) INTO v_ids FROM u;
    v_moved := v_moved || jsonb_build_object('pre_orders', coalesce(to_jsonb(v_ids), '[]'::jsonb));
    v_docs := v_docs || jsonb_build_object('key', 'pre_orders', 'label', 'حجوزات', 'count', coalesce(array_length(v_ids, 1), 0), 'total', NULL);

    WITH u AS (UPDATE public.customer_credit_log SET contact_id = p_into WHERE contact_id = p_from RETURNING id)
      SELECT array_agg(id) INTO v_ids FROM u;
    v_moved := v_moved || jsonb_build_object('customer_credit_log', coalesce(to_jsonb(v_ids), '[]'::jsonb));

    v_type := CASE WHEN f.type = t.type THEN t.type ELSE 'both' END;
    UPDATE public.contacts SET type = v_type,
           phone = coalesce(nullif(phone, ''), f.phone), address = coalesce(nullif(address, ''), f.address)
     WHERE id = p_into;

    PERFORM public.ledger_sync_contact(p_from);
    PERFORM public.ledger_sync_contact(p_into);
    PERFORM public.recompute_contact_credit(p_from);
    PERFORM public.recompute_contact_credit(p_into);

    SELECT * INTO af FROM public.contact_side_balances(ARRAY[p_into], NULL);
    v_c_after := coalesce(af.customer_balance, 0); v_s_after := coalesce(af.supplier_balance, 0);

    v_res := jsonb_build_object(
      'from', jsonb_build_object('id', f.id, 'name', f.name, 'type', f.type, 'customer_balance', coalesce(bf.customer_balance, 0), 'supplier_balance', coalesce(bf.supplier_balance, 0)),
      'into', jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type, 'customer_balance', coalesce(bt.customer_balance, 0), 'supplier_balance', coalesce(bt.supplier_balance, 0)),
      'after', jsonb_build_object('name', t.name, 'type', v_type, 'customer_balance', v_c_after, 'supplier_balance', v_s_after),
      'documents', v_docs,
      'balanced', (abs(v_c_after - v_c_before) < 0.01 AND abs(v_s_after - v_s_before) < 0.01),
      'difference', jsonb_build_object('customer', round(v_c_after - v_c_before, 2), 'supplier', round(v_s_after - v_s_before, 2)));

    IF NOT p_apply THEN RAISE EXCEPTION USING ERRCODE = 'MRGPV', MESSAGE = v_res::text; END IF;
    IF NOT (v_res->>'balanced')::boolean THEN
      RAISE EXCEPTION 'الدمج اترفض: رصيد الحساب بعد الدمج مش بيساوي الرصيدين قبله (فرق عميل %، مورد %). مفيش حاجة اتغيرت.', v_res->'difference'->>'customer', v_res->'difference'->>'supplier';
    END IF;

    UPDATE public.contacts SET is_archived = true, merged_into = p_into,
           notes = concat_ws(E'\n', nullif(notes, ''), 'اتدمج في «' || t.name || '» يوم ' || to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD'))
     WHERE id = p_from;
    INSERT INTO public.contact_merges (tenant_id, from_contact_id, into_contact_id, summary, moved, created_by)
    VALUES (v_t, p_from, p_into, v_res, v_moved, auth.uid());
  EXCEPTION WHEN SQLSTATE 'MRGPV' THEN
    RETURN SQLERRM::jsonb || jsonb_build_object('applied', false);
  END;
  RETURN v_res || jsonb_build_object('applied', true);
END
$fn$;

REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid, boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
