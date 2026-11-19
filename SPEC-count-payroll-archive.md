# Spec Delta: partial count · payroll fixes · historical archive — V1

Status: proposed (owner 2026-11-19)

## Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| partial-count | open a stock count on part of a branch's items | 0267 (count flow) |
| payroll-fixes | salary month, cancel with advance, Friday attendance, switches | — |
| hist-archive | «الأرشيف التاريخي» accepts «سهل» files of any company / branch | — |

Build order: payroll-fixes (bugs in a money path) → hist-archive → partial-count. Independent; one migration each.

---

## 1. partial-count

### Objective
Count one part of a branch instead of all ~935 items; items outside the count are not touched.

### New behaviour
- «بدء جرد جديد» asks «جرد كامل» or «جرد جزئي»; partial picks items by any mix of:
  - words in the item name (e.g. «غسالة», «شاشة»), because no product has a category or brand today (0 of 2,802);
  - items picked by name / code;
  - items that moved (sale / purchase / return / transfer) between two dates.
- The picked list is shown with its count before opening; the count session stores only those lines (`create_inventory_session(branch, notes, product_ids[])`).
- Review / approval / cancel unchanged; the report says «جرد جزئي — N صنف».
- One open count per branch still holds (partial or full).

### Success criteria
- A partial count of 3 items changes only those 3 (quantity, log, batches, journal); the other items keep everything.
- Empty pick refused; ids of another branch refused.
- Rollback SQL check + unit test of the picker + e2e of the dialog.

---

## 2. payroll-fixes (found by the 2026-11-19 test, rollback-only)

| # | Found | Example | Fix |
|---|---|---|---|
| P1 | Cancelling a salary that deducted an advance fails | Sep salary of محمد ياسر with 500 advance deduct → «duplicate key uq_advance_payments_advance_month» | the return row must not clash: unique key covers the salary (add `salary_id`, unique on (advance_id, salary_id, sign)) |
| P2 | A status on a day off counts as a paid day | محمد ياسر Sep: absent 10 + 12/9, «leave» on Fri 4/9 → deducted 1 day (153.85) instead of 2 (307.69) | only working days count; a day off with «present» is shown as «يوم إضافي» (owner decides — Q2) |
| P3 | The salary is booked on the PAY day, not the salary month | Sep salary paid 19/11 → expense, voucher and till in November | owner decides (Q1) |
| P4 | Pay / cancel salary follow the role, not the switches | branch manager pays even if «المرتبات» is closed for him | `require_switch('salaries.create' / '.delete', branch)` like 0264 |
| P5 | Cash till of سكة (−158,005) and شلبى (−199,061) is below zero → every cash salary / advance there is refused | «رصيد النقدي مش كفاية» | information only — pay by another vessel or fix the till (owner) |
| P6 | Hourly day: 11 h counts as 1 day (no overtime) | 1/9: 11 h | owner decides (Q3) |

Success: rollback SQL checks for P1–P4; e2e of the pay / cancel buttons per role.

---

## 3. hist-archive

### Found
- Branch names are fixed in the database to A&N's three old names (`CHECK branch_name IN ('معرض عبد المنعم','مخزن شلبي','معرض شلبي اللي اتقفل')`): سكة تلة files cannot be uploaded, and no other company can upload anything.
- Unique keys (branch_name, doc_type, invoice_no, date) ignore the company: two companies with the same branch name overwrite each other.
- The page reads every row (≈ 30,000 vouchers, 12,000 invoices) in the browser.
- The file type is chosen by hand; the «سهل» title already says it («تقرير فواتير البيع ل … سنة 2025»).

### New behaviour
- The archive branch = free text per company (a list of its own archive branches + any current branch); no fixed names.
- Unique keys include `tenant_id`.
- Upload: one or many files or a zip; type and branch guessed from the «سهل» title, shown for confirmation; a file already uploaded (same SHA-256) is skipped.
- Summaries (per year / month / branch: sales, purchases, returns, profit, expenses by item) computed on the server; the page reads totals, opens rows on demand.
- Stays outside the system: no ledger, till, stock or report reads it (AGENTS rule kept).

### Success
- Upload of a «سهل» 2025 sales file for سكة تلة works; same file twice → nothing doubles.
- Another company can upload its own branch names; A&N rows unchanged.
- Page opens < 3 s on A&N's archive.

---

## Boundaries
- Always: dry-run on live data in a rolled-back block; failing test first; vitest + tsc before push; AGENTS bullet.
- Ask first: P3 / P2 / P6 policy; archive branch mapping.
- Never: touch the current-system ledger from the archive; delete archive rows except by the owner's own delete.

## Open questions
- Q1 salary month: book the salary on the last day of its month (Sep salary in September) or keep the pay day?
- Q2 day off with «present»: extra paid day, or ignore?
- Q3 hours above the working day: pay overtime (rate = day ÷ hours), or ignore?
- Q4 archive branches: keep the old names («مخزن شلبي» …) or map each file to the current branch (شلبى / عبدالمنعم / سكة)?
- Q5 partial count: which of the three pickers first (all three are cheap)?
- Q6 archive: send me one or two old «سهل» files (e.g. 2025 sales of سكة) to test with real columns.
