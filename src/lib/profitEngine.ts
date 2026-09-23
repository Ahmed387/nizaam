/**
 * Profit Engine — Single Source of Truth for Revenue / Cost / Expenses / Net Profit.
 *
 * Every screen that shows profitability numbers MUST use these helpers, otherwise
 * different pages will show different totals and the admin will lose trust.
 *
 * Canonical formula (matches accounting):
 *   Revenue        = Σ unit_price × net_quantity                  (net of returns)
 *   COGS / Cost    = Σ unit_cost_at_sale × net_quantity           (FIFO snapshot at sale time)
 *   Gross Profit   = Revenue − COGS
 *   Expenses       = Σ vouchers(type=payment, status=active)
 *   Net Profit     = Gross Profit − Expenses
 *
 *   net_quantity   = max(0, quantity − returned_quantity)
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

export function lineProfit(
  it: InvoiceItemLike,
  opts: { invoiceIsMigrated?: boolean } = {}
): LineProfit {
  const qty = Number(it.quantity) || 0;
  const ret = Number(it.returned_quantity ?? 0) || 0;
  const netQty = Math.max(0, Number(it.net_quantity ?? qty - ret));

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
  const items = inv.invoice_items ?? [];
  let grossRevenue = 0; // full quantity, before invoice-level discount
  let netRevenue = 0; // net of returns, before invoice-level discount
  let cost = 0;
  for (const it of items) {
    const lp = lineProfit(it, { invoiceIsMigrated: !!inv.is_migrated });
    const qty = Number(it.quantity) || 0;
    const unitRev = lp.netQty > 0 ? lp.revenue / lp.netQty : it.total != null && qty > 0 ? Number(it.total) / qty : 0;
    grossRevenue += unitRev * qty;
    netRevenue += lp.revenue;
    cost += lp.cost;
  }
  const discount = Math.max(0, Number(inv.discount_amount ?? 0) || 0);
  const discountShare = grossRevenue > 0 ? Math.min(discount, discount * (netRevenue / grossRevenue)) : 0;
  const revenue = Math.max(0, netRevenue - discountShare);
  return { revenue, cost, profit: revenue - cost, discountShare };
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
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const prevFromIso = range.prevFrom.toISOString();
  const prevToIso = range.prevTo.toISOString();
  const fromDate = range.from.toISOString().slice(0, 10);
  const toDate = range.to.toISOString().slice(0, 10);
  const prevFromDate = range.prevFrom.toISOString().slice(0, 10);
  const prevToDate = range.prevTo.toISOString().slice(0, 10);

  const invSelect =
    "id, branch_id, is_migrated, discount_amount, invoice_items(quantity, returned_quantity, net_quantity, total, selling_price, line_discount, unit_cost_at_sale, cost_price)";

  // ملاحظة: PostgREST بيقص عند 1000 صف — بنستخدم fetchAllRows عشان الأرقام ما تنقصش
  const buildInv = (f: string, t: string) => {
    let q = supabase
      .from("invoices")
      .select(invSelect)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .gte("invoice_date", f)
      .lte("invoice_date", t);
    if (branchId) q = q.eq("branch_id", branchId);
    return q;
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
    return q;
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
    return q;
  };

  const [invRows, prevInvRows, expRows, prevExpRows, incRows, prevIncRows, branchesRes] = await Promise.all([
    fetchAllRows<any>(() => buildInv(fromIso, toIso)),
    fetchAllRows<any>(() => buildInv(prevFromIso, prevToIso)),
    fetchAllRows<any>(() => buildExp(fromDate, toDate, true)),
    fetchAllRows<any>(() => buildExp(prevFromDate, prevToDate, false)),
    fetchAllRows<any>(() => buildInc(fromDate, toDate, true)),
    fetchAllRows<any>(() => buildInc(prevFromDate, prevToDate, false)),
    supabase.from("branches").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).neq("code", "PARTNER-CASH"),
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

  const cur = sumInv(invRows);
  const prev = sumInv(prevInvRows);
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
  const from = new Date(fromDate + "T00:00:00");
  const to = new Date(toDate + "T23:59:59.999");
  const spanMs = to.getTime() - from.getTime() + 1;
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - spanMs + 1);
  return { from, to, prevFrom, prevTo };
}
