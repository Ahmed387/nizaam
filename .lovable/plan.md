# FIFO Batch Tracking — Edit Invoice & Sale Returns

This is a large, multi-layer change (DB schema + RPC functions + 3 UI flows + realtime). I'll ship it in clear phases so each step is reviewable.

## Phase 1 — Database Schema

**`invoice_items`** add columns:
- `batch_id uuid` (FK → product_batches, nullable, ON DELETE SET NULL)
- `batches_consumed jsonb` (nullable) — `[{batch_id, qty_taken, cost_price}]`
- `fully_returned boolean default false`
- `returned_quantity numeric default 0`
- `net_quantity numeric generated always as (quantity - returned_quantity) stored`
- `original_unit_cost numeric` (preserved across edits)

**`product_batches`** add:
- `restore_count integer default 0`
- `batch_type text default 'purchase'` (values: `purchase`, `return_restored`, `adjustment`)
- `last_restored_at` already exists

**Indexes:** `invoice_items(batch_id)`, `product_batches(product_id, created_at)` for FIFO ordering.

**Realtime:** add `invoice_items`, `product_batches`, `returns` to `supabase_realtime` publication.

## Phase 2 — RPC Functions (SECURITY DEFINER)

1. `consume_product_batches(_product_id, _qty, _branch_id) → jsonb`
   - Walk batches FIFO (oldest `created_at` first, `quantity_remaining > 0`), deduct, return `{batches:[{batch_id,qty_taken,cost_price}], weighted_unit_cost}`.
   - If insufficient stock, fall back: consume what's available and return remainder (caller decides).

2. `restore_batches_from_item(_invoice_item_id) → void`
   - Reads `batches_consumed`, restores `quantity_remaining` in reverse (LIFO), bumps `restore_count`, sets `last_restored_at`.
   - If a batch no longer exists, creates a new `batch_type='return_restored'` batch with `cost_price = original_unit_cost`, logs to `audit_log`.

3. `edit_invoice(_invoice_id, _customer_id, _items)` — rewrite existing RPC to:
   - For each existing item: call `restore_batches_from_item`.
   - Delete old items, re-insert new ones, calling `consume_product_batches` per line.
   - Persist `batch_id` (when single batch) or `batches_consumed` (when multi), and `unit_cost_at_sale = weighted_unit_cost`.
   - Recalculate invoice subtotal/discount/total. Preserve original payments.

4. `register_sale_return(_invoice_id, _items)` — wraps existing return logic:
   - For each return line, call `restore_batches_from_item` proportionally.
   - Update `invoice_items.returned_quantity`, `fully_returned`.
   - Recompute `profit_amount` on remaining qty: `(unit_price - unit_cost_at_sale) * net_quantity`.
   - Release matching `inventory_reservations`.

## Phase 3 — Frontend Changes

**`NewSale.tsx`**
- After inserting invoice header, for each line call `consume_product_batches` and store the returned `batch_id`/`batches_consumed`/`unit_cost_at_sale` on the `invoice_items` insert.

**`EditInvoiceDialog.tsx`**
- Add an AlertDialog confirmation before save: *"تعديل الفاتورة سيؤثر على تكلفة المنتجات وأرباح هذه الفاتورة. هل تريد المتابعة؟"*
- Calls the rewritten `edit_invoice` RPC (same signature — no callsite changes needed elsewhere).
- Permission gate: Manager/Admin only (hide edit button otherwise — already done via existing role checks; verify).

**`NewSaleReturn.tsx`**
- Switch to `register_sale_return` RPC so batch restoration runs server-side atomically.
- UI unchanged.

**`/admin/profitability` (ProfitabilityReport.tsx)**
- Show badges: `تم التعديل` when `invoices.edited_at is not null`, `يشمل مرتجع` when `returned_quantity > 0` on any line.
- Tooltip with original vs updated profit (uses `original_unit_cost` vs `unit_cost_at_sale`).
- Net profit column = profit on `net_quantity`.

## Phase 4 — Realtime

Add `useRealtimeRefresh` subscriptions on:
- `EditInvoiceDialog` view & `InvoiceView` — subscribe to `invoice_items` filtered by `invoice_id`; show "جارٍ التعديل" pill when another session has the dialog open (use a lightweight `editing_by` column or a presence channel — I'll use presence since it doesn't need a column).
- Cashier `NewSale` / `Inventory` — subscribe to `product_batches` to refresh available qty live.
- `ProfitabilityReport` & invoice list — subscribe to `returns` and `invoice_items` to flip badges live.

All channels cleaned up in `useEffect` return.

## Phase 5 — Backfill & Backwards Compatibility

- Old `invoice_items` rows have `batches_consumed = null` → edit/return code path checks for null and falls back to the legacy quantity-only behavior (no batch restoration), per spec.
- One-time backfill: set `original_unit_cost = unit_cost_at_sale`, `returned_quantity = 0`, `fully_returned = false` for existing rows.

## Edge Cases Covered

| Case | Handling |
|---|---|
| Batch deleted after sale | `restore_batches_from_item` creates `return_restored` batch + audit log |
| Edit increases qty beyond original batch | After restoring, `consume_product_batches` walks FIFO into next batch; `batches_consumed` reflects both |
| Edit decreases qty | Restore full original batches, then re-consume only the new (smaller) qty from same oldest batch |
| Pre-fix invoices (no `batches_consumed`) | Skip restoration, just adjust `products.quantity` like before |

## Execution Order

1. Migration (Phase 1 + Phase 2 SQL — single migration call).
2. After migration approved → update `NewSale.tsx`, `EditInvoiceDialog.tsx`, `NewSaleReturn.tsx`, `ProfitabilityReport.tsx`, add realtime hooks.
3. Verify build, spot-check the three flows in preview.

Ready to start with the migration on your go-ahead.
