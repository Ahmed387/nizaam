-- 0171: owner 2026-11-07 «تدخل خزنة سكة كقبض»: شلبى's payment voucher 14411 of 28/10 (110,000 cash to «معرض سكة تلة
-- (حساب خاص)») had no receipt in سكة. It becomes a receipt in سكة's cash drawer on 28/10 from «المخزن الرئيسي»
-- (his supplier side: what سكة owes شلبى goes up), through the import engine like every other voucher, then the
-- account's ledger / GL is re-synced. The other 17 such vouchers (82,579.81, expenses شلبى paid for سكة) stay as they
-- are (owner «نسيبهم زي ما هم»). Dry-run first: one receipt, cash +110,000.
DO $mig$
DECLARE v_id bigint; v_c uuid;
BEGIN
  IF to_regclass('sahl_import.ops') IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE code = 'FR-003') THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM sahl_import.ops WHERE branch = 'sekka' AND kind = 'voucher' AND no = 14411 AND payload->>'notes' LIKE 'من سجل شلبى: سند صرف 14411%') THEN RETURN; END IF;
  v_c := sahl_import.cid('sekka', 'المخزن الرئيسي');
  INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, payload)
  VALUES ('sekka', '2026-10-28', '23:00', 4, 'voucher', 'قبض', 14411,
    jsonb_build_object('type', 'receipt', 'contact', 'المخزن الرئيسي', 'item', NULL, 'method', 'cash', 'till', 'درج النقدية', 'amount', 110000,
      'notes', 'من سجل شلبى: سند صرف 14411 لسكة يوم 28/10 (110,000 كاش) — ما اتسجلش قبض في سكة (المالك 2026-11-07 «تدخل خزنة سكة كقبض»)'))
  RETURNING id INTO v_id;
  PERFORM sahl_import.run_ops('2026-10-28', true, 5);
  IF (SELECT status FROM sahl_import.ops WHERE id = v_id) <> 'done' THEN RAISE EXCEPTION '0171: receipt not saved'; END IF;
  PERFORM set_config('app.sahl_import', '0', true);
  PERFORM set_config('app.ledger_capture', '', true);
  PERFORM public.ledger_sync_safe(v_c, NULL, 'sahl_import');
END
$mig$;
