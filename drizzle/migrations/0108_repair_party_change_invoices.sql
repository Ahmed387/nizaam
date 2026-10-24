-- 0108 — Repair the two invoices hit by the party-change bug (owner: «طبقها علي نفس الفاتورتين», 2026-10-24)
--
-- IN05108 (معرض سكة تلة, 3,150 cash): customer changed مايكل الجمل → مايكل جمال; the money was on nobody,
--   مايكل جمال showed 3,150 owed, and the branch till was 3,150 above its cash account (ledger_gl_reconciliation).
-- IN04936 (معرض عبدالمنعم الغربي, 8,500 vodafone): walk-in → محمود احمد امين; the money stayed on the walk-in,
--   dated 16/10 instead of 30/9 (Cairo 01/10).
--
-- Same path as the fixed trigger (0107): release the walk-in money, then sync the customers (ledger + GL).
-- Till rows, vouchers, invoice amounts: untouched. Only the ledger (money_movements / allocations) and its GL entries.

DO $fix$
DECLARE a uuid; b uuid; ca uuid; cb uuid;
BEGIN
  SELECT id, contact_id INTO a, ca FROM public.invoices WHERE invoice_number = 'IN05108';
  SELECT id, contact_id INTO b, cb FROM public.invoices WHERE invoice_number = 'IN04936';
  PERFORM set_config('ledger.done', '', true);
  PERFORM public.ledger_sync_safe(NULL, b, 'repair_0108');   -- walk-in money of IN04936 leaves the walk-in
  PERFORM public.ledger_sync_safe(cb, NULL, 'repair_0108');  -- … and lands on محمود احمد امين
  PERFORM public.ledger_sync_safe(ca, NULL, 'repair_0108');  -- IN05108 money lands on مايكل جمال

  IF public.ledger_doc_open('invoice', a) <> 0 OR public.ledger_doc_open('invoice', b) <> 0 THEN
    RAISE EXCEPTION '0108: invoices still open (IN05108 %, IN04936 %)', public.ledger_doc_open('invoice', a), public.ledger_doc_open('invoice', b);
  END IF;
  IF EXISTS (SELECT 1 FROM public.ledger_sync_errors WHERE context = 'repair_0108') THEN
    RAISE EXCEPTION '0108: ledger sync error';
  END IF;
END
$fix$;
