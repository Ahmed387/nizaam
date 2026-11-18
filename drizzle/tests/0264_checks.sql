-- 0264 checks (rollback-only): each action follows its switch on the server. A case «passes the gate» when it saves or
-- stops for another reason (no shift, no stock, empty lines …); «refused» = a permission message.
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  out text := ''; fails int := 0; ok boolean; err text; done boolean; n int;
  c jsonb; v_uid uuid; v_br uuid; v_id uuid; v_emp uuid; v_prod uuid;
  cases jsonb := '[
    ["cancel_voucher",   "محمد ياسر",        "FR-003", null, false],
    ["cancel_voucher",   "محمد ياسر",        "FR-003", ["receipt_vouchers.delete", true], true],
    ["sale",             "محمد ياسر",        "FR-003", null, true],
    ["sale",             "محمد ياسر",        "FR-003", ["sales.create", false], false],
    ["purchase",         "ا/محمد طه",        "FR-005", null, true],
    ["purchase",         "ا/محمد طه",        "FR-005", ["shipments.create", false], false],
    ["purchase",         "محمد ياسر",        "FR-003", null, false],
    ["new_product",      "محمد ياسر",        "FR-003", null, false],
    ["new_product",      "ا/محمد طه",        "FR-005", null, true],
    ["pack",             "محمد ياسر",        "FR-003", null, false],
    ["pack",             "ا/محمد طه",        "FR-005", null, true],
    ["transfer",         "محمد ياسر",        "FR-003", null, false],
    ["transfer",         "ا/محمد طه",        "FR-005", null, true],
    ["new_preorder",     "محمد ياسر",        "FR-003", null, true],
    ["new_preorder",     "محمد ياسر",        "FR-003", ["preorders.create", false], false],
    ["cancel_preorder",  "محمد ياسر",        "FR-003", null, false],
    ["cancel_preorder",  "ا/محمود علاء ضيف", "FR-003", null, true],
    ["advance",          "محمد ياسر",        "FR-003", null, false],
    ["advance",          "ا/محمود علاء ضيف", "FR-003", null, true],
    ["advance",          "ا/محمود علاء ضيف", "FR-003", ["advances.create", false], false],
    ["employee_update",  "محمد ياسر",        "FR-003", null, false],
    ["employee_update",  "ا/محمود علاء ضيف", "FR-003", null, true],
    ["employee_update",  "ا/محمود علاء ضيف", "FR-003", ["employees.update", false], false],
    ["employee_update",  "ا/محمد طه",        "FR-005", null, true],
    ["attendance",       "ا/محمود علاء ضيف", "FR-003", null, true],
    ["attendance",       "ا/محمود علاء ضيف", "FR-003", ["attendance.update", false], false],
    ["attendance",       "محمد ياسر",        "FR-003", null, false]
  ]';
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cases) LOOP
    SELECT id INTO v_uid FROM profiles WHERE name = c->>1 AND tenant_id = T;
    SELECT id INTO v_br FROM branches WHERE code = c->>2 AND tenant_id = T;
    SELECT id INTO v_prod FROM products WHERE branch_id = v_br AND archived_at IS NULL ORDER BY id LIMIT 1;
    SELECT id INTO v_emp FROM employees WHERE branch_id = v_br AND tenant_id = T AND role = 'cashier' LIMIT 1;
    v_emp := coalesce(v_emp, (SELECT id FROM employees WHERE branch_id = v_br AND tenant_id = T LIMIT 1));
    -- what the case needs, made by the owner
    PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', OWNER::text, true);
    v_id := NULL;
    IF c->>0 = 'cancel_voucher' THEN
      v_id := public.create_manual_voucher(v_br, 'receipt', '1fc0e486-8acc-4395-9a4a-5c553222d44e', 1, 'cash', NULL, NULL, 0, NULL, NULL, NULL, 'فحص', CURRENT_DATE, NULL);
    ELSIF c->>0 = 'cancel_preorder' THEN
      v_id := public.create_pre_order(v_br, NULL, 'فحص', NULL, NULL, 'فحص صنف', NULL, 1, 100, 0, 'cash', NULL, NULL, NULL, NULL);
    END IF;
    IF jsonb_typeof(c->3) = 'array' THEN
      INSERT INTO user_permissions (tenant_id, user_id, permission_key, allowed, branch_id) VALUES (T, v_uid, c->3->>0, (c->3->>1)::boolean, NULL);
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    err := NULL; done := false;
    BEGIN
      CASE c->>0
        WHEN 'cancel_voucher' THEN PERFORM public.cancel_voucher(v_id, 'فحص');
        WHEN 'sale' THEN PERFORM public.process_sale_full(v_br, NULL, 0, 0, 0, NULL, 0, 'cash', '[]'::jsonb, '[]'::jsonb, 0, 0, NULL, NULL, NULL, 0, NULL);
        WHEN 'purchase' THEN PERFORM public.record_shipment_with_credit(jsonb_build_object('branch_id', v_br, 'contact_id', gen_random_uuid()), '[]'::jsonb, '{}'::jsonb);
        WHEN 'new_product' THEN PERFORM public.create_product_with_opening_stock(jsonb_build_object('branch_id', v_br, 'name', 'فحص صنف 0264', 'quantity', 0), now());
        WHEN 'pack' THEN PERFORM public.set_product_pack(v_prod, 1, NULL, NULL);
        WHEN 'transfer' THEN PERFORM public.transfer_stock_multi_atomic(v_br, (SELECT id FROM branches WHERE code = 'FR-004' AND tenant_id = T), '[]'::jsonb, 'فحص', NULL::date);
        WHEN 'new_preorder' THEN PERFORM public.create_pre_order(v_br, NULL, 'فحص', NULL, NULL, 'فحص صنف', NULL, 1, 100, 0, 'cash', NULL, NULL, NULL, NULL);
        WHEN 'cancel_preorder' THEN PERFORM public.cancel_pre_order(v_id, false);
        WHEN 'advance' THEN PERFORM public.disburse_employee_advance(v_emp, 1, 1, 'فحص', 'cash', NULL, NULL, NULL, 0);
        WHEN 'employee_update' THEN
          EXECUTE 'SET LOCAL ROLE authenticated';
          UPDATE public.employees SET name = name WHERE id = v_emp; GET DIAGNOSTICS n = ROW_COUNT;
          EXECUTE 'RESET ROLE';
          IF n = 0 THEN RAISE EXCEPTION 'مش مسموح (0 صفوف)'; END IF;
        WHEN 'attendance' THEN
          EXECUTE 'SET LOCAL ROLE authenticated';
          -- edit an attendance record of the branch's cashier (a second record for the same day is refused by its own rule)
          UPDATE public.attendance SET status = status WHERE employee_id = (SELECT id FROM employees WHERE name = 'محمد ياسر' AND tenant_id = T)
             AND date = DATE '2026-10-12';
          GET DIAGNOSTICS n = ROW_COUNT;
          EXECUTE 'RESET ROLE';
          IF n = 0 THEN RAISE EXCEPTION 'مش مسموح (0 صفوف)'; END IF;
      END CASE;
      done := true;
    EXCEPTION WHEN OTHERS THEN err := SQLERRM; EXECUTE 'RESET ROLE';
    END;
    DELETE FROM user_permissions WHERE user_id = v_uid AND tenant_id = T AND branch_id IS NULL AND jsonb_typeof(c->3) = 'array' AND permission_key = c->3->>0;
    ok := (done OR err !~ 'مصرح|مسموح|صلاحية|للمدير|للإدارة|row-level security') = (c->>4)::boolean;
    IF NOT ok THEN fails := fails + 1; END IF;
    out := out || format(E'\n%s %s %s %s rule=%s → %s', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, c->>0, c->>1, c->>2, coalesce(c->>3, '—'), left(coalesce(err, 'done'), 90));
  END LOOP;
  RAISE EXCEPTION 'CHECKS fails=% %', fails, out;
END $t$;
