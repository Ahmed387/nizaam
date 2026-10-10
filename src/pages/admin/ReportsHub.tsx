import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AdminReports from "./Reports";
import ScheduledReports from "./ScheduledReports";
import AuditLog from "./AuditLog";
import ProfitabilityReport from "./ProfitabilityReport";
import ReturnOverrides from "./ReturnOverrides";
import HistoricalAnalytics from "./HistoricalAnalytics";
import { BusinessSnapshot } from "@/components/reports/BusinessSnapshot";

export default function ReportsHub() {
  const [params, setParams] = useSearchParams();
  const { isOwner, can } = useAuth();
  const show = {
    snapshot: isOwner || can("admin_reports_profitability.view"),
    central: can("admin_reports_central.view"),
    profitability: isOwner || can("admin_reports_profitability.view"),
    historical: can("admin_historical_analytics.view"),
    scheduled: can("admin_reports_scheduled.view"),
    audit: can("admin_reports_audit.view"),
    "return-overrides": can("admin_reports_return_overrides.view"),
  };
  const first = show.snapshot ? "snapshot" : show.central
    ? "central"
    : (Object.keys(show) as (keyof typeof show)[]).find((k) => show[k]) ?? "central";
  const rawTab = params.get("tab");
  // old links to the removed «ملخص الأرباح» / «مقارنة الفترات» tabs land on the snapshot
  const requested = (rawTab === "monthly" || rawTab === "comparison" ? "snapshot" : rawTab) as keyof typeof show | null;
  const tab = requested && show[requested] ? requested : first;
  return (
    <AdminLayout>
      <PageHeader title="التقارير" subtitle="ابدأ من «هل بنكسب؟» — وبعدها التفاصيل" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          {show.snapshot && <TabsTrigger value="snapshot">🎯 هل بنكسب؟ وبضاعة كل فرع</TabsTrigger>}
          {show.central && <TabsTrigger value="central">🏢 العمليات (مركزية)</TabsTrigger>}
          {show.profitability && <TabsTrigger value="profitability">📊 الربحية</TabsTrigger>}
          {show.historical && <TabsTrigger value="historical">🕰️ الأرشيف والتحليل التاريخي</TabsTrigger>}
          {show.scheduled && <TabsTrigger value="scheduled">⏰ المجدولة</TabsTrigger>}
          {show.audit && <TabsTrigger value="audit">سجل العمليات</TabsTrigger>}
          {show["return-overrides"] && <TabsTrigger value="return-overrides">↩️ تجاوزات المرتجعات</TabsTrigger>}
        </TabsList>
        {show.snapshot && <TabsContent value="snapshot" className="mt-4"><BusinessSnapshot defaultFrom="2026-01-01" /></TabsContent>}
        {show.central && <TabsContent value="central" className="mt-4"><AdminReports embedded /></TabsContent>}
        {show.profitability && <TabsContent value="profitability" className="mt-4"><ProfitabilityReport embedded /></TabsContent>}
        {show.historical && <TabsContent value="historical" className="mt-4"><HistoricalAnalytics embedded /></TabsContent>}
        {show.scheduled && <TabsContent value="scheduled" className="mt-4"><ScheduledReports embedded /></TabsContent>}
        {show.audit && <TabsContent value="audit" className="mt-4"><AuditLog embedded /></TabsContent>}
        {show["return-overrides"] && <TabsContent value="return-overrides" className="mt-4"><ReturnOverrides embedded /></TabsContent>}
      </Tabs>

    </AdminLayout>
  );
}
