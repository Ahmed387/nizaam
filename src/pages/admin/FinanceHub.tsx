import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import AllVouchers from "./AllVouchers";
import Receivables from "./Receivables";

export default function FinanceHub() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "vouchers";
  return (
    <AdminLayout>
      <PageHeader title="المالية" subtitle="السندات المالية والذمم" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="vouchers">السندات المالية</TabsTrigger>
          <TabsTrigger value="receivables">الذمم المالية</TabsTrigger>
        </TabsList>
        <TabsContent value="vouchers" className="mt-4"><AllVouchers embedded /></TabsContent>
        <TabsContent value="receivables" className="mt-4"><Receivables embedded /></TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
