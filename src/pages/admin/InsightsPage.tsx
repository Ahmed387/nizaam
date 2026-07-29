import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import ExecutiveInsights from "./ExecutiveInsights";

export default function InsightsPage() {
  return (
    <AdminLayout>
      <PageHeader
        title="الرؤى التنفيذية"
        subtitle="أعلى/أقل المنتجات والفروع والعملاء للقرار الاستراتيجي"
      />
      <div className="p-4 md:p-6">
        <ExecutiveInsights embedded />
      </div>
    </AdminLayout>
  );
}
