import type { TreasuryDetail } from "@/lib/treasuryVessels";
import { useMemo } from "react";
import { PermCard } from "@/contexts/PermCustomize";
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
  /** what the card shows, in words (owner 2026-11-26: «مفيش فيها اي توضيح») */
  meaning?: string;
}

/** 0287: a click on a card opens its movements (owner 2026-11-26 «اي كارت … يدخلني علي تفاصيل الكارت») */
export type TreasuryPick = TreasuryDetail;

/** a whole card is a button; the (i) inside keeps its own click */
function Clickable({ onPick, title, children, testId }: { onPick?: () => void; title: string; children: React.ReactNode; testId?: string }) {
  if (!onPick) return <>{children}</>;
  return (
    <div role="button" tabIndex={0} title={title} data-testid={testId} aria-label={title}
      className="cursor-pointer rounded-xl transition hover:ring-2 hover:ring-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={onPick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }}>
      {children}
    </div>
  );
}
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

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
  onPick?: (p: TreasuryPick) => void;
}

export function TreasuryMetricsGrid({ cumulativeBalance, periodRows, channels, loading, lowThresholdAlert, onPick }: Props) {
  const pick = (p: TreasuryPick) => (onPick ? () => onPick(p) : undefined);
  const { overall, byChannel } = usePeriodTotals(periodRows, channels);

  return (
    <div className="space-y-4 mb-6" dir="rtl">
      {/* 1. Global cumulative balance — independent of filters */}
      <PermCard label="رصيد الخزنة دلوقتي (كل الأوعية)"><Clickable onPick={pick({ kind: "balance" })} title="اضغط تشوف كل حركات الخزنة من أول يوم" testId="card-balance"><div className="card-elevated p-6 text-center">
        <div className="text-sm text-muted-foreground mb-1 flex items-center justify-center gap-1 flex-wrap">
          رصيد الخزنة دلوقتي (كل الأوعية)
          <span onClick={stop}><MetricHint
            label="شرح رصيد الخزنة دلوقتي"
            meaning="صافي النقدية المتبقية فعليًا بكل أوعية هذا الفرع حتى اللحظة، ولا يتأثر بأي فلتر. الرقم السالب يعني أن المصروفات وسندات الصرف والتحويلات الصادرة المسجلة تجاوزت المقبوضات المسجلة للفرع."
            source="سجل حركات الخزينة للفرع كاملًا (get_branch_wallet_balances)."
            formula="Σ amount (type = income) − Σ amount (type = expense) لكل حركات الفرع منذ البداية"
          /></span>
          <span className="text-xs">(من أول يوم — الفلاتر مش بتغيّره)</span>
        </div>
        <FinancialAmount value={cumulativeBalance} size="hero" className="gradient-text font-extrabold" />
        {lowThresholdAlert}
      </div></Clickable></PermCard>

      {/* 2. Period summary — follows all filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <PeriodCard onPick={pick({ kind: "income" })} pickTitle="اضغط تشوف حركات الدخل بس في الفترة دي" testId="card-income"
          title="إجمالي اللي دخل الخزنة في الفترة (+)" tone="text-success" icon={<ArrowDownCircle className="w-5 h-5" />}
          value={overall.income} loading={loading}
          hint={{ meaning: "كل المقبوضات الداخلة للفرع ضمن الفلاتر المطبقة فقط.", source: "حركات الخزينة المفلترة (نفس فلاتر الجدول).", formula: "Σ amount حيث type = income ضمن النطاق المفلتر" }}
        />
        <PeriodCard onPick={pick({ kind: "expense" })} pickTitle="اضغط تشوف حركات الخرج بس في الفترة دي" testId="card-expense"
          title="إجمالي اللي خرج من الخزنة في الفترة (−)" tone="text-destructive" icon={<ArrowUpCircle className="w-5 h-5" />}
          value={overall.expense} loading={loading}
          hint={{ meaning: "كل المصروفات وسندات الصرف والتحويلات الخارجة ضمن الفلاتر المطبقة فقط.", source: "حركات الخزينة المفلترة (نفس فلاتر الجدول).", formula: "Σ amount حيث type = expense ضمن النطاق المفلتر" }}
        />
        <PeriodCard onPick={pick({ kind: "net" })} pickTitle="اضغط تشوف كل حركات الفترة دي" testId="card-net"
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
            <PermCard key={c.method} label={`وعاء ${c.label}`}><Clickable onPick={pick({ kind: "channel", method: c.method, label: c.label })}
              title={`${c.meaning ?? `اللي دخل وطلع من ${c.label} في الفترة دي`} — اضغط تشوف حركاته`} testId={`card-channel-${c.method}`}><div className="card-elevated p-4 h-full">
              <div className="flex items-center justify-center gap-1.5 mb-3 text-sm font-semibold">
                <Icon className={`w-5 h-5 ${c.color}`} />
                {c.label}
                <span onClick={stop}><MetricHint
                  label={`شرح ${c.label}`}
                  meaning={c.meaning ?? `اللي دخل وطلع من «${c.label}» في الفترة اللي فوق بس — مش رصيده الكلي.`}
                  source="حركات خزنة الفرع في الفترة دي، اللي طريقة دفعها الوعاء ده."
                  formula={`الصافي = اللي دخل ${c.label} − اللي طلع منه`}
                /></span>
              </div>
              <div className="space-y-1.5 text-sm">
                <Row label="دخل (+)" value={t.income} tone="text-success" />
                <Row label="خرج (−)" value={t.expense} tone="text-destructive" />
                <div className="border-t pt-1.5">
                  <Row label="الصافي (دخل − خرج)" value={t.net} tone={t.net < 0 ? "text-destructive" : "text-foreground"} bold />
                </div>
              </div>
            </div></Clickable></PermCard>
          );
        })}
      </div>
    </div>
  );
}

function PeriodCard({ title, tone, icon, value, hint, loading, onPick, pickTitle, testId }: {
  onPick?: () => void; pickTitle?: string; testId?: string;
  title: string; tone: string; icon: React.ReactNode; value: number; loading?: boolean;
  hint: { meaning: string; source: string; formula: string };
}) {
  return (
    <PermCard label={title}><Clickable onPick={onPick} title={pickTitle ?? title} testId={testId}><div className="card-elevated p-5 text-center h-full">
      <div className="text-sm font-semibold flex items-center justify-center gap-1.5 mb-2">
        <span className={tone}>{icon}</span>{title}
        <span onClick={stop}><MetricHint {...hint} label={`شرح ${title}`} /></span>
      </div>
      {loading ? <div className="h-8 bg-muted rounded animate-pulse" /> : <FinancialAmount value={value} size="md" className={`font-extrabold ${tone}`} />}
    </div></Clickable></PermCard>
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
