/**
 * What the unified filter needs to know about a document that a movement list (contact file, item page) does not carry:
 * the item names in it, its payment method / vessel and its recipient (the user's name written on it).
 * Read in pieces of 200 ids per table; RLS decides what the user may read.
 */
import { supabase } from "@/integrations/supabase/client";
import type { DocumentFilters } from "@/components/documents/UnifiedDocumentFilters";

export type DocTable = "invoices" | "shipments" | "returns" | "purchase_returns" | "vouchers";
export interface DocMeta { items: string; method: string; recipient: string; total: number; notes: string; party: string; phone: string }

const CHUNK = 200;
const chunks = <T,>(a: T[]) => Array.from({ length: Math.ceil(a.length / CHUNK) }, (_, i) => a.slice(i * CHUNK, (i + 1) * CHUNK));

async function readTable(table: DocTable, ids: string[]): Promise<Record<string, DocMeta>> {
  const out: Record<string, DocMeta> = {};
  const sel: Record<DocTable, string> = {
    invoices: "id, payment_method, recipient_name, total, notes, contacts(name, phone), invoice_items(product_name)",
    shipments: "id, received_by, total_cost, notes, contacts(name, phone), shipment_items(product_name)",
    returns: "id, refund_method, recipient_name, total_refund, notes, invoices(contacts(name, phone)), return_items(products(name))",
    purchase_returns: "id, refund_method, recipient_name, total_amount, notes, contacts(name, phone), purchase_return_items(product_name)",
    vouchers: "id, payment_method, recipient_name, amount, description, party_name",
  };
  for (const part of chunks(ids)) {
    const { data } = await (supabase.from(table as any) as any).select(sel[table]).in("id", part);
    for (const r of (data ?? []) as any[]) {
      const items = (r.invoice_items ?? r.shipment_items ?? r.purchase_return_items ?? []).map((x: any) => x.product_name)
        .concat((r.return_items ?? []).map((x: any) => x.products?.name)).filter(Boolean).join(" ");
      const c = r.contacts ?? r.invoices?.contacts ?? null;
      out[r.id] = {
        items, method: r.payment_method ?? r.refund_method ?? "", recipient: r.recipient_name ?? r.received_by ?? "",
        total: Number(r.total ?? r.total_cost ?? r.total_refund ?? r.total_amount ?? r.amount ?? 0) || 0,
        notes: r.notes ?? r.description ?? "", party: c?.name ?? r.party_name ?? "", phone: c?.phone ?? "",
      };
    }
  }
  return out;
}

/** meta of every (table, id) pair, keyed by id */
export async function fetchDocMeta(refs: { table: string | null | undefined; id: string | null | undefined }[]): Promise<Record<string, DocMeta>> {
  const by = new Map<DocTable, Set<string>>();
  for (const r of refs) {
    if (!r.id || !r.table) continue;
    if (!["invoices", "shipments", "returns", "purchase_returns", "vouchers"].includes(r.table)) continue;
    const t = r.table as DocTable;
    if (!by.has(t)) by.set(t, new Set());
    by.get(t)!.add(r.id);
  }
  const parts = await Promise.all(Array.from(by.entries()).map(([t, ids]) => readTable(t, Array.from(ids)).catch(() => ({}))));
  return Object.assign({}, ...parts);
}

/** payment options of the movement lists (wallets of any name count as «محفظة») */
export const MOVEMENT_PAYMENT_OPTIONS = [
  { value: "cash", label: "كاش" },
  { value: "instapay", label: "انستاباي" },
  { value: "vodafone", label: "محفظة" },
  { value: "bank", label: "بنكي" },
  { value: "credit", label: "آجل" },
];
const BUILT_IN = ["cash", "instapay", "bank", "credit", "balance", "account", ""];

export function methodMatches(method: string, wanted: string): boolean {
  if (!wanted) return true;
  const m = (method || "").toLowerCase();
  if (wanted === "vodafone") return m === "vodafone" || m === "wallet" || !BUILT_IN.includes(m);
  if (wanted === "credit") return m === "credit" || m === "balance" || m === "account";
  return m === wanted;
}

const norm = (s: string) => (s || "").toLowerCase()
  .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ً-ْ]/g, "").replace(/\s+/g, " ").trim();
/** every word typed appears somewhere in the text (any order, Arabic spelling rules) */
export const textHas = (text: string, q: string) => { const t = norm(text); return norm(q).split(" ").filter(Boolean).every((w) => t.includes(w)); };

/** One movement against the applied filters (the period is applied by the reader). */
export function movementMatches(
  row: { reference?: string | null; party?: string | null; phone?: string | null; notes?: string | null; amount: number },
  meta: DocMeta | undefined,
  f: DocumentFilters,
  searchItems: boolean,
): boolean {
  if (f.q.trim()) {
    const hay = [row.reference, searchItems ? meta?.items : null, row.party, row.phone].filter(Boolean).join(" ");
    if (!textHas(hay, f.q)) return false;
  }
  if (f.notes.trim() && !textHas(row.notes ?? "", f.notes)) return false;
  const min = f.amountMin.trim() === "" ? null : Number(f.amountMin), max = f.amountMax.trim() === "" ? null : Number(f.amountMax);
  if (min != null && !isNaN(min) && Math.abs(row.amount) < min) return false;
  if (max != null && !isNaN(max) && Math.abs(row.amount) > max) return false;
  if (f.payment && !methodMatches(meta?.method ?? "", f.payment)) return false;
  if (f.recipient && norm(meta?.recipient ?? "") !== norm(f.recipient)) return false;
  return true;
}
