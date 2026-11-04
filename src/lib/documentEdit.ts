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
  | "update_invoice_date_sovereign" | "update_shipment_date" | "restore_invoice" | "restore_voucher"
  | "restore_sale_return" | "restore_purchase_return" | "restore_shipment";

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

export type RestoreMoney = { action: "collect" | "debt" | "pay" | "as_before" | "keep"; method?: string };
export type RestoreKind = "invoice" | "voucher" | "sale_return" | "purchase_return" | "shipment";

/** What left the customer's side when the invoice was cancelled (0142): cash given back, or its voided payments. */
export function restoreMoneyLeft(doc: { refund_method?: string | null; refund_amount?: number | null; total_paid_before_cancel?: number | null }): number {
  const v = doc.refund_method === "cash" ? Number(doc.refund_amount ?? 0)
    : doc.refund_method === "void" ? Number(doc.total_paid_before_cancel ?? 0) : 0;
  return v > 0.005 ? Math.round(v * 100) / 100 : 0;
}

/**
 * A cancelled purchase invoice (0146 / 0149): did money leave at the cancellation, and which question is asked?
 *  refund («المورد رجّع فلوسنا»): «ترجعهوله النهارده» (pay) / «كأن الاسترداد ماحصلش» (as_before) / «تفضل معانا وتبقى
 *  علينا له» (keep); void («غلط ومفيش فلوس»): «ندفعله تاني دلوقتي» (pay) / «تفضل علينا» (debt); credit: nothing to ask.
 */
export function shipmentRestoreQuestion(doc: { money_action?: string | null; refund_amount?: number | null }): "refund" | "void" | null {
  if (doc.money_action === "refund" && Number(doc.refund_amount ?? 0) > 0.005) return "refund";
  if (doc.money_action === "void") return "void";
  return null;
}

export type RestoreDoc = {
  refund_method?: string | null; refund_amount?: number | null; total_paid_before_cancel?: number | null;
  money_action?: string | null; contact_id?: string | null;
};
export type RestoreChoice = { action: RestoreMoney["action"]; method?: string; label: string; effect: string; disabled?: boolean; why?: string };

/**
 * The choices of «استرجاع من الملغاة» when money left at the cancellation — the same for the owner and for whoever sends
 * the request — each with what it does to the till and to his account (0142 / 0146 / 0149). Example PO00578, the supplier
 * gave back 200: «النهارده» → till −200 today; «بيومه» → till −200 on the refund day; «تفضل علينا» → till as it is, we owe
 * him 200. Empty = nothing to ask.
 */
export function restoreChoices(kind: RestoreKind, doc: RestoreDoc, left = 0): RestoreChoice[] {
  const walkIn = !doc.contact_id;
  if (kind === "invoice" && left > 0) {
    const x = formatEGP(left);
    const mustCollect = walkIn && doc.refund_method === "cash";
    return [
      { action: "collect", method: "cash", label: "يدفعهم تاني دلوقتي",
        effect: `الخزنة +${x} النهارده — الفاتورة تبقى مدفوعة زي ما كانت` },
      { action: "debt", label: "يفضلوا عليه",
        effect: `الخزنة زي ما هي — الفاتورة تفضل مفتوحة وعليه ${x}`,
        disabled: mustCollect, why: mustCollect ? "عميل نقدي من غير اسم: الفلوس لازم ترجع." : undefined },
    ];
  }
  if (kind !== "shipment") return [];
  const q = shipmentRestoreQuestion(doc);
  if (q === "refund") {
    const x = formatEGP(Number(doc.refund_amount ?? 0));
    return [
      { action: "pay", label: "هترجعهوله النهارده",
        effect: `الخزنة −${x} النهارده — حسابه يرجع زي ما كان قبل الإلغاء` },
      { action: "as_before", label: "كأن الاسترداد ماحصلش (بيومه)",
        effect: `الخزنة −${x} في يوم الاسترداد نفسه (خزنة اليوم ده تتغير) — حسابه يرجع زي ما كان قبل الإلغاء` },
      { action: "keep", label: "تفضل معانا وتبقى علينا له",
        effect: `الخزنة زي ما هي (الـ ${x} يفضلوا فيها) — حسابه: علينا له ${x} تدفعهمله بعدين زي أي دين مورد`,
        disabled: walkIn, why: walkIn ? "مفيش مورد على الفاتورة: الفلوس لازم ترجعله." : undefined },
    ];
  }
  if (q === "void") {
    return [
      { action: "pay", method: "cash", label: "ندفعهم للمورد تاني دلوقتي (نقدي)",
        effect: "الخزنة تقل بمبلغ الدفعات النهارده — الفاتورة تبقى مدفوعة زي ما كانت" },
      { action: "debt", label: "يفضلوا علينا",
        effect: "الخزنة زي ما هي — الفاتورة تفضل مفتوحة وعلينا له مبلغ الدفعات" },
    ];
  }
  return [];
}

const RESTORE_FALLBACK: Record<RestoreMoney["action"], string> = {
  collect: "العميل هيدفع تاني دلوقتي", debt: "الفلوس تفضل علينا للمورد", pay: "الفلوس هتطلع للمورد النهارده",
  as_before: "كأن الاسترداد ماحصلش (بيومه)", keep: "الفلوس تفضل معانا وتبقى علينا للمورد",
};

/** The request for «استرجاع من الملغاة» — the same door as an edit. The card says the choice and its effect. */
export function restorePayload(kind: RestoreKind, id: string, money: RestoreMoney | null, left = 0, doc: RestoreDoc = {}): DocEditPayload {
  const diff = ["الحالة: ملغي ← شغال (بنفس الرقم والتاريخ)"];
  if (kind === "invoice" && money && left > 0) {
    diff.push(money.action === "collect" ? `العميل هيدفع ${formatEGP(left)} تاني دلوقتي` : `الـ ${formatEGP(left)} يفضلوا على العميل`);
    const c = restoreChoices(kind, doc, left).find((x) => x.action === money.action);
    if (c) diff.push(c.effect);
  }
  if (kind === "shipment" && money) {
    const c = restoreChoices(kind, doc).find((x) => x.action === money.action);
    diff.push(c ? `${c.label}: ${c.effect}` : RESTORE_FALLBACK[money.action]);
  }
  switch (kind) {
    case "invoice": return { rpc: "restore_invoice", args: { p_invoice_id: id, p_money: money ?? {} }, diff };
    case "voucher": return { rpc: "restore_voucher", args: { p_voucher_id: id }, diff };
    case "sale_return": return { rpc: "restore_sale_return", args: { p_return_id: id }, diff };
    case "purchase_return": return { rpc: "restore_purchase_return", args: { p_return_id: id }, diff };
    case "shipment": return { rpc: "restore_shipment", args: { p_shipment_id: id, p_money: money ?? {} }, diff };
  }
}
