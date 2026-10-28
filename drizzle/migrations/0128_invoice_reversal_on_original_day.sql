-- 0128: editing or cancelling a 2026 sale invoice reverses its old journal entry on the ORIGINAL day (owner «نفذ», 2026-10-28)
--
-- repost_invoice_journal (edit) and trg_invoice_journal (cancel) called reverse_journal_for_source without
-- app.reverse_on_original_date, so the reversal was dated the day of the edit / cancel while the new entry sits on the
-- invoice day: IN03887 (4/1) had its revenue twice in January (90,499.50 + 89,789.50) and −90,499.50 in October;
-- IN04936 (30/9) 17,000 in September and −8,500 in October; cancelled IN04916 (16/9) kept 5,650 in September.
-- Same rule as vouchers (0084): a correction takes effect on the original day (a closed period moves it to the first
-- open day, ledger_effective_date). Archive invoices (before 2026) keep their own rules (0058 / 0067) and are left out.
-- The 56 reversal entries already dated elsewhere move to the day of the entry they reverse (only entry_date changes).

CREATE OR REPLACE FUNCTION public.repost_invoice_journal(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE inv RECORD; v_net NUMERIC(18,2); v_lines JSONB; v_prev text;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND OR inv.status <> 'active' THEN RETURN; END IF;

  -- 0128: the old entry is reversed on its own day (2026 invoices)
  v_prev := COALESCE(current_setting('app.reverse_on_original_date', true), '');
  IF NOT public.ledger_invoice_is_archive(inv.invoice_date, inv.created_at, inv.is_migrated, inv.migration_batch_id) THEN
    PERFORM set_config('app.reverse_on_original_date', '1', true);
  END IF;
  PERFORM public.reverse_journal_for_source(
    inv.tenant_id, 'invoice', inv.id,
    'Invoice '||inv.invoice_number||' edited — reversing old GL');
  PERFORM set_config('app.reverse_on_original_date', v_prev, true);

  v_net := COALESCE(inv.total,0) - COALESCE(inv.vat_amount,0);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','1200','debit', inv.total, 'credit', 0, 'description','Invoice '||inv.invoice_number||' (edited)'),
    jsonb_build_object('account_code','4100','debit', 0, 'credit', v_net, 'description','Sales revenue (edited)'),
    jsonb_build_object('account_code','2200','debit', 0, 'credit', COALESCE(inv.vat_amount,0), 'description','VAT payable (edited)')
  );
  PERFORM public.post_journal(inv.tenant_id, inv.invoice_date::date,
    'Sale Invoice '||inv.invoice_number||' (edited)', 'invoice', inv.id, v_lines);

  PERFORM public.post_invoice_cogs(inv.id);
END; $function$;

CREATE OR REPLACE FUNCTION public.trg_invoice_journal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_net NUMERIC(18,2); v_lines JSONB; v_prev text;
BEGIN
  IF COALESCE(current_setting('app.skip_journal', true),'') = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    v_net := COALESCE(NEW.total,0) - COALESCE(NEW.vat_amount,0);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1200','debit',NEW.total,'credit',0,'description','Invoice '||NEW.invoice_number),
      jsonb_build_object('account_code','4100','debit',0,'credit',v_net,'description','Sales revenue'),
      jsonb_build_object('account_code','2200','debit',0,'credit',COALESCE(NEW.vat_amount,0),'description','VAT payable')
    );
    PERFORM public.post_journal(NEW.tenant_id, NEW.invoice_date::date, 'Sale Invoice '||NEW.invoice_number,
      'invoice', NEW.id, v_lines);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
        AND public.ledger_invoice_is_archive(NEW.invoice_date, NEW.created_at, NEW.is_migrated, NEW.migration_batch_id)
        AND public.ledger_day(COALESCE(NEW.cancelled_at, now())) >= public.ledger_cutoff() THEN
    NULL;   -- Step 6E: posted from the ledger as a sales return (4900) on the cancellation day
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    -- 0128: a cancelled 2026 invoice leaves its own day
    v_prev := COALESCE(current_setting('app.reverse_on_original_date', true), '');
    IF NOT public.ledger_invoice_is_archive(NEW.invoice_date, NEW.created_at, NEW.is_migrated, NEW.migration_batch_id) THEN
      PERFORM set_config('app.reverse_on_original_date', '1', true);
    END IF;
    PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'invoice', NEW.id,
      'Invoice '||NEW.invoice_number||' cancelled');
    PERFORM set_config('app.reverse_on_original_date', v_prev, true);
  END IF;
  RETURN NEW;
END $function$;

-- the reversals already dated elsewhere: to the day of the entry they reverse
UPDATE public.journal_entries rev
   SET entry_date = public.ledger_effective_date(rev.tenant_id, orig.entry_date)
  FROM public.journal_entries orig, public.invoices i
 WHERE orig.reversed_by = rev.id AND rev.source_type = 'invoice_reversal'
   AND i.id = rev.source_id
   AND NOT public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
   AND rev.entry_date <> public.ledger_effective_date(rev.tenant_id, orig.entry_date);
