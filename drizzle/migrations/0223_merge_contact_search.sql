-- 0223 — search of «دمج حسابين» (owner 2026-11-15 «البحث فى دمج الحسابات مش متظبط», answer «ب»: the merge stays inside ONE
-- branch). The dialog used a raw ILIKE on the name inside the account's branch: «نقابه» found nothing because the name is
-- written «نقابة», words had to come in the same order, and the result showed only a name. Example: «النقابة المعلمين»
-- (سكة) and «نقابة المعلمين» (عبدالمنعم) — the second never showed.
--   merge_contact_candidates(p_contact, p_query) — owner only (merging is owner only), read only:
--     * with a query: every word in any order over name + phone + account number, written the system's way
--       (normalize_search_text: ة = ه, ى = ي, أ / إ / آ = ا, Arabic digits);
--     * without a query: accounts whose name shares a word with this one («ال» ignored, common words like شركة / معرض /
--       الحاج / محمد skipped), most shared words first;
--     * every branch: the account's own branch first; another branch is listed with can_merge = false and the reason
--       (merge_contacts keeps refusing it — rule «ب»); archived accounts, branch-internal accounts and the account itself
--       are never listed;
--     * each hit: account number, branch, type, phone, balance (customer side − supplier side, the screen shows مدين / دائن),
--       documents count, opening balance, can_merge / why_not.
CREATE OR REPLACE FUNCTION public.merge_contact_candidates(p_contact uuid, p_query text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t uuid := public.current_tenant_id();
  me public.contacts%ROWTYPE;
  v_toks text[];
  v_words text[];
  v_stop text[] := ARRAY['شركه','شركات','معرض','مؤسسه','موسسه','مكتب','محل','مخزن','الحاج','حاج','الحاجه','محمد','احمد',
                         'محمود','مصطفي','علي','عبد','ابو','ام','للتجاره','تجاره','والتوزيع','للاجهزه','مصر','فرع','حساب',
                         'خاص','الاستاذ','استاذ','الدكتور','دكتور','المهندس','مهندس'];
  v_res jsonb;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'دمج الحسابات للمالك بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO me FROM public.contacts WHERE id = p_contact AND tenant_id = v_t;
  IF me.id IS NULL THEN RAISE EXCEPTION 'الحساب مش موجود'; END IF;

  v_toks := array_remove(regexp_split_to_array(public.normalize_search_text(btrim(coalesce(p_query, ''))), '\s+'), '');
  -- words of this account's name for the «similar names» list: «ال» removed, short / common words skipped
  SELECT coalesce(array_agg(DISTINCT w), '{}') INTO v_words FROM (
    SELECT regexp_replace(x, '^ال', '') AS w
      FROM unnest(regexp_split_to_array(public.normalize_search_text(me.name), '\s+')) x
  ) z WHERE length(w) >= 3 AND w <> ALL (v_stop) AND regexp_replace(w, '^ال', '') <> ALL (v_stop);

  WITH pool AS (
    SELECT c.id, c.name, c.account_no, c.phone, c.type::text AS type, c.branch_id, c.opening_balance,
           public.normalize_search_text(coalesce(c.name, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.account_no::text, '')
                                        || ' ' || coalesce(c.contact_person, '')) AS hay,
           ARRAY(SELECT regexp_replace(x, '^ال', '') FROM unnest(regexp_split_to_array(public.normalize_search_text(c.name), '\s+')) x) AS cw
      FROM public.contacts c
     WHERE c.tenant_id = v_t AND c.id <> me.id AND NOT coalesce(c.is_archived, false) AND c.internal_branch_id IS NULL
       AND c.merged_into IS NULL
  ), hits AS (
    SELECT p.*,
           (SELECT count(*) FROM unnest(v_words) w WHERE w = ANY (p.cw)) AS shared
      FROM pool p
     WHERE CASE WHEN cardinality(v_toks) > 0
                THEN NOT EXISTS (SELECT 1 FROM unnest(v_toks) tk WHERE p.hay NOT LIKE '%' || tk || '%')
                ELSE cardinality(v_words) > 0 AND EXISTS (SELECT 1 FROM unnest(v_words) w WHERE w = ANY (p.cw)) END
     ORDER BY (p.branch_id IS NOT DISTINCT FROM me.branch_id) DESC,
              CASE WHEN cardinality(v_toks) > 0 THEN 0 ELSE -(SELECT count(*) FROM unnest(v_words) w WHERE w = ANY (p.cw)) END,
              p.name, p.id
     LIMIT 30
  ), bal AS (
    SELECT b.contact_id, coalesce(b.customer_balance, 0) AS cb, coalesce(b.supplier_balance, 0) AS sb
      FROM public.contact_side_balances((SELECT array_agg(id) FROM hits), NULL) b
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', h.id, 'name', h.name, 'account_no', h.account_no, 'phone', h.phone, 'type', h.type,
           'branch_id', h.branch_id, 'branch_name', br.name, 'same_branch', h.branch_id IS NOT DISTINCT FROM me.branch_id,
           'customer_balance', coalesce(bal.cb, 0), 'supplier_balance', coalesce(bal.sb, 0),
           'net', round(coalesce(bal.cb, 0) - coalesce(bal.sb, 0), 2),
           'opening_balance', coalesce(h.opening_balance, 0), 'shared_words', h.shared,
           'documents', (SELECT count(*) FROM public.invoices i WHERE i.contact_id = h.id)
                      + (SELECT count(*) FROM public.shipments s WHERE s.contact_id = h.id)
                      + (SELECT count(*) FROM public.purchase_returns pr WHERE pr.contact_id = h.id)
                      + (SELECT count(*) FROM public.vouchers v WHERE v.party_id = h.id),
           'can_merge', h.branch_id IS NOT DISTINCT FROM me.branch_id,
           'why_not', CASE WHEN h.branch_id IS DISTINCT FROM me.branch_id THEN 'في فرع تاني — الدمج جوه الفرع الواحد بس' END
         ) ORDER BY (h.branch_id IS NOT DISTINCT FROM me.branch_id) DESC, h.shared DESC, h.name, h.id), '[]'::jsonb)
    INTO v_res
    FROM hits h
    LEFT JOIN bal ON bal.contact_id = h.id
    LEFT JOIN public.branches br ON br.id = h.branch_id;

  RETURN jsonb_build_object('mode', CASE WHEN cardinality(v_toks) > 0 THEN 'search' ELSE 'similar' END,
                            'words', to_jsonb(v_words), 'results', v_res);
END
$function$;
REVOKE ALL ON FUNCTION public.merge_contact_candidates(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_contact_candidates(uuid, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('merge_contact_candidates', '0223', 'owner: accounts to merge with (search / similar names, every branch, read only)')
ON CONFLICT DO NOTHING;
