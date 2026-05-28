import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { VouchersTable } from "@/components/VouchersTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";

export default function AllVouchers({ embedded }: { embedded?: boolean } = {}) {
  const { tenantId } = useAuth();
  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader title="السندات المالية" subtitle="كل سندات القبض والصرف من جميع الفروع" />
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">الكل</TabsTrigger>
          <TabsTrigger value="receipt">قبض</TabsTrigger>
          <TabsTrigger value="payment">صرف</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">
          <VouchersTable adminAllBranches tenantId={tenantId ?? undefined} />
        </TabsContent>
        <TabsContent value="receipt" className="mt-4">
          <VouchersTable adminAllBranches tenantId={tenantId ?? undefined} type="receipt" />
        </TabsContent>
        <TabsContent value="payment" className="mt-4">
          <VouchersTable adminAllBranches tenantId={tenantId ?? undefined} type="payment" />
        </TabsContent>
      </Tabs>
    </ConditionalLayout>
  );
}
