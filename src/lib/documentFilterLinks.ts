import type { DocumentFilters } from "@/components/documents/UnifiedDocumentFilters";
import { BLANK, type ColumnFilter, type FilterState } from "@/lib/tableFilter";

/**
 * The documents screen (فواتير ومستندات الفرع) has two ways to filter, kept as two faces of ONE set of filters
 * (owner 2026-10-26: «خلي الاتنين موجودين ويفضلو مربوطين ببعض»):
 *  - the filter bar on top, and
 *  - the Excel arrow of each column.
 * A field of the bar that a column can say — the period, the amount, «التصنيف», «حالة السداد», «طريقة الدفع»,
 * «نوع السند», the customer / supplier, «الحالة», «من فرع» / «إلى فرع» — is read from that column's filter and
 * written to it: pick «مدفوعة بالكامل» on top and the arrow of «حالة السداد» lights up with that value ticked; tick two
 * values in the arrow and the bar shows «الكل» (it can say one value only) while the chip says both.
 * Search, «المستلم» and «الملاحظات» (text inside) stay the bar's own filters, run in the database.
 * The period runs in the database too (it decides «as of the period's last day»); every other column filter runs on the
 * whole list in memory.
 */

export type DocTab = "sale" | "purchase" | "sale_return" | "purchase_return" | "income" | "expense" | "transfer" | "quote";
type Field = keyof DocumentFilters;
type Filters = Record<string, ColumnFilter>;

export type LinkCtx = {
  /** voucher categories of the tab (id ↔ the name the column shows) */
  categories: { id: string; name: string }[];
  /** the company's branches (id ↔ the name the column shows) */
  branches: { id: string; name: string }[];
  /** the customer / supplier picked in the bar: id → name, and back */
  partyName: (id: string) => string | undefined;
  partyId: (name: string) => string | undefined;
};

type Link = {
  fields: Field[];
  read: (f: Filters, c: LinkCtx) => Partial<DocumentFilters>;
  write: (f: Filters, bar: DocumentFilters, c: LinkCtx) => Filters;
};

/** the column of each tab that holds the document's date — the bar's period */
export const DATE_COLUMN: Partial<Record<DocTab, string>> = {
  sale: "invoice_date", purchase: "invoice_date", sale_return: "invoice_date", purchase_return: "invoice_date",
  income: "created_at", expense: "created_at", transfer: "created_at",
};

const without = (f: Filters, col: string): Filters => {
  if (!(col in f)) return f;
  const n = { ...f };
  delete n[col];
  return n;
};
const withF = (f: Filters, col: string, cf: ColumnFilter | null): Filters => (cf ? { ...f, [col]: cf } : without(f, col));

/** a values filter that says exactly one (non-blank) value */
const single = (cf?: ColumnFilter) => (cf?.kind === "values" && cf.values.length === 1 && cf.values[0] !== BLANK ? cf.values[0] : undefined);

function dateLink(col: string): Link {
  return {
    fields: ["from", "to"],
    read: (f) => {
      const cf = f[col];
      return cf?.kind === "date" ? { from: cf.from ?? "", to: cf.to ?? "" } : { from: "", to: "" };
    },
    write: (f, bar) => {
      const prev = f[col]?.kind === "date" ? (f[col] as Extract<ColumnFilter, { kind: "date" }>) : undefined;
      const next: ColumnFilter = { kind: "date" };
      if (prev?.days?.length) next.days = prev.days;
      if (bar.from) next.from = bar.from;
      if (bar.to) next.to = bar.to;
      return withF(f, col, next.days || next.from || next.to ? next : null);
    },
  };
}

const num = (s: string) => {
  const t = String(s ?? "").replace(/,/g, "").trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

function amountLink(col: string): Link {
  return {
    fields: ["amountMin", "amountMax"],
    read: (f) => {
      const cf = f[col];
      if (cf?.kind !== "number") return { amountMin: "", amountMax: "" };
      const a = String(cf.a);
      switch (cf.op) {
        case "between": {
          const lo = Math.min(cf.a, cf.b ?? cf.a), hi = Math.max(cf.a, cf.b ?? cf.a);
          return { amountMin: String(lo), amountMax: String(hi) };
        }
        case "eq": return { amountMin: a, amountMax: a };
        case "gte": case "gt": return { amountMin: a, amountMax: "" };
        case "lte": case "lt": return { amountMin: "", amountMax: a };
      }
      return { amountMin: "", amountMax: "" };
    },
    write: (f, bar) => {
      const lo = num(bar.amountMin), hi = num(bar.amountMax);
      if (lo !== undefined && hi !== undefined) return withF(f, col, { kind: "number", op: "between", a: lo, b: hi });
      if (lo !== undefined) return withF(f, col, { kind: "number", op: "gte", a: lo });
      if (hi !== undefined) return withF(f, col, { kind: "number", op: "lte", a: hi });
      return without(f, col);
    },
  };
}

/** a bar select ↔ one value of a column (the bar keeps its own keys, the column the words it shows) */
function valueLink(field: Field, col: string, toLabel: (v: string, c: LinkCtx) => string | undefined, fromLabel: (label: string, c: LinkCtx) => string | undefined): Link {
  return {
    fields: [field],
    read: (f, c) => {
      const v = single(f[col]);
      return { [field]: v !== undefined ? fromLabel(v, c) ?? "" : "" } as Partial<DocumentFilters>;
    },
    write: (f, bar, c) => {
      const v = bar[field];
      if (!v) return without(f, col);
      const label = toLabel(v, c);
      return label ? withF(f, col, { kind: "values", values: [label] }) : f;
    },
  };
}
const mapLink = (field: Field, col: string, map: Record<string, string>) =>
  valueLink(field, col, (v) => map[v], (label) => Object.keys(map).find((k) => map[k] === label));

/** «طريقة الدفع» of a sale / purchase = «that method's column is more than 0» */
const BUCKET_COLUMN: Record<string, string> = {
  cash: "__b_cash", instapay: "__b_instapay", wallet: "__b_wallet", bank: "__b_bank", account: "__b_account", return: "__b_other",
};
const isPositive = (cf?: ColumnFilter) => cf?.kind === "number" && cf.op === "gt" && cf.a === 0;
const paymentBucketLink: Link = {
  fields: ["payment"],
  read: (f) => ({ payment: Object.keys(BUCKET_COLUMN).find((k) => isPositive(f[BUCKET_COLUMN[k]])) ?? "" }),
  write: (f, bar) => {
    let n = f;
    const was = Object.keys(BUCKET_COLUMN).find((k) => isPositive(f[BUCKET_COLUMN[k]]));
    if (was) n = without(n, BUCKET_COLUMN[was]);
    if (bar.payment && BUCKET_COLUMN[bar.payment]) n = withF(n, BUCKET_COLUMN[bar.payment], { kind: "number", op: "gt", a: 0 });
    return n;
  },
};

export const CLASS_LABEL: Record<string, string> = { cash: "نقدي", credit: "آجل" };
export const PAY_STATE_LABEL: Record<string, string> = { paid: "مدفوعة بالكامل", partial: "سداد جزئي", unpaid: "لم يتم الدفع" };
export const VOUCHER_METHOD_LABEL: Record<string, string> = { cash: "كاش", instapay: "انستاباي", wallet: "محفظة", bank: "بنكي" };
export const TRANSFER_STATUS_LABEL: Record<string, string> = { pending: "معلق", confirmed: "مؤكد", rejected: "مرفوض" };
const QUOTE_STATUS: Record<string, string> = { draft: "draft", sent: "sent", accepted: "accepted", rejected: "rejected" };

const categoryLink = valueLink("categoryId", "category",
  (id, c) => c.categories.find((x) => x.id === id)?.name, (name, c) => c.categories.find((x) => x.name === name)?.id);
const branchLink = (field: "fromBranch" | "toBranch", col: string) => valueLink(field, col,
  (id, c) => c.branches.find((x) => x.id === id)?.name, (name, c) => c.branches.find((x) => x.name === name)?.id);
const partyLink = (col: string) => valueLink("partyId", col, (id, c) => c.partyName(id), (name, c) => c.partyId(name));

export function linksOf(tab: DocTab): Link[] {
  switch (tab) {
    case "sale": return [dateLink("invoice_date"), amountLink("total"), mapLink("settleClass", "__class", CLASS_LABEL), mapLink("payState", "__pay_state", PAY_STATE_LABEL), paymentBucketLink];
    case "purchase": return [dateLink("invoice_date"), amountLink("total_cost"), mapLink("settleClass", "__class", CLASS_LABEL), mapLink("payState", "__pay_state", PAY_STATE_LABEL), paymentBucketLink];
    case "sale_return": return [dateLink("invoice_date"), amountLink("total_refund"), partyLink("customer")];
    case "purchase_return": return [dateLink("invoice_date"), amountLink("total_amount"), partyLink("supplier")];
    case "income":
    case "expense": return [dateLink("created_at"), amountLink("amount"), mapLink("payment", "payment_method", VOUCHER_METHOD_LABEL), categoryLink];
    case "transfer": return [dateLink("created_at"), mapLink("status", "status", TRANSFER_STATUS_LABEL), branchLink("fromBranch", "from_branch_id"), branchLink("toBranch", "to_branch_id")];
    case "quote": return [amountLink("total"), mapLink("status", "status", QUOTE_STATUS)];
  }
}

/** the bar fields a column says (the rest of the bar are its own filters) */
export function linkedFields(tab: DocTab): Set<Field> {
  return new Set(linksOf(tab).flatMap((l) => l.fields));
}

/** what the bar shows for its linked fields, read from the column filters */
export function barFromColumns(tab: DocTab, f: Filters, c: LinkCtx): Partial<DocumentFilters> {
  return Object.assign({}, ...linksOf(tab).map((l) => l.read(f, c)));
}

/**
 * The column filters after the person changed the bar from `prev` to `next`: only links whose fields changed write
 * (a column filter the bar can't say — two values ticked — stays as it is while another field is edited).
 */
export function columnsFromBar(tab: DocTab, f: Filters, prev: DocumentFilters, next: DocumentFilters, c: LinkCtx): Filters {
  let out = f;
  for (const l of linksOf(tab)) {
    if (l.fields.some((k) => (prev[k] ?? "") !== (next[k] ?? ""))) out = l.write(out, next, c);
  }
  return out;
}

/**
 * Does the screen need the whole list in memory? Yes for every column filter and any sort; no when the only filter
 * is the period (the database applies it and the screen keeps reading one page at a time).
 */
export function needsWholeList(tab: DocTab, s: FilterState): boolean {
  if (s.sort) return true;
  const dc = DATE_COLUMN[tab];
  return Object.entries(s.filters).some(([k, cf]) => !(k === dc && cf.kind === "date" && !cf.days?.length));
}

/** the period the database filters on: the date column's from / to */
export function periodOf(tab: DocTab, s: FilterState): { from: string; to: string } | null {
  const dc = DATE_COLUMN[tab];
  if (!dc) return null;
  const cf = s.filters[dc];
  return cf?.kind === "date" ? { from: cf.from ?? "", to: cf.to ?? "" } : { from: "", to: "" };
}
