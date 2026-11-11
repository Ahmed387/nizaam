-- 0198: owner 2026-11-11 «حركات 29/10 لحد 10/11 … نفذ والملفات اللي رفعتهالك هيا الموجوده فقط».
-- The 14 files of the period 28/10 → 10/11 (zip `sahl2.zip` in the bucket `sahl-import`) were staged by the edge function; this migration
-- records the tool that turned them into documents and what was run once on 2026-11-11 (it only creates objects, it loads nothing by itself).
--   view  sahl_import.load2_nr       = the staged records of the 14 newest files that are NOT in `sahl_import.ops` yet (the 28/10 overlap is skipped by
--                                       document number), one row per (branch, kind, number)
--   func  sahl_import.load2_prepare() = adds the missing codes / products / accounts and builds the ops of those records in the same shapes as build()
--                                       (build() itself is never run again: it truncates `ops`). New ops carry payload.load2 = '1'.
-- Run once (one transaction, any failure rolls everything back): load2_prepare(); contact «محمود عيد ( تله )» (سكة) customer → both (it got a purchase);
-- run_ops(2026-11-10); recost_product_sales for the sold products from 2026-10-28; ledger_sync_safe for the 97 touched accounts; then checks:
-- every till = its GL cash (max difference 0.00) and ledger_reconciliation unexplained = 0.00.
-- Result: 683 documents, 0 errors — 119 sales, 41 purchases, 9 sale returns, 1 purchase return, 506 vouchers (+9 linked to their credit invoice),
-- 7 transfers between tills; 12 new accounts, 10 new products (17 new codes). Dry-run first (rolled back), then the real run.
DO $mig$
BEGIN
  IF to_regnamespace('sahl_import') IS NULL THEN RETURN; END IF;
  EXECUTE $v$
    CREATE OR REPLACE VIEW sahl_import.load2_nr AS
    SELECT DISTINCT ON (r.branch, r.kind, k.num) r.id, r.branch, r.kind, r.rec, k.num
      FROM sahl_import.records r
      JOIN (SELECT sha256 FROM sahl_import.files ORDER BY staged_at DESC LIMIT 14) nf ON nf.sha256 = r.sha256
      CROSS JOIN LATERAL (SELECT CASE WHEN r.kind IN ('قبض','صرف') THEN (r.rec->>'رقم الحركة')::int ELSE (r.rec->>'رقم الفاتورة')::int END AS num) k
     WHERE r.kind IN ('بيع','شراء','مرتجع بيع','مرتجع شراء','قبض','صرف')
       AND NOT EXISTS (SELECT 1 FROM sahl_import.ops o WHERE o.branch = r.branch AND o.src_kind = r.kind AND o.no = k.num AND coalesce(o.payload->>'load2','') <> '1')
     ORDER BY r.branch, r.kind, k.num, r.id
  $v$;
END
$mig$;
-- The body of sahl_import.load2_prepare() lives in the database (created through the SQL editor on 2026-11-11, `#variable_conflict use_column`);
-- read it with pg_get_functiondef('sahl_import.load2_prepare()'::regprocedure).
