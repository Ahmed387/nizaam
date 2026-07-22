export type KpiSnapshot = {
  revenue: number; cogs: number; gross_profit: number; gross_margin_pct: number;
  expenses: number; net_profit: number; net_margin_pct: number;
  total_assets: number; total_liabilities: number; total_equity: number;
  cash_balance: number; accounts_receivable: number; accounts_payable: number; inventory_value: number;
  current_ratio: number | null; quick_ratio: number | null; debt_to_equity: number | null;
  roa_pct: number; roe_pct: number;
  inventory_turnover: number | null; break_even_revenue: number | null;
};

export type KpiAlert = {
  key: string;
  level: "danger" | "warning";
  title: string;
  detail: string;
  advice: string;
};

export function buildKpiAlerts(k: KpiSnapshot): KpiAlert[] {
  const a: KpiAlert[] = [];
  if (k.current_ratio != null) {
    if (k.current_ratio < 1)
      a.push({ key: "current_ratio_danger", level: "danger",
        title: `النسبة الجارية ${k.current_ratio.toFixed(2)} — خطر سيولة`,
        detail: "الأصول المتداولة أقل من الخصوم المتداولة — الشركة قد لا تستطيع سداد التزاماتها قصيرة الأجل.",
        advice: "قلّل المشتريات الآجلة، حصّل الذمم بسرعة، أو ضخ سيولة جديدة." });
    else if (k.current_ratio < 1.5)
      a.push({ key: "current_ratio_warn", level: "warning",
        title: `النسبة الجارية ${k.current_ratio.toFixed(2)} — منخفضة`,
        detail: "أقل من المعدل الآمن (1.5–2).", advice: "راقب التدفق النقدي عن قرب." });
  }
  if (k.quick_ratio != null) {
    if (k.quick_ratio < 0.5)
      a.push({ key: "quick_ratio_danger", level: "danger",
        title: `النسبة السريعة ${k.quick_ratio.toFixed(2)} — خطر شديد`,
        detail: "بدون بيع المخزون، السيولة لا تغطي حتى نصف الالتزامات قصيرة الأجل.",
        advice: "أوقف المصروفات غير الضرورية وسرّع تحصيل العملاء فورًا." });
    else if (k.quick_ratio < 1)
      a.push({ key: "quick_ratio_warn", level: "warning",
        title: `النسبة السريعة ${k.quick_ratio.toFixed(2)} — أقل من 1`,
        detail: "الاعتماد على المخزون لسداد الالتزامات.", advice: "خطط لتقليل المخزون الراكد." });
  }
  if (k.debt_to_equity != null) {
    if (k.debt_to_equity > 3)
      a.push({ key: "de_danger", level: "danger",
        title: `الرافعة المالية ${k.debt_to_equity.toFixed(2)} — مديونية خطرة`,
        detail: "الخصوم أضعاف حقوق الملكية — مخاطر مرتفعة.",
        advice: "أوقف الاستدانة وابدأ خطة سداد أو ضخ رأس مال." });
    else if (k.debt_to_equity > 2)
      a.push({ key: "de_warn", level: "warning",
        title: `الرافعة المالية ${k.debt_to_equity.toFixed(2)} — عالية`,
        detail: "الاعتماد على الديون مرتفع.", advice: "قلّل الاعتماد على التمويل الخارجي." });
  }
  if (k.net_profit < 0)
    a.push({ key: "net_loss", level: "danger",
      title: `صافي خسارة ${Math.abs(k.net_profit).toLocaleString("en-EG")}`,
      detail: "المصروفات تجاوزت الأرباح خلال الفترة.", advice: "راجع بنود المصروفات وهامش الربح." });
  else if (k.net_margin_pct != null && k.net_margin_pct < 5 && k.revenue > 0)
    a.push({ key: "net_margin_low", level: "warning",
      title: `هامش صافي الربح ${k.net_margin_pct.toFixed(2)}% — منخفض`,
      detail: "هامش أقل من 5% يعتبر ضعيف.", advice: "راجع الأسعار أو قلل التكاليف." });

  if (k.gross_profit < 0)
    a.push({ key: "gross_loss", level: "danger",
      title: "مجمل الربح سالب",
      detail: "تكلفة البضاعة أعلى من الإيرادات — بتبيع بخسارة!",
      advice: "راجع أسعار البيع والتكلفة فورًا." });

  if (k.cash_balance < 0)
    a.push({ key: "cash_neg", level: "danger",
      title: "الرصيد النقدي سالب",
      detail: "الخزينة تعرض عجزًا — احتمال خطأ في التسجيل أو سحب زائد.",
      advice: "افحص حركات الخزينة." });

  return a;
}
