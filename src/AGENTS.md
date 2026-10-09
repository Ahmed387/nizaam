# Frontend rules

- New-document recipient is the signed-in user via `LockedRecipientInput` and stays read-only.
- Render list-level `#` columns through `DataTable.indexColumn` as 1-based numeric indices with the correct server-page offset — why: numbering stays consistent and continuous across pagination.
- Derive treasury labels with format helpers; never rewrite stored ledger text.
- Every statistical card uses `MetricHint` with meaning, source, and exact formula.
- Wide tables use DataTable `minTableWidth` (wrapper gets `data-wide`); `index.css` compact CSS stays `:not([data-wide])`-guarded.
- The six document tabs in `Invoices.tsx` use `UnifiedDocumentFilters` + `UnifiedDocumentMetrics`; card values and click-to-filter both come from `docFacts` in `lib/documentMetrics.ts` — why: one formula per card, cards and table never diverge.
- Every document contact picker uses `ContactLookup` → `search_branch_contacts` RPC (eligibility: not archived, type+both, own branch / no branch / activity in branch; server-side search) — why: one rule everywhere, no 1,000-row cap.
- The Contacts page reads through the `contacts_page` RPC (search, type tab, balance filter, paging, counts and totals in one jsonb result) — why: all contacts searchable, no 1,000-row cap.
