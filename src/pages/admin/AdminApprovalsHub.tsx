import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { ShieldCheck, Percent } from "lucide-react";
import ApprovalRequests from "./ApprovalRequests";
import AdminDiscountApprovals from "./AdminDiscountApprovals";

export default function AdminApprovalsHub() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "approvals";
  return (
    <AdminLayout>
      <PageHeader title="طلبات موافقة الأدمن" subtitle="طلبات الحذف/التعديل وطلبات الخصم — كل الفروع" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="approvals" className="gap-1"><ShieldCheck className="w-4 h-4" /> طلبات الموافقة</TabsTrigger>
          <TabsTrigger value="discounts" className="gap-1"><Percent className="w-4 h-4" /> طلبات الخصم</TabsTrigger>
        </TabsList>
        <TabsContent value="approvals" className="mt-4"><ApprovalRequests embedded /></TabsContent>
        <TabsContent value="discounts" className="mt-4"><AdminDiscountApprovals embedded /></TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
