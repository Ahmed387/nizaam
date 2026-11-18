# Spec Delta: Inter-branch mirror documents 1/9/2026 → today

Status: implemented (2026-11-18, migration 0252)

## Objective
Owner 2026-11-18: «فواتير البيع في شلبي للمعارض تتعمل فواتير شراء لكل معرض بداية من 1.9.2026 حتي وقتنا هذا»،
«المرتجعات … نفذ»، «مرتجعات بس» (no money), «ده للفترة اللي فاتت بس»، «وكذلك البيع في المعارض يتعمل قصاده شراء في شلبي ونفس النظام في المرتجعات».
Every document between شلبى and a branch (سكة تلة / عبدالمنعم) dated 1/9/2026 → today that exists on ONE side only gets its mirror on the other side.

## Current Behavior (read 2026-11-18)
| Direction | 1/9 → 28/10 | 29/10 → today |
|---|---|---|
| شلبى sale → branch purchase (سكة) | 75 / 75 mirrored | **18 missing, 1,133,095** |
| شلبى sale → branch purchase (عبدالمنعم) | 35 / 35 mirrored | **19 missing, 417,895** |
| شلبى sale return → branch purchase return (سكة) | 45 / 53 | **8 missing, 89,825** |
| شلبى sale return → branch purchase return (عبدالمنعم) | 39 / 41 | **7 missing, 66,000** |
| branch sale → شلبى purchase | 16 / 16 mirrored | none |
| branch sale return → شلبى purchase return | none | none |

The 10 unmirrored returns before 29/10 are the 0175 decision (شلبى corrections of its own over-bill — never copied) and stay.
Why the gap: the 29/10 → 11/11 «سهل» loads gave each branch only its own files (no mirrors).

## New Behavior
- Each missing شلبى sale → a purchase invoice in the branch from «المخزن الرئيسي»: same day, same items (same code in that branch), quantities, prices, discount, total; credit (no payment); note «مقابل فاتورة شلبى IN… — سهل N».
- Each missing شلبى sale return → a purchase return in the branch on the mirror purchase of its invoice: same day, items, quantities, values; on account (no money).
- Then `recost_product_sales` of the touched codes in the branch (from the earliest day), `ledger_sync_safe` for «المخزن الرئيسي».
- One-time, for this period only; no automatic mirroring afterwards.

## Success Criteria
- After: 0 unmirrored شلبى sales / returns to the branches dated ≥ 29/10 (same matching rule: total ±1, day −5..+30).
- Each mirror's total = its source total to the piaster; Σ purchases سكة +1,133,095, عبدالمنعم +417,895; returns −89,825 / −66,000.
- Tills unchanged in all branches (no money row); tills = books; ledger unexplained 0; profit_reconciliation sales / returns / cost = 0 differences per branch; 1910 = 0.
- Branch stock +(purchased − returned) per code; nothing in شلبى changes.
- Dry-run (rolled back) first, numbers shown, then the real run.

## Boundaries
- Only through the system's own write paths (purchase save / purchase return RPCs) as the owner; import mode only if a path refuses a legitimate old date / negative stock.
- Never touch the 10 pre-29/10 0175 returns, money, vouchers, or شلبى documents.
- Sequences saved and put back after every dry-run.
