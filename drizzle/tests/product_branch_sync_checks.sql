-- Integration test (real A & N database, ONE transaction that raises at the end → ROLLBACK, nothing is kept):
-- a product added in one branch reaches the other branches (everything but the quantity), and later changes of
-- its details (not quantity, not prices — each branch its own) follow it to the other branches (migration 0119). Run the whole file in one execute_sql; read «ROLLBACK-RESULTS».
CREATE FUNCTION pg_temp.as_(uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN EXECUTE 'reset role';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  EXECUTE 'set local role authenticated'; END $f$;

-- the other branch rows of the test product that differ from the source row on a field
CREATE FUNCTION pg_temp.diff(v_sku text, f text) RETURNS int LANGUAGE plpgsql AS $f$
DECLARE n int; BEGIN
  EXECUTE format('SELECT count(*) FROM products p JOIN products s ON s.id = (SELECT id FROM products WHERE sku = $1 AND branch_id = %L)
                   WHERE p.sku = $1 AND p.id <> s.id AND p.%I IS DISTINCT FROM s.%I', '1329f6cc-a4a5-418c-9e91-cccd651b3142', f, f)
    INTO n USING v_sku;
  RETURN n; END $f$;

DO $$
DECLARE
  t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  b_src uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';  -- معرض سكة تلة
  v_sku text := 'ZZ-SYNC-' || substr(md5(random()::text), 1, 6);
  r text := E'\n'; pass int := 0; fail int := 0;
  pid uuid; n int; j jsonb; f text; bad text;
  branches_n int;
BEGIN
  SELECT count(*) INTO branches_n FROM branches WHERE tenant_id = t AND NOT COALESCE(is_system, false);

  PERFORM pg_temp.as_(owner);
  j := public.create_product_with_opening_stock(jsonb_build_object(
        'branch_id', b_src, 'name', 'منتج اختبار مزامنة', 'sku', v_sku, 'quantity', 5, 'cost_price', 0,
        'selling_price', 1000, 'market_price', 1100, 'low_stock_alert', 2, 'image', t || '/' || b_src || '/zz.webp',
        'brand', 'تورنيدو', 'model', 'M1', 'color', 'ابيض', 'product_type', 'غسالة', 'capacity', '7 كيلو', 'size', '60 سم'));
  pid := (j->>'product_id')::uuid;
  EXECUTE 'reset role';

  -- 1. on add: one row per branch
  SELECT count(*) INTO n FROM products WHERE tenant_id = t AND sku = v_sku AND archived_at IS NULL;
  IF n = branches_n THEN pass := pass + 1; r := r || '✅ 1. المنتج نزل في الـ ' || n || ' فروع' || E'\n';
  ELSE fail := fail + 1; r := r || '❌ 1. نزل في ' || n || ' من ' || branches_n || E'\n'; END IF;

  -- 2. on add: quantity only in its branch
  IF (SELECT quantity FROM products WHERE id = pid) = 5 AND NOT EXISTS (SELECT 1 FROM products WHERE sku = v_sku AND id <> pid AND quantity <> 0)
  THEN pass := pass + 1; r := r || '✅ 2. الكمية 5 في فرعه بس، وصفر في الباقي' || E'\n';
  ELSE fail := fail + 1; r := r || '❌ 2. الكمية نزلت في فروع تانية' || E'\n'; END IF;

  -- 3. on add: every detail copied
  bad := '';
  FOREACH f IN ARRAY ARRAY['name','image','brand','model','color','product_type','capacity','size','category_id','selling_price','market_price','cost_price','low_stock_alert'] LOOP
    IF pg_temp.diff(v_sku, f) > 0 THEN bad := bad || f || ' '; END IF;
  END LOOP;
  IF bad = '' THEN pass := pass + 1; r := r || '✅ 3. كل التفاصيل والصورة والأسعار اتنسخت' || E'\n';
  ELSE fail := fail + 1; r := r || '❌ 3. مش متنسخ: ' || bad || E'\n'; END IF;

  -- 4..: a later change in the source branch (update_product_details, as the owner)
  PERFORM pg_temp.as_(owner);
  PERFORM public.update_product_details(pid, jsonb_build_object('name', 'منتج اختبار مزامنة 2', 'image', t || '/' || b_src || '/zz2.webp', 'brand', 'شارب', 'model', 'M2'));
  EXECUTE 'reset role';
  bad := '';
  FOREACH f IN ARRAY ARRAY['name','image','brand','model'] LOOP IF pg_temp.diff(v_sku, f) > 0 THEN bad := bad || f || ' '; END IF; END LOOP;
  IF bad = '' THEN pass := pass + 1; r := r || '✅ 4. تغيير الاسم والصورة والماركة والموديل وصل لكل الفروع' || E'\n';
  ELSE fail := fail + 1; r := r || '❌ 4. ما وصلش: ' || bad || E'\n'; END IF;

  PERFORM pg_temp.as_(owner);
  PERFORM public.update_product_details(pid, jsonb_build_object('image', ''));
  EXECUTE 'reset role';
  IF NOT EXISTS (SELECT 1 FROM products WHERE sku = v_sku AND image IS NOT NULL)
  THEN pass := pass + 1; r := r || '✅ 5. مسح الصورة (صفحة الصور) فضّاها في كل الفروع' || E'\n';
  ELSE fail := fail + 1; r := r || '❌ 5. مسح الصورة ما وصلش لكل الفروع' || E'\n'; END IF;

  PERFORM pg_temp.as_(owner);
  PERFORM public.update_product_details(pid, jsonb_build_object('color', 'اسود', 'product_type', 'غسالة اطباق', 'capacity', '9 كيلو', 'size', '80 سم', 'low_stock_alert', 4, 'min_stock_level', 3));
  EXECUTE 'reset role';
  bad := '';
  FOREACH f IN ARRAY ARRAY['color','product_type','capacity','size','low_stock_alert','min_stock_level'] LOOP IF pg_temp.diff(v_sku, f) > 0 THEN bad := bad || f || ' '; END IF; END LOOP;
  IF bad = '' THEN pass := pass + 1; r := r || '✅ 6. اللون والنوع والسعة والمقاس وحد التنبيه وصلوا لكل الفروع' || E'\n';
  ELSE fail := fail + 1; r := r || '❌ 6. ما وصلش للفروع التانية: ' || bad || E'\n'; END IF;

  PERFORM pg_temp.as_(owner);
  PERFORM public.update_product_price_with_reason(pid, 1500, NULL, 1600, 'اختبار مزامنة الأسعار');
  EXECUTE 'reset role';
  -- owner rule 2026-10-25: every branch has its own price → the change stays in its branch
  IF (SELECT selling_price FROM products WHERE id = pid) = 1500
     AND NOT EXISTS (SELECT 1 FROM products WHERE sku = v_sku AND id <> pid AND (selling_price <> 1000 OR market_price <> 1100))
  THEN pass := pass + 1; r := r || '✅ 7. السعر اتغير في فرعه بس (كل فرع ليه سعره)' || E'\n';
  ELSE fail := fail + 1; r := r || '❌ 7. تغيير السعر وصل لفروع تانية' || E'\n'; END IF;

  PERFORM pg_temp.as_(owner);
  PERFORM public.update_product_details(pid, jsonb_build_object('sku', v_sku || '-B'));
  PERFORM public.update_product_details(pid, jsonb_build_object('name', 'منتج اختبار مزامنة 3'));
  EXECUTE 'reset role';
  SELECT count(*) INTO n FROM products WHERE tenant_id = t AND sku = v_sku || '-B';
  IF n = branches_n AND NOT EXISTS (SELECT 1 FROM products WHERE tenant_id = t AND sku LIKE v_sku || '%' AND name <> 'منتج اختبار مزامنة 3')
  THEN pass := pass + 1; r := r || '✅ 8. تغيير الكود وصل لكل الفروع، والربط فضل شغال بعده' || E'\n';
  ELSE fail := fail + 1; r := r || '❌ 8. الكود اتغير في ' || n || ' فرع بس — بعدها الاسم ما بقاش بيوصل للباقي' || E'\n'; END IF;

  RAISE EXCEPTION 'ROLLBACK-RESULTS: نجح % / فشل % %', pass, fail, r;
END $$;
