-- 0168: during the «سهل» import the write paths (process_sale_full, settle_contact_without_money, record_prior_year_return,
-- …) still called `ledger_refresh_contact` on every operation, i.e. a FULL `ledger_sync_contact` of the account from
-- all his documents (temp tables, every movement again) — `app.ledger_capture = 'off'` (0156) stops only the capture
-- triggers. For the branch accounts with thousands of documents each new operation re-read all of them: steps of
-- 1,500 operations went 25 s → 150 s → many minutes (2026-11-05 evening, on top of the Micro server's spent CPU
-- credits). In import mode only, the refresh is skipped: no import step reads the ledger (returns take the old split
-- from `app.sahl_split`, no advance is applied), and the end of the import rebuilds every account's ledger, GL and
-- mirror with `ledger_sync_safe` (0165). Outside import mode nothing changes.
DO $mig$
BEGIN
  PERFORM sahl_import._patch('public.ledger_refresh_contact(uuid)'::regprocedure,
    $p$PERFORM public.ledger_sync_contact(p_contact);$p$,
    $p$IF NOT public.sahl_import_mode() THEN PERFORM public.ledger_sync_contact(p_contact); END IF;  -- 0168: the import rebuilds it at the end$p$);
END
$mig$;
