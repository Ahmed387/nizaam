# Project rules

- Stock movements use document operational dates, never `created_at`, so history and point-in-time balances match the event day.
- Set stock-ledger context with `public.stock_mv_ctx(...)` immediately before quantity changes in transfer RPCs.
- Validate backdated transfers transactionally via `stock_balance_as_of`; block insufficient stock without override.
- Voucher journals follow `voucher_date`; `uq_journal_entries_voucher_source` prevents duplicate live entries.
- Date filters use `cairoDate.ts`: Cairo bounds for timestamps and plain-day comparison for SQL dates.
- Write recipient/notes only via `set_document_annotations` so financial fields stay untouched.
- New-document recipient is the signed-in user via `LockedRecipientInput` and stays read-only in edits.
- Compute contact running balances before filters; date views add a synthetic prior-balance row.
- Render row `#` only through `DataTable.indexColumn` and `toArabicAlphabetIndex`.
- Derive treasury references/notes with format helpers; never rewrite stored ledger text.
- Reads over 1,000 rows use `fetchAllRows`, stable `.order("id")`, and lean columns.
- Save sales only via atomic `process_sale_full`; it enforces shifts and admin-only backdating.
- Voucher cancellation posts a reversing row via `cancel_voucher`; never delete treasury history.
- Cap sale-return refunds server-side at actual cash/transfer paid; remainder becomes credit.
- Default today values use `cairoTodayDay()`, never UTC slicing.
- Contact credit deposits use only `MAIN-TREASURY`; `PARTNER-CASH` is partner-capital-only, and neither is operational.
- Admin financial branch reports use `contact_branch_balances` for branch debt, `get_branch_wallet_balances` for cash, and `v_contact_balances.ledger_balance` for company debt so management credit stays separate.
- Treasury Overview presents active under-account contact balances from negative `v_contact_balances.credit_balance` as a separate informational card; never add them to treasury cash or flow totals.
