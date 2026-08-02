import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AllVouchers from "./AllVouchers";
import Receivables from "./Receivables";

export default function FinanceHub() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const show = { vouchers: can("admin_finance_vouchers.view"), receivables: can("admin_finance_receivables.view") };
  const first = show.vouchers ? "vouchers" : "receivables";
  const requested = params.get("tab") as keyof typeof show | null;
  const tab = requested && show[requested] ? requested : first;
  return (
    <AdminLayout>
      <div dir="rtl" className="text-right">
        <PageHeader title="المالية" subtitle="السندات المالية والذمم" />
        <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })} dir="rtl">
          <div className="flex justify-start">
            <TabsList className="flex-wrap h-auto">
              {show.vouchers && <TabsTrigger value="vouchers">السندات المالية</TabsTrigger>}
              {show.receivables && <TabsTrigger value="receivables">ذمم العملاء والموردين</TabsTrigger>}
            </TabsList>
          </div>
          {show.vouchers && <TabsContent value="vouchers" className="mt-4"><AllVouchers embedded /></TabsContent>}
          {show.receivables && <TabsContent value="receivables" className="mt-4"><Receivables embedded /></TabsContent>}
        </Tabs>
      </div>
    </AdminLayout>
  );
}
