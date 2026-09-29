import { TrendingUp, XCircle, ArrowDownCircle, Clock, Banknote, CreditCard, Smartphone, Landmark, Scale } from "lucide-react";
import type { ReactNode } from "react";
import { MetricCardWithHint } from "@/components/MetricCardWithHint";
import type { SalesMetrics } from "@/hooks/useSalesInvoices";

const SOURCE = "فواتير البيع المطابقة لكل الفلاتر الحالية (بتاريخ الفاتورة الفعلي) في هذا الفرع فقط، مع مدفوعاتها غير الملغاة وغير العكسية.";
const EMPTY: SalesMetrics = { count: 0, activeCount: 0, cancelledCount: 0, cancelledTotal: 0, totalSales: 0, collected: 0, remaining: 0, byBucket: { cash: 0, instapay: 0, wallet: 0, bank: 0, other: 0 } };

const countFooter = (n: number, word: string): ReactNode => <span className="tabular-nums">{n.toLocaleString("en-US")} {word}</span>;

export function SalesMetricsGrid({ metrics, loading }: { metrics: SalesMetrics | null; loading: boolean }) {
  const m = metrics ?? EMPTY;
  const bucketHint = (name: string) => ({
    meaning: `إجمالي ما حُصّل ${name} على الفواتير النشطة المطابقة؛ يساوي مجموع عمود «${name}» في الجدول لكل الصفحات.`,
    source: SOURCE,
    formula: `Σ مدفوعات ${name} للفواتير النشطة`,
  });
  return (
    <div className={`space-y-3 mb-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCardWithHint label="المبيعات النشطة" value={m.totalSales} icon={<TrendingUp />} tone="primary" footer={countFooter(m.activeCount, "فاتورة نشطة")}
          metricHint={{ meaning: "عدد وقيمة فواتير البيع النشطة فقط (بعد الخصم والضريبة).", source: SOURCE, formula: "Σ total حيث الحالة = نشطة" }} />
        <MetricCardWithHint label="الفواتير الملغاة" value={m.cancelledTotal} icon={<XCircle />} tone="destructive" footer={countFooter(m.cancelledCount, "فاتورة ملغاة")}
          metricHint={{ meaning: "عدد وقيمة الفواتير الملغاة، منفصلة تمامًا عن المبيعات النشطة.", source: SOURCE, formula: "Σ total حيث الحالة = ملغاة" }} />
        <MetricCardWithHint label="المحصل الفعلي (+)" value={m.collected} icon={<ArrowDownCircle />} tone="success"
          metricHint={{ meaning: "كل ما سُدّد على الفواتير النشطة (نقدًا أو تحويلًا أو مقاصة من رصيد العميل). لا يُخصم منه أي مصروف.", source: SOURCE, formula: "Σ مدفوعات الفواتير النشطة = نقدي + انستاباي + محفظة + بنكي + مقاصة/أخرى" }} />
        <MetricCardWithHint label="المتبقي / الآجل (-)" value={m.remaining} icon={<Clock />} tone="warning"
          metricHint={{ meaning: "المبالغ الآجلة المتبقية على العملاء في الفواتير النشطة.", source: SOURCE, formula: "Σ max(0, الإجمالي − المدفوع) لكل فاتورة نشطة" }} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MetricCardWithHint label="نقدي" value={m.byBucket.cash} icon={<Banknote />} tone="success" metricHint={bucketHint("نقدي")} />
        <MetricCardWithHint label="انستاباي" value={m.byBucket.instapay} icon={<CreditCard />} tone="success" metricHint={bucketHint("انستاباي")} />
        <MetricCardWithHint label="محفظة" value={m.byBucket.wallet} icon={<Smartphone />} tone="success" metricHint={bucketHint("محفظة")} />
        <MetricCardWithHint label="بنكي" value={m.byBucket.bank} icon={<Landmark />} tone="success" metricHint={bucketHint("بنكي")} />
        <MetricCardWithHint label="مقاصة / أخرى" value={m.byBucket.other} icon={<Scale />} tone="warning"
          metricHint={{ meaning: "ما سُدّد من الفواتير النشطة بغير نقدية فعلية: مقاصة من رصيد العميل تحت الحساب (settlement) أو أي طريقة غير الأوعية الأربعة. لا تدخل الخزينة كاش.", source: SOURCE, formula: "Σ مدفوعات الفواتير النشطة حيث الطريقة ∉ {نقدي، انستاباي، محفظة، بنكي}. والتوازن: المحصل = نقدي + انستاباي + محفظة + بنكي + مقاصة/أخرى" }} />
      </div>
    </div>
  );
}
