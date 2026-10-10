import { useMemo } from "react";
import { ArrowDownCircle, ArrowUpCircle, Scale } from "lucide-react";
import { FinancialAmount } from "@/components/FinancialAmount";
import { MetricHint } from "@/components/ui/MetricHint";

export interface PeriodTransaction {
  type: "income" | "expense" | string;
  payment_method: string | null;
  amount: number | string;
}

export interface TreasuryChannel {
  method: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

interface Totals { income: number; expense: number; net: number }

const emptyTotals = (): Totals => ({ income: 0, expense: 0, net: 0 });

/** Memoized selector: period totals overall and per channel from the filtered movements. */
export function usePeriodTotals(rows: PeriodTransaction[], channels: TreasuryChannel[]) {
  return useMemo(() => {
    const overall = emptyTotals();
    const byChannel = new Map<string, Totals>(channels.map((c) => [c.method, emptyTotals()]));
    const known = new Set(channels.map((c) => c.method));
    for (const r of rows) {
      const amt = Number(r.amount) || 0;
      const key = known.has(String(r.payment_method)) ? String(r.payment_method) : "other";
      const bucket = byChannel.get(key) ?? emptyTotals();
      if (r.type === "income") { overall.income += amt; bucket.income += amt; }
      else { overall.expense += amt; bucket.expense += amt; }
      byChannel.set(key, bucket);
    }
    overall.net = overall.income - overall.expense;
    byChannel.forEach((t) => { t.net = t.income - t.expense; });
    return { overall, byChannel };
  }, [rows, channels]);
}

interface Props {
  cumulativeBalance: number;
  periodRows: PeriodTransaction[];
  channels: TreasuryChannel[];
  loading?: boolean;
  lowThresholdAlert?: React.ReactNode;
}

export function TreasuryMetricsGrid({ cumulativeBalance, periodRows, channels, loading, lowThresholdAlert }: Props) {
  const { overall, byChannel } = usePeriodTotals(periodRows, channels);

  return (
    <div className="space-y-4 mb-6" dir="rtl">
      {/* 1. Global cumulative balance — independent of filters */}
      <div className="card-elevated p-6 text-center">
        <div className="text-sm text-muted-foreground mb-1 flex items-center justify-center gap-1 flex-wrap">
          رصيد الخزنة دلوقتي (كل الأوعية)
          <MetricHint
            label="شرح رصيد الخزنة دلوقتي"
            meaning="صافي النقدية المتبقية فعليًا بكل أوعية هذا الفرع حتى اللحظة، ولا يتأثر بأي فلتر. الرقم السالب يعني أن المصروفات وسندات الصرف والتحويلات الصادرة المسجلة تجاوزت المقبوضات المسجلة للفرع."
            source="سجل حركات الخزينة للفرع كاملًا (get_branch_wallet_balances)."
            formula="Σ amount (type = income) − Σ amount (type = expense) لكل حركات الفرع منذ البداية"
          />
          <span className="text-xs">(من أول يوم — الفلاتر مش بتغيّره)</span>
        </div>
        <FinancialAmount value={cumulativeBalance} size="hero" className="gradient-text font-extrabold" />
        {lowThresholdAlert}
      </div>

      {/* 2. Period summary — follows all filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <PeriodCard
          title="إجمالي اللي دخل الخزنة في الفترة (+)" tone="text-success" icon={<ArrowDownCircle className="w-5 h-5" />}
          value={overall.income} loading={loading}
          hint={{ meaning: "كل المقبوضات الداخلة للفرع ضمن الفلاتر المطبقة فقط.", source: "حركات الخزينة المفلترة (نفس فلاتر الجدول).", formula: "Σ amount حيث type = income ضمن النطاق المفلتر" }}
        />
        <PeriodCard
          title="إجمالي اللي خرج من الخزنة في الفترة (−)" tone="text-destructive" icon={<ArrowUpCircle className="w-5 h-5" />}
          value={overall.expense} loading={loading}
          hint={{ meaning: "كل المصروفات وسندات الصرف والتحويلات الخارجة ضمن الفلاتر المطبقة فقط.", source: "حركات الخزينة المفلترة (نفس فلاتر الجدول).", formula: "Σ amount حيث type = expense ضمن النطاق المفلتر" }}
        />
        <PeriodCard
          title="صافي حركة الخزنة في الفترة (دخل − خرج)" tone={overall.net < 0 ? "text-destructive" : "text-success"} icon={<Scale className="w-5 h-5" />}
          value={overall.net} loading={loading}
          hint={{ meaning: "موجب = دخل الخزنة أكتر من اللي خرج في الفترة دي بس، سالب = خرج أكتر. ده مش رصيد الخزنة الكلي.", source: "حركات الخزينة المفلترة.", formula: "اللي دخل الخزنة في الفترة − اللي خرج منها في الفترة" }}
        />
      </div>

      {/* 3. Channels breakdown — follows filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {channels.map((c) => {
          const t = byChannel.get(c.method) ?? emptyTotals();
          const Icon = c.icon;
          return (
            <div key={c.method} className="card-elevated p-4">
              <div className="flex items-center justify-center gap-1.5 mb-3 text-sm font-semibold">
                <Icon className={`w-5 h-5 ${c.color}`} />
                {c.label}
                <MetricHint
                  label={`شرح ${c.label}`}
                  meaning={`حركة وعاء «${c.label}» خلال الفترة المفلترة.`}
                  source="حركات الخزينة المفلترة حسب طريقة الدفع (payment_method)."
                  formula={`صافي ${c.label} = Σ الوارد عبر ${c.label} − Σ المنصرف عبر ${c.label}`}
                />
              </div>
              <div className="space-y-1.5 text-sm">
                <Row label="دخل (+)" value={t.income} tone="text-success" />
                <Row label="خرج (−)" value={t.expense} tone="text-destructive" />
                <div className="border-t pt-1.5">
                  <Row label="الصافي (دخل − خرج)" value={t.net} tone={t.net < 0 ? "text-destructive" : "text-foreground"} bold />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PeriodCard({ title, tone, icon, value, hint, loading }: {
  title: string; tone: string; icon: React.ReactNode; value: number; loading?: boolean;
  hint: { meaning: string; source: string; formula: string };
}) {
  return (
    <div className="card-elevated p-5 text-center">
      <div className="text-sm font-semibold flex items-center justify-center gap-1.5 mb-2">
        <span className={tone}>{icon}</span>{title}
        <MetricHint {...hint} label={`شرح ${title}`} />
      </div>
      {loading ? <div className="h-8 bg-muted rounded animate-pulse" /> : <FinancialAmount value={value} size="md" className={`font-extrabold ${tone}`} />}
    </div>
  );
}

function Row({ label, value, tone, bold }: { label: string; value: number; tone: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <FinancialAmount value={value} size="sm" className={`${tone} ${bold ? "font-bold" : ""}`} />
    </div>
  );
}
