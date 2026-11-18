-- 0260 checks (rollback-only): «سندات القبض / الصرف» follow the permission set in settings, per person and branch
-- (owner 2026-11-18 «لما بسمح بيها لشخص … مش قادرين ينفذوا اي سند»، «موافق إن المديرين يتقفل عليهم»).
-- Each line calls create_manual_voucher as that user; ends with RAISE so nothing stays.
DO $t$
DECLARE
  out text := ''; fails int := 0; v_id uuid; ok boolean; err text; v_num text; v_amt numeric; v_tbr uuid; v_by uuid;
  c_rcv uuid := '1fc0e486-8acc-4395-9a4a-5c553222d44e';  -- إيرادات أخرى
  c_pay uuid := 'cce7b6e3-37c4-46b6-a98a-281ad2648ed2';  -- نثريات
  cases jsonb := '[
    ["ا/محمد طه",        "FR-005", "receipt", true],
    ["ا/محمد طه",        "FR-005", "payment", true],
    ["محمد ياسر",        "FR-003", "receipt", true],
    ["محمد ياسر",        "FR-003", "payment", true],
    ["ا/محمود علاء ضيف", "FR-003", "receipt", true],
    ["ا/محمود علاء ضيف", "FR-004", "receipt", false],
    ["ا/محمود علاء ضيف", "FR-005", "payment", false],
    ["د/نور ناصر",       "FR-004", "receipt", true],
    ["د/نور ناصر",       "FR-003", "payment", false],
    ["احمد ناصر",        "FR-004", "payment", true]
  ]';
  c jsonb; v_uid uuid; v_br uuid;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cases) LOOP
    SELECT id INTO v_uid FROM profiles WHERE name = c->>0 AND tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
    SELECT id INTO v_br FROM branches WHERE code = c->>1 AND tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    v_id := NULL; err := NULL;
    BEGIN
      v_id := public.create_manual_voucher(v_br, (c->>2)::voucher_type, CASE WHEN c->>2 = 'receipt' THEN c_rcv ELSE c_pay END,
        1, 'cash', NULL, NULL, 0, NULL, NULL, NULL, 'فحص صلاحية السندات', CURRENT_DATE, NULL);
    EXCEPTION WHEN OTHERS THEN err := SQLERRM;
    END;
    -- «allowed» = passed the permission gate: saved, or stopped later for another reason (e.g. the till has no cash)
    ok := ((v_id IS NOT NULL) OR (err IS NOT NULL AND err !~ 'صلاحية')) = (c->>3)::boolean;
    IF v_id IS NOT NULL THEN  -- a saved voucher has its till row, same amount and branch, his name
      SELECT t.amount, t.branch_id, v.voucher_number, t.created_by INTO v_amt, v_tbr, v_num, v_by
        FROM vouchers v JOIN treasury t ON t.id = v.treasury_id WHERE v.id = v_id;
      ok := ok AND v_amt = 1 AND v_tbr = v_br AND v_by = v_uid;
    END IF;
    IF NOT ok THEN fails := fails + 1; END IF;
    out := out || format(E'\n%s %s %s %s → %s', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, c->>0, c->>1, c->>2,
      coalesce(v_num, err, 'saved'));
    v_num := NULL;
  END LOOP;
  RAISE EXCEPTION 'CHECKS fails=% %', fails, out;
END $t$;
