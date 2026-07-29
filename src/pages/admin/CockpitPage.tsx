import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import OwnerCockpit from "./OwnerCockpit";

export default function CockpitPage() {
  return (
    <AdminLayout>
      <PageHeader
        title="لوحة المالك"
        subtitle="نظرة لحظية على أداء الشركة — كل الأرقام من المحرك المالي الموحّد"
      />
      <div className="p-4 md:p-6">
        <OwnerCockpit embedded />
      </div>
    </AdminLayout>
  );
}
