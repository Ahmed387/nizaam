import { supabase } from "@/integrations/supabase/client";

/**
 * What a till row belongs to (migration 0099, `treasury_row_links`): the customer / supplier account and the
 * document it came from — a sale's money through its invoice, a plan payment through its document, a return
 * through its invoice, a voucher cancel through the voucher it cancelled. Used by the till table and the voucher
 * tables («اسم الحساب», «المصدر»).
 */
export interface TreasuryLink {
  id: string;
  account_name: string | null;
  contact_id: string | null;
  src_type: "sale" | "purchase" | "sale_return" | "purchase_return" | null;
  src_id: string | null;
  src_number: string | null;
  voucher_id: string | null;
  voucher_number: string | null;
  voucher_status: string | null;
  voucher_source: string | null;
  cancelled_voucher_id: string | null;
  cancelled_voucher_number: string | null;
}

export const SRC_LABEL: Record<string, string> = {
  sale: "فاتورة بيع", purchase: "فاتورة شراء", sale_return: "مرتجع بيع", purchase_return: "مرتجع شراء",
};
const SRC_PATH: Record<string, string> = {
  sale: "sales", purchase: "shipments", sale_return: "sale-returns", purchase_return: "purchase-returns",
};
export const srcPath = (branchId: string, l: Pick<TreasuryLink, "src_type" | "src_id">) =>
  l.src_type && l.src_id ? `/branch/${branchId}/${SRC_PATH[l.src_type]}/${l.src_id}` : null;

/** Links of till rows by their treasury id (chunks of 500). */
export async function fetchTreasuryLinks(treasuryIds: (string | null | undefined)[], signal?: AbortSignal): Promise<Map<string, TreasuryLink>> {
  const ids = Array.from(new Set(treasuryIds.filter(Boolean) as string[]));
  const out = new Map<string, TreasuryLink>();
  for (let i = 0; i < ids.length; i += 500) {
    let q = supabase.rpc("treasury_row_links" as any, { p_ids: ids.slice(i, i + 500) } as any);
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of (data ?? []) as any[]) out.set(r.id, r as TreasuryLink);
  }
  return out;
}

/** «طريقة الدفع» of a till / voucher row in words. */
export function payMethodLabel(m?: string | null): string {
  const v = String(m ?? "cash").toLowerCase();
  if (v.includes("insta")) return "انستاباي";
  if (v.includes("vodafone") || v.includes("wallet") || v.includes("etisalat") || v.includes("orange")) return "محفظة";
  if (v.includes("bank") || v.includes("transfer") || v.includes("visa") || v.includes("card")) return "بنكي";
  if (v.includes("credit")) return "من تحت الحساب";
  return "كاش";
}
