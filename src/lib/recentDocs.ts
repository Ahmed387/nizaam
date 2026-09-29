import { supabase } from "@/integrations/supabase/client";

export type RecentDoc = {
  id: string;
  branch_id: string | null;
  branch_name?: string | null;
  number: string;
  party: string;
  contact_id?: string | null;
  amount: number;
  created_at: string;
  kind: "sale" | "purchase" | "sale_return" | "purchase_return";
  kindLabel: string;
  path: string;
};

const LABELS: Record<RecentDoc["kind"], string> = {
  sale: "فاتورة بيع",
  purchase: "فاتورة شراء",
  sale_return: "مرتجع بيع",
  purchase_return: "مرتجع شراء",
};

/** Last N documents across sales, purchases and returns. Pass branchId to scope to one branch. */
export async function fetchRecentDocs(limit = 5, branchId?: string): Promise<RecentDoc[]> {
  const scope = (q: any) => (branchId ? q.eq("branch_id", branchId) : q);

  const [inv, shp, sret, pret] = await Promise.all([
    scope(supabase.from("invoices").select("id, branch_id, invoice_number, contact_id, total, created_at, contacts:contact_id(name), branches(name)")).order("created_at", { ascending: false }).limit(limit),
    scope(supabase.from("shipments").select("id, branch_id, shipment_number, contact_id, total_cost, created_at, contacts:contact_id(name), branches(name)")).order("created_at", { ascending: false }).limit(limit),
    scope(supabase.from("returns").select("id, branch_id, return_number, total_refund, created_at, branches(name)")).order("created_at", { ascending: false }).limit(limit),
    scope(supabase.from("purchase_returns").select("id, branch_id, return_number, contact_id, total_amount, created_at, contacts:contact_id(name), branches(name)")).order("created_at", { ascending: false }).limit(limit),
  ]);

  const map = (rows: any[] | null, kind: RecentDoc["kind"], num: string, amt: string, pathFor: (r: any) => string): RecentDoc[] =>
    (rows ?? []).map((r: any) => ({
      id: r.id,
      branch_id: r.branch_id,
      branch_name: r.branches?.name ?? null,
      number: r[num] ?? "—",
      party: r.contacts?.name ?? "—",
      contact_id: r.contact_id ?? null,
      amount: Number(r[amt] ?? 0),
      created_at: r.created_at,
      kind,
      kindLabel: LABELS[kind],
      path: pathFor(r),
    }));

  const all = [
    ...map(inv.data, "sale", "invoice_number", "total", (r) => `/branch/${r.branch_id}/sales/${r.id}`),
    ...map(shp.data, "purchase", "shipment_number", "total_cost", (r) => `/branch/${r.branch_id}/shipments/${r.id}`),
    ...map(sret.data, "sale_return", "return_number", "total_refund", (r) => `/branch/${r.branch_id}/sale-returns/${r.id}`),
    ...map(pret.data, "purchase_return", "return_number", "total_amount", (r) => `/branch/${r.branch_id}/purchase-returns/${r.id}`),
  ];

  return all
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
}

export const RECENT_DOC_KIND_CLASS: Record<RecentDoc["kind"], string> = {
  sale: "bg-success/15 text-success border-success/30",
  purchase: "bg-primary/15 text-primary border-primary/30",
  sale_return: "bg-warning/15 text-warning border-warning/30",
  purchase_return: "bg-destructive/15 text-destructive border-destructive/30",
};
