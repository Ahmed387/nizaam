-- Checks for 0123 — run after 0123_pre.sql and 0123 in the same batch. Raises at the end → ROLLBACK.
DO $$
DECLARE r text := E'\n'; n int; pass int := 0; fail int := 0; ok boolean; msg text;
  nasser uuid := '06e224b7-5c3f-4f7c-9f4a-11f8695ff981'; cashier uuid := 'a3174891-df98-4baa-a806-8c4c94d29eca';
  b1 uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142'; b2 uuid := 'f2b47364-4837-4e1b-84b0-e39f78940d59';
  ten uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  t2 uuid := gen_random_uuid(); x uuid := gen_random_uuid();
BEGIN
  CREATE TEMP TABLE sweep_after AS
  SELECT x.who, s.f, s.o FROM (VALUES
      ('owner',   '85c76e60-3d27-4a99-8cd7-c8f8b39d914a'::uuid),
      ('cashier', 'a3174891-df98-4baa-a806-8c4c94d29eca'::uuid),
      ('nasser',  '06e224b7-5c3f-4f7c-9f4a-11f8695ff981'::uuid)) x(who, uid),
    LATERAL pg_temp.sweep(x.uid, '1329f6cc-a4a5-418c-9e91-cccd651b3142'::uuid) s;

  -- 1. owner / cashier / manager: every answer unchanged
  SELECT count(*) INTO n FROM sweep_before a JOIN sweep_after b USING (who, f) WHERE a.who <> 'nasser' AND a.o IS DISTINCT FROM b.o;
  IF n = 0 THEN pass := pass+1; r := r || '✅ 1. المالك والكاشير: كل الشاشات نفس النتيجة (' || (SELECT count(*) FROM sweep_after WHERE who <> 'nasser') || ' فحص)' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 1. ' || (SELECT string_agg(a.who || ':' || a.f || ' ' || a.o || ' → ' || b.o, '; ') FROM sweep_before a JOIN sweep_after b USING (who, f) WHERE a.who <> 'nasser' AND a.o IS DISTINCT FROM b.o) || E'\n'; END IF;

  -- 2. Nasser: the branch reads and the four company reports now answer
  SELECT count(*) INTO n FROM sweep_after WHERE who = 'nasser' AND o LIKE 'ERR%' AND f = ANY (array['contacts_page','contact_side_balances',
    'ledger_aging','ledger_contact_documents','ledger_contact_money','ledger_contact_overview','ledger_contact_statement','ledger_money_flow',
    'get_branch_wallet_balances','get_available_quantity','get_product_references_count','current_shift_schedule','expected_opening_cash',
    'historical_stock_at','owner_business_snapshot','ledger_position','opening_balances_summary']);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', nasser, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.branch_stock_report(current_date - 7, current_date, b1); EXCEPTION WHEN others THEN n := n + 1; msg := 'branch_stock_report ' || sqlerrm; END;
  IF n = 0 THEN pass := pass+1; r := r || '✅ 2. ناصر بقى يقرأ: العملاء، كشف الحساب، الأعمار، المحافظ، الكمية، الشيفت، لقطة البيزنس، حركة المخزون، مركز الشركة' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 2. ' || coalesce(msg, '') || ' ' || coalesce((SELECT string_agg(f || ' ' || o, '; ') FROM sweep_after WHERE who = 'nasser' AND o LIKE 'ERR%'), '') || E'\n'; END IF;

  -- 3. Nasser and the cashier: the same numbers as the owner where both answer
  SELECT count(*) INTO n FROM sweep_after a JOIN sweep_after o ON o.f = a.f AND o.who = 'owner'
   WHERE a.who = 'nasser' AND a.o NOT LIKE 'ERR%' AND a.o IS DISTINCT FROM o.o
     AND a.f NOT IN ('get_opening_balances');
  IF n = 0 THEN pass := pass+1; r := r || '✅ 3. اللي ناصر بيشوفه نفس أرقام المالك بالظبط' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 3. ' || (SELECT string_agg(a.f || ' ' || a.o || ' vs ' || o.o, '; ') FROM sweep_after a JOIN sweep_after o ON o.f = a.f AND o.who = 'owner' WHERE a.who = 'nasser' AND a.o NOT LIKE 'ERR%' AND a.o IS DISTINCT FROM o.o) || E'\n'; END IF;

  -- 4. the audit tools stay admin only
  SELECT count(*) INTO n FROM sweep_after WHERE who = 'nasser' AND o NOT LIKE 'ERR%' AND f = ANY (array['system_integrity_summary',
    'detect_anomalies','detect_orphaned_batches','preview_flexible_distribution']);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', nasser, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.ledger_gl_reconciliation(); n := n + 1; EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.system_health_check(); n := n + 1; EXCEPTION WHEN others THEN NULL; END;
  IF n = 0 THEN pass := pass+1; r := r || '✅ 4. أدوات المراجعة (سلامة البيانات، المطابقات، التوزيع المرن) لسه للأدمن بس' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 4. ' || n || E'\n'; END IF;

  -- 5. Nasser still writes nothing
  PERFORM set_config('request.jwt.claims', json_build_object('sub', nasser, 'role', 'authenticated')::text, true);
  ok := true;
  BEGIN PERFORM public.assert_access(b1, 'sales.create'); ok := false; EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.assert_read_access(b1, 'sales.create'); ok := false; EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.assert_read_access(b1, 'receipt_vouchers.create'); ok := false; EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.guard_read_product('a945e0be-4e1f-4205-ba8b-f9f23682d99d', 'inventory.update'); ok := false; EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.assert_access(b1, NULL); ok := false; EXCEPTION WHEN others THEN NULL; END;
  IF ok THEN pass := pass+1; r := r || '✅ 5. ناصر لسه مايقدرش يبيع ولا يعمل سند ولا يرجّع منتج — الكتابة مقفولة' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 5. ناصر عدّى بوابة كتابة' || E'\n'; END IF;

  -- 6. the cashier still reads only his own branch
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cashier, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.assert_read_access(b2, NULL); ok := false; EXCEPTION WHEN others THEN ok := true; END;
  BEGIN PERFORM public.ledger_read_scope(b2, 'customer'); ok := false; EXCEPTION WHEN others THEN NULL; END;
  IF ok THEN pass := pass+1; r := r || '✅ 6. الكاشير لسه مايقرأش فرع مش بتاعه' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 6. الكاشير قرأ فرع تاني' || E'\n'; END IF;

  -- 7. closing the page closes the report on the server
  INSERT INTO user_permissions(tenant_id, user_id, permission_key, allowed, branch_id) VALUES
    (ten, nasser, 'admin_reports_profitability.view', false, NULL),
    (ten, nasser, 'part.admin_home.business_snapshot.view', false, NULL),
    (ten, nasser, 'admin_main_treasury.view', false, NULL);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', nasser, 'role', 'authenticated')::text, true);
  ok := true;
  BEGIN PERFORM public.owner_business_snapshot(current_date - 30, current_date); ok := false; EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.ledger_position(NULL); ok := false; EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.opening_balances_summary(); ok := false; EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM public.ledger_position(b1); EXCEPTION WHEN others THEN ok := false; msg := sqlerrm; END;
  IF ok THEN pass := pass+1; r := r || '✅ 7. لو قفلت صفحة التقارير / ملخص الخزائن لناصر، السيرفر بيقفل التقرير، ومركز الفرع الواحد لسه مفتوح' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 7 ' || coalesce(msg, '') || E'\n'; END IF;
  DELETE FROM user_permissions WHERE user_id = nasser AND permission_key IN ('admin_reports_profitability.view', 'part.admin_home.business_snapshot.view', 'admin_main_treasury.view');

  -- 8. a viewer of another company reads nothing of ours
  INSERT INTO tenants(id, name, slug, plan, is_active, setup_completed, max_branches, is_test) VALUES (t2, 'شركة تانية', 'zz-0123', 'free', true, true, 3, true);
  INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-0123@test.local', 'x', now(), '{}', '{}', now(), now());
  INSERT INTO profiles(id, name, username, tenant_id) VALUES (x, 'غريب', 'zz-0123', t2) ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id;
  INSERT INTO user_roles(user_id, role, tenant_id) VALUES (x, 'viewer', t2);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  ok := true;
  BEGIN PERFORM public.assert_read_access(b1, NULL); ok := false; EXCEPTION WHEN others THEN NULL; END;
  IF public.user_reads_branch(x, b1) THEN ok := false; END IF;
  BEGIN PERFORM public.ledger_read_scope(b1, 'customer'); ok := false; EXCEPTION WHEN others THEN NULL; END;
  IF ok THEN pass := pass+1; r := r || '✅ 8. مراقب في شركة تانية مايشوفش فروعك' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 8' || E'\n'; END IF;

  SELECT count(*) INTO n FROM security_exposed_definer_functions();
  IF n = 0 THEN pass := pass+1; r := r || '✅ 9. مفيش دوال مكشوفة' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 9. ' || (SELECT string_agg(z, ', ') FROM security_exposed_definer_functions() z) || E'\n'; END IF;

  r := r || E'\nناصر قبل → بعد:\n' || (SELECT string_agg(a.f || ': ' || left(a.o, 40) || ' → ' || left(b.o, 40), E'\n' ORDER BY a.f)
         FROM sweep_before a JOIN sweep_after b USING (who, f) WHERE a.who = 'nasser' AND a.o IS DISTINCT FROM b.o);
  RAISE EXCEPTION 'ROLLBACK-RESULTS: نجح % / فشل % %', pass, fail, r;
END $$;
