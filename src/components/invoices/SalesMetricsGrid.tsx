import { TrendingUp, XCircle, ArrowDownCircle, Clock, Banknote, CreditCard, Smartphone, Landmark, Scale } from "lucide-react";
import type { ReactNode } from "react";
import { MetricCardWithHint } from "@/components/MetricCardWithHint";
import type { SalesMetrics, SalesCardFilter } from "@/hooks/useSalesInvoices";

const SOURCE = "فواتير البيع المطابقة لكل الفلاتر الحالية (بتاريخ الفاتورة الفعلي) في هذا الفرع فقط، مع مدفوعاتها غير الملغاة وغير العكسية.";
const EMPTY: SalesMetrics = { count: 0, activeCount: 0, cancelledCount: 0, cancelledTotal: 0, totalSales: 0, collected: 0, remaining: 0, byBucket: { cash: 0, instapay: 0, wallet: 0, bank: 0, other: 0 } };

const countFooter = (n: number, word: string): ReactNode => <span className="tabular-nums">{n.toLocaleString("en-US")} {word}</span>;

export function SalesMetricsGrid({ metrics, loading, selected, onSelect }: { metrics: SalesMetrics | null; loading: boolean; selected?: SalesCardFilter | null; onSelect?: (k: SalesCardFilter | null) => void }) {
  const m = metrics ?? EMPTY;
  const sel = (k: SalesCardFilter) => onSelect ? { active: selected === k, onClick: () => onSelect(selected === k ? null : k) } : {};
  const bucketHint = (name: string) => ({
    meaning: `إجمالي ما حُصّل ${name} على الفواتير النشطة المطابقة؛ يساوي مجموع عمود «${name}» في الجدول لكل الصفحات.`,
    source: SOURCE,
    formula: `Σ مدفوعات ${name} للفواتير النشطة`,
  });
  return (
    <div className={`space-y-3 mb-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCardWithHint label="المبيعات النشطة" {...sel("active")} value={m.totalSales} icon={<TrendingUp />} tone="primary" footer={countFooter(m.activeCount, "فاتورة نشطة")}
          metricHint={{ meaning: "عدد وقيمة فواتير البيع النشطة فقط (بعد الخصم والضريبة).", source: SOURCE, formula: "Σ total حيث الحالة = نشطة" }} />
        <MetricCardWithHint label="الفواتير الملغاة" {...sel("cancelled")} value={m.cancelledTotal} icon={<XCircle />} tone="destructive" footer={countFooter(m.cancelledCount, "فاتورة ملغاة")}
          metricHint={{ meaning: "عدد وقيمة الفواتير الملغاة، منفصلة تمامًا عن المبيعات النشطة.", source: SOURCE, formula: "Σ total حيث الحالة = ملغاة" }} />
        <MetricCardWithHint label="المحصل الفعلي (+)" {...sel("collected")} value={m.collected} icon={<ArrowDownCircle />} tone="success"
          metricHint={{ meaning: "كل ما سُدّد على الفواتير النشطة (نقدًا أو تحويلًا أو خصم من الرصيد المسبق للعميل). لا يُخصم منه أي مصروف.", source: SOURCE, formula: "Σ مدفوعات الفواتير النشطة = نقدي + انستاباي + محفظة + بنكي + رصيد مسبق" }} />
        <MetricCardWithHint label="المتبقي / الآجل (-)" {...sel("remaining")} value={m.remaining} icon={<Clock />} tone="warning"
          metricHint={{ meaning: "المبالغ الآجلة المتبقية على العملاء في الفواتير النشطة.", source: SOURCE, formula: "Σ max(0, الإجمالي − المدفوع) لكل فاتورة نشطة" }} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MetricCardWithHint label="نقدي" {...sel("cash")} value={m.byBucket.cash} icon={<Banknote />} tone="success" metricHint={bucketHint("نقدي")} />
        <MetricCardWithHint label="انستاباي" {...sel("instapay")} value={m.byBucket.instapay} icon={<CreditCard />} tone="success" metricHint={bucketHint("انستاباي")} />
        <MetricCardWithHint label="محفظة" {...sel("wallet")} value={m.byBucket.wallet} icon={<Smartphone />} tone="success" metricHint={bucketHint("محفظة")} />
        <MetricCardWithHint label="بنكي" {...sel("bank")} value={m.byBucket.bank} icon={<Landmark />} tone="success" metricHint={bucketHint("بنكي")} />
        <MetricCardWithHint label="رصيد مسبق" {...sel("other")} value={m.byBucket.other} icon={<Scale />} tone="warning"
          metricHint={{ meaning: "ما خُصم من الدفعات المقدمة للعملاء على الفواتير النشطة. لا يدخل الخزينة لأن النقدية دخلت وقت الإيداع.", source: SOURCE, formula: "Σ مدفوعات الفواتير النشطة حيث الطريقة = رصيد مسبق. والتوازن: المحصل = نقدي + انستاباي + محفظة + بنكي + رصيد مسبق" }} />
      </div>
    </div>
  );
}
