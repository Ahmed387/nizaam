import type { ListColumn } from "@/lib/tableFilter";
import { CLASS_LABEL, PAY_STATE_LABEL, TRANSFER_STATUS_LABEL, type DocTab } from "@/lib/documentFilterLinks";
import { payMethodLabel, SRC_LABEL } from "@/lib/treasuryLinks";

/**
 * What each column of the documents screen SHOWS, read from the row, for the Excel filters of the whole list
 * (owner 2026-10-26). Every value here is the word / number the cell shows, so a filter keeps exactly the rows whose
 * cell says it. The table's own cells use the same helpers (`returnSplit`, `sourceText`).
 */

/** Which method column a payment method belongs to (same four columns as the sale table). */
export const methodBucket = (m?: string | null): "cash" | "instapay" | "wallet" | "bank" => {
  const v = String(m ?? "cash").toLowerCase();
  if (v.includes("insta")) return "instapay";
  if (v.includes("vodafone") || v.includes("wallet") || v.includes("etisalat") || v.includes("orange")) return "wallet";
  if (v.includes("bank") || v.includes("transfer") || v.includes("visa")) return "bank";
  return "cash";
};

/** A return's refund: money given back (cash / transfer by method) and what went to his account. */
export const returnSplit = (r: any) => {
  const cash = Number(r.refund_cash_amount) || 0, transfer = Number(r.refund_transfer_amount) || 0;
  const b: Record<string, number> = { cash: 0, instapay: 0, wallet: 0, bank: 0 };
  b.cash += cash;
  if (transfer > 0) { const k = methodBucket(r.refund_method); b[k === "cash" ? "bank" : k] += transfer; }
  return { out: cash + transfer, account: Number(r.refund_balance_amount) || 0, buckets: b };
};

/** «التصنيف» of a return: all given back / all on account / both. */
export function returnClass(r: any): "نقدي" | "على الحساب" | "نقدي + حساب" {
  const x = returnSplit(r);
  return x.out > 0.005 && x.account <= 0.005 ? "نقدي" : x.out <= 0.005 ? "على الحساب" : "نقدي + حساب";
}

/** «المصدر» of a voucher in words, as its cell shows it. */
export function sourceText(link: any, source?: string | null): string {
  if (link?.cancelled_voucher_number) return `إلغاء سند ${link.cancelled_voucher_number}`;
  if (link?.src_type && link?.src_id) return `${SRC_LABEL[link.src_type] ?? ""} ${link.src_number ?? ""}`.trim();
  return source === "manual" ? "يدوي" : "تلقائي";
}

/** the columns that only mean something on active documents (a cancelled one shows «—» there) */
export const ACTIVE_ONLY = new Set(["__class", "__paid_rem", "__pay_state", "__refund_split", "__m_cash", "__m_instapay", "__m_wallet", "__m_bank", "__r_account"]);

const n = (v: unknown) => Number(v) || 0;
/** a money cell that shows «—» when there is nothing */
const pos = (v: unknown) => (n(v) > 0 ? n(v) : null);
const fmt = (v: number) => `${(Math.round(v * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} ج.م`;
const live = (r: any) => r.status !== "cancelled";

type Ctx = {
  branchName: (id?: string | null) => string;
  /** a transfer's value at the sender's moving average (0080) */
  transferValue: (id: string) => number | undefined;
};
type Col = ListColumn<any>;

const text = (key: string, label: string, get: (r: any) => unknown): Col => ({ key, label, kind: "text", get });
const money = (key: string, label: string, get: (r: any) => unknown, extra: Partial<Col> = {}): Col => ({ key, label, kind: "number", get, sum: true, money: true, ...extra });
const date = (key: string, label: string, get: (r: any) => unknown): Col => ({ key, label, kind: "date", get });

function settleCols(k: "sale" | "purchase"): Col[] {
  return [
    text("__class", "التصنيف", (r) => (live(r) ? CLASS_LABEL[r.__class === "cash" ? "cash" : "credit"] : null)),
    // one cell shows paid AND remaining: its filter is on what is still open, its total says both
    money("__paid_rem", "المتبقي", (r) => (live(r) ? n(r.__remaining) : null), {
      total: (rows) => {
        const act = rows.filter(live);
        return `مدفوع ${fmt(act.reduce((s, r) => s + n(r.__paid), 0))} · متبقي ${fmt(act.reduce((s, r) => s + n(r.__remaining), 0))}`;
      },
    }),
    text("__pay_state", "حالة السداد", (r) => (live(r) ? PAY_STATE_LABEL[r.__payState] ?? PAY_STATE_LABEL.unpaid : null)),
    money("__b_cash", "كاش", (r) => pos(r.__byBucket?.cash)),
    money("__b_instapay", "انستاباي", (r) => pos(r.__byBucket?.instapay)),
    money("__b_wallet", "محفظة", (r) => pos(r.__byBucket?.wallet)),
    money("__b_bank", "بنكي", (r) => pos(r.__byBucket?.bank)),
    money("__b_account", k === "sale" ? "من تحت حسابه" : "من تحت حسابنا", (r) => pos(r.__byBucket?.account)),
    money("__b_other", "من مرتجع", (r) => pos(r.__byBucket?.other)),
  ];
}

function returnCols(k: "sale_return" | "purchase_return"): Col[] {
  const split = (r: any) => (live(r) ? returnSplit(r) : null);
  return [
    text("__class", "التصنيف", (r) => (live(r) ? returnClass(r) : null)),
    money("__refund_split", k === "sale_return" ? "اترد له" : "رجعلنا", (r) => split(r)?.out ?? null, {
      total: (rows) => {
        const act = rows.filter(live).map(returnSplit);
        return `${k === "sale_return" ? "اترد" : "رجع"} ${fmt(act.reduce((s, x) => s + x.out, 0))} · حساب ${fmt(act.reduce((s, x) => s + x.account, 0))}`;
      },
    }),
    money("__m_cash", "كاش", (r) => pos(split(r)?.buckets.cash)),
    money("__m_instapay", "انستاباي", (r) => pos(split(r)?.buckets.instapay)),
    money("__m_wallet", "محفظة", (r) => pos(split(r)?.buckets.wallet)),
    money("__m_bank", "بنكي", (r) => pos(split(r)?.buckets.bank)),
    money("__r_account", k === "sale_return" ? "على حسابه" : "على حسابنا عنده", (r) => pos(split(r)?.account)),
  ];
}

const DOC_STATUS = (r: any) => (r.status === "cancelled" ? "ملغي" : "نشط");

/** the filterable columns of one tab (keys = the table's column keys); a cancelled view drops ACTIVE_ONLY ones */
export function documentListColumns(tab: DocTab, view: "active" | "cancelled", ctx: Ctx): Col[] {
  const cols = ((): Col[] => {
    switch (tab) {
      case "sale": return [
        text("invoice_number", "رقم", (r) => r.invoice_number),
        text("customer", "العميل", (r) => r.contacts?.name ?? "نقدي"),
        money("total", "المبلغ", (r) => n(r.total)),
        ...settleCols("sale"),
        text("status", "الحالة", (r) => (r.status === "active" ? "نشطة" : "ملغاة")),
        text("__recipient", "المستلم", (r) => r.recipient_name),
        text("__notes", "الملاحظات", (r) => r.notes),
        date("invoice_date", "تاريخ الفاتورة", (r) => r.invoice_date ?? r.created_at),
      ];
      case "purchase": return [
        text("shipment_number", "رقم", (r) => r.shipment_number),
        text("supplier", "المورد", (r) => r.contacts?.name),
        money("total_cost", "المبلغ", (r) => n(r.total_cost)),
        ...settleCols("purchase"),
        text("status", "الحالة", (r) => (r.status === "cancelled" ? "ملغاة" : "نشطة")),
        text("__recipient", "المستلم", (r) => r.received_by),
        text("__notes", "الملاحظات", (r) => r.notes),
        date("invoice_date", "تاريخ الفاتورة", (r) => r.invoice_date ?? r.created_at),
        date("arrival_date", "تاريخ الوصول", (r) => r.arrival_date),
      ];
      case "sale_return": return [
        text("return_number", "رقم", (r) => r.return_number),
        text("customer", "العميل", (r) => r.invoices?.contacts?.name ?? "نقدي"),
        text("inv", "رقم الفاتورة", (r) => r.invoices?.invoice_number),
        text("reason", "السبب", (r) => r.reason),
        money("total_refund", "المبلغ", (r) => n(r.total_refund)),
        ...returnCols("sale_return"),
        text("status", "الحالة", DOC_STATUS),
        text("__recipient", "المستلم", (r) => r.recipient_name),
        text("__notes", "الملاحظات", (r) => r.notes),
        date("invoice_date", "تاريخ المرتجع", (r) => r.invoice_date ?? r.created_at),
      ];
      case "purchase_return": return [
        text("return_number", "رقم", (r) => r.return_number),
        text("supplier", "المورد", (r) => r.contacts?.name),
        text("ship", "رقم الفاتورة", (r) => r.shipments?.shipment_number),
        text("reason", "السبب", (r) => r.reason),
        money("total_amount", "المبلغ", (r) => n(r.total_amount)),
        ...returnCols("purchase_return"),
        text("status", "الحالة", DOC_STATUS),
        text("__recipient", "المستلم", (r) => r.recipient_name),
        text("__notes", "الملاحظات", (r) => r.notes),
        date("invoice_date", "تاريخ المرتجع", (r) => r.invoice_date ?? r.created_at),
      ];
      case "income":
      case "expense": return [
        text("voucher_number", "رقم السند", (r) => r.voucher_number),
        text("__account", "اسم الحساب", (r) => r.__account),
        money("amount", "المبلغ", (r) => n(r.amount)),
        text("category", "التصنيف", (r) => r.category),
        text("payment_method", "طريقة الدفع", (r) => payMethodLabel(r.payment_method)),
        date("created_at", "التاريخ", (r) => r.voucher_date ?? r.created_at),
        text("status", "الحالة", DOC_STATUS),
        text("__source", "المصدر", (r) => sourceText(r.__link, r.source)),
        text("__recipient", "المستلم", (r) => r.recipient_name),
        text("description", "البيان", (r) => r.description),
      ];
      case "transfer": return [
        text("from_branch_id", "من", (r) => ctx.branchName(r.from_branch_id)),
        text("to_branch_id", "إلى", (r) => ctx.branchName(r.to_branch_id)),
        text("status", "الحالة", (r) => TRANSFER_STATUS_LABEL[r.status] ?? TRANSFER_STATUS_LABEL.pending),
        money("__value", "القيمة", (r) => ctx.transferValue(r.id) ?? null),
        text("__recipient", "المستلم", (r) => r.recipient_name),
        text("__notes", "الملاحظات", (r) => r.notes),
        date("created_at", "التاريخ", (r) => r.transfer_date ?? r.created_at),
      ];
      case "quote": return [
        text("quote_number", "رقم", (r) => r.quote_number),
        text("customer", "العميل", (r) => r.contacts?.name ?? r.customer_name),
        money("total", "الإجمالي", (r) => n(r.total)),
        date("valid_until", "صالح حتى", (r) => r.valid_until),
        text("status", "الحالة", (r) => r.status),
      ];
    }
  })();
  return view === "cancelled" ? cols.filter((c) => !ACTIVE_ONLY.has(c.key)) : cols;
}
