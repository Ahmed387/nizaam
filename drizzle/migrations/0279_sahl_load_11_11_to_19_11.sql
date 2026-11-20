-- 0279 (owner 2026-11-20 «ضم sahl5 علي باقي الملفات»، «سهل صح نفذ»، «أعدّلها في السيستم زي سهل، كل فاتورة في يومها»، «موافق»،
-- «مش عاوز تكرار للفواتير»). sahl5.zip (14 files, 11/11 → 19/11; three شلبى files are NAMED 10-11 → 15-11 but hold 11 → 19/11; the
-- سكة sale-returns file is the old 10 → 15/11 one) staged by the edge function `sahl-import` (map sha → branch, one entry per call).
-- Found before loading:
--  * 21 documents typed BY HAND in the system for days of the files — each is a «سهل» document already loaded or in sahl5
--    (سكة IN47864–IN47867 14/11 = «سهل» 1299 / 1300 / 1302 / 1307…, عبدالمنعم IN47922–IN47925 = 1628–1631, 6 + 3 vouchers
--    PV-7412–PV-7417 / RV-6238–RV-6240, شلبى IN47918–IN47921 = 8603 / 8591 / 8592 / 8597 with other amounts or days).
--    Owner: «سهل» is right → each is cancelled ON ITS DAY (sales «غلط ومفيش فلوس»: their payments are cancelled on their own
--    day; vouchers through cancel_voucher) and «سهل» is loaded — no document twice.
--  * 6 شلبى sales of 14–15/11 edited in «سهل» after the sahl4 load (IN47905 / 8578: «شاشة سينكس» 4,550 → 4,450 × 8; IN47909,
--    IN47911, IN47913, IN47914, IN47915: an invoice discount of 50–200) → edit_invoice on their own day with «سهل»'s prices and
--    discount (−1,400 in all).
--  * شلبى → branch («حساب خاص») sales / returns 16 → 19/11 have no purchase in the branch files → `load5_run` (0252) makes the
--    branch copies (purchase / purchase return from «المخزن الرئيسي», no money).
-- Tools: view sahl_import.load6_nr = sahl5 records dated ≤ 19/11 not in ops; sahl_import.load6_prepare() = load4_prepare on it;
-- sahl_import.load6_run(apply) = all of the above + run_ops + doc_source_times + recost_product_sales (from 11/11) +
-- ledger_sync_safe + sync_sale_return_journal of the new returns; checks: every sahl5 document is in the system ONCE, totals per
-- branch and kind = the files, tills = GL, unexplained 0, no duplicate (same branch, account, day, amount) among active sales.
-- Found while dry-running (fixed in the tools, not in the data):
--  * 4 documents loaded from sahl4 were DELETED in «سهل» afterwards: 8571 (sale to سكة 14/11) and 1285 (return from عبدالمنعم 14/11)
--    were typed again on 17/11 as 8605 / 1299 with the same lines → the documents and their branch copies (PO25003 / PR09620) were
--    MOVED to 17/11 (update_invoice_date_sovereign / update_shipment_date / the return date triggers) and linked to the new numbers;
--    8588 (sale to عبدالمنعم 15/11) + 4188 (purchase from سكة 15/11) were deleted with no replacement → IN47917, PO24969 and the copy
--    PO25006 cancelled on their day.
--  * vessel accounts (0244) are not asked in import mode: `assert_vessel_account` and `transfer_between_vessels` skip the check when
--    `sahl_import_mode()` (console / pg_cron only) — «سهل» files carry no account.
--  * an import account that the owner merged («دمج حسابين», e.g. «احمد لوكس» → «احمد جمال لوكس») follows `merged_into` before the
--    run (sahl_import.acc), so no document lands on an archived account.
--  * a receipt that is the incoming half of a vessel transfer is in the system under the transfer's out number (1276 / 1284).
-- Applied 2026-11-20 (`select sahl_import.load6_run(true)`): 214 documents, 0 errors — sales سكة 13 / شلبى 22 / عبدالمنعم 4,
-- purchases 28, شلبى returns 11, 150 vouchers (+2 linked as payments), 1 vessel transfer; 4 new accounts, 1 new product; 21 typed
-- documents cancelled, 2 moved, 3 cancelled (deleted in «سهل»), 6 invoices edited (−1,400); branch copies 13 purchases + 10 purchase
-- returns; 77 products re-costed, 49 accounts synced. Checks: every sahl5 document in the system once with «سهل»'s total, tills = GL
-- and accounts = GL in all three branches, ledger unexplained 0, cross-branch 0, profit_reconciliation cost ±0.03, sales 0, no new
-- duplicate (the one pair left, IN47856 / IN47862, is two «سهل» invoices 8553 / 8556). Net profit 1/1 → 20/11: 561,177.07.

-- the two import-mode guards (applied live in the same session, kept here as they now are):
DO $$ DECLARE d text := pg_get_functiondef('public.assert_vessel_account(text,text,text)'::regprocedure); BEGIN
  IF position('sahl_import_mode' in d) = 0 THEN
    d := replace(d, $a$  IF p_method IS NULL OR p_method IN ('cash', 'credit_balance') OR v_t IS NULL THEN RETURN; END IF;$a$,
                    $b$  IF p_method IS NULL OR p_method IN ('cash', 'credit_balance') OR v_t IS NULL THEN RETURN; END IF;
  -- 0279: «سهل» files carry no vessel account — the import (console / pg_cron only) records the money without one
  IF public.sahl_import_mode() THEN RETURN; END IF;$b$);
    EXECUTE d;
  END IF;
END $$;
DO $$ DECLARE d text := pg_get_functiondef('public.transfer_between_vessels(uuid,text,text,numeric,text,numeric,date,text,text,text)'::regprocedure); BEGIN
  IF position('sahl_import_mode' in d) = 0 THEN
    d := replace(d, 'IF EXISTS (SELECT 1 FROM vessel_accounts WHERE tenant_id = v_t AND payment_method = p_from AND is_active)',
                    'IF NOT public.sahl_import_mode() AND EXISTS (SELECT 1 FROM vessel_accounts WHERE tenant_id = v_t AND payment_method = p_from AND is_active)');
    d := replace(d, 'IF EXISTS (SELECT 1 FROM vessel_accounts WHERE tenant_id = v_t AND payment_method = p_to AND is_active)',
                    'IF NOT public.sahl_import_mode() AND EXISTS (SELECT 1 FROM vessel_accounts WHERE tenant_id = v_t AND payment_method = p_to AND is_active)');
    EXECUTE d;
  END IF;
END $$;
