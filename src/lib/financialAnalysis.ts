// «القوائم المالية» (migration 0227, owner 2026-11-15): one page, one filter (period + branch) for every tab, and the analysis
// tab. The numbers come from the books (`financial_analysis`); this file only shapes them: the comparison period, the income
// lines of both periods, the balance items, the ratios with their meaning / formula / verdict, horizontal and vertical analysis.

/** what every statement tab gets from the page filter (branch null = the whole company) */
export type StatementProps = { from: string; to: string; branch: string | null };

export const STATEMENT_TABS = [
  { key: "income", label: "قائمة الدخل" },
  { key: "balance", label: "المركز المالي" },
  { key: "cashflow", label: "التدفقات النقدية" },
  { key: "equity", label: "التغيرات في حقوق الملكية" },
  { key: "cogs", label: "تكلفة البضاعة المباعة" },
  { key: "analysis", label: "تحليل القوائم المالية" },
] as const;
export type StatementTab = (typeof STATEMENT_TABS)[number]["key"];
export const isStatementTab = (v: string | null | undefined): v is StatementTab => STATEMENT_TABS.some((t) => t.key === v);

const DAY = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const fmtDay = (d: Date) => d.toISOString().slice(0, 10);
export const daysIn = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY) + 1;

/** The period before (same length, ending the day before). A whole month → the whole month before. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const f = toDate(from), t = toDate(to);
  const lastOfMonth = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0));
  if (f.getUTCDate() === 1 && t.getTime() === lastOfMonth.getTime()) {
    const months = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + (t.getUTCMonth() - f.getUTCMonth()) + 1;
    const pf = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - months, 1));
    const pt = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 0));
    return { from: fmtDay(pf), to: fmtDay(pt) };
  }
  const n = daysIn(from, to);
  const pt = new Date(f.getTime() - DAY);
  const pf = new Date(pt.getTime() - (n - 1) * DAY);
  return { from: fmtDay(pf), to: fmtDay(pt) };
}

export type PL = { sales: number; returns: number; cogs: number; expenses: number; other_income: number; count_diff: number };
export type Bal = {
  cash: number; receivables: number; inventory: number; other_current: number; fixed_net: number; other_assets: number;
  payables: number; other_liabilities: number; equity_accounts: number; profit_to_date: number;
};
export type Analysis = {
  cur: { from: string; to: string }; cmp: { from: string; to: string };
  pl: { cur?: Partial<PL>; cmp?: Partial<PL> };
  bal: { cur_end: Partial<Bal>; cur_start: Partial<Bal>; cmp_end: Partial<Bal>; cmp_start: Partial<Bal> };
  months: { month: string; net_sales: number; cogs: number; net_profit: number }[];
};

const n = (v: unknown) => Number(v ?? 0) || 0;

/** the income lines of one period (same lines as قائمة الدخل) */
export function incomeOf(p?: Partial<PL>) {
  const sales = n(p?.sales), returns = n(p?.returns), cogs = n(p?.cogs), expenses = n(p?.expenses);
  const other_income = n(p?.other_income), count_diff = n(p?.count_diff);
  const net_sales = sales - returns;
  const gross_profit = net_sales - cogs;
  const operating_profit = gross_profit - expenses;
  const net_profit = operating_profit + other_income + count_diff;
  return { sales, returns, net_sales, cogs, gross_profit, expenses, operating_profit, other_income, count_diff, net_profit };
}
export type Income = ReturnType<typeof incomeOf>;

/** the balance items of one day; customers / suppliers are the accounts' balances (Σ مدين / Σ دائن) */
export function balanceOf(b?: Partial<Bal>) {
  const cash = n(b?.cash), receivables = n(b?.receivables), inventory = n(b?.inventory), other_current = n(b?.other_current);
  const fixed_net = n(b?.fixed_net), other_assets = n(b?.other_assets);
  const payables = n(b?.payables), other_liabilities = n(b?.other_liabilities);
  const current_assets = cash + receivables + inventory + other_current;
  const total_assets = current_assets + fixed_net + other_assets;
  const current_liabilities = payables + other_liabilities;
  const equity = n(b?.equity_accounts) + n(b?.profit_to_date);
  return { cash, receivables, inventory, other_current, fixed_net, other_assets, current_assets, total_assets,
           payables, other_liabilities, current_liabilities, equity, total_liab_equity: current_liabilities + equity };
}
export type Balance = ReturnType<typeof balanceOf>;

export const INCOME_ROWS: { key: keyof Income; label: string; sub?: boolean }[] = [
  { key: "sales", label: "المبيعات" },
  { key: "returns", label: "مرتجع المبيعات" },
  { key: "net_sales", label: "صافي المبيعات", sub: true },
  { key: "cogs", label: "تكلفة البضاعة المباعة" },
  { key: "gross_profit", label: "مجمل الربح", sub: true },
  { key: "expenses", label: "المصروفات" },
  { key: "operating_profit", label: "ربح التشغيل", sub: true },
  { key: "other_income", label: "إيرادات أخرى" },
  { key: "count_diff", label: "فروقات الجرد" },
  { key: "net_profit", label: "صافي الربح", sub: true },
];
export const BALANCE_ROWS: { key: keyof Balance; label: string; sub?: boolean }[] = [
  { key: "cash", label: "النقدية (الخزن والبنوك والمحافظ)" },
  { key: "receivables", label: "العملاء — مدين (لنا عندهم)" },
  { key: "inventory", label: "المخزون" },
  { key: "other_current", label: "أصول متداولة أخرى (سلف وغيرها)" },
  { key: "current_assets", label: "الأصول المتداولة", sub: true },
  { key: "fixed_net", label: "الأصول الثابتة (بعد الإهلاك)" },
  { key: "total_assets", label: "إجمالي الأصول", sub: true },
  { key: "payables", label: "الموردين — دائن (علينا ليهم)" },
  { key: "other_liabilities", label: "التزامات أخرى" },
  { key: "current_liabilities", label: "إجمالي الالتزامات", sub: true },
  { key: "equity", label: "حقوق الملكية (رأس المال + الأرباح)", sub: true },
];

/** change between two numbers: amount and % (null when the base is 0) */
export function change(cur: number, prev: number) {
  const diff = cur - prev;
  const pct = Math.abs(prev) > 0.005 ? (diff / Math.abs(prev)) * 100 : null;
  return { diff, pct };
}
/** share of a base in % (null when the base is 0) */
export const share = (v: number, base: number) => (Math.abs(base) > 0.005 ? (v / base) * 100 : null);

export type Verdict = "good" | "watch" | "bad" | "none";
export type Ratio = {
  key: string; group: "الربحية" | "السيولة" | "النشاط" | "المديونية";
  label: string; unit: "%" | "x" | "يوم";
  cur: number | null; cmp: number | null;
  meaning: string; formula: string; verdict: Verdict; advice: string;
  /** higher is better (false: lower is better) — for the arrow next to the change */
  higherBetter: boolean;
};

const div = (a: number, b: number) => (Math.abs(b) > 0.005 ? a / b : null);
const avg = (a: number, b: number) => (a + b) / 2;

/** every ratio for the two periods (period ratios use the days of each period, balances = average of start and end) */
export function ratiosOf(a: Analysis): Ratio[] {
  const ic = incomeOf(a.pl.cur), ip = incomeOf(a.pl.cmp);
  const be = balanceOf(a.bal.cur_end), bs = balanceOf(a.bal.cur_start);
  const pe = balanceOf(a.bal.cmp_end), ps = balanceOf(a.bal.cmp_start);
  const dc = daysIn(a.cur.from, a.cur.to), dp = daysIn(a.cmp.from, a.cmp.to);
  const pct = (x: number | null) => (x === null ? null : x * 100);
  const make = (r: Omit<Ratio, "verdict" | "advice"> & { judge: (v: number) => [Verdict, string] }): Ratio => {
    const [verdict, advice] = r.cur === null ? (["none", "مفيش أرقام كفاية في الفترة دي."] as [Verdict, string]) : r.judge(r.cur);
    const { judge: _j, ...rest } = r;
    return { ...rest, verdict, advice };
  };
  return [
    make({
      key: "gross_margin", group: "الربحية", label: "هامش مجمل الربح", unit: "%", higherBetter: true,
      cur: pct(div(ic.gross_profit, ic.net_sales)), cmp: pct(div(ip.gross_profit, ip.net_sales)),
      meaning: "من كل 100 جنيه بعتها، فاضل كام بعد تكلفة البضاعة.",
      formula: "مجمل الربح ÷ صافي المبيعات × 100",
      judge: (v) => v < 0 ? ["bad", "بتبيع بأقل من التكلفة — راجع الأسعار وتكلفة الأصناف."]
        : v < 5 ? ["watch", "الهامش ضعيف — جزء كبير من المبيعات ممكن يكون بين الفروع بسعر التكلفة؛ شوف ربح كل فرع لوحده."]
        : ["good", "الهامش معقول."],
    }),
    make({
      key: "net_margin", group: "الربحية", label: "هامش صافي الربح", unit: "%", higherBetter: true,
      cur: pct(div(ic.net_profit, ic.net_sales)), cmp: pct(div(ip.net_profit, ip.net_sales)),
      meaning: "من كل 100 جنيه بعتها، فاضل كام ربح صافي بعد كل المصروفات.",
      formula: "صافي الربح ÷ صافي المبيعات × 100",
      judge: (v) => v < 0 ? ["bad", "الفترة خسرانة."] : v < 2 ? ["watch", "الربح الصافي قليل قصاد حجم المبيعات."] : ["good", "الفترة كسبانة."],
    }),
    make({
      key: "expense_ratio", group: "الربحية", label: "المصروفات من المبيعات", unit: "%", higherBetter: false,
      cur: pct(div(ic.expenses, ic.net_sales)), cmp: pct(div(ip.expenses, ip.net_sales)),
      meaning: "من كل 100 جنيه مبيعات، بيروح كام مصروفات (مرتبات وإيجار ومرافق ونقل…).",
      formula: "المصروفات ÷ صافي المبيعات × 100",
      judge: (v) => v > 10 ? ["bad", "المصروفات عالية قصاد المبيعات."] : v > 5 ? ["watch", "تابع المصروفات."] : ["good", "المصروفات تحت السيطرة."],
    }),
    make({
      key: "roe", group: "الربحية", label: "العائد على حقوق الملكية (للفترة)", unit: "%", higherBetter: true,
      cur: pct(div(ic.net_profit, avg(bs.equity, be.equity))), cmp: pct(div(ip.net_profit, avg(ps.equity, pe.equity))),
      meaning: "الربح الصافي في الفترة دي نسبته كام من فلوس الشركاء الموجودة في الشركة.",
      formula: "صافي الربح ÷ متوسط حقوق الملكية (أول وآخر الفترة) × 100",
      judge: (v) => v < 0 ? ["bad", "الفترة نقصت من حقوق الشركاء."] : ["good", "الفترة زودت حقوق الشركاء."],
    }),
    make({
      key: "current_ratio", group: "السيولة", label: "النسبة الجارية", unit: "x", higherBetter: true,
      cur: div(be.current_assets, be.current_liabilities), cmp: div(pe.current_assets, pe.current_liabilities),
      meaning: "عندك كام جنيه أصول متداولة (فلوس + عملاء + بضاعة) قصاد كل جنيه عليك.",
      formula: "الأصول المتداولة ÷ الالتزامات (آخر الفترة)",
      judge: (v) => v < 1 ? ["bad", "اللي عليك أكتر من اللي عندك متداول."] : v < 1.5 ? ["watch", "مغطّي التزاماتك بس من غير هامش كبير."] : ["good", "مغطّي التزاماتك كويس."],
    }),
    make({
      key: "quick_ratio", group: "السيولة", label: "النسبة السريعة", unit: "x", higherBetter: true,
      cur: div(be.cash + be.receivables, be.current_liabilities), cmp: div(pe.cash + pe.receivables, pe.current_liabilities),
      meaning: "زي الجارية بس من غير البضاعة — لو احتجت تدفع بسرعة من غير ما تبيع.",
      formula: "(النقدية + العملاء) ÷ الالتزامات",
      judge: (v) => v < 0.7 ? ["bad", "معتمد على بيع البضاعة عشان تسدد."] : v < 1 ? ["watch", "محتاج تبيع جزء من البضاعة عشان تغطي."] : ["good", "تقدر تغطي من غير ما تبيع."],
    }),
    make({
      key: "cash_ratio", group: "السيولة", label: "نسبة النقدية", unit: "x", higherBetter: true,
      cur: div(be.cash, be.current_liabilities), cmp: div(pe.cash, pe.current_liabilities),
      meaning: "الفلوس اللي في إيدك فعلاً قصاد اللي عليك.",
      formula: "النقدية ÷ الالتزامات",
      judge: (v) => v < 0.1 ? ["watch", "النقدية قليلة قصاد اللي عليك."] : ["good", "فيه نقدية مريحة."],
    }),
    make({
      key: "inventory_days", group: "النشاط", label: "أيام بقاء البضاعة", unit: "يوم", higherBetter: false,
      cur: (() => { const t = div(ic.cogs, avg(bs.inventory, be.inventory)); return t ? dc / t : null; })(),
      cmp: (() => { const t = div(ip.cogs, avg(ps.inventory, pe.inventory)); return t ? dp / t : null; })(),
      meaning: "البضاعة بتقعد في المخزن قد إيه في المتوسط قبل ما تتباع.",
      formula: "أيام الفترة ÷ (تكلفة البضاعة المباعة ÷ متوسط المخزون)",
      judge: (v) => v > 120 ? ["bad", "بضاعة راكدة — شوف الأصناف اللي مش بتتحرك."] : v > 60 ? ["watch", "البضاعة بتقعد شوية."] : ["good", "البضاعة بتلف بسرعة."],
    }),
    make({
      key: "receivable_days", group: "النشاط", label: "أيام التحصيل من العملاء", unit: "يوم", higherBetter: false,
      cur: (() => { const r = div(avg(bs.receivables, be.receivables), ic.net_sales); return r === null ? null : r * dc; })(),
      cmp: (() => { const r = div(avg(ps.receivables, pe.receivables), ip.net_sales); return r === null ? null : r * dp; })(),
      meaning: "بتاخد فلوس البيع الآجل بعد كام يوم في المتوسط.",
      formula: "متوسط أرصدة العملاء (مدين) ÷ صافي المبيعات × أيام الفترة",
      judge: (v) => v > 60 ? ["bad", "التحصيل بطيء — شوف تقرير الأعمار."] : v > 30 ? ["watch", "التحصيل محتاج متابعة."] : ["good", "التحصيل سريع."],
    }),
    make({
      key: "payable_days", group: "النشاط", label: "أيام السداد للموردين", unit: "يوم", higherBetter: true,
      cur: (() => { const r = div(avg(bs.payables, be.payables), ic.cogs); return r === null ? null : r * dc; })(),
      cmp: (() => { const r = div(avg(ps.payables, pe.payables), ip.cogs); return r === null ? null : r * dp; })(),
      meaning: "بتدفع للموردين بعد كام يوم في المتوسط (كل ما يطول ومن غير مشاكل، كل ما فلوسك تشتغل أكتر).",
      formula: "متوسط أرصدة الموردين (دائن) ÷ تكلفة البضاعة المباعة × أيام الفترة",
      judge: (v) => v < 7 ? ["watch", "بتدفع للموردين بسرعة جداً."] : ["good", "مدة السداد معقولة."],
    }),
    make({
      key: "debt_to_equity", group: "المديونية", label: "الالتزامات على حقوق الملكية", unit: "x", higherBetter: false,
      cur: div(be.current_liabilities, be.equity), cmp: div(pe.current_liabilities, pe.equity),
      meaning: "كل جنيه من فلوس الشركاء قصاده كام جنيه فلوس ناس تانية (موردين وغيرهم).",
      formula: "إجمالي الالتزامات ÷ حقوق الملكية (آخر الفترة)",
      judge: (v) => v > 2 ? ["bad", "الشركة شغالة بفلوس الموردين أكتر من فلوس الشركاء بكتير."] : v > 1 ? ["watch", "فلوس الموردين أكتر من فلوس الشركاء."] : ["good", "الشركة شغالة بفلوسها أكتر."],
    }),
  ];
}

export const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  good: { label: "كويس", tone: "bg-success/15 text-success" },
  watch: { label: "محتاج انتباه", tone: "bg-warning/15 text-warning" },
  bad: { label: "مشكلة", tone: "bg-destructive/15 text-destructive" },
  none: { label: "—", tone: "bg-muted text-muted-foreground" },
};

export function ratioText(v: number | null, unit: Ratio["unit"]): string {
  if (v === null || !isFinite(v)) return "—";
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "يوم") return `${Math.round(v)} يوم`;
  return `${v.toFixed(2)}×`;
}
