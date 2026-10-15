# Frontend rules

- New-document recipient is the signed-in user via `LockedRecipientInput` and stays read-only.
- Render list-level `#` columns through `DataTable.indexColumn` as 1-based numeric indices with the correct server-page offset — why: numbering stays consistent and continuous across pagination.
- Derive treasury labels with format helpers; never rewrite stored ledger text.
- Every statistical card uses `MetricHint` with meaning, source, and exact formula.
- Wide tables use DataTable `minTableWidth` (wrapper gets `data-wide`); `index.css` compact CSS stays `:not([data-wide])`-guarded.
- The six document tabs in `Invoices.tsx` use `UnifiedDocumentFilters` + `UnifiedDocumentMetrics`; card values and click-to-filter both come from `docFacts` in `lib/documentMetrics.ts` — why: one formula per card, cards and table never diverge.
- Every document contact picker uses `ContactLookup` → `search_branch_contacts` RPC: every customer / supplier of the company (not archived, type + both), own branch first, paged 50 at a time while scrolling, any letter filters on the server (name / phone); other branches' contacts show their branch name — why: owner rule (0085), one picker everywhere, no 1,000-row cap.
- The sale / purchase cancel dialogs use `CancelMoneyChoice` with `document_cancel_preview`: one question about the money paid ON the document (credit / refund with method / void) — why: owner rule (0085).
- The Contacts page reads through the `contacts_page` RPC (search, type tab, balance filter, paging, counts and totals in one jsonb result) — why: all contacts searchable, no 1,000-row cap.
- An automatic voucher carries its document's notes (" — ملاحظات: …" after its own text) and the document's recipient when it has none (migration 0087): filled on insert, on the plan link, and again whenever the document's notes / recipient change (`doc_notes_to_vouchers_trg`); text only — amounts, dates, till and ledger untouched.
- `cancel_sale_return`'s guard uses the alias `gr` (the alias `r` clashed with its record variable and made every sale-return cancel fail) — migration 0088.
- «إيصال التحويل» (owner rule 2026-10-15): every payment form shows an optional receipt upload for non-cash methods (`PaymentProofInput`, inside `PaymentMethodPicker` and the custom forms); after the save `attachPaymentProofs` (src/lib/paymentProofs.ts) uploads the files to the voucher of THAT payment (record_type `voucher`, found by user / method / amount / branch since `proofClock()`). Never send the files to an RPC. Documents show `DocumentMoneyMovements` (movements count + attachments count, 📎 per voucher); treasury and the contact file show 📎 per movement.
