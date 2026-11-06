-- 0170: the end of the «سهل» import — re-sync the journal of every active sale return (`sync_sale_return_journal`).
-- The returns were saved while their invoice lines still had no average cost (import mode, 0156), so their «cost back»
-- line (Dr 1300 / Cr 5100) was posted with 0; `recost_product_sales` (0165) re-synced only the returns of invoices whose
-- line cost changed. `profit_reconciliation(2026-01-01, 2026-10-28)` after the import: sales and returns equal, invoice
-- cost equal to the piaster, but cost back short — شلبى 2,056,277.50, سكة 232,487.90, عبدالمنعم 125,191.01 (dry-run on
-- 100 returns: +538,063.22, 1.2 s). Same system function as every edit / recost; nothing else changes.
DO $mig$
DECLARE v_owner uuid; r record; n int := 0;
BEGIN
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  IF v_owner IS NULL THEN RETURN; END IF;   -- another database (no A & N branches): nothing to do
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  FOR r IN SELECT rt.id FROM public.returns rt JOIN public.branches b ON b.id = rt.branch_id
            WHERE rt.status = 'active' AND b.tenant_id = (SELECT tenant_id FROM public.branches WHERE code = 'FR-005')
            ORDER BY rt.invoice_date, rt.id LOOP
    PERFORM public.sync_sale_return_journal(r.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '0170: % sale return journals re-synced', n;
END
$mig$;
