-- 0095 — a sale / purchase return dated in the past moves EVERYTHING to its date (owner report 2026-10-16, SR00070:
-- return dated 31/01, refund voucher PV-3054 + till + stock movement stayed on 16/10, the day it was entered).
-- The return is saved first (today) and its date is set right after (update_return_sovereign / the date cell in the
-- table). That moved only the journal (and the till row's created_at, not its transaction_date); the refund voucher,
-- the till period and the stock movements stayed on the entry day — and some date edits did not move the journal.
-- return_sync_dates puts the journal entries, the refund voucher (its trigger moves the till row and the voucher
-- journal) and the till rows of the return on the return's own day (stock reports already read the return date); a trigger runs it whenever
-- the return's date changes, and every existing return is re-synced once. Reversal rows of a cancelled return stay
-- on their cancel day.
CREATE OR REPLACE FUNCTION public.return_sync_dates(p_kind text, p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_dated timestamptz; v_day date; v_tenant uuid; n int := 0; m int;
BEGIN
  IF p_kind = 'sale_return' THEN
    SELECT invoice_date, tenant_id INTO v_dated, v_tenant FROM returns WHERE id = p_id;
  ELSIF p_kind = 'purchase_return' THEN
    SELECT invoice_date, tenant_id INTO v_dated, v_tenant FROM purchase_returns WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'نوع مرتجع غير صالح';
  END IF;
  IF v_dated IS NULL THEN RETURN 0; END IF;
  v_day := public.ledger_day(v_dated);
  IF public.ledger_period_closed(v_tenant, v_day) THEN RETURN 0; END IF;

  UPDATE journal_entries SET entry_date = v_day, updated_at = now()
   WHERE source_type = p_kind AND source_id = p_id AND status = 'posted' AND entry_date <> v_day;
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;

  -- the refund voucher first: its trigger moves the till row's period and the voucher journal
  UPDATE vouchers v SET voucher_date = v_day
    FROM treasury t
   WHERE v.treasury_id = t.id AND t.reference_id = p_id
     AND t.category NOT IN ('إلغاء سند', 'return_cancel', 'purchase_return_cancel')
     AND v.voucher_date <> v_day
     AND NOT public.ledger_period_closed(v_tenant, v.voucher_date);
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  UPDATE treasury t SET transaction_date = v_day, created_at = v_dated
   WHERE t.reference_id = p_id AND t.category NOT IN ('إلغاء سند', 'return_cancel', 'purchase_return_cancel')
     AND t.transaction_date <> v_day
     AND NOT public.ledger_period_closed(v_tenant, t.transaction_date);
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;

  -- stock: the stock reports read the return's own date (stock_balance_as_of / branch_stock_report);
  -- stock_movements is the immutable log of when the quantity was entered and is not re-dated
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.return_sync_dates(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.return_dates_sync_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.return_sync_dates(CASE WHEN TG_TABLE_NAME = 'returns' THEN 'sale_return' ELSE 'purchase_return' END, NEW.id);
  RETURN NULL;
END $function$;

CREATE OR REPLACE TRIGGER zz_return_dates_sync AFTER UPDATE OF invoice_date ON public.returns
  FOR EACH ROW WHEN (OLD.invoice_date IS DISTINCT FROM NEW.invoice_date) EXECUTE FUNCTION public.return_dates_sync_trg();
CREATE OR REPLACE TRIGGER zz_return_dates_sync AFTER UPDATE OF invoice_date ON public.purchase_returns
  FOR EACH ROW WHEN (OLD.invoice_date IS DISTINCT FROM NEW.invoice_date) EXECUTE FUNCTION public.return_dates_sync_trg();

-- every existing return once
DO $b$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT 'sale_return' AS k, id FROM returns UNION ALL SELECT 'purchase_return', id FROM purchase_returns LOOP
    n := n + public.return_sync_dates(r.k, r.id);
  END LOOP;
  RAISE NOTICE 'return rows re-dated: %', n;
END $b$;
