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

const egp = (n: number) => Math.abs(n).toLocaleString("en-EG", { maximumFractionDigits: 0 });

export function buildKpiAlerts(k: KpiSnapshot): KpiAlert[] {
  const a: KpiAlert[] = [];

  // 🔴 السيولة الجارية
  if (k.current_ratio != null) {
    if (k.current_ratio < 1)
      a.push({ key: "current_ratio_danger", level: "danger",
        title: `⚠️ فلوسك مش هتكفي! (النسبة الجارية = ${k.current_ratio.toFixed(2)})`,
        detail: `يعني إيه؟ عندك التزامات لازم تدفعها قريب، والفلوس والبضاعة اللي معاك مش هيكفوا. كل 1 جنيه عليك، معاك بس ${k.current_ratio.toFixed(2)} جنيه.`,
        advice: "اعمل إيه؟ حصّل من العملاء بسرعة، أجّل أي شراء جديد بالآجل، أو اضخ فلوس من عندك دلوقتي." });
    else if (k.current_ratio < 1.5)
      a.push({ key: "current_ratio_warn", level: "warning",
        title: `🟡 السيولة عندك ضعيفة (${k.current_ratio.toFixed(2)})`,
        detail: "يعني إيه؟ لسه تقدر تدفع اللي عليك، بس الهامش ضيق. الطبيعي يكون بين 1.5 و 2.",
        advice: "اعمل إيه؟ خلي عينك على الخزينة يوم بيوم، ومتزودش المصاريف دلوقتي." });
  }

  // 🔴 السيولة السريعة
  if (k.quick_ratio != null) {
    if (k.quick_ratio < 0.5)
      a.push({ key: "quick_ratio_danger", level: "danger",
        title: `🚨 لو مبعتش البضاعة مش هتقدر تدفع! (السريعة = ${k.quick_ratio.toFixed(2)})`,
        detail: "يعني إيه؟ من غير ما تصفّي المخزون، الكاش اللي معاك مش هيغطي حتى نص اللي عليك.",
        advice: "اعمل إيه؟ اقفل أي مصروف مش ضروري النهارده، وكلم العملاء يدفعوا فورًا." });
    else if (k.quick_ratio < 1)
      a.push({ key: "quick_ratio_warn", level: "warning",
        title: `🟡 معتمد على البضاعة عشان تدفع (السريعة = ${k.quick_ratio.toFixed(2)})`,
        detail: "يعني إيه؟ لو البضاعة وقفت أو ما اتباعتش، هتقع في مشكلة سيولة.",
        advice: "اعمل إيه؟ صرّف المخزون الراكد، وقلل الكميات اللي قاعدة من غير حركة." });
  }

  // 🔴 المديونية
  if (k.debt_to_equity != null) {
    if (k.debt_to_equity > 3)
      a.push({ key: "de_danger", level: "danger",
        title: `🚨 غرقان في الديون! (الرافعة = ${k.debt_to_equity.toFixed(2)})`,
        detail: `يعني إيه؟ كل 1 جنيه من فلوسك، عليك ${k.debt_to_equity.toFixed(2)} جنيه ديون. الشركة شبه مرهونة.`,
        advice: "اعمل إيه؟ بلاش أي استدانة جديدة خالص، وابدأ خطة سداد، أو ضخ رأسمال من الشركاء." });
    else if (k.debt_to_equity > 2)
      a.push({ key: "de_warn", level: "warning",
        title: `🟡 الديون بقت كتير (الرافعة = ${k.debt_to_equity.toFixed(2)})`,
        detail: "يعني إيه؟ الاعتماد على القروض والآجل بقى عالي أكتر من اللازم.",
        advice: "اعمل إيه؟ حاول تسدد جزء من اللي عليك قبل ما تشتري كميات جديدة بالآجل." });
  }

  // 🔴 الخسائر
  if (k.net_profit < 0)
    a.push({ key: "net_loss", level: "danger",
      title: `🚨 الشركة خسرانة ${egp(k.net_profit)} جنيه`,
      detail: "يعني إيه؟ المصاريف اللي طلعت أكتر من اللي كسبته من البيع.",
      advice: "اعمل إيه؟ افتح كشف المصروفات وشوف بتصرف فين، وراجع سعر البيع مقابل التكلفة." });
  else if (k.net_margin_pct != null && k.net_margin_pct < 5 && k.revenue > 0)
    a.push({ key: "net_margin_low", level: "warning",
      title: `🟡 مكسبك ضعيف — ${k.net_margin_pct.toFixed(1)}% بس من المبيعات`,
      detail: "يعني إيه؟ كل 100 جنيه بتبيعهم، بيرجعلك أقل من 5 جنيه صافي. ده هامش خطر.",
      advice: "اعمل إيه؟ زوّد الأسعار شوية أو قلل المصاريف الثابتة." });

  // 🔴 مجمل الربح سالب
  if (k.gross_profit < 0)
    a.push({ key: "gross_loss", level: "danger",
      title: "🚨 انت بتبيع بخسارة!",
      detail: "يعني إيه؟ تكلفة البضاعة اللي بتبيعها أعلى من سعر بيعها. كل عملية بيع بتخسرك فلوس.",
      advice: "اعمل إيه؟ وقّف البيع دلوقتي وراجع سعر التكلفة والأسعار." });

  // 🔴 الخزينة سالبة
  if (k.cash_balance < 0)
    a.push({ key: "cash_neg", level: "danger",
      title: `🚨 الخزينة عاجزة بـ ${egp(k.cash_balance)} جنيه`,
      detail: "يعني إيه؟ الخزينة بتقولك رصيد بالسالب — ده مستحيل واقعيًا، يبقى فيه حركة اتسجلت غلط أو سحب من غير رصيد.",
      advice: "اعمل إيه؟ ادخل على حركات الخزينة وراجع آخر العمليات." });

  return a;
}
