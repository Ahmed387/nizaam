# Project rules

- Stock movements carry the document's operational date (`transfer_date` for transfers, `invoice_date` for sales/purchases/returns), never `created_at` — so product history and point-in-time balances match the day the event happened.
- Stock-ledger context is set explicitly with `public.stock_mv_ctx(...)` immediately before each `products.quantity` change inside transfer RPCs — relying on trigger firing order silently mislabelled transfers as adjustments.
- Backdated stock transfers are validated inside the same transaction via `public.stock_balance_as_of(branch, product, date)` and hard-blocked when insufficient — no client-side estimate, no user override.
- A voucher's posted journal entry follows its `voucher_date` through `trg_voucher_date_journal_sync`, and `uq_journal_entries_voucher_source` prevents a second live entry per voucher — keeps the general ledger dated with the voucher.
- All date-range filters go through `src/lib/cairoDate.ts` (`getCairoDayBounds` / `applyCairoRange`): timestamp columns get Cairo 00:00 → 23:59:59.999, SQL `date` columns compare plain days — prevents dropping the last day or leaking the next.
- «المستلم»/«الملاحظات» are written only via `public.set_document_annotations(kind, id, recipient, notes)` (`src/lib/docAnnotations.ts`) — touches just those two columns so amounts, dates and journal entries stay untouched.
