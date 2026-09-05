import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AdminReports from "./Reports";
import ScheduledReports from "./ScheduledReports";
import AuditLog from "./AuditLog";
import ProfitabilityReport from "./ProfitabilityReport";
import OwnerCockpit from "./OwnerCockpit";
import MonthlyProfitSummary from "./MonthlyProfitSummary";
import ReturnOverrides from "./ReturnOverrides";
import ReportComparison from "./ReportComparison";
import HistoricalAnalytics from "./HistoricalAnalytics";

export default function ReportsHub() {
  const [params, setParams] = useSearchParams();
  const { isOwner, can } = useAuth();
  const show = {
    owner: isOwner || can("admin_reports_owner.view"),
    monthly: isOwner || can("admin_monthly_profit.view"),
    central: can("admin_reports_central.view"),
    profitability: isOwner || can("admin_reports_profitability.view"),
    comparison: isOwner || can("admin_reports_central.view"),
    historical: can("admin_historical_analytics.view"),
    scheduled: can("admin_reports_scheduled.view"),
    audit: can("admin_reports_audit.view"),
    "return-overrides": can("admin_reports_return_overrides.view"),
  };
  const first = (Object.keys(show) as (keyof typeof show)[]).find((k) => show[k]) ?? "central";
  const requested = params.get("tab") as keyof typeof show | null;
  const tab = requested && show[requested] ? requested : first;
  return (
    <AdminLayout>
      <PageHeader title="التقارير" subtitle="🏢 عمليات يومية • 📊 ربحية محاسبية • 🕰️ أرشيف تاريخي • ⏰ أتمتة — كل تبويب فريد بدون تكرار" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          {show.owner && <TabsTrigger value="owner">👑 نظرة المالك</TabsTrigger>}
          {show.monthly && <TabsTrigger value="monthly">💰 ملخص الأرباح الشهري</TabsTrigger>}
          {show.central && <TabsTrigger value="central">🏢 العمليات (مركزية)</TabsTrigger>}
          {show.profitability && <TabsTrigger value="profitability">📊 الربحية</TabsTrigger>}
          {show.comparison && <TabsTrigger value="comparison">⚖️ مقارنة الفترات</TabsTrigger>}
          {show.historical && <TabsTrigger value="historical">🕰️ الأرشيف والتحليل التاريخي</TabsTrigger>}
          {show.scheduled && <TabsTrigger value="scheduled">⏰ المجدولة</TabsTrigger>}
          {show.audit && <TabsTrigger value="audit">سجل العمليات</TabsTrigger>}
          {show["return-overrides"] && <TabsTrigger value="return-overrides">↩️ تجاوزات المرتجعات</TabsTrigger>}
        </TabsList>
        {show.owner && <TabsContent value="owner" className="mt-4"><OwnerCockpit embedded /></TabsContent>}
        {show.monthly && <TabsContent value="monthly" className="mt-4"><MonthlyProfitSummary embedded /></TabsContent>}
        {show.central && <TabsContent value="central" className="mt-4"><AdminReports embedded /></TabsContent>}
        {show.profitability && <TabsContent value="profitability" className="mt-4"><ProfitabilityReport embedded /></TabsContent>}
        {show.comparison && <TabsContent value="comparison" className="mt-4"><ReportComparison embedded /></TabsContent>}
        {show.historical && <TabsContent value="historical" className="mt-4"><HistoricalAnalytics embedded /></TabsContent>}
        {show.scheduled && <TabsContent value="scheduled" className="mt-4"><ScheduledReports embedded /></TabsContent>}
        {show.audit && <TabsContent value="audit" className="mt-4"><AuditLog embedded /></TabsContent>}
        {show["return-overrides"] && <TabsContent value="return-overrides" className="mt-4"><ReturnOverrides embedded /></TabsContent>}
      </Tabs>

    </AdminLayout>
  );
}
