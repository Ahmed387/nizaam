import { HandCoins, ArrowDownCircle, Wallet } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { BranchFinancialDistribution } from "@/components/FinancialBranchScope";
import { useAdminFinancialBranchMetrics } from "@/hooks/useAdminFinancialBranchMetrics";
import { formatEGP } from "@/lib/format";

/**
 * Cash in every till, Σ مدين, Σ دائن and their split per branch — moved here from the partners page's old «نظرة عامة»
 * tab (owner 2026-11-25: that tab is gone, nothing it showed is lost). `branchId` null = the whole company.
 */
export function CompanyPositionCards({ branchId }: { branchId: string | null }) {
  const f = useAdminFinancialBranchMetrics();
  const snap = branchId ? f.distribution.find((r) => r.id === branchId) : undefined;
  const cash = branchId ? snap?.cash ?? 0 : f.totalCash;
  const debit = branchId ? snap?.receivables ?? 0 : f.companyReceivables;
  const credit = branchId ? snap?.payables ?? 0 : f.companyPayables;
  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="الكاش في كل الخزن" value={formatEGP(cash)} icon={<Wallet className="w-5 h-5" />} accent="primary"
          metricHint={{ meaning: "رصيد الخزن والأوعية دلوقتي", source: "أرصدة الأوعية لكل فرع", formula: "Σ رصيد كل وعاء" }} />
        <StatCard label="إجمالي المدين (لنا)" value={formatEGP(debit)} icon={<HandCoins className="w-5 h-5" />} accent="success"
          metricHint={{ meaning: "اللي لينا عند الحسابات", source: "رصيد كل حساب (contacts_page)", formula: "Σ الحسابات اللي رصيدها مدين" }} />
        <StatCard label="إجمالي الدائن (علينا)" value={formatEGP(credit)} icon={<ArrowDownCircle className="w-5 h-5" />} accent="destructive"
          metricHint={{ meaning: "اللي علينا للحسابات", source: "رصيد كل حساب (contacts_page)", formula: "Σ الحسابات اللي رصيدها دائن" }} />
      </div>
      {!branchId && <BranchFinancialDistribution rows={f.distribution} loading={f.loading} />}
    </div>
  );
}
