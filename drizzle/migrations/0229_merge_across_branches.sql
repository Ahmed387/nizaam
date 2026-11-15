-- 0229 — «دمج حسابين» across branches, with the kept NAME and BRANCH chosen by the owner
-- (owner 2026-11-15 «لو عاوز ادمج حسابين مختلفين واختار الاسم اللي هيبقي ظاهر بيه وكمان الفرع … ويبقي حساب واحد»,
--  «الدمج يفضل للمالك بس نفذ»).
--
-- merge_contacts(p_from, p_into, p_apply, p_name, p_branch):
--   * the two accounts may be in different branches; every document keeps ITS branch (a سكة invoice stays in سكة's till,
--     reports and balance) — only the account becomes one;
--   * p_name = the name shown after the merge (NULL = the kept account's name), p_branch = the account's branch
--     (NULL = the kept account's branch); the kept account's opening balance stays on ITS branch
--     (opening_branch_id is filled with the old branch before the branch changes);
--   * the check is now PER BRANCH: in every branch, the merged account's customer / supplier balance must equal the two
--     accounts' balances there before, or the merge is refused (the old check compared all branches together only);
--   * unchanged rules: owner only, never archived / «فرع داخلي» / hidden accounts, the account that goes away must have
--     no opening balance, no money / till / stock / journal moves, the old account is archived with merged_into.
-- merge_contact_candidates: an account of another branch can be picked now (can_merge true, own branch still first).

DROP FUNCTION IF EXISTS public.merge_contacts(uuid, uuid, boolean);

CREATE FUNCTION public.merge_contacts(p_from uuid, p_into uuid, p_apply boolean DEFAULT false,
                                      p_name text DEFAULT NULL, p_branch uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t uuid := public.current_tenant_id();
  f public.contacts%ROWTYPE; t public.contacts%ROWTYPE;
  bf record; bt record; af record; br record;
  v_moved jsonb := '{}'::jsonb; v_docs jsonb := '[]'::jsonb; v_ids uuid[]; v_tot numeric; v_res jsonb; v_type text; v_cnt int;
  v_c_before numeric; v_s_before numeric; v_c_after numeric; v_s_after numeric;
  v_name text; v_branch uuid; v_branch_name text;
  v_before jsonb := '{}'::jsonb; v_branches jsonb := '[]'::jsonb; v_ok boolean := true;
  v_cb numeric; v_sb numeric; v_ca numeric; v_sa numeric;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'دمج الحسابات للمالك بس' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_into IS NULL OR p_from = p_into THEN RAISE EXCEPTION 'اختار حسابين مختلفين'; END IF;
  SELECT * INTO f FROM public.contacts WHERE id = p_from AND tenant_id = v_t FOR UPDATE;
  SELECT * INTO t FROM public.contacts WHERE id = p_into AND tenant_id = v_t FOR UPDATE;
  IF f.id IS NULL OR t.id IS NULL THEN RAISE EXCEPTION 'الحساب مش موجود'; END IF;
  IF f.is_archived OR t.is_archived THEN RAISE EXCEPTION 'مينفعش دمج حساب مؤرشف'; END IF;
  IF f.internal_branch_id IS NOT NULL OR t.internal_branch_id IS NOT NULL THEN RAISE EXCEPTION 'حساب الفرع الداخلي مينفعش يتدمج'; END IF;
  IF EXISTS (SELECT 1 FROM public.hidden_contacts h WHERE h.contact_id IN (p_from, p_into)) THEN
    RAISE EXCEPTION 'واحد من الحسابين مخفي — اظهره الأول من «الحسابات المخفية» وبعدين ادمج';
  END IF;
  IF coalesce(f.opening_balance, 0) <> 0 THEN
    RAISE EXCEPTION 'الحساب «%» عليه رصيد افتتاحي (%). خليه هو الحساب الباقي وادمج التاني فيه.', f.name, f.opening_balance;
  END IF;

  v_name := coalesce(nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ''), t.name);
  IF length(v_name) > 200 THEN RAISE EXCEPTION 'الاسم طويل قوي'; END IF;
  v_branch := coalesce(p_branch, t.branch_id);
  IF v_branch IS NOT NULL THEN
    SELECT name INTO v_branch_name FROM public.branches WHERE id = v_branch AND tenant_id = v_t AND NOT coalesce(is_system, false);
    IF v_branch_name IS NULL THEN RAISE EXCEPTION 'الفرع ده مش من فروع الشركة'; END IF;
  END IF;

  SELECT * INTO bf FROM public.contact_side_balances(ARRAY[p_from], NULL);
  SELECT * INTO bt FROM public.contact_side_balances(ARRAY[p_into], NULL);
  v_c_before := coalesce(bf.customer_balance, 0) + coalesce(bt.customer_balance, 0);
  v_s_before := coalesce(bf.supplier_balance, 0) + coalesce(bt.supplier_balance, 0);
  -- every branch's balance of the two accounts BEFORE (each document keeps its branch, so each branch must stay the same)
  FOR br IN SELECT id, name FROM public.branches WHERE tenant_id = v_t ORDER BY is_system, name LOOP
    SELECT coalesce(sum(customer_balance), 0), coalesce(sum(supplier_balance), 0) INTO v_cb, v_sb
      FROM public.contact_side_balances(ARRAY[p_from, p_into], br.id);
    v_before := v_before || jsonb_build_object(br.id::text, jsonb_build_array(v_cb, v_sb));
  END LOOP;

  BEGIN
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

    WITH u AS (UPDATE public.vouchers SET party_id = p_into WHERE party_id = p_from RETURNING id, amount, status)
      SELECT array_agg(id), coalesce(sum(amount) FILTER (WHERE status IS DISTINCT FROM 'cancelled'), 0) INTO v_ids, v_tot FROM u;
    v_moved := v_moved || jsonb_build_object('vouchers', coalesce(to_jsonb(v_ids), '[]'::jsonb));
    v_docs := v_docs || jsonb_build_object('key', 'vouchers', 'label', 'سندات قبض وصرف', 'count', coalesce(array_length(v_ids, 1), 0), 'total', v_tot);
    -- the vouchers carry the account's name as text: the merged account's name from now on
    UPDATE public.vouchers SET party_name = v_name WHERE party_id = p_into AND party_name IN (f.name, t.name) AND party_name IS DISTINCT FROM v_name;

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

    -- the old account goes to the archive FIRST, so the kept one may take its name (the same-name guard skips archived rows)
    UPDATE public.contacts SET is_archived = true, merged_into = p_into,
           notes = concat_ws(E'\n', nullif(notes, ''), 'اتدمج في «' || v_name || '» يوم ' || to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD'))
     WHERE id = p_from;

    v_type := CASE WHEN f.type = t.type THEN t.type ELSE 'both' END;
    UPDATE public.contacts SET type = v_type, name = v_name, branch_id = v_branch,
           -- the kept account's opening balance stays on the branch it was on
           opening_branch_id = CASE WHEN coalesce(opening_balance, 0) <> 0 AND opening_branch_id IS NULL THEN t.branch_id ELSE opening_branch_id END,
           phone = coalesce(nullif(phone, ''), f.phone), address = coalesce(nullif(address, ''), f.address)
     WHERE id = p_into;

    PERFORM public.ledger_sync_contact(p_from);
    PERFORM public.ledger_sync_contact(p_into);
    PERFORM public.recompute_contact_credit(p_from);
    PERFORM public.recompute_contact_credit(p_into);

    SELECT * INTO af FROM public.contact_side_balances(ARRAY[p_into], NULL);
    v_c_after := coalesce(af.customer_balance, 0); v_s_after := coalesce(af.supplier_balance, 0);
    IF abs(v_c_after - v_c_before) >= 0.01 OR abs(v_s_after - v_s_before) >= 0.01 THEN v_ok := false; END IF;

    FOR br IN SELECT id, name FROM public.branches WHERE tenant_id = v_t ORDER BY is_system, name LOOP
      SELECT coalesce(sum(customer_balance), 0), coalesce(sum(supplier_balance), 0) INTO v_ca, v_sa
        FROM public.contact_side_balances(ARRAY[p_into], br.id);
      v_cb := (v_before->br.id::text->>0)::numeric; v_sb := (v_before->br.id::text->>1)::numeric;
      IF abs(v_ca - v_cb) >= 0.01 OR abs(v_sa - v_sb) >= 0.01 THEN v_ok := false; END IF;
      IF abs(v_cb) >= 0.005 OR abs(v_sb) >= 0.005 OR abs(v_ca) >= 0.005 OR abs(v_sa) >= 0.005 THEN
        v_branches := v_branches || jsonb_build_object('branch_id', br.id, 'branch_name', br.name,
          'customer_before', v_cb, 'supplier_before', v_sb, 'customer_after', v_ca, 'supplier_after', v_sa);
      END IF;
    END LOOP;

    v_res := jsonb_build_object(
      'from', jsonb_build_object('id', f.id, 'name', f.name, 'type', f.type, 'branch_id', f.branch_id,
                                 'customer_balance', coalesce(bf.customer_balance, 0), 'supplier_balance', coalesce(bf.supplier_balance, 0)),
      'into', jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type, 'branch_id', t.branch_id,
                                 'customer_balance', coalesce(bt.customer_balance, 0), 'supplier_balance', coalesce(bt.supplier_balance, 0)),
      'after', jsonb_build_object('name', v_name, 'type', v_type, 'branch_id', v_branch, 'branch_name', v_branch_name,
                                  'customer_balance', v_c_after, 'supplier_balance', v_s_after),
      'branches', v_branches,
      'documents', v_docs,
      'balanced', v_ok,
      'difference', jsonb_build_object('customer', round(v_c_after - v_c_before, 2), 'supplier', round(v_s_after - v_s_before, 2)));

    IF NOT p_apply THEN RAISE EXCEPTION USING ERRCODE = 'MRGPV', MESSAGE = v_res::text; END IF;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'الدمج اترفض: رصيد الحساب بعد الدمج مش بيساوي الرصيدين قبله في كل فرع. مفيش حاجة اتغيرت.';
    END IF;

    INSERT INTO public.contact_merges (tenant_id, from_contact_id, into_contact_id, summary, moved, created_by)
    VALUES (v_t, p_from, p_into, v_res, v_moved, auth.uid());
  EXCEPTION WHEN SQLSTATE 'MRGPV' THEN
    RETURN SQLERRM::jsonb || jsonb_build_object('applied', false);
  END;
  RETURN v_res || jsonb_build_object('applied', true);
END
$function$;

REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid, boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid, boolean, text, uuid) TO authenticated;

-- candidates: another branch can be picked now (own branch still listed first)
DO $m$
DECLARE d text; d0 text;
BEGIN
  d := pg_get_functiondef('public.merge_contact_candidates(uuid,text)'::regprocedure);
  d0 := d;
  d := replace(d, '''can_merge'', h.branch_id IS NOT DISTINCT FROM me.branch_id,', '''can_merge'', true,');
  d := replace(d, '''why_not'', CASE WHEN h.branch_id IS DISTINCT FROM me.branch_id THEN ''في فرع تاني — الدمج جوه الفرع الواحد بس'' END', '''why_not'', NULL::text');
  IF d = d0 OR position('''can_merge'', true,' IN d) = 0 OR position('''why_not'', NULL::text' IN d) = 0 THEN
    RAISE EXCEPTION '0229: merge_contact_candidates text not found';
  END IF;
  EXECUTE d;
END
$m$;
