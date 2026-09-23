# Fix report dates and stock movement history

## Phase 1 audit findings (read-only, nothing changed)

**The accounting ledger is already correct.** Journal entries are dated from the invoice date, and the income statement, the KPI screen and the net-profit calculation all use that date.

**These screens still use the save date instead of the invoice date:**
- Admin dashboard: today's sales, and today's sales per branch
- Profitability report: date filter, sorting and the date shown
- Monthly profit summary: month filter
- Owner cockpit: 30-day KPIs, trend line and monthly groups
- Financial dashboard: 180-day window and monthly groups
- Executive insights: period filter for invoices and pre-orders
- Admin reports and branch reports: invoices, returns and payments, including CSV export dates
- The shared profit engine: invoices use the save date while vouchers use the voucher date, so the two can fall into different periods
- Contact statement: return rows only

**These screens are already correct:** the invoices list, the aging report, the income statement and the KPI dashboard.

**Stock movements:**
- There is no separate movement table. The screen builds its history from sales, returns, purchases, purchase returns, opening stock, stock adjustments and transfers.
- There is no hidden current-month filter and no row limit, so sales are not being hidden by a date filter.
- The real problems:
  1. Sale lines are dated by their save date, so a backdated invoice appears in the wrong position.
  2. Stock count adjustments saved as inventory adjustments are not included.
  3. Cancelled invoices are excluded without any label.
  4. When a product has stock but no recorded opening balance, nothing explains where that stock came from.

## What I will change (screens and reports only, no database changes)

1. **One shared date helper** that uses the invoice date and falls back to the save date only for old records that have no invoice date. Every report above will use it.
2. **Fix each screen listed above** to filter, group and sort by the invoice date (voucher date for vouchers). An invoice dated 15 January will then count only in January everywhere.
3. **Stock movements screen:**
   - Date sales and all other documents by their invoice date
   - Include inventory count adjustments
   - Add filters: all time (default), custom date range, branch, and movement type
   - Show an "Opening / unrecorded balance" row when current stock is higher than the recorded movements explain
4. **Verification:** build and type checks pass with 0 errors, a browser test of a January date range on the reports and the stock movements screen, and a recount of the protected totals (11,842 invoices / 26,092 vouchers / 59 deposits / 783 expenses / 1,776 product rows). I will not create any test invoices.

## Decision for you (STOP & ASK)

The directive asks for a permanent `stock_movements` record written automatically for every stock change. That table does not exist today. Building it means new database triggers on sales, purchases, returns, adjustments and transfers, plus filling in past history, all running inside the same transaction as each sale. That is a bigger and riskier change.

This plan fixes what you can see without it. If you also want the permanent movement table, tell me when you approve, and I will add it as a separate step with its own safety checks.

## Technical details
- New `src/lib/docDate.ts`: `docDate(row)`, which returns `invoice_date ?? created_at`, plus a query helper that applies `gte/lte` on `invoice_date`.
- Files: admin/Dashboard, ProfitabilityReport, MonthlyProfitSummary, OwnerCockpit, FinancialDashboard, ExecutiveInsights, admin/Reports, branch/Reports, lib/profitEngine (`buildInv`), branch/ContactStatement (returns), branch/StockMovements.
- "Today" is calculated in Cairo time and compared against `invoice_date`.
