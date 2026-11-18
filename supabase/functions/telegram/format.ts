// Pure text helpers for the `telegram` edge function (no imports — also tested by vitest: src/lib/telegramFormat.test.ts).
// Owner 2026-11-16: e-invoice messages and the daily activity report go to the company owner's Telegram.

export const AR = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "«": "»", "»": "«" };
const mirror = (t: string) => t.replace(/[()[\]«»]/g, (c) => MIRROR[c] ?? c);
const LTR_RUN = /[A-Za-z0-9][A-Za-z0-9.,:\/%+_@&\- ]*[A-Za-z0-9%]|[A-Za-z0-9]/g;

/** A right-to-left line cut into pieces for pdf-lib + fontkit, in DRAWING order from the right edge to the left.
 *  fontkit picks the direction of a piece from its first letter's script, so each piece is homogeneous:
 *  an Arabic piece (fontkit shapes and reverses it; brackets mirrored), a Latin / number piece (as typed), or a piece of
 *  spaces / dashes only (reversed + mirrored by hand). A line with no Arabic is one piece. */
export function rtlPieces(s: string): string[] {
  if (!AR.test(s)) return [s];
  const out: string[] = [];
  let last = 0;
  const pushRtl = (t: string) => {
    if (!t) return;
    if (AR.test(t)) {
      // leading / trailing neutrals of an Arabic piece are drawn by hand so fontkit sees an Arabic letter first
      const m = t.match(/^([^\u0600-\u06FF\uFB50-\uFEFF]*)([\s\S]*?)([^\u0600-\u06FF\uFB50-\uFEFF]*)$/)!;
      if (m[1]) out.push([...mirror(m[1])].reverse().join(""));
      out.push(mirror(m[2]));
      if (m[3]) out.push([...mirror(m[3])].reverse().join(""));
    } else out.push([...mirror(t)].reverse().join(""));
  };
  for (const m of s.matchAll(LTR_RUN)) {
    pushRtl(s.slice(last, m.index));
    out.push(m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  pushRtl(s.slice(last));
  return out.filter((p) => p !== "");
}

export const money = (n: unknown): string => {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "0";
  const fixed = Math.abs(v).toFixed(2).replace(/\.00$/, "");
  const [i, d] = fixed.split(".");
  const withSep = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (v < 0 ? "-" : "") + withSep + (d ? "." + d : "");
};

const cairo = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: `${g("day")}/${g("month")}/${g("year")}`, time: `${g("hour")}:${g("minute")}`, pm: g("dayPeriod").toLowerCase() === "pm" };
};
export const dayText = (iso: string | null | undefined) => cairo(iso)?.day ?? "—";
export const timeText = (iso: string | null | undefined) => {
  const c = cairo(iso);
  return c ? `${c.time} ${c.pm ? "م" : "ص"}` : "—";
};
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export function dayTitle(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------- e-invoice message
export interface EtaPending {
  id: string; internal_id: string | null; type_name: string | null; issuer_id: string | null; issuer_name: string | null;
  date_issued: string | null; total_sales: number | null; total_discount: number | null; net_amount: number | null;
  total: number | null; detail: any; matched_number: string | null; match_mode: string | null; ref_internal_id: string | null;
}

export function etaLinesOf(detail: any): { description: string; quantity: number; total: number }[] {
  const lines: any[] = detail?.document?.invoiceLines ?? [];
  return lines.map((l) => ({ description: String(l?.description ?? "").trim(), quantity: Number(l?.quantity || 0), total: Number(l?.total || 0) }));
}

export function etaTitle(type: string | null): string {
  switch ((type ?? "").toUpperCase()) {
    case "C": return "🔻 <b>إشعار دائن جديد (Valid)</b>";
    case "D": return "🔺 <b>إشعار مدين جديد (Valid)</b>";
    default: return "🧾 <b>فاتورة إلكترونية جديدة (Valid)</b>";
  }
}

export function etaMessage(d: EtaPending, appUrl?: string): string {
  const supplier = String(d.issuer_name ?? "").replace(/^\d+\s*/, "") || "مورد";
  const net = Number(d.net_amount ?? 0);
  const total = Number(d.total ?? 0);
  const vat = Math.round((total - net) * 100) / 100;
  const out: string[] = [etaTitle(d.type_name)];
  out.push(`المورد: <b>${esc(supplier)}</b>${d.issuer_id ? ` — رقم ضريبي ${esc(d.issuer_id)}` : ""}`);
  out.push(`الرقم: ${esc(d.internal_id ?? "—")} — بتاريخ ${dayText(d.date_issued)}`);
  if ((d.type_name ?? "").toUpperCase() !== "I" && d.ref_internal_id) out.push(`على فاتورة: ${esc(d.ref_internal_id)}`);
  if (Number(d.total_discount ?? 0) > 0) out.push(`الخصم: ${money(d.total_discount)}`);
  out.push(`قبل الضريبة: ${money(net)} — الضريبة: ${money(vat)} — <b>الإجمالي: ${money(total)}</b>`);
  const lines = etaLinesOf(d.detail);
  if (lines.length) {
    const shown = lines.slice(0, 5).map((l) => `• ${esc(l.description || "صنف")} × ${money(l.quantity)}`);
    if (lines.length > 5) shown.push(`• (+${lines.length - 5} أصناف كمان)`);
    out.push("الأصناف:\n" + shown.join("\n"));
  }
  if ((d.type_name ?? "").toUpperCase() === "I") {
    out.push(d.matched_number ? `في السيستم: ✅ مربوطة بفاتورة شراء ${esc(d.matched_number)}`
      : d.match_mode === "ignore" ? "في السيستم: مش فاتورة شراء" : "في السيستم: ⚠️ مش متسجلة عندنا لسه");
  }
  if (appUrl) out.push(`<a href="${esc(appUrl)}/admin/eta-invoices/${esc(d.id)}">افتحها في السيستم</a>`);
  return out.join("\n");
}

// ---------------------------------------------------------------- daily report labels
const DOC: Record<string, string> = {
  sale: "فاتورة بيع", purchase: "فاتورة شراء", sale_return: "مرتجع بيع", purchase_return: "مرتجع شراء",
  receipt: "سند قبض", payment: "سند صرف",
};
const ACT: Record<string, string> = {
  create: "عمل", cancel: "ألغى", payment_add: "سجّل دفعة على", payment_void: "ألغى دفعة على", payment_move: "نقل دفعة",
  date: "غيّر تاريخ", amount: "عدّل مبلغ", party: "غيّر الحساب في", annotations: "عدّل ملاحظات", method: "غيّر طريقة الدفع في",
};
export const docLabel = (t: string) => DOC[t] ?? t;
export const actLabel = (a: string) => ACT[a] ?? a;

const ENT: Record<string, string> = {
  contacts: "حسابات العملاء والموردين", contact: "حسابات العملاء والموردين", Contact: "حسابات العملاء والموردين",
  products: "الأصناف", employees: "الموظفين", attendance: "الحضور والانصراف", user_roles: "صلاحيات الموظفين",
  user_permissions: "صلاحيات الموظفين", role_permissions: "صلاحيات الأدوار", branches: "الفروع", settings: "الإعدادات",
  stock_transfers: "تحويلات المخزون", stock_adjustments: "تسويات المخزون", cashier_shifts: "الورديات",
};
const AU: Record<string, string> = { CREATE: "إضافة", UPDATE: "تعديل", DELETE: "حذف", CANCEL: "إلغاء", create: "إضافة", update: "تعديل" };
export const entityLabel = (e: string) => ENT[e] ?? e;
export const auditActLabel = (a: string) => AU[a] ?? a;

export interface ReportUser {
  name: string; first_at: string | null; last_at: string | null;
  docs: { doc_type: string; action: string; n: number; total: number | null }[];
  items: { at: string; doc_type: string; action: string; number: string | null; party: string | null; amount: number | null }[];
  items_total: number;
  other: { entity: string; action: string; n: number }[];
  pages: { label: string; hits: number }[];
}

/** «عمل 14 فاتورة بيع — إجمالي 186,400» */
export function docSummary(d: ReportUser["docs"][number]): string {
  const total = d.total != null && Number(d.total) !== 0 ? ` — إجمالي ${money(d.total)}` : "";
  return `${actLabel(d.action)} ${d.n} ${docLabel(d.doc_type)}${total}`;
}

export function pagesSummary(pages: ReportUser["pages"]): string {
  return pages.map((p) => `${p.label} (${p.hits})`).join("، ");
}

export function reportCaption(r: { company: string; day: string; totals: any }): string {
  const t = r.totals ?? {};
  return [
    `📊 <b>تقرير نشاط يوم ${dayTitle(r.day)}</b>`,
    esc(r.company),
    `${t.users ?? 0} مستخدم — ${t.documents ?? 0} مستند جديد — ${t.sales_n ?? 0} فاتورة بيع (${money(t.sales_total)}) — ${t.cancels ?? 0} إلغاء`,
  ].join("\n");
}

/**
 * What a chat sent the bot (owner 2026-11-18 «حوار الربط مدوخني»): a link code — «/start 123456» (the link), «/link 123456»
 * (typed in a group), or the 6 digits alone in a private chat, Arabic digits too; «/start» with no code → 'bare';
 * anything else → null. Old 24-letter codes still work.
 */
export function linkCodeOf(text: string, isGroup: boolean): { code: string } | "bare" | null {
  const t = String(text ?? "").trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const m = /^\/(?:start|link)(?:@\w+)?\s+([0-9]{6}|[a-f0-9]{24})$/i.exec(t);
  if (m) return { code: m[1].toLowerCase() };
  if (!isGroup && /^[0-9]{6}$/.test(t.replace(/\s+/g, ""))) return { code: t.replace(/\s+/g, "") };
  if (/^\/(?:start|link)(?:@\w+)?$/i.test(t)) return "bare";
  return null;
}

// ---------------------------------------------------------------- documents to the company group (0268)
export interface DocPayload {
  id: number; kind: string; doc_type: string; event: string; title: string; number: string | null;
  company: string | null; branch: string | null; date: string | null; created_at: string | null;
  party: string | null; employee: string | null; recipient: string | null; notes: string | null;
  total: number | null; extra: Record<string, any> | null;
  lines: { name: string | null; qty: number | null; price: number | null; total: number | null }[];
  payments: { number: string; type: string; method: string; amount: number; status: string }[];
  cancel: { reason: string; by: string; at: string } | null;
  chat: number | null; link: string | null; skip?: boolean; why?: string;
}

const DOC_ICON: Record<string, string> = { sale: "🧾", purchase: "📦", sale_return: "↩️", purchase_return: "↪️", receipt: "💵", payment: "💸" };

/** «IN47906 - معرض سكة تلة - احمد ناصر.pdf» (owner: number + branch + employee) */
export function docFileName(p: Pick<DocPayload, "number" | "branch" | "employee">): string {
  const clean = (s: string | null | undefined) => String(s ?? "").replace(/[\\/:*?"<>|\n\r\t]+/g, "-").replace(/\s+/g, " ").trim();
  const parts = [clean(p.number) || "مستند", clean(p.branch), clean(p.employee)].filter((x) => x && x !== "—");
  return `${parts.join(" - ").slice(0, 120)}.pdf`;
}

/** money paid with the document, by method: «23,800 (كاش 20,000 + إنستاباي 3,800)» */
export function paidWith(payments: DocPayload["payments"]): { sum: number; text: string } {
  const live = (payments ?? []).filter((x) => x.status !== "cancelled");
  const sum = Math.round(live.reduce((s, x) => s + Number(x.amount || 0), 0) * 100) / 100;
  const by = new Map<string, number>();
  for (const x of live) by.set(x.method, (by.get(x.method) ?? 0) + Number(x.amount || 0));
  const text = [...by].map(([m, a]) => (by.size > 1 ? `${m} ${money(a)}` : m)).join(" + ");
  return { sum, text };
}

/** the caption under the PDF in the group */
export function docCaption(p: DocPayload, appUrl?: string): string {
  const out: string[] = [];
  out.push(`${DOC_ICON[p.doc_type] ?? "📄"} <b>${esc(p.title)} ${esc(p.number ?? "")}</b> — ${esc(p.branch ?? "")}`);
  out.push(`الحساب: ${esc(p.party ?? "—")}${p.doc_type === "receipt" || p.doc_type === "payment" ? (p.extra?.category ? ` — ${esc(p.extra.category)}` : "") : ""}`);
  if (p.doc_type === "receipt" || p.doc_type === "payment") {
    out.push(`المبلغ: <b>${money(p.total)}</b> — ${esc(p.extra?.method ?? "")}`);
  } else {
    const { sum, text } = paidWith(p.payments);
    let line = `الإجمالي: <b>${money(p.total)}</b>`;
    if (sum > 0) line += ` — ${p.doc_type === "sale_return" || p.doc_type === "purchase" ? "اتدفع" : "اتقبض"} معاه ${money(sum)} (${esc(text)})`;
    if (p.doc_type === "sale" && Number(p.total ?? 0) - sum > 0.009) line += ` — آجل ${money(Number(p.total ?? 0) - sum)}`;
    out.push(line);
    if (p.extra?.on_invoice) out.push(`على فاتورة: ${esc(p.extra.on_invoice)}`);
  }
  out.push(`بواسطة: ${esc(p.employee ?? "—")} — ${dayText(p.date)} ${timeText(p.created_at)}`);
  if (appUrl && p.link) out.push(`<a href="${esc(appUrl)}${esc(p.link)}">افتحه في السيستم</a>`);
  return out.join("\n");
}

/** «اتلغى» message */
export function cancelMessage(p: DocPayload, appUrl?: string): string {
  const out = [
    `❌ <b>اتلغى: ${esc(p.title)} ${esc(p.number ?? "")}</b> — ${esc(p.branch ?? "")}`,
    `الحساب: ${esc(p.party ?? "—")} — المبلغ: ${money(p.total)}`,
    `السبب: ${esc(p.cancel?.reason || "—")}`,
    `ألغاه: ${esc(p.cancel?.by ?? "—")} — ${dayText(p.cancel?.at)} ${timeText(p.cancel?.at)}`,
  ];
  if (appUrl && p.link) out.push(`<a href="${esc(appUrl)}${esc(p.link)}">افتحه في السيستم</a>`);
  return out.join("\n");
}
