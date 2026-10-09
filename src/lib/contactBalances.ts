// One side of a contact's balance from the unified ledger (Step 6C). Customer and supplier sides are
// never netted: a sale / sale return reads the customer side, a purchase / purchase return the supplier side.
// customer: + the customer owes us, − his advance with us; supplier: + we owe him, − our advance with him.
import { fetchSideBalance, type Side } from "@/lib/ledger";

export async function fetchContactBalance(id: string | null | undefined, side: Side = "customer"): Promise<number> {
  if (!id) return 0;
  const sb = await fetchSideBalance(id).catch(() => null);
  return Number((side === "customer" ? sb?.customer_balance : sb?.supplier_balance) ?? 0);
}
