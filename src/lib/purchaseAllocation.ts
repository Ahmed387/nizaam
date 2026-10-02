import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Supplier payments are account-level (not tied to one shipment). Per supplier and branch,
 * all active supplier payment vouchers are allocated FIFO to that supplier's purchase
 * invoices (oldest invoice_date first). Returns shipmentId → { paid, remaining }.
 */
export async function fetchPurchaseAllocation(branchId: string, contactIds: string[], signal?: AbortSignal) {
  const out = new Map<string, { paid: number; remaining: number }>();
  const ids = [...new Set(contactIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [ships, pays] = await Promise.all([
      fetchAllRows<any>(() => (supabase.from("shipments").select("id, contact_id, total_cost, invoice_date, created_at")
        .eq("branch_id", branchId).in("contact_id", chunk).order("id") as any).abortSignal(signal)),
      fetchAllRows<any>(() => (supabase.from("vouchers" as any).select("id, party_id, amount")
        .eq("branch_id", branchId).eq("type", "payment").eq("status", "active").eq("party_type", "supplier")
        .in("party_id", chunk).order("id") as any).abortSignal(signal)),
    ]);
    const pool = new Map<string, number>();
    for (const p of pays) pool.set(p.party_id, (pool.get(p.party_id) ?? 0) + (Number(p.amount) || 0));
    ships.sort((a, b) => String(a.invoice_date ?? a.created_at).localeCompare(String(b.invoice_date ?? b.created_at)) || String(a.created_at).localeCompare(String(b.created_at)));
    for (const s of ships) {
      const total = Number(s.total_cost) || 0;
      const avail = pool.get(s.contact_id) ?? 0;
      const paid = Math.min(total, avail);
      pool.set(s.contact_id, avail - paid);
      out.set(s.id, { paid: r2(paid), remaining: r2(Math.max(0, total - paid)) });
    }
  }
  return out;
}
