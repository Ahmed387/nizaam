import { FileText, TrendingUp, ArrowDownCircle, Clock, Wallet } from "lucide-react";
import { MetricCardWithHint } from "@/components/MetricCardWithHint";
import { MetricHint } from "@/components/ui/MetricHint";
import { formatEGP } from "@/lib/format";
import { BUCKET_LABELS, type CollectionBucket, type SalesMetrics } from "@/hooks/useSalesInvoices";

const SOURCE = "فواتير البيع المطابقة لكل الفلاتر الحالية (بتاريخ الفاتورة الفعلي) في هذا الفرع فقط، مع مدفوعاتها غير الملغاة.";
const BUCKETS: CollectionBucket[] = ["cash", "instapay", "wallet", "bank", "other"];

export function SalesMetricsGrid({ metrics, loading }: { metrics: SalesMetrics | null; loading: boolean }) {
  const m = metrics ?? { count: 0, totalSales: 0, collected: 0, remaining: 0, byBucket: { cash: 0, instapay: 0, wallet: 0, bank: 0, other: 0 } };
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="card-elevated p-5 flex flex-col items-center justify-center text-center">
        <div className="text-base font-semibold text-foreground flex items-center gap-1.5">
          <FileText className="w-5 h-5 text-primary" /> عدد الفواتير
          <MetricHint label="شرح عدد الفواتير" meaning="عدد فواتير البيع المطابقة للفلاتر (نشطة وملغاة)." source={SOURCE} formula="COUNT(الفواتير المطابقة)" />
        </div>
        <div className="mt-2 text-2xl font-extrabold text-primary tabular-nums">{m.count.toLocaleString("en-US")}</div>
      </div>
      <MetricCardWithHint label="إجمالي المبيعات" value={m.totalSales} icon={<TrendingUp />} tone="primary"
        metricHint={{ meaning: "صافي قيمة الفواتير النشطة بعد الخصم والضريبة.", source: SOURCE, formula: "Σ total للفواتير النشطة" }} />
      <MetricCardWithHint label="المحصل الفعلي (+)" value={m.collected} icon={<ArrowDownCircle />} tone="success"
        metricHint={{ meaning: "ما دفعه العملاء فعليًا على هذه الفواتير.", source: SOURCE, formula: "Σ مبالغ مدفوعات الفواتير النشطة (باستثناء الملغاة والعكسية)" }} />
      <MetricCardWithHint label="المتبقي / الآجل (-)" value={m.remaining} icon={<Clock />} tone="warning"
        metricHint={{ meaning: "المبالغ الآجلة المتبقية على العملاء.", source: SOURCE, formula: "Σ max(0, الإجمالي − المدفوع) لكل فاتورة نشطة" }} />
      <div className="card-elevated p-4 col-span-2 lg:col-span-1">
        <div className="text-base font-semibold text-foreground flex items-center justify-center gap-1.5 mb-2">
          <Wallet className="w-5 h-5 text-success" /> أوعية التحصيل
          <MetricHint label="شرح أوعية التحصيل" meaning="تقسيم المحصل الفعلي حسب وسيلة الدفع." source={SOURCE} formula="Σ المدفوعات مجمّعة حسب طريقة الدفع" />
        </div>
        <ul className="space-y-1 text-sm">
          {BUCKETS.filter((b) => b !== "other" || m.byBucket.other > 0).map((b) => (
            <li key={b} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{BUCKET_LABELS[b]}</span>
              <span className="font-semibold tabular-nums">{formatEGP(m.byBucket[b])}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
