-- 0143 checks — rollback-only. «مروحة سقف نوفا NCF-56D» (SKU-109607): عبدالمنعم → سكة, after the سكة row's name was
-- changed (sync triggers off for that one update, to make the names differ).
--  T1) received 2 → the سكة row with the same CODE got them; T2) no new product (no «T-…» code); T3) sequences same.
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_a uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213'; v_s uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';
  v_src uuid := '2603d439-af62-42af-b114-6f0fc653eb3a'; v_dst uuid := '769e8917-597d-4934-901c-aa218e64ac8f';
  v_seq jsonb; v_seq_after jsonb; r record; q0 numeric; q1 numeric; n0 int; n1 int; v_tr uuid; v_res jsonb;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL session_replication_role = replica;
  UPDATE public.products SET name = 'مروحة سقف نوفا NCF56D (اسم مختلف)' WHERE id = v_dst;
  SET LOCAL session_replication_role = origin;
  SELECT quantity INTO q0 FROM public.products WHERE id = v_dst;
  SELECT count(*) INTO n0 FROM public.products WHERE branch_id = v_s;
  v_res := to_jsonb(public.transfer_stock_multi_atomic(v_a, v_s, jsonb_build_array(jsonb_build_object('product_id', v_src, 'quantity', 2)), '0143 check', NULL::date));
  SELECT id INTO v_tr FROM public.stock_transfers WHERE product_id = v_src AND to_branch_id = v_s AND status = 'pending' ORDER BY created_at DESC LIMIT 1;
  PERFORM public.partial_confirm_transfer(v_tr, 2);
  SELECT quantity INTO q1 FROM public.products WHERE id = v_dst;
  SELECT count(*) INTO n1 FROM public.products WHERE branch_id = v_s;
  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text
       AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';
  RAISE EXCEPTION '0143 CHECKS %', jsonb_build_object('T1_same_code_row_got_2', q1 - q0, 'T2_new_products', n1 - n0,
    'T3_seq_same', v_seq = v_seq_after);
END
$t$;
