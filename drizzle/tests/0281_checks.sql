-- 0281 checks: vessels per person (rollback-only: run after the migration in ONE call, ends with RAISE).
-- محمود علاء (branch manager, سكة): cash 'use' (default), instapay 'view', vodafone 'hidden' but the number 01017144488 'use'.
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  U uuid := '9aa41d69-13ef-41d8-a6ca-b6c722c95c62'; B uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';
  OPEN_ACC uuid := '4830d903-00ed-4a79-b64a-fec7cc465bb2'; OTHER_ACC uuid := 'c7925658-c4c8-4244-b69c-1808c2001fdc';
  seq jsonb; out text := ''; fails int := 0; ok boolean; n int; v_inst int; v_vod_open int; v_vod_other int; v_vod_all int; t0 timestamptz; ms numeric;
  ins text := $i$INSERT INTO treasury (branch_id, tenant_id, type, category, amount, description, created_by, payment_method, vessel_account_id, transaction_date)
                VALUES ('1329f6cc-a4a5-418c-9e91-cccd651b3142', '5316fbfe-b862-4c91-b48b-1d81c8aa5a71', 'income', 'تحصيل أقساط عملاء', 1, 'تجربة 0281',
                        '9aa41d69-13ef-41d8-a6ca-b6c722c95c62', %L, %L, '2026-11-25')$i$;
BEGIN
  SELECT jsonb_object_agg(sequencename, last_value) INTO seq FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL;
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM set_config('app.skip_treasury_voucher', '1', true);

  -- 1) only the owner sets it, never for himself
  PERFORM set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  ok := false; BEGIN PERFORM public.set_vessel_access(U, '[]'); EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%لصاحب الشركة%'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.set_vessel_access(OWNER, '[]'); ok := false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE '%بيشوف كل الأوعية%'; END;
  n := public.set_vessel_access(U, jsonb_build_array(
         jsonb_build_object('method', 'cash', 'level', 'use'),
         jsonb_build_object('method', 'instapay', 'level', 'view'),
         jsonb_build_object('method', 'vodafone', 'level', 'hidden'),
         jsonb_build_object('method', 'vodafone', 'account_id', OPEN_ACC, 'level', 'use')));
  IF ok AND n = 3 THEN out := out || E'\nPASS 1 المالك بس اللي بيحدد — ومينفعش يقفل على نفسه — 3 قواعد (النقدي «يستخدم» مابيتخزنش)';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 1 ok %s n %s', ok, n); END IF;

  -- 2) the levels
  IF public.vessel_level(U, 'cash', NULL) = 'use' AND public.vessel_level(U, 'instapay', NULL) = 'view'
     AND public.vessel_level(U, 'vodafone', OTHER_ACC) = 'hidden' AND public.vessel_level(U, 'vodafone', OPEN_ACC) = 'use'
     AND public.vessel_level(OWNER, 'vodafone', OTHER_ACC) = 'use'
  THEN out := out || E'\nPASS 2 نقدي يستخدم، إنستاباي يشوف بس، فودافون مخفي ما عدا الرقم 01017144488 — والمالك كله مفتوح';
  ELSE fails := fails + 1; out := out || E'\nFAIL 2 levels'; END IF;

  -- 3) new money: refused where he may not USE
  PERFORM set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  ok := true;
  BEGIN EXECUTE format(ins, 'cash', NULL); EXCEPTION WHEN OTHERS THEN ok := false; out := out || ' cash:' || SQLERRM; END;
  BEGIN EXECUTE format(ins, 'vodafone', OPEN_ACC); EXCEPTION WHEN OTHERS THEN ok := false; out := out || ' open:' || SQLERRM; END;
  BEGIN EXECUTE format(ins, 'instapay', NULL); ok := false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE '%مش متاح ليك%'; END;
  BEGIN EXECUTE format(ins, 'vodafone', OTHER_ACC); ok := false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE '%مش متاح ليك%'; END;
  IF ok THEN out := out || E'\nPASS 3 حركة جديدة: نقدي والرقم المفتوح اتقبلوا — إنستاباي (يشوف بس) والرقم المخفي اترفضوا';
  ELSE fails := fails + 1; out := out || E'\nFAIL 3 writes'; END IF;

  -- 4) reading the till as him: instapay rows visible, hidden vodafone number not, the open one yes
  SELECT count(*) FILTER (WHERE payment_method = 'instapay'), count(*) FILTER (WHERE vessel_account_id = OPEN_ACC),
         count(*) FILTER (WHERE vessel_account_id = OTHER_ACC), count(*) FILTER (WHERE payment_method = 'vodafone')
    INTO v_inst, v_vod_open, v_vod_other, v_vod_all FROM treasury WHERE tenant_id = T AND branch_id = B;
  SET LOCAL ROLE authenticated;
  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM treasury WHERE branch_id = B;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  ok := (SELECT count(*) FROM treasury WHERE branch_id = B AND payment_method = 'instapay') = v_inst
    AND (SELECT count(*) FROM treasury WHERE branch_id = B AND vessel_account_id = OPEN_ACC) = v_vod_open
    AND (SELECT count(*) FROM treasury WHERE branch_id = B AND vessel_account_id = OTHER_ACC) = 0
    AND (SELECT count(*) FROM treasury WHERE branch_id = B AND payment_method = 'vodafone') = v_vod_open;
  RESET ROLE;
  IF ok THEN out := out || format(E'\nPASS 4 الخزنة زي ما هو شايفها: إنستاباي %s حركة ظاهرة، فودافون %s من %s (الرقم المفتوح بس)، قراية خزنة الفرع كلها (%s حركة) %s ms', v_inst, v_vod_open, v_vod_all, n, round(ms));
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 4 inst %s open %s other %s', v_inst, v_vod_open, v_vod_other); END IF;

  -- 5) the owner still reads everything; clearing his rules opens all again
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := (SELECT count(*) FROM treasury WHERE branch_id = B AND vessel_account_id = OTHER_ACC) = v_vod_other;
  RESET ROLE;
  PERFORM public.set_vessel_access(U, '[]');
  IF ok AND public.vessel_level(U, 'instapay', NULL) = 'use' AND (SELECT count(*) FROM security_rpc_allowlist WHERE function_name = 'set_vessel_access') = 1
     AND (SELECT count(*) FROM public.security_exposed_definer_functions()) = 0
  THEN out := out || E'\nPASS 5 المالك شايف كل حاجة — ومسح القواعد بيرجّع كله مفتوح';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 5 owner %s exposed %s', ok, (SELECT count(*) FROM public.security_exposed_definer_functions())); END IF;

  PERFORM setval(format('public.%I', k), (seq->>k)::bigint) FROM jsonb_object_keys(seq) k WHERE k IN (SELECT sequencename FROM pg_sequences WHERE schemaname = 'public');
  RAISE EXCEPTION 'DRY 0281 — fails %: %', fails, out;
END $t$;
