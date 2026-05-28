import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import AdminReports from "./Reports";
import ScheduledReports from "./ScheduledReports";
import AuditLog from "./AuditLog";

export default function ReportsHub() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "central";
  return (
    <AdminLayout>
      <PageHeader title="التقارير" subtitle="التقارير المركزية والمجدولة وسجل العمليات" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="central">التقارير المركزية</TabsTrigger>
          <TabsTrigger value="scheduled">التقارير المجدولة</TabsTrigger>
          <TabsTrigger value="audit">سجل العمليات</TabsTrigger>
        </TabsList>
        <TabsContent value="central" className="mt-4"><AdminReports embedded /></TabsContent>
        <TabsContent value="scheduled" className="mt-4"><ScheduledReports embedded /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditLog embedded /></TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
