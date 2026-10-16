import { supabase } from "@/integrations/supabase/client";
import { saveDocAnnotations, type AnnotationKind } from "@/lib/docAnnotations";

/** The document tabs that support selection + bulk actions. */
export type BulkKind = "sale" | "purchase" | "sale_return" | "purchase_return" | "income" | "expense";

export const BULK_LABEL: Record<BulkKind, { one: string; many: string }> = {
  sale: { one: "فاتورة بيع", many: "فاتورة" },
  purchase: { one: "فاتورة شراء", many: "فاتورة" },
  sale_return: { one: "مرتجع بيع", many: "مرتجع" },
  purchase_return: { one: "مرتجع شراء", many: "مرتجع" },
  income: { one: "سند قبض", many: "سند" },
  expense: { one: "سند صرف", many: "سند" },
};

export const isVoucherKind = (k: BulkKind) => k === "income" || k === "expense";

export function docNumber(k: BulkKind, r: any): string {
  switch (k) {
    case "sale": return r.invoice_number ?? "—";
    case "purchase": return r.shipment_number ?? "—";
    case "sale_return":
    case "purchase_return": return r.return_number ?? "—";
    default: return r.voucher_number ?? "—";
  }
}

export function docParty(k: BulkKind, r: any): string {
  switch (k) {
    case "sale": return r.contacts?.name ?? "نقدي";
    case "sale_return": return r.invoices?.contacts?.name ?? "نقدي";
    case "purchase":
    case "purchase_return": return r.contacts?.name ?? "—";
    default: return r.party_name ?? "—";
  }
}

export function docAmount(k: BulkKind, r: any): number {
  switch (k) {
    case "sale": return Number(r.total) || 0;
    case "purchase": return Number(r.total_cost) || 0;
    case "sale_return": return Number(r.total_refund) || 0;
    case "purchase_return": return Number(r.total_amount) || 0;
    default: return Number(r.amount) || 0;
  }
}

/** The document's own date (what the tables show). */
export function docDate(k: BulkKind, r: any): string | null {
  return isVoucherKind(k) ? (r.voucher_date ?? r.created_at ?? null) : (r.invoice_date ?? r.created_at ?? null);
}

export const docRecipient = (k: BulkKind, r: any): string => (k === "purchase" ? r.received_by : r.recipient_name) ?? "";
export const docNotes = (k: BulkKind, r: any): string => (isVoucherKind(k) ? r.description : r.notes) ?? "";

export function docPath(k: BulkKind, branchId: string, r: any): string {
  const base = `/branch/${r.branch_id ?? branchId}`;
  switch (k) {
    case "sale": return `${base}/sales/${r.id}`;
    case "purchase": return `${base}/shipments/${r.id}`;
    case "sale_return": return `${base}/sale-returns/${r.id}`;
    case "purchase_return": return `${base}/purchase-returns/${r.id}`;
    default: return `${base}/vouchers/${r.id}`;
  }
}

const ANNOTATION: Record<BulkKind, AnnotationKind> = {
  sale: "invoice", purchase: "shipment", sale_return: "sale_return", purchase_return: "purchase_return", income: "voucher", expense: "voucher",
};

/** Notes only — the recipient is locked once a document is issued, so it is sent back unchanged. */
export async function setDocNotes(k: BulkKind, r: any, notes: string) {
  await saveDocAnnotations(ANNOTATION[k], r.id, docRecipient(k, r), notes);
}

/** The money that moves with the document when its date changes (shown in the preview). */
export function movingMoney(k: BulkKind, r: any): number {
  switch (k) {
    case "sale": return Number(r.settle?.at_sale) || 0; // payments of the invoice's own day (invoice_move_sale_payments)
    case "purchase": return 0; // update_shipment_date moves the invoice and its journal, not its payments
    case "sale_return":
    case "purchase_return": return (Number(r.refund_cash_amount) || 0) + (Number(r.refund_transfer_amount) || 0); // 0095
    default: return Number(r.amount) || 0;
  }
}

/** Keeps the document's own time of day and changes its day. */
function withDay(original: string | null, day: string): string {
  const o = original ? new Date(original) : null;
  const hh = o ? String(o.getHours()).padStart(2, "0") : "12";
  const mm = o ? String(o.getMinutes()).padStart(2, "0") : "00";
  return new Date(`${day}T${hh}:${mm}:00`).toISOString();
}

/** Changes one document's date through the same server paths as the single-row date cells. */
export async function setDocDate(k: BulkKind, r: any, day: string) {
  let res: { error: any };
  if (k === "sale") {
    res = await supabase.rpc("update_invoice_date_sovereign", { p_invoice_id: r.id, p_new_date: withDay(r.invoice_date ?? r.created_at, day), p_reason: "تعديل جماعي لتاريخ الفواتير" });
  } else if (k === "purchase") {
    res = await (supabase.rpc as any)("update_shipment_date", { p_shipment_id: r.id, p_new_date: withDay(r.invoice_date ?? r.created_at, day), p_reason: "تعديل جماعي لتاريخ فواتير الشراء" });
  } else if (k === "sale_return" || k === "purchase_return") {
    res = await supabase.rpc("update_return_sovereign" as any, { p_kind: k, p_return_id: r.id, p_date: day, p_notes: null });
  } else {
    res = await supabase.rpc("edit_voucher" as any, {
      p_voucher_id: r.id,
      p_category_id: r.category_id,
      p_amount: Number(r.amount),
      p_payment_method: r.payment_method,
      p_voucher_date: day,
      p_party_type: r.party_type ?? null,
      p_party_id: r.party_id ?? null,
      p_party_name: r.party_name ?? null,
      p_description: r.description ?? null,
      p_reference_number: r.reference_number ?? null,
      p_transferred_to: r.transferred_to ?? null,
      p_transferred_from: r.transferred_from ?? null,
      p_fee_amount: Number(r.fee_amount ?? 0),
      p_edit_reason: "تعديل جماعي لتاريخ السندات",
    });
  }
  if (res.error) throw res.error;
}

/** Cancels one return / voucher through its own cancel path (sale / purchase invoices ask about their money one by one). */
export async function cancelDoc(k: BulkKind, r: any, reason: string) {
  let res: { error: any };
  if (k === "sale_return") res = await supabase.rpc("cancel_sale_return" as any, { _return_id: r.id, _reason: reason });
  else if (k === "purchase_return") res = await supabase.rpc("cancel_purchase_return" as any, { _return_id: r.id, _reason: reason });
  else if (isVoucherKind(k)) res = await supabase.rpc("cancel_voucher" as any, { p_voucher_id: r.id, p_reason: reason });
  else throw new Error("إلغاء الفواتير بيتعمل واحدة واحدة عشان سؤال الفلوس");
  if (res.error) throw res.error;
}

export type BulkResult = { id: string; number: string; ok: boolean; message?: string };

/** Runs an action over the documents one by one; a failure never stops the rest. */
export async function runBulk(k: BulkKind, rows: any[], fn: (r: any) => Promise<void>, onProgress?: (done: number) => void): Promise<BulkResult[]> {
  const out: BulkResult[] = [];
  for (const r of rows) {
    try {
      await fn(r);
      out.push({ id: r.id, number: docNumber(k, r), ok: true });
    } catch (e: any) {
      out.push({ id: r.id, number: docNumber(k, r), ok: false, message: e?.message ?? String(e) });
    }
    onProgress?.(out.length);
  }
  return out;
}
