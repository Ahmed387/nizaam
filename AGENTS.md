# Project rules

- Stock movements carry the document's operational date (`transfer_date` for transfers, `invoice_date` for sales/purchases/returns), never `created_at` — so product history and point-in-time balances match the day the event happened.
- Stock-ledger context is set explicitly with `public.stock_mv_ctx(...)` immediately before each `products.quantity` change inside transfer RPCs — relying on trigger firing order silently mislabelled transfers as adjustments.
- Backdated stock transfers are validated inside the same transaction via `public.stock_balance_as_of(branch, product, date)` and hard-blocked when insufficient — no client-side estimate, no user override.
- A voucher's posted journal entry follows its `voucher_date` through `trg_voucher_date_journal_sync`, and `uq_journal_entries_voucher_source` prevents a second live entry per voucher — keeps the general ledger dated with the voucher.
- All date-range filters go through `src/lib/cairoDate.ts` (`getCairoDayBounds` / `applyCairoRange`): timestamp columns get Cairo 00:00 → 23:59:59.999, SQL `date` columns compare plain days — prevents dropping the last day or leaking the next.
- «المستلم»/«الملاحظات» are written only via `public.set_document_annotations(kind, id, recipient, notes)` (`src/lib/docAnnotations.ts`) — touches just those two columns so amounts, dates and journal entries stay untouched.
- «المستلم» on new documents is always the signed-in user via `useCurrentUserName()` / `LockedRecipientInput` (`src/components/LockedRecipient.tsx`) and is read-only in edit dialogs — keeps an untamperable audit trail.
- Contact-statement running balances are calculated over the full chronological ledger before UI filters; a date-filtered view adds a synthetic «رصيد ما قبل الفترة» row — preserves the financial carry-over without changing ledger data.
- Row `#` columns are rendered only by `DataTable`'s `indexColumn` prop using `toArabicAlphabetIndex` from `src/lib/format.ts` — one central visual indexer instead of per-page index maps.
- Treasury operation numbers and notes are display-derived via `extractOperationReference` / `sanitizeOperationalDescription` in `src/lib/format.ts` — legacy UUID tags are hidden on screen while stored ledger text stays untouched.
- Any read that can exceed 1,000 rows (totals, reports, statements, exports) goes through `fetchAllRows` (`src/lib/fetchAll.ts`) with a stable `.order("id")` and lean columns — PostgREST silently caps responses at 1,000 rows.
- Sales are saved only through `public.process_sale_full` (invoice, treasury, notes, recipient, earlier credit, offset in one transaction; enforces open shift and admin-only backdating) — a dropped connection can't leave a half-saved invoice.
- Cancelling a voucher never deletes its treasury row; `cancel_voucher` posts a reversing row (category «إلغاء سند») — the drawer keeps a full audit trail.
- Sale-return money refunds are capped server-side (`allocate_sale_return_settlement`) at cash/transfer actually paid on the invoice; the rest becomes customer credit — offset/credit sales can't pay out cash.
- Default "today" values use `cairoTodayDay()` from `src/lib/cairoDate.ts`, never `toISOString().slice(0,10)` — UTC shows yesterday between 00:00 and 03:00 Cairo.
