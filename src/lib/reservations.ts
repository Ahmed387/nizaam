import { supabase } from "@/integrations/supabase/client";

export interface ReserveResult {
  ok: boolean;
  error?: "insufficient" | "product_not_found" | string;
  reservation_id?: string;
  stock?: number;
  reserved_by_others?: number;
  available?: number;
  available_for_me?: number;
  requested?: number;
  expires_at?: string;
}

/** Get current available qty for a product in a branch (stock − active reservations). */
export async function getAvailableQuantity(productId: string, branchId: string): Promise<number> {
  const { data } = await supabase.rpc("get_available_quantity" as any, {
    p_product_id: productId,
    p_branch_id: branchId,
  });
  return Number(data ?? 0);
}

/** Try to (re)serve `quantity` units of `productId` for the current draft. */
export async function reserveStock(args: {
  productId: string;
  branchId: string;
  draftId: string;
  quantity: number;
  cashierName?: string | null;
}): Promise<ReserveResult> {
  const { data, error } = await supabase.rpc("reserve_stock" as any, {
    p_product_id: args.productId,
    p_branch_id: args.branchId,
    p_draft_id: args.draftId,
    p_quantity: args.quantity,
    p_cashier_name: args.cashierName ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return (data as any) as ReserveResult;
}

/** Release all reservations for a draft. status defaults to 'cancelled'. */
export async function releaseDraftReservations(
  draftId: string,
  status: "completed" | "cancelled" | "expired" = "cancelled",
): Promise<void> {
  await supabase.rpc("release_reservations_for_draft" as any, {
    p_draft_id: draftId,
    p_status: status,
  });
}

/** Release a single reservation (manager override). */
export async function releaseReservation(id: string, status: "cancelled" | "completed" = "cancelled") {
  await supabase.rpc("release_reservation" as any, { p_id: id, p_status: status });
}

/** Send a release call that survives tab close. */
export function releaseDraftBeacon(draftId: string) {
  try {
    const url = `${(import.meta as any).env.VITE_SUPABASE_URL}/rest/v1/rpc/release_reservations_for_draft`;
    const apikey = (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY ?? (import.meta as any).env.VITE_SUPABASE_ANON_KEY;
    const blob = new Blob(
      [JSON.stringify({ p_draft_id: draftId, p_status: "cancelled" })],
      { type: "application/json" },
    );
    // sendBeacon doesn't support custom headers; fall back to fetch keepalive
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey,
        Authorization: `Bearer ${apikey}`,
      },
      body: blob,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
