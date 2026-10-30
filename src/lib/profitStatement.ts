/**
 * One profit statement (migration 0135): the card «الشركة كسبانة / خسرانة», the income statement and the profit
 * distribution all read the books through `profit_statement_core`, split into the same lines. This file only shapes
 * those numbers for the screens — it never computes profit from documents.
 */

export type ProfitTotals = {
  sales: number;
  returns: number;
  net_sales: number;
  cogs: number;
  gross_profit: number;
  expenses: number;
  operating_profit: number;
  other_income: number;
  count_diff: number;
  net_profit: number;
};

export type ProfitAccount = { code: string; name: string; group: ProfitGroup; amount: number };
export type ProfitGroup = "sales" | "returns" | "cogs" | "expenses" | "other_income" | "count_diff";

export type ProfitStatement = {
  from: string;
  to: string;
  total: ProfitTotals;
  branches: (ProfitTotals & { branch_id: string | null; branch: string })[];
  accounts: ProfitAccount[];
};

export type StatementLine = {
  key: keyof ProfitTotals;
  label: string;
  value: number;
  /** "+" adds to the result, "−" takes from it, "=" is a subtotal */
  op: "+" | "−" | "=";
  hint?: string;
};

const n = (v: unknown) => Number(v ?? 0) || 0;

/** The statement in the order the owner reads it, each line with its sign. */
export function statementLines(t: Partial<ProfitTotals> | null | undefined): StatementLine[] {
  const x = t ?? {};
  return [
    { key: "sales", label: "المبيعات", value: n(x.sales), op: "+", hint: "بدون الضريبة، الفواتير الملغاة مش داخلة" },
    { key: "returns", label: "المرتجعات", value: n(x.returns), op: "−", hint: "في شهر المرتجع نفسه" },
    { key: "net_sales", label: "صافي المبيعات", value: n(x.net_sales), op: "=" },
    { key: "cogs", label: "تكلفة البضاعة المباعة", value: n(x.cogs), op: "−", hint: "متوسط التكلفة وقت البيع" },
    { key: "gross_profit", label: "مجمل الربح", value: n(x.gross_profit), op: "=" },
    { key: "expenses", label: "المصروفات", value: n(x.expenses), op: "−", hint: "مرتبات وإيجارات ومصاريف تشغيل" },
    { key: "operating_profit", label: "ربح التشغيل", value: n(x.operating_profit), op: "=" },
    { key: "other_income", label: "إيرادات أخرى", value: n(x.other_income), op: "+", hint: "سندات قبض إيرادات، عمولة التحويل على العميل…" },
    { key: "count_diff", label: "فروقات الجرد", value: n(x.count_diff), op: "+", hint: "زيادة الجرد − العجز" },
    { key: "net_profit", label: "صافي الربح", value: n(x.net_profit), op: "=" },
  ];
}

/** True when the lines add up to the net profit (to the piaster). */
export function statementAddsUp(t: Partial<ProfitTotals> | null | undefined): boolean {
  const x = t ?? {};
  const net = n(x.sales) - n(x.returns) - n(x.cogs) - n(x.expenses) + n(x.other_income) + n(x.count_diff);
  return Math.abs(net - n(x.net_profit)) < 0.02;
}

export const GROUP_LABELS: Record<ProfitGroup, string> = {
  sales: "المبيعات",
  returns: "المرتجعات",
  cogs: "تكلفة البضاعة المباعة",
  expenses: "المصروفات",
  other_income: "إيرادات أخرى",
  count_diff: "فروقات الجرد",
};

/** Accounts of one line of the statement (the detail under «المصروفات», «إيرادات أخرى», …). */
export function accountsOf(accounts: ProfitAccount[] | null | undefined, group: ProfitGroup): ProfitAccount[] {
  return (accounts ?? []).filter((a) => a.group === group);
}
