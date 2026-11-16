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
