-- 0127: the two count-surplus entries of 2026-10-08 (مكتب ومخزن شلبى) are reversed on their own day (owner «نفذ», 2026-10-28)
--
-- ADJ-20261008-C95842 (JE-202610-0583, 90,150) and ADJ-20261008-1CB22B (JE-202610-0596, 12,485) posted
-- Dr 1300 Inventory / Cr 4300 «Inventory Count Surplus»: +102,635 of profit in the books for pieces no document
-- explains. Owner rule 2026-10-11: such quantities stay as counted with NO journal entry. A reversing entry dated
-- 2026-10-08 cancels both (cancel-only: the originals stay, marked reversed_by). The stock quantities do not change.

DO $mig$
DECLARE a record;
BEGIN
  PERFORM set_config('app.reverse_on_original_date', '1', true);
  FOR a IN SELECT sa.id, sa.tenant_id, sa.adjustment_number FROM public.stock_adjustments sa
            WHERE sa.adjustment_number IN ('ADJ-20261008-C95842', 'ADJ-20261008-1CB22B') LOOP
    PERFORM public.reverse_journal_for_source(a.tenant_id, 'stock_adjustment', a.id,
      'عكس فائض جرد بدون مستند (قرار المالك 2026-10-11) — ' || a.adjustment_number);
  END LOOP;
  PERFORM set_config('app.reverse_on_original_date', '', true);
END
$mig$;
