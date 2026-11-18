-- 0262 checks (rollback-only): «العملاء والموردين» = one switch; add / edit / archive / restore follow it on the server.
-- Each case makes its own empty account as the owner, then acts as the person (with an optional rule just for the case).
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  BR uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';  -- سكة
  out text := ''; fails int := 0; ok boolean; err text; done boolean; n int := 0;
  c jsonb; v_uid uuid; v_cid uuid; r jsonb;
  cases jsonb := '[
    ["create_customer", "محمد ياسر",        null,  true],
    ["create_supplier", "محمد ياسر",        null,  true],
    ["update",          "محمد ياسر",        null,  false],
    ["update",          "محمد ياسر",        true,  true],
    ["archive",         "محمد ياسر",        null,  false],
    ["archive",         "محمد ياسر",        true,  true],
    ["restore",         "محمد ياسر",        null,  false],
    ["update",          "ا/محمد طه",        null,  true],
    ["update",          "ا/محمود علاء ضيف", null,  true],
    ["update",          "ا/محمود علاء ضيف", false, false],
    ["archive",         "احمد ناصر",        null,  true]
  ]';
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cases) LOOP
    n := n + 1;
    SELECT id INTO v_uid FROM profiles WHERE name = c->>1 AND tenant_id = T;
    -- a fresh empty account, made by the owner
    PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', OWNER::text, true);
    r := public.save_contact(NULL, jsonb_build_object('name', 'فحص صلاحيات ' || n, 'type', 'both', 'branch_id', BR));
    v_cid := (r->>'id')::uuid;
    IF c->>0 = 'restore' THEN PERFORM public.delete_contact(v_cid); END IF;
    IF jsonb_typeof(c->2) = 'boolean' THEN
      INSERT INTO user_permissions (tenant_id, user_id, permission_key, allowed, branch_id)
      VALUES (T, v_uid, CASE WHEN c->>0 IN ('archive', 'restore') THEN 'customers.delete' ELSE 'customers.' || CASE WHEN c->>0 LIKE 'create%' THEN 'create' ELSE c->>0 END END,
              (c->>2)::boolean, NULL);
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    err := NULL; done := false;
    BEGIN
      CASE c->>0
        WHEN 'create_customer' THEN PERFORM public.save_contact(NULL, jsonb_build_object('name', 'فحص عميل ' || n, 'type', 'customer', 'branch_id', BR));
        WHEN 'create_supplier' THEN PERFORM public.save_contact(NULL, jsonb_build_object('name', 'فحص مورد ' || n, 'type', 'supplier', 'branch_id', BR));
        WHEN 'update'  THEN PERFORM public.save_contact(v_cid, jsonb_build_object('phone', '01001234567'));
        WHEN 'archive' THEN PERFORM public.delete_contact(v_cid);
        WHEN 'restore' THEN PERFORM public.restore_contact(v_cid);
      END CASE;
      done := true;
    EXCEPTION WHEN OTHERS THEN err := SQLERRM;
    END;
    DELETE FROM user_permissions WHERE user_id = v_uid AND permission_key LIKE 'customers.%';
    ok := (done OR err !~ 'مصرح|مسموح|صلاحية|للإدارة') = (c->>3)::boolean;
    IF NOT ok THEN fails := fails + 1; END IF;
    out := out || format(E'\n%s %s %s rule=%s → %s', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, c->>0, c->>1, coalesce(c->>2, '—'), coalesce(err, 'done'));
  END LOOP;
  RAISE EXCEPTION 'CHECKS fails=% %', fails, out;
END $t$;
