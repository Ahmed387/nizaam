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

  const unitCost = Number(it.unit_cost_at_sale ?? it.cost_price ?? 0);
  const costUnknown = unitCost <= 0 && !!opts.invoiceIsMigrated;

  const revenue = unitRev * netQty;
  const cost = unitCost * netQty;
  const profit = costUnknown ? 0 : revenue - cost;

  return { netQty, revenue, cost, profit, costUnknown };
}

export interface ProfitTotals {
  revenue: number;
  cost: number;
  gross: number;
  expenses: number;
  net: number;
  margin: number; // 0..100
}

export function aggregateTotals(
  items: Array<{ line: LineProfit }>,
  expensesAmount: number
): ProfitTotals {
  let revenue = 0,
    cost = 0;
  for (const r of items) {
    revenue += r.line.revenue;
    cost += r.line.cost;
  }
  const gross = revenue - cost;
  const net = gross - expensesAmount;
  const margin = revenue > 0 ? (net / revenue) * 100 : 0;
  return { revenue, cost, gross, expenses: expensesAmount, net, margin };
}

export interface ProfitWindow {
  totals: ProfitTotals;
  prevNet: number;
  perBranch: { id: string; name: string; revenue: number; cost: number; expenses: number; net: number }[];
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
    "id, branch_id, is_migrated, invoice_items(quantity, returned_quantity, net_quantity, total, selling_price, line_discount, unit_cost_at_sale, cost_price)";

  let curQ = supabase
    .from("invoices")
    .select(invSelect)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);
  let prevQ = supabase
    .from("invoices")
    .select(invSelect)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .gte("created_at", prevFromIso)
    .lte("created_at", prevToIso);
  let expQ = supabase
    .from("vouchers")
    .select("amount, branch_id, voucher_categories!inner(is_deductible_from_profit)")
    .eq("tenant_id", tenantId)
    .eq("type", "payment")
    .eq("status", "active")
    .eq("voucher_categories.is_deductible_from_profit", true)
    .gte("voucher_date", fromDate)
    .lte("voucher_date", toDate);
  let prevExpQ = supabase
    .from("vouchers")
    .select("amount, voucher_categories!inner(is_deductible_from_profit)")
    .eq("tenant_id", tenantId)
    .eq("type", "payment")
    .eq("status", "active")
    .eq("voucher_categories.is_deductible_from_profit", true)
    .gte("voucher_date", prevFromDate)
    .lte("voucher_date", prevToDate);

  if (branchId) {
    curQ = curQ.eq("branch_id", branchId);
    prevQ = prevQ.eq("branch_id", branchId);
    expQ = expQ.eq("branch_id", branchId);
    prevExpQ = prevExpQ.eq("branch_id", branchId);
  }

  const [invRes, prevInvRes, expRes, prevExpRes, branchesRes] = await Promise.all([
    curQ,
    prevQ,
    expQ,
    prevExpQ,
    supabase.from("branches").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).neq("code", "PARTNER-CASH"),
  ]);

  const sumInv = (rows: any[]) => {
    let rev = 0,
      cost = 0;
    for (const inv of rows ?? []) {
      for (const it of inv.invoice_items ?? []) {
        const lp = lineProfit(it, { invoiceIsMigrated: !!inv.is_migrated });
        rev += lp.revenue;
        cost += lp.cost;
      }
    }
    return { revenue: rev, cost };
  };

  const cur = sumInv(invRes.data ?? []);
  const prev = sumInv(prevInvRes.data ?? []);
  const expenses = (expRes.data ?? []).reduce((s: number, v: any) => s + Number(v.amount || 0), 0);
  const prevExpenses = (prevExpRes.data ?? []).reduce((s: number, v: any) => s + Number(v.amount || 0), 0);

  const totals: ProfitTotals = {
    revenue: cur.revenue,
    cost: cur.cost,
    gross: cur.revenue - cur.cost,
    expenses,
    net: cur.revenue - cur.cost - expenses,
    margin: cur.revenue > 0 ? ((cur.revenue - cur.cost - expenses) / cur.revenue) * 100 : 0,
  };
  const prevNet = prev.revenue - prev.cost - prevExpenses;

  // Per-branch
  const branches = branchesRes.data ?? [];
  const byBranch: Record<string, { revenue: number; cost: number; expenses: number }> = {};
  for (const inv of (invRes.data ?? []) as any[]) {
    const b = inv.branch_id;
    if (!b) continue;
    if (!byBranch[b]) byBranch[b] = { revenue: 0, cost: 0, expenses: 0 };
    for (const it of inv.invoice_items ?? []) {
      const lp = lineProfit(it, { invoiceIsMigrated: !!inv.is_migrated });
      byBranch[b].revenue += lp.revenue;
      byBranch[b].cost += lp.cost;
    }
  }
  for (const v of (expRes.data ?? []) as any[]) {
    if (!v.branch_id) continue;
    if (!byBranch[v.branch_id]) byBranch[v.branch_id] = { revenue: 0, cost: 0, expenses: 0 };
    byBranch[v.branch_id].expenses += Number(v.amount || 0);
  }
  const perBranch = branches.map((b: any) => {
    const x = byBranch[b.id] ?? { revenue: 0, cost: 0, expenses: 0 };
    return {
      id: b.id,
      name: b.name,
      revenue: x.revenue,
      cost: x.cost,
      expenses: x.expenses,
      net: x.revenue - x.cost - x.expenses,
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
