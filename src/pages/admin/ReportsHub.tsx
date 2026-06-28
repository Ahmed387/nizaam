import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AdminReports from "./Reports";
import ScheduledReports from "./ScheduledReports";
import AuditLog from "./AuditLog";
import PriceAuditLog from "./PriceAuditLog";
import ProfitabilityReport from "./ProfitabilityReport";
import ExecutiveInsights from "./ExecutiveInsights";
import OwnerCockpit from "./OwnerCockpit";

export default function ReportsHub() {
  const [params, setParams] = useSearchParams();
  const { isAdmin, hasRole } = useAuth();
  const canSeeProfit = isAdmin || hasRole("accountant") || hasRole("branch_manager");
  const tab = params.get("tab") ?? "owner";
  return (
    <AdminLayout>
      <PageHeader title="التقارير" subtitle="نظرة المالك، التقارير المركزية، الربحية، الرؤى التنفيذية، والتقارير المجدولة" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          {canSeeProfit && <TabsTrigger value="owner">👑 نظرة المالك</TabsTrigger>}
          <TabsTrigger value="central">🏢 العمليات (مركزية)</TabsTrigger>
          {canSeeProfit && <TabsTrigger value="profitability">📊 الربحية</TabsTrigger>}
          {canSeeProfit && <TabsTrigger value="insights">🎯 الرؤى التنفيذية</TabsTrigger>}
          <TabsTrigger value="scheduled">⏰ المجدولة</TabsTrigger>
          <TabsTrigger value="audit">سجل العمليات</TabsTrigger>
          <TabsTrigger value="price-audit">سجل الأسعار</TabsTrigger>
        </TabsList>
        {canSeeProfit && <TabsContent value="owner" className="mt-4"><OwnerCockpit embedded /></TabsContent>}
        <TabsContent value="central" className="mt-4"><AdminReports embedded /></TabsContent>
        {canSeeProfit && <TabsContent value="profitability" className="mt-4"><ProfitabilityReport embedded /></TabsContent>}
        {canSeeProfit && <TabsContent value="insights" className="mt-4"><ExecutiveInsights embedded /></TabsContent>}
        <TabsContent value="scheduled" className="mt-4"><ScheduledReports embedded /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditLog embedded /></TabsContent>
        <TabsContent value="price-audit" className="mt-4"><PriceAuditLog embedded /></TabsContent>
      </Tabs>
    </AdminLayout>
  );
}

