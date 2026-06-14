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

export default function ReportsHub() {
  const [params, setParams] = useSearchParams();
  const { isAdmin, hasRole } = useAuth();
  const canSeeProfit = isAdmin || hasRole("accountant") || hasRole("branch_manager");
  const tab = params.get("tab") ?? "central";
  return (
    <AdminLayout>
      <PageHeader title="التقارير" subtitle="التقارير المركزية والربحية والمجدولة وسجلات العمليات والأسعار" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="central">التقارير المركزية</TabsTrigger>
          {canSeeProfit && <TabsTrigger value="profitability">تقرير الربحية</TabsTrigger>}
          <TabsTrigger value="scheduled">التقارير المجدولة</TabsTrigger>
          <TabsTrigger value="audit">سجل العمليات</TabsTrigger>
          <TabsTrigger value="price-audit">سجل الأسعار</TabsTrigger>
        </TabsList>
        <TabsContent value="central" className="mt-4"><AdminReports embedded /></TabsContent>
        {canSeeProfit && <TabsContent value="profitability" className="mt-4"><ProfitabilityReport embedded /></TabsContent>}
        <TabsContent value="scheduled" className="mt-4"><ScheduledReports embedded /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditLog embedded /></TabsContent>
        <TabsContent value="price-audit" className="mt-4"><PriceAuditLog embedded /></TabsContent>
      </Tabs>
    </AdminLayout>
  );
}

