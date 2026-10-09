// Unified ledger readers (Step 6C). Every balance on screen comes from these server functions.
// Rules: customer and supplier sides are never netted; a branch view = documents and money of that
// branch, with cross-branch uses shown as their own lines; company-wide = sum of all branches.
// Sign of a side balance: customer + = the customer owes us, − = we hold his advance (2150);
//                         supplier + = we owe the supplier, − = our advance with him (1460).
import { supabase } from "@/integrations/supabase/client";

export type Side = "customer" | "supplier";

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);
const n = (v: unknown) => Number(v) || 0;
/** Round money to the piaster (all sums are done in SQL numeric; this only cleans JSON numbers). */
export const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** Every row of a set-returning reader, in pages of 1,000 (PostgREST caps one response at 1,000 rows). */
const PAGE = 1000;
async function callAll<T>(fn: string, args: Record<string, unknown>, orderBy: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = rpc(fn, args);
    for (const col of orderBy) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ---------------------------------------------------------------- side balances of contacts
export interface SideBalances {
  contact_id: string;
  customer_balance: number | null;
  customer_open: number | null;
  customer_advance: number | null;
  customer_overdue: number | null;
  supplier_balance: number | null;
  supplier_open: number | null;
  supplier_advance: number | null;
  supplier_overdue: number | null;
}

/** Both side balances of the given contacts (company-wide unless a branch is given). */
export async function fetchSideBalances(ids: (string | null | undefined)[], branchId?: string | null): Promise<Map<string, SideBalances>> {
  const clean = Array.from(new Set(ids.filter(Boolean) as string[]));
  const out = new Map<string, SideBalances>();
  for (let i = 0; i < clean.length; i += PAGE) {
    const chunk = clean.slice(i, i + PAGE);
    const rows = await call<any[]>("contact_side_balances", { p_contact_ids: chunk, p_branch_id: branchId ?? null });
    for (const r of rows ?? []) {
      out.set(r.contact_id, {
        contact_id: r.contact_id,
        customer_balance: r.customer_balance == null ? null : n(r.customer_balance),
        customer_open: r.customer_open == null ? null : n(r.customer_open),
        customer_advance: r.customer_advance == null ? null : n(r.customer_advance),
        customer_overdue: r.customer_overdue == null ? null : n(r.customer_overdue),
        supplier_balance: r.supplier_balance == null ? null : n(r.supplier_balance),
        supplier_open: r.supplier_open == null ? null : n(r.supplier_open),
        supplier_advance: r.supplier_advance == null ? null : n(r.supplier_advance),
        supplier_overdue: r.supplier_overdue == null ? null : n(r.supplier_overdue),
      });
    }
  }
  return out;
}

export async function fetchSideBalance(id: string | null | undefined, branchId?: string | null): Promise<SideBalances | null> {
  if (!id) return null;
  const m = await fetchSideBalances([id], branchId);
  return m.get(id) ?? null;
}

/** Plain-language label of one side balance. */
export function sideBalanceLabel(side: Side, balance: number | null | undefined): { label: string; amount: number; tone: "good" | "bad" | "neutral" } {
  const b = r2(n(balance));
  if (Math.abs(b) < 0.005) return { label: side === "customer" ? "حساب العميل مسدد" : "حساب المورد مسدد", amount: 0, tone: "neutral" };
  if (side === "customer") {
    return b > 0 ? { label: "مستحق لنا على العميل", amount: b, tone: "bad" } : { label: "مقدم من العميل عندنا", amount: -b, tone: "good" };
  }
  return b > 0 ? { label: "مستحق للمورد علينا", amount: b, tone: "bad" } : { label: "مقدم لينا عند المورد", amount: -b, tone: "good" };
}

// ---------------------------------------------------------------- contacts page
export interface ContactPageRow {
  id: string; name: string; phone: string | null; contact_person: string | null; email: string | null;
  address: string | null; notes: string | null; type: "customer" | "supplier" | "both"; branch_id: string | null;
  created_at: string; opening_balance: number | null; is_migrated: boolean | null;
  customer_balance: number; customer_open: number; customer_advance: number; customer_overdue: number; customer_balance_all: number;
  supplier_balance: number; supplier_open: number; supplier_advance: number; supplier_overdue: number; supplier_balance_all: number;
}
export interface ContactPageTotals {
  customers_open: number; customers_open_count: number; customer_advances: number; customer_advances_count: number;
  suppliers_open: number; suppliers_open_count: number; supplier_advances: number; supplier_advances_count: number;
  customer_overdue: number; supplier_overdue: number;
}
export interface ContactsPage {
  rows: ContactPageRow[];
  total: number;
  counts: { all: number; customer: number; supplier: number; both: number };
  totals: ContactPageTotals;
  sides: { customer: boolean; supplier: boolean };
}
export type BalanceFilter = "owe_us" | "we_owe" | "customer_advance" | "supplier_advance" | "overdue" | "settled";

export async function fetchContactsPage(args: {
  branchId: string | null; type?: "all" | "customer" | "supplier" | "both"; query?: string | null;
  balance?: BalanceFilter[] | null; limit?: number; offset?: number;
}): Promise<ContactsPage> {
  const data = await call<any>("contacts_page", {
    p_branch_id: args.branchId, p_type: args.type ?? "all", p_query: args.query || null,
    p_balance: args.balance && args.balance.length ? args.balance : null, p_limit: args.limit ?? 50, p_offset: args.offset ?? 0,
  });
  const num = (o: any) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, typeof v === "string" || typeof v === "number" ? n(v) : v]));
  return {
    rows: ((data?.rows ?? []) as any[]).map((r) => ({
      ...r,
      customer_balance: n(r.customer_balance), customer_open: n(r.customer_open), customer_advance: n(r.customer_advance),
      customer_overdue: n(r.customer_overdue), customer_balance_all: n(r.customer_balance_all),
      supplier_balance: n(r.supplier_balance), supplier_open: n(r.supplier_open), supplier_advance: n(r.supplier_advance),
      supplier_overdue: n(r.supplier_overdue), supplier_balance_all: n(r.supplier_balance_all),
    })),
    total: n(data?.total),
    counts: num(data?.counts) as any,
    totals: num(data?.totals) as any,
    sides: data?.sides ?? { customer: true, supplier: true },
  };
}

/** Every row of the contacts page (pages of 1,000) — for exports and admin lists. */
export async function fetchAllContactsPage(args: Omit<Parameters<typeof fetchContactsPage>[0], "limit" | "offset">) {
  const rows: ContactPageRow[] = [];
  let first: ContactsPage | null = null;
  for (let off = 0; ; off += 1000) {
    const p = await fetchContactsPage({ ...args, limit: 1000, offset: off });
    if (!first) first = p;
    rows.push(...p.rows);
    if (p.rows.length < 1000) break;
  }
  return { ...(first as ContactsPage), rows };
}

// ---------------------------------------------------------------- contact file (360°)
export interface SideOverview {
  documents: { count: number; total: number; open_count: number; closed_count: number; cancelled_count: number; cancelled_total: number };
  returns: { count: number; total: number; cash: number; credit: number };
  money: { collected?: number; paid?: number; deposits?: number; by_method: Record<string, number>; refunded: number; opening_debt: number; opening_advance: number };
  open_remaining: number; advance: number; balance: number; overdue: number;
  paid_from_other_branches: number; used_in_other_branches: number;
  discounts?: number;
  before_ledger: { count: number; total: number };
  /** Set for branch staff viewing "all branches": only the four global totals are filled. */
  totals_only?: boolean;
}
export interface ContactOverview {
  contact: {
    id: string; name: string; type: "customer" | "supplier" | "both"; phone: string | null; contact_person: string | null;
    address: string | null; notes: string | null; email: string | null; is_archived: boolean; opening_balance: number | null;
    branch_id: string | null; branch_name: string | null; branches?: { id: string; name: string }[];
  };
  branch_id: string | null;
  ledger_date: string;
  customer: SideOverview | null;
  supplier: SideOverview | null;
}

const numDeep = (v: any): any => {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map(numDeep);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "by_method" ? Object.fromEntries(Object.entries(x as any ?? {}).map(([a, b]) => [a, n(b)])) : numDeep(x)]));
  return typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
};

export async function fetchContactOverview(contactId: string, branchId?: string | null): Promise<ContactOverview> {
  const d = await call<any>("ledger_contact_overview", { p_contact: contactId, p_branch_id: branchId ?? null });
  return { ...d, customer: numDeep(d.customer), supplier: numDeep(d.supplier) };
}

export type DocState = "open" | "closed" | "cancelled" | "before_ledger";
export interface ContactDocument {
  doc_type: "invoice" | "shipment" | "movement"; doc_id: string; doc_number: string | null; doc_date: string;
  branch_id: string; branch_name: string | null; state: DocState; total: number;
  paid_money: number | null; paid_by_returns: number | null; paid_from_other_branches: number | null; remaining: number | null;
  cancel_reason: string | null;
}
export async function fetchContactDocuments(contactId: string, side: Side, branchId?: string | null): Promise<ContactDocument[]> {
  const rows = await callAll<any>("ledger_contact_documents", { p_contact: contactId, p_side: side, p_branch_id: branchId ?? null }, ["doc_type", "doc_id"]);
  return (rows ?? []).map((r) => ({
    ...r, total: n(r.total),
    paid_money: r.paid_money == null ? null : n(r.paid_money), paid_by_returns: r.paid_by_returns == null ? null : n(r.paid_by_returns),
    paid_from_other_branches: r.paid_from_other_branches == null ? null : n(r.paid_from_other_branches),
    remaining: r.remaining == null ? null : n(r.remaining),
  })).sort((a, b) => (a.doc_date < b.doc_date ? 1 : a.doc_date > b.doc_date ? -1 : 0));
}

export interface ContactMoneyRow {
  movement_id: string; kind: string; kind_label: string; effect: "settle" | "charge"; movement_date: string;
  branch_id: string; branch_name: string | null; method: string | null; amount: number; allocated: number; unallocated: number;
  used_in_other_branches: number; status: "active" | "cancelled"; reference: string | null; source_table: string; source_id: string;
  target_doc_number: string | null; cancel_reason: string | null;
}
export async function fetchContactMoney(contactId: string, side: Side, branchId?: string | null): Promise<ContactMoneyRow[]> {
  const rows = await callAll<any>("ledger_contact_money", { p_contact: contactId, p_side: side, p_branch_id: branchId ?? null }, ["movement_id"]);
  return (rows ?? []).map((r) => ({ ...r, amount: n(r.amount), allocated: n(r.allocated), unallocated: n(r.unallocated), used_in_other_branches: n(r.used_in_other_branches) }))
    .sort((a, b) => (a.movement_date < b.movement_date ? 1 : a.movement_date > b.movement_date ? -1 : 0));
}

export interface StatementLine {
  line_no: number; line_date: string | null; line_type: string; reference: string | null; branch_name: string | null;
  description: string | null; debit: number; credit: number; balance: number; doc_type: string | null; doc_id: string | null;
  branch_id: string | null;
}
/** Statement of one side; debit = adds to what is open, credit = reduces it; balance uses the side's sign. */
export async function fetchContactStatement(contactId: string, side: Side, branchId?: string | null, from?: string | null, to?: string | null): Promise<StatementLine[]> {
  const rows = await callAll<any>("ledger_contact_statement", { p_contact: contactId, p_side: side, p_branch_id: branchId ?? null, p_from: from || null, p_to: to || null }, ["line_no"]);
  return (rows ?? []).map((r) => ({ ...r, debit: n(r.debit), credit: n(r.credit), balance: n(r.balance) }));
}

// ---------------------------------------------------------------- documents on the six screens
export interface DocumentStatus {
  doc_id: string; total: number; paid: number; paid_money: number; paid_by_returns: number;
  paid_from_other_branches: number; remaining: number; state: "paid" | "partial" | "unpaid" | "cancelled" | "before_ledger";
}
export async function fetchDocumentStatus(docType: "invoice" | "shipment", ids: (string | null | undefined)[], signal?: AbortSignal): Promise<Map<string, DocumentStatus>> {
  const clean = Array.from(new Set(ids.filter(Boolean) as string[]));
  const out = new Map<string, DocumentStatus>();
  for (let i = 0; i < clean.length; i += 1000) {
    let q = rpc("ledger_document_status", { p_doc_type: docType, p_ids: clean.slice(i, i + 1000) });
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of (data ?? []) as any[]) {
      out.set(r.doc_id, {
        doc_id: r.doc_id, total: n(r.total), paid: n(r.paid), paid_money: n(r.paid_money), paid_by_returns: n(r.paid_by_returns),
        paid_from_other_branches: n(r.paid_from_other_branches), remaining: n(r.remaining), state: r.state,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- company / branch position
export interface LedgerPosition {
  branch_id: string | null;
  ledger_date: string;
  customers: { open: number; open_contacts: number; advances: number; advance_contacts: number; overdue: number; walkin_open: number } | null;
  suppliers: { open: number; open_contacts: number; advances: number; advance_contacts: number; overdue: number } | null;
  cross_branch: { paid_here_for_other_branches: number; paid_elsewhere_for_this_branch: number; total: number; count: number };
}
export async function fetchLedgerPosition(branchId?: string | null): Promise<LedgerPosition> {
  const d = await call<any>("ledger_position", { p_branch_id: branchId ?? null });
  return { ...d, customers: numDeep(d.customers), suppliers: numDeep(d.suppliers), cross_branch: numDeep(d.cross_branch) };
}

export interface AgingRow {
  contact_id: string; contact_name: string; contact_type: string; d0_30: number; d31_60: number; d61_90: number;
  d91_120: number; d120_plus: number; total_open: number; advance: number; oldest_date: string | null;
}
export async function fetchAging(side: Side, branchId?: string | null): Promise<AgingRow[]> {
  const rows = await callAll<any>("ledger_aging", { p_side: side, p_branch_id: branchId ?? null }, ["contact_id"]);
  return (rows ?? []).map((r) => ({
    ...r, d0_30: n(r.d0_30), d31_60: n(r.d31_60), d61_90: n(r.d61_90), d91_120: n(r.d91_120), d120_plus: n(r.d120_plus),
    total_open: n(r.total_open), advance: n(r.advance),
  }));
}

// ---------------------------------------------------------------- opening balances and integrity
export interface OpeningSummary {
  as_of: string | null; ledger_date: string; main_treasury: { id: string; name: string } | null;
  cash: { branch_id: string; branch_name: string; amount: number }[]; cash_total: number;
  customers_debt: number; customers_advance: number; suppliers_payable: number; suppliers_advance: number;
  contacts_count: number; inventory_value: number; inventory_remaining_value: number;
}
export async function fetchOpeningSummary(): Promise<OpeningSummary> {
  return numDeep(await call<any>("opening_balances_summary", {}));
}

export interface IntegrityFinding {
  check_code: string; severity: "error" | "warning" | "info"; area: string; title: string; details: string | null;
  contact_id: string | null; contact_name: string | null; branch_id: string | null; branch_name: string | null;
  doc_type: string | null; doc_id: string | null; doc_number: string | null; amount: number | null;
}
export async function fetchIntegrityAudit(): Promise<IntegrityFinding[]> {
  // The JSON form returns every finding in one value, so the 1,000-row response cap never cuts the list.
  const rows = await call<any[]>("system_integrity_audit_json", { p_tenant: null });
  return (rows ?? []).map((r) => ({ ...r, amount: r.amount == null ? null : n(r.amount) }));
}

/** Arabic label of a stored payment method key. */
export const METHOD_LABEL: Record<string, string> = {
  cash: "نقدي", instapay: "انستاباي", vodafone: "فودافون كاش", vodafone_cash: "فودافون كاش", wallet: "محفظة",
  bank: "تحويل بنكي", bank_transfer: "تحويل بنكي", transfer: "تحويل بنكي", card: "كارت", other: "أخرى",
};
export const methodLabel = (m: string | null | undefined) => (m ? METHOD_LABEL[m] ?? m : "—");
