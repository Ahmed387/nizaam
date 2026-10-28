import { getCairoDayBounds } from "@/lib/cairoDate";
/**
 * Profit Engine — Single Source of Truth for Revenue / Cost / Expenses / Net Profit.
 *
 * Every screen that shows profitability numbers MUST use these helpers, otherwise
 * different pages will show different totals and the admin will lose trust.
 *
 * Canonical formula — the SAME as the card «لقطة البيزنس» and the books (migrations 0129 / 0133, owner 2026-10-28):
 *   a sale counts on ITS day at its FULL quantity, a return counts on the RETURN's day.
 *   Revenue        = Σ unit_price × quantity (− the bill discount)   − Σ refunds of the returns dated in the period
 *   COGS / Cost    = Σ unit_cost_at_sale × quantity                  − Σ cost that came back with those returns
 *                    (archive invoices before 2026 keep cost × net_quantity: their cost was net, no cost comes back)
 *   Gross Profit   = Revenue − COGS
 *   Expenses       = Σ vouchers(type=payment, status=active, deductible category)
 *   Net Profit     = Gross Profit − Expenses
 *   Returns of the period come from `sale_return_lines(from, to, branch)` (fetchReturnLines / returnEffect).
 *   Example SR00083: IN04796 sold 2/3 for 20,332 (cost 16,350), returned 23/5 → March +3,982, May −3,982.
 *
 *   net_quantity   = max(0, quantity − returned_quantity)   (archive cost only)
 *   unit_price     = total / quantity   (per row; total is post line_discount)
 *
 * Note: "is_migrated" invoices may have unit_cost_at_sale=0 — cost is then unknown,
 * not zero. Use `lineProfit(it, { invoiceIsMigrated })` and check `costUnknown`.
 */

import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";

export interface InvoiceItemLike {
  quantity: number | string | null;
  returned_quantity?: number | string | null;
  net_quantity?: number | string | null;
  total?: number | string | null;
  selling_price?: number | string | null;
  line_discount?: number | string | null;
  unit_cost_at_sale?: number | string | null;
  cost_price?: number | string | null;
}

export interface LineProfit {
  netQty: number;
  revenue: number;
  cost: number;
  profit: number;
  costUnknown: boolean;
}

/** Archive invoice = dated before 2026 AND recorded before it (or migrated) — same rule as ledger_invoice_is_archive. */
export const LEDGER_CUTOFF_DAY = "2026-01-01";
const cairoDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
export function isArchiveInvoice(inv: { invoice_date?: string | null; created_at?: string | null; is_migrated?: boolean | null; migration_batch_id?: string | null }): boolean {
  const doc = inv.invoice_date ?? inv.created_at;
  if (!doc) return !!inv.is_migrated;
  if (cairoDay(doc) >= LEDGER_CUTOFF_DAY) return false;
  return cairoDay(inv.created_at ?? doc) < LEDGER_CUTOFF_DAY || !!inv.is_migrated || !!inv.migration_batch_id;
}

export function lineProfit(
  it: InvoiceItemLike,
  opts: { invoiceIsMigrated?: boolean; /** return lens (0133): count the full quantity, returns come back on their day */ fullQuantity?: boolean } = {}
): LineProfit {
  const qty = Number(it.quantity) || 0;
  const ret = Number(it.returned_quantity ?? 0) || 0;
  const netQty = opts.fullQuantity ? qty : Math.max(0, Number(it.net_quantity ?? qty - ret));

  // Prefer pre-computed total (post line_discount) when available, fall back to
  // selling_price − unit line_discount.
  let unitRev = 0;
  if (it.total != null && qty > 0) {
    unitRev = Number(it.total) / qty;
  } else {
    const sp = Number(it.selling_price ?? 0);
    const ld = qty > 0 ? Number(it.line_discount ?? 0) / qty : 0;
    unitRev = sp - ld;
  }

  // unit_cost_at_sale بيتسجل 0 في حالات كتير (مش NULL) — لازم نرجع لـ cost_price
  // وإلا التكلفة بتتحسب صفر والربح بيطلع مضخّم.
  const snapCost = Number(it.unit_cost_at_sale ?? 0) || 0;
  const unitCost = snapCost > 0 ? snapCost : Number(it.cost_price ?? 0) || 0;
  const costUnknown = unitCost <= 0 && !!opts.invoiceIsMigrated;

  const revenue = unitRev * netQty;
  const cost = unitCost * netQty;
  const profit = costUnknown ? 0 : revenue - cost;

  return { netQty, revenue, cost, profit, costUnknown };
}

export interface InvoiceLike {
  is_migrated?: boolean | null;
  invoice_date?: string | null;
  created_at?: string | null;
  migration_batch_id?: string | null;
  discount_amount?: number | string | null;
  invoice_items?: InvoiceItemLike[] | null;
}

export interface InvoiceProfit {
  /** Revenue net of returns AND net of the invoice-level discount (excludes VAT). */
  revenue: number;
  cost: number;
  profit: number;
  /** Portion of the invoice-level discount attributed to the non-returned lines. */
  discountShare: number;
}

/**
 * Canonical per-invoice revenue.
 *
 * `lineProfit()` only sees line-level values, so an invoice-level discount
 * (invoices.discount_amount — applied on the whole bill, not per line) used to be
 * invisible in every report: sales and gross profit were both overstated by it.
 * Here the discount is allocated proportionally over the lines that were NOT
 * returned, so returns and bill discounts compose correctly.
 *
 * VAT is intentionally excluded (invoices.total includes it) — reports show
 * revenue, not what the customer paid.
 */
export function invoiceProfit(inv: InvoiceLike): InvoiceProfit {
  // return lens (0133): the sale counts at its FULL quantity and the whole bill discount; what comes back is taken
  // off on the return's day (returnEffect). The cost of an archive invoice stays net (no cost comes back for it).
  const archive = isArchiveInvoice(inv);
  const items = inv.invoice_items ?? [];
  let grossRevenue = 0; // full quantity, before invoice-level discount
  let cost = 0;
  for (const it of items) {
    const full = lineProfit(it, { invoiceIsMigrated: !!inv.is_migrated, fullQuantity: true });
    grossRevenue += full.revenue;
    cost += archive ? lineProfit(it, { invoiceIsMigrated: !!inv.is_migrated }).cost : full.cost;
  }
  const discount = Math.max(0, Number(inv.discount_amount ?? 0) || 0);
  const discountShare = Math.min(discount, grossRevenue);
  const revenue = Math.max(0, grossRevenue - discountShare);
  return { revenue, cost, profit: revenue - cost, discountShare };
}

/** One line of a sale return dated in the period (`sale_return_lines`, migration 0133). */
export interface ReturnLine {
  branch_id: string;
  return_id: string;
  return_number: string;
  return_day: string;
  invoice_id: string;
  invoice_number: string;
  invoice_day: string;
  archive_invoice: boolean;
  product_id: string | null;
  product_name: string;
  quantity: number;
  refund: number;
  unit_cost: number;
  cost: number;
}

/** The returns dated in [fromDay, toDay] (Cairo days), optionally of one branch. */
export async function fetchReturnLines(fromDay: string, toDay: string, branchId?: string | null): Promise<ReturnLine[]> {
  const { data, error } = await (supabase.rpc as any)("sale_return_lines", { p_from: fromDay, p_to: toDay, p_branch: branchId ?? null });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    quantity: Number(r.quantity ?? 0), refund: Number(r.refund ?? 0), unit_cost: Number(r.unit_cost ?? 0), cost: Number(r.cost ?? 0),
  }));
}

export interface ReturnEffect { revenue: number; cost: number; returns: number }
/** What the returns take off: their refunds from revenue, the cost that came back from COGS. */
export function returnEffect(lines: ReturnLine[], keep: (l: ReturnLine) => boolean = () => true): ReturnEffect {
  let revenue = 0, cost = 0;
  const ids = new Set<string>();
  for (const l of lines) {
    if (!keep(l)) continue;
    revenue += l.refund;
    cost += l.cost;
    ids.add(l.return_id);
  }
  return { revenue, cost, returns: ids.size };
}

export interface ProfitTotals {
  revenue: number;
  cost: number;
  gross: number;
  expenses: number;
  /** إيرادات أخرى: سندات قبض مربوطة بتصنيف عليه فلاج «يُضاف للربح» */
  otherIncomes: number;
  net: number;
  margin: number; // 0..100
  /** عدد سندات المصروفات المحتسبة */
  expensesCount?: number;
}

export function aggregateTotals(
  items: Array<{ line: LineProfit }>,
  expensesAmount: number,
  otherIncomesAmount = 0
): ProfitTotals {
  let revenue = 0,
    cost = 0;
  for (const r of items) {
    revenue += r.line.revenue;
    cost += r.line.cost;
  }
  const gross = revenue - cost;
  const net = gross - expensesAmount + otherIncomesAmount;
  const margin = revenue > 0 ? (net / revenue) * 100 : 0;
  return { revenue, cost, gross, expenses: expensesAmount, otherIncomes: otherIncomesAmount, net, margin };
}


export interface ProfitWindow {
  totals: ProfitTotals;
  prevNet: number;
  perBranch: { id: string; name: string; revenue: number; cost: number; expenses: number; otherIncomes: number; net: number }[];
}

export interface ProfitRange {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
}

/**
 * Fetch invoices+items+vouchers for the given window and return canonical totals,
 * previous-window net (for delta), and per-branch breakdown.
 */
export async function fetchProfitWindow(params: {
  tenantId: string;
  range: ProfitRange;
  branchId?: string | null;
}): Promise<ProfitWindow> {
  const { tenantId, range, branchId } = params;
  // تواريخ محلية (وليس UTC) عشان voucher_date عمود date ويتطابق مع يوم المستخدم
  // توحيد اليوم بتوقيت القاهرة (يوم كامل 00:00:00.000 → 23:59:59.999)
  const localDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  const fromDate = localDay(range.from);
  const toDate = localDay(range.to);
  const prevFromDate = localDay(range.prevFrom);
  const prevToDate = localDay(range.prevTo);

  const invSelect =
    "id, branch_id, is_migrated, migration_batch_id, invoice_date, created_at, discount_amount, invoice_items(quantity, returned_quantity, net_quantity, total, selling_price, line_discount, unit_cost_at_sale, cost_price)";

  // ملاحظة: PostgREST بيقص عند 1000 صف — بنستخدم fetchAllRows عشان الأرقام ما تنقصش
  const buildInv = (f: string, t: string) => {
    let q = supabase
      .from("invoices")
      .select(invSelect)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .gte("invoice_date", getCairoDayBounds(f).startIso!)
      .lte("invoice_date", getCairoDayBounds(undefined, t).endIso!);
    if (branchId) q = q.eq("branch_id", branchId);
    return q.order("id");
  };
  const buildExp = (f: string, t: string, withBranch: boolean) => {
    let q = supabase
      .from("vouchers")
      .select(
        withBranch
          ? "amount, branch_id, voucher_categories!inner(is_deductible_from_profit)"
          : "amount, voucher_categories!inner(is_deductible_from_profit)",
      )
      .eq("tenant_id", tenantId)
      .eq("type", "payment")
      .eq("status", "active")
      .eq("voucher_categories.is_deductible_from_profit", true)
      .gte("voucher_date", f)
      .lte("voucher_date", t);
    if (branchId) q = q.eq("branch_id", branchId);
    return q.order("id");
  };
  // إيرادات أخرى: سندات قبض يدوية بتصنيف عليه فلاج «يُضاف للربح».
  // بنستثني السندات النظامية (source='system') لأنها مرآة لتحصيلات الفواتير — وإلا يحصل ازدواج.
  const buildInc = (f: string, t: string, withBranch: boolean) => {
    let q = supabase
      .from("vouchers")
      .select(
        withBranch
          ? "amount, branch_id, voucher_categories!inner(is_added_to_profit)"
          : "amount, voucher_categories!inner(is_added_to_profit)",
      )
      .eq("tenant_id", tenantId)
      .eq("type", "receipt")
      .eq("status", "active")
      .eq("source", "manual")
      .eq("voucher_categories.is_added_to_profit", true)
      .gte("voucher_date", f)
      .lte("voucher_date", t);
    if (branchId) q = q.eq("branch_id", branchId);
    return q.order("id");
  };

  const [invRows, prevInvRows, expRows, prevExpRows, incRows, prevIncRows, branchesRes, retLines, prevRetLines] = await Promise.all([
    // Cairo days (not UTC ISO instants): getCairoDayBounds reads the first 10 characters, so an ISO
    // instant of Cairo midnight (the previous UTC day) used to start the window one day early.
    fetchAllRows<any>(() => buildInv(fromDate, toDate)),
    fetchAllRows<any>(() => buildInv(prevFromDate, prevToDate)),
    fetchAllRows<any>(() => buildExp(fromDate, toDate, true)),
    fetchAllRows<any>(() => buildExp(prevFromDate, prevToDate, false)),
    fetchAllRows<any>(() => buildInc(fromDate, toDate, true)),
    fetchAllRows<any>(() => buildInc(prevFromDate, prevToDate, false)),
    supabase.from("branches").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).eq("is_system", false),
    // the returns of each window, on their own day (0133)
    fetchReturnLines(fromDate, toDate, branchId),
    fetchReturnLines(prevFromDate, prevToDate, branchId),
  ]);
  const invRes = { data: invRows };
  const expRes = { data: expRows };
  const incRes = { data: incRows };

  const sumInv = (rows: any[]) => {
    let rev = 0,
      cost = 0;
    for (const inv of rows ?? []) {
      const ip = invoiceProfit(inv);
      rev += ip.revenue;
      cost += ip.cost;
    }
    return { revenue: rev, cost };
  };

  const curInv = sumInv(invRows);
  const prevInv = sumInv(prevInvRows);
  const curRet = returnEffect(retLines);
  const prevRet = returnEffect(prevRetLines);
  const cur = { revenue: curInv.revenue - curRet.revenue, cost: curInv.cost - curRet.cost };
  const prev = { revenue: prevInv.revenue - prevRet.revenue, cost: prevInv.cost - prevRet.cost };
  const expenses = expRows.reduce((s: number, v: any) => s + Number(v.amount || 0), 0);
  const prevExpenses = prevExpRows.reduce((s: number, v: any) => s + Number(v.amount || 0), 0);
  const otherIncomes = incRows.reduce((s: number, v: any) => s + Number(v.amount || 0), 0);
  const prevOtherIncomes = prevIncRows.reduce((s: number, v: any) => s + Number(v.amount || 0), 0);

  const netNow = cur.revenue - cur.cost - expenses + otherIncomes;
  const totals: ProfitTotals = {
    revenue: cur.revenue,
    cost: cur.cost,
    gross: cur.revenue - cur.cost,
    expenses,
    otherIncomes,
    net: netNow,
    margin: cur.revenue > 0 ? (netNow / cur.revenue) * 100 : 0,
    expensesCount: expRows.length,
  };
  const prevNet = prev.revenue - prev.cost - prevExpenses + prevOtherIncomes;


  // Per-branch
  const branches = branchesRes.data ?? [];
  const blank = () => ({ revenue: 0, cost: 0, expenses: 0, otherIncomes: 0 });
  const byBranch: Record<string, { revenue: number; cost: number; expenses: number; otherIncomes: number }> = {};
  for (const inv of (invRes.data ?? []) as any[]) {
    const b = inv.branch_id;
    if (!b) continue;
    if (!byBranch[b]) byBranch[b] = blank();
    const ip = invoiceProfit(inv);
    byBranch[b].revenue += ip.revenue;
    byBranch[b].cost += ip.cost;
  }
  for (const l of retLines) {
    if (!l.branch_id) continue;
    if (!byBranch[l.branch_id]) byBranch[l.branch_id] = blank();
    byBranch[l.branch_id].revenue -= l.refund;
    byBranch[l.branch_id].cost -= l.cost;
  }
  for (const v of (expRes.data ?? []) as any[]) {
    if (!v.branch_id) continue;
    if (!byBranch[v.branch_id]) byBranch[v.branch_id] = blank();
    byBranch[v.branch_id].expenses += Number(v.amount || 0);
  }
  for (const v of (incRes.data ?? []) as any[]) {
    if (!v.branch_id) continue;
    if (!byBranch[v.branch_id]) byBranch[v.branch_id] = blank();
    byBranch[v.branch_id].otherIncomes += Number(v.amount || 0);
  }
  const perBranch = branches.map((b: any) => {
    const x = byBranch[b.id] ?? blank();
    return {
      id: b.id,
      name: b.name,
      revenue: x.revenue,
      cost: x.cost,
      expenses: x.expenses,
      otherIncomes: x.otherIncomes,
      net: x.revenue - x.cost - x.expenses + x.otherIncomes,
    };
  });

  return { totals, prevNet, perBranch };
}

export type ProfitPeriod = "day" | "week" | "month" | "year";

export function rangeFor(p: ProfitPeriod): ProfitRange {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (p === "week") from.setDate(from.getDate() - 6);
  else if (p === "month") from.setDate(from.getDate() - 29);
  else if (p === "year") from.setDate(from.getDate() - 364);
  const spanMs = to.getTime() - from.getTime() + 1;
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - spanMs + 1);
  return { from, to, prevFrom, prevTo };
}

export function rangeForDates(fromDate: string, toDate: string): ProfitRange {
  const from = new Date(getCairoDayBounds(fromDate).startIso!);
  const to = new Date(getCairoDayBounds(undefined, toDate).endIso!);
  const spanMs = to.getTime() - from.getTime() + 1;
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - spanMs + 1);
  return { from, to, prevFrom, prevTo };
}
