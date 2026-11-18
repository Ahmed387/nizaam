-- 0261 checks (rollback-only): archive_product needs «المخزون ← يلغي» in the product's branch; add_invoice_payment needs
-- someone who writes in the invoice's branch. A case «passes the gate» when it saves or stops for another reason.
DO $t$
DECLARE
  out text := ''; fails int := 0; ok boolean; err text; done boolean;
  c jsonb; v_uid uuid; v_br uuid; v_target uuid;
  cases jsonb := '[
    ["archive", "محمد ياسر",        "FR-003", false],
    ["archive", "ا/محمد طه",        "FR-005", false],
    ["archive", "ا/محمود علاء ضيف", "FR-003", true],
    ["archive", "ا/محمود علاء ضيف", "FR-004", false],
    ["archive", "احمد ناصر",        "FR-004", true],
    ["payment", "محمد ياسر",        "FR-003", true],
    ["payment", "محمد ياسر",        "FR-005", false],
    ["payment", "ا/محمود علاء ضيف", "FR-004", false],
    ["payment", "د/نور ناصر",       "FR-004", true],
    ["payment", "احمد ناصر",        "FR-005", true]
  ]';
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cases) LOOP
    SELECT id INTO v_uid FROM profiles WHERE name = c->>1 AND tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
    SELECT id INTO v_br FROM branches WHERE code = c->>2 AND tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
    IF c->>0 = 'archive' THEN
      SELECT p.id INTO v_target FROM products p WHERE p.branch_id = v_br AND p.archived_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.product_id = p.id AND r.status = 'active') ORDER BY p.id LIMIT 1;
    ELSE
      SELECT i.id INTO v_target FROM invoices i WHERE i.branch_id = v_br AND i.status <> 'cancelled' ORDER BY i.invoice_date DESC, i.id LIMIT 1;
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    err := NULL; done := false;
    BEGIN
      IF c->>0 = 'archive' THEN PERFORM public.archive_product(v_target);
      ELSE PERFORM public.add_invoice_payment(v_target, 'cash', 1, NULL, NULL, NULL, 0, false, NULL); END IF;
      done := true;
    EXCEPTION WHEN OTHERS THEN err := SQLERRM;
    END;
    ok := (done OR err !~ 'مصرح|مسموح|صلاحية') = (c->>3)::boolean;
    IF NOT ok THEN fails := fails + 1; END IF;
    out := out || format(E'\n%s %s %s %s → %s', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, c->>0, c->>1, c->>2, coalesce(err, 'done'));
  END LOOP;
  RAISE EXCEPTION 'CHECKS fails=% %', fails, out;
END $t$;
