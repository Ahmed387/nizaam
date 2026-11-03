/**
 * Editing a document (migrations 0141 / 0141b): every screen sends its edit through ONE server door,
 * `request_document_edit`. The owner's edit runs at once; anybody else's becomes a «طلب موافقة» that shows
 * «قبل ← بعد» (payload.diff) and runs the same edit when the owner approves it.
 *
 * Two questions are asked before sending:
 *  - the document has active returns → «الغي المرتجع وكمّل / سيب المرتجع وكمّل / عدّل المرتجع / رجوع»
 *    (the owner answers; a request carries the return ids and the owner answers on approval);
 *  - the new total is below what was paid → «يفضل على حسابه» or «يرجعله دلوقتي» from the vessel he paid with.
 */
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";

export type DocEntity = "invoice" | "shipment" | "sale_return" | "purchase_return" | "voucher";
export type DocEditRpc =
  | "edit_invoice" | "edit_shipment" | "edit_sale_return" | "edit_purchase_return" | "edit_voucher"
  | "update_invoice_date_sovereign" | "update_shipment_date" | "restore_invoice" | "restore_voucher";

export type DocEditStep = { rpc: DocEditRpc; args: Record<string, unknown> };
export type ReturnAction = "cancel" | "keep";
export type ExcessChoice = { action: "keep" | "refund"; amount: number; method?: string; reference?: string };

export type DocEditPayload = DocEditStep & {
  /** «قبل ← بعد» lines shown on the request */
  diff?: string[];
  return_ids?: string[];
  return_action?: ReturnAction;
  excess?: ExcessChoice;
  then?: DocEditPayload;
};

export const ENTITY_LABELS: Record<DocEntity, string> = {
  invoice: "فاتورة بيع",
  shipment: "فاتورة شراء",
  sale_return: "مرتجع بيع",
  purchase_return: "مرتجع شراء",
  voucher: "سند",
};

/** Several steps of the same edit (lines, then the date) as one payload; empty steps are skipped. */
export function chainSteps(steps: (DocEditStep | null | undefined | false)[], extra: Omit<DocEditPayload, keyof DocEditStep | "then"> = {}): DocEditPayload | null {
  const real = steps.filter(Boolean) as DocEditStep[];
  if (real.length === 0) return null;
  let next: DocEditPayload | undefined;
  for (let i = real.length - 1; i >= 1; i--) next = { ...real[i], ...(next ? { then: next } : {}) };
  return { ...real[0], ...extra, ...(next ? { then: next } : {}) };
}

/** Every rpc of the chain, in order (for tests and for the request card). */
export function stepsOf(p: DocEditPayload | null | undefined): DocEditRpc[] {
  const out: DocEditRpc[] = [];
  let s: DocEditPayload | undefined | null = p;
  while (s) { out.push(s.rpc); s = s.then; }
  return out;
}

/** Money paid above the new total (0 when nothing is above). */
export function excessAfterEdit(newTotal: number, paid: number): number {
  const x = Math.round((Number(paid || 0) - Number(newTotal || 0)) * 100) / 100;
  return x > 0.005 ? x : 0;
}

export type ReturnEffectLine = { name: string; oldQty: number; newQty: number; returnedQty: number; stock?: number | null };

/**
 * What happens if the return is KEPT while the invoice changes — the sentences the owner reads before he chooses.
 *  sale: 5 fridges, 2 came back, edited to 1 → «هيرجع للمخزن 1 «تلاجة» زيادة عن اللي اتباع».
 *  purchase: 10 screens, 4 went back, stock 6, edited to 3 → «المخزن هيقل 7 «شاشة» كمان ويبقى −1».
 * The account: new total − paid − what the return gave back (customer: «ليه» / «عليه», supplier: «علينا» / «عليه لنا»).
 */
export function returnEditEffect(
  kind: "sale" | "purchase",
  lines: ReturnEffectLine[],
  money: { newTotal: number; paid: number; returned: number },
): string[] {
  const out: string[] = [];
  const q = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  for (const l of lines) {
    const drop = Number(l.oldQty) - Number(l.newQty);
    if (kind === "sale") {
      const extra = Number(l.returnedQty) - Number(l.newQty);
      if (l.returnedQty > 0 && extra > 0) out.push(`هيرجع للمخزن ${q(extra)} «${l.name}» زيادة عن اللي اتباع`);
    } else if (drop > 0) {
      const after = l.stock == null ? null : Number(l.stock) - drop;
      out.push(`المخزن هيقل ${q(drop)} «${l.name}» كمان${after == null ? "" : ` ويبقى ${after < 0 ? "−" : ""}${q(Math.abs(after))}`}`);
    }
  }
  const bal = Math.round((Number(money.newTotal) - Number(money.paid) - Number(money.returned)) * 100) / 100;
  if (kind === "sale") {
    if (bal < -0.005) out.push(`العميل هيبقى ليه ${formatEGP(-bal)}`);
    else if (bal > 0.005) out.push(`العميل هيبقى عليه ${formatEGP(bal)}`);
  } else {
    if (bal < -0.005) out.push(`المورد هيبقى عليه لنا ${formatEGP(-bal)}`);
    else if (bal > 0.005) out.push(`هيفضل علينا للمورد ${formatEGP(bal)}`);
  }
  return out;
}

export type SubmitResult = { mode: "applied" | "requested"; result?: any; request_id?: string };

/** The one door: owner → applied now; anybody else → a request to the owner. Throws the server's message. */
export async function submitDocumentEdit(input: {
  entity: DocEntity; entityId: string; label: string; payload: DocEditPayload; reason?: string | null;
}): Promise<SubmitResult> {
  const { data, error } = await (supabase.rpc as any)("request_document_edit", {
    p_entity: input.entity, p_entity_id: input.entityId, p_label: input.label, p_payload: input.payload,
    p_reason: input.reason ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? { mode: "applied" }) as SubmitResult;
}

/** Active returns of a sale / purchase invoice: ids, numbers and the quantity that came back per product. */
export async function activeReturnsOf(kind: "sale" | "purchase", docId: string): Promise<{
  ids: string[]; numbers: string[]; qtyByProduct: Record<string, number>; value: number;
}> {
  if (kind === "sale") {
    const { data } = await supabase.from("returns" as any)
      .select("id, return_number, status, total_refund, return_items(product_id, quantity)").eq("invoice_id", docId);
    const act = ((data ?? []) as any[]).filter((r) => (r.status ?? "active") === "active");
    const qty: Record<string, number> = {};
    for (const r of act) for (const it of r.return_items ?? []) if (it.product_id) qty[it.product_id] = (qty[it.product_id] ?? 0) + Number(it.quantity || 0);
    return { ids: act.map((r) => r.id), numbers: act.map((r) => r.return_number ?? ""), qtyByProduct: qty,
      value: act.reduce((s, r) => s + Number(r.total_refund || 0), 0) };
  }
  const { data } = await supabase.from("purchase_returns" as any)
    .select("id, return_number, status, total_amount, purchase_return_items(product_id, quantity)").eq("shipment_id", docId);
  const act = ((data ?? []) as any[]).filter((r) => (r.status ?? "active") === "active");
  const qty: Record<string, number> = {};
  for (const r of act) for (const it of r.purchase_return_items ?? []) if (it.product_id) qty[it.product_id] = (qty[it.product_id] ?? 0) + Number(it.quantity || 0);
  return { ids: act.map((r) => r.id), numbers: act.map((r) => r.return_number ?? ""), qtyByProduct: qty,
    value: act.reduce((s, r) => s + Number(r.total_amount || 0), 0) };
}

/** The toast after sending: what happened, in one line. */
export function submitMessage(r: SubmitResult, label: string): string {
  return r.mode === "requested" ? `اتبعت طلب تعديل «${label}» للمالك — هيتنفذ لما يوافق` : `اتعدّل «${label}»`;
}

export type DiffLine = { product_id?: string | null; name: string; qty: number; price: number };

/** «قبل ← بعد» for the lines of a document, matched by product (then by name). */
export function lineDiff(before: DiffLine[], after: DiffLine[]): string[] {
  const key = (l: DiffLine, i: number) => l.product_id ?? `n:${l.name}:${i}`;
  const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const a = new Map(before.map((l, i) => [key(l, i), l]));
  const b = new Map(after.map((l, i) => [key(l, i), l]));
  const out: string[] = [];
  a.forEach((o, k) => { if (!b.has(k)) out.push(`اتشال «${o.name}» (كان ${fmt(o.qty)} × ${fmt(o.price)})`); });
  b.forEach((n, k) => {
    const o = a.get(k);
    if (!o) { out.push(`اتضاف «${n.name}»: ${fmt(n.qty)} × ${fmt(n.price)}`); return; }
    if (Number(o.qty) !== Number(n.qty)) out.push(`كمية «${n.name}»: ${fmt(o.qty)} ← ${fmt(n.qty)}`);
    if (Math.abs(Number(o.price) - Number(n.price)) > 0.005) out.push(`سعر «${n.name}»: ${fmt(o.price)} ← ${fmt(n.price)}`);
  });
  return out;
}

export type RestoreMoney = { action: "collect" | "debt"; method?: string };

/** What left the customer's side when the invoice was cancelled (0142): cash given back, or its voided payments. */
export function restoreMoneyLeft(doc: { refund_method?: string | null; refund_amount?: number | null; total_paid_before_cancel?: number | null }): number {
  const v = doc.refund_method === "cash" ? Number(doc.refund_amount ?? 0)
    : doc.refund_method === "void" ? Number(doc.total_paid_before_cancel ?? 0) : 0;
  return v > 0.005 ? Math.round(v * 100) / 100 : 0;
}

/** The request for «استرجاع من الملغاة» — the same door as an edit. */
export function restorePayload(kind: "invoice" | "voucher", id: string, money: RestoreMoney | null, left = 0): DocEditPayload {
  const diff = ["الحالة: ملغي ← شغال (بنفس الرقم والتاريخ)"];
  if (money && left > 0) diff.push(money.action === "collect" ? `العميل هيدفع ${formatEGP(left)} تاني دلوقتي` : `الـ ${formatEGP(left)} يفضلوا على العميل`);
  return kind === "invoice"
    ? { rpc: "restore_invoice" as DocEditRpc, args: { p_invoice_id: id, p_money: money ?? {} }, diff }
    : { rpc: "restore_voucher" as DocEditRpc, args: { p_voucher_id: id }, diff };
}
