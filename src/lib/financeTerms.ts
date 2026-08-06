/**
 * قاموس المصطلحات المالية الموحّد.
 *
 * كل شاشة مالية في النظام لازم تستخدم `fin()` بدل ما تكتب الاسم يدوي، عشان
 * المالك يقرا المصطلح بالعامية ومعاه الاسم العلمي بالإنجليزي بين قوسين:
 *   fin("revenue") => "المبيعات (Revenue / Sales)"
 */
export const FINANCE_TERMS = {
  revenue: { ar: "المبيعات", en: "Revenue / Sales" },
  cogs: { ar: "تكلفة البضاعة المباعة", en: "Cost of Goods Sold - COGS" },
  grossProfit: { ar: "مجمل الربح", en: "Gross Profit" },
  opex: { ar: "المصاريف التشغيلية", en: "Operating Expenses - OPEX" },
  netProfit: { ar: "صافي الربح", en: "Net Profit" },
  margin: { ar: "هامش الربح", en: "Profit Margin" },
  receivables: { ar: "الذمم المدينة", en: "Accounts Receivable" },
  payables: { ar: "الذمم الدائنة", en: "Accounts Payable" },
  cash: { ar: "النقدية", en: "Cash" },
  distributableCash: { ar: "الكاش المتاح للتوزيع", en: "Distributable Cash" },
  equity: { ar: "حقوق الملكية", en: "Equity" },
  capital: { ar: "رأس المال", en: "Capital" },
  drawings: { ar: "المسحوبات", en: "Drawings" },
  advance: { ar: "السلفة", en: "Advance" },
  inventoryValue: { ar: "قيمة المخزون", en: "Inventory Value" },
  incomeStatement: { ar: "قائمة الدخل", en: "Income Statement / P&L" },
  balanceSheet: { ar: "الميزانية", en: "Balance Sheet" },
  trialBalance: { ar: "ميزان المراجعة", en: "Trial Balance" },
  cashFlow: { ar: "التدفقات النقدية", en: "Cash Flow" },
  aging: { ar: "أعمار الديون", en: "Aging Report" },
  expenses: { ar: "المصروفات", en: "Expenses" },
  profitShare: { ar: "نصيب الشريك من الأرباح", en: "Profit Share" },
} as const;

export type FinanceTermKey = keyof typeof FINANCE_TERMS;

/** "المبيعات (Revenue / Sales)" */
export const fin = (key: FinanceTermKey) => {
  const t = FINANCE_TERMS[key];
  return `${t.ar} (${t.en})`;
};

/** الاسم بالعامية بس */
export const finAr = (key: FinanceTermKey) => FINANCE_TERMS[key].ar;

/** الاسم العلمي بالإنجليزي بس — مفيد كسطر صغير تحت العنوان */
export const finEn = (key: FinanceTermKey) => FINANCE_TERMS[key].en;

/**
 * توزيع مبلغ على نسب من غير ما تضيع قروش في التقريب (Largest Remainder).
 * مجموع النواتج = المبلغ بالظبط لحد قرش.
 */
export function allocateByShares(amount: number, shares: number[], decimals = 2): number[] {
  const unit = Math.pow(10, decimals);
  const totalShare = shares.reduce((s, x) => s + (Number(x) || 0), 0);
  if (!shares.length) return [];
  if (totalShare <= 0) return shares.map(() => 0);

  const totalUnits = Math.round(amount * unit);
  const raw = shares.map((s) => (totalUnits * (Number(s) || 0)) / totalShare);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = totalUnits - floors.reduce((s, x) => s + x, 0);

  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);

  const out = [...floors];
  let k = 0;
  while (remainder !== 0 && order.length) {
    const idx = order[k % order.length].i;
    out[idx] += remainder > 0 ? 1 : -1;
    remainder += remainder > 0 ? -1 : 1;
    k++;
  }
  return out.map((u) => u / unit);
}
