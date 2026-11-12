import { supabase } from "@/integrations/supabase/client";

/** Last purchase price of each product (0201): the newest active purchase invoice line. branchId null = every branch readable. */
export async function fetchLastPurchaseCosts(branchId: string | null): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (supabase.rpc as any)("products_last_purchase_cost", { p_branch_id: branchId }).order("product_id").range(from, from + 999);
    if (error) throw error;
    for (const r of (data ?? []) as any[]) out.set(r.product_id, Number(r.last_cost) || 0);
    if ((data ?? []).length < 1000) break;
  }
  return out;
}
