import { Building2 } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatEGP } from "@/lib/format";
import { ALL_FINANCIAL_BRANCHES, BranchFinancialSnapshot, FinancialBranch } from "@/hooks/useAdminFinancialBranchMetrics";

export function FinancialBranchFilter({ value, onChange, branches }: { value: string; onChange: (value: string) => void; branches: FinancialBranch[] }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card p-2">
      <Building2 className="h-4 w-4 text-muted-foreground" />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="نطاق التقرير" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FINANCIAL_BRANCHES}>كل الفروع (مجمّع للشركة)</SelectItem>
          {branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function BranchFinancialDistribution({ rows, loading }: { rows: BranchFinancialSnapshot[]; loading: boolean }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-bold">توزيع الموقف المالي حسب الفرع</h3>
        <p className="text-xs text-muted-foreground">ذمم كل فرع مستقلة (العملاء والموردين كل واحد لوحده)، والأرصدة الافتتاحية مسجلة على الخزينة الرئيسية.</p>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        indexColumn
        getRowKey={(row) => row.id}
        empty="لا توجد بيانات فروع"
        columns={[
          { key: "name", header: "الفرع / الوعاء", render: (row) => <span className="font-semibold">{row.name}</span> },
          { key: "receivables", header: "مستحق على العملاء", render: (row) => formatEGP(row.receivables) },
          { key: "payables", header: "مستحق للموردين", render: (row) => formatEGP(row.payables) },
          { key: "customerAdvances", header: "مقدمات عملاء", render: (row) => formatEGP(row.customerAdvances) },
          { key: "supplierAdvances", header: "مقدمات موردين", render: (row) => formatEGP(row.supplierAdvances) },
          { key: "cash", header: "النقدية", render: (row) => <span className="font-bold">{formatEGP(row.cash)}</span> },
        ]}
      />
    </section>
  );
}