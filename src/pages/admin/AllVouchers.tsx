import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PermButton } from "@/contexts/PermCustomize";
import { PageHeader } from "@/components/layout/AppShell";
import { VouchersTable } from "@/components/VouchersTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams } from "react-router-dom";
import { CreditDepositButton } from "@/components/CreditDepositDialog";

export default function AllVouchers({ embedded }: { embedded?: boolean } = {}) {
  const { tenantId } = useAuth();
  const [sp] = useSearchParams();
  const initialFrom = sp.get("startDate") ?? undefined;
  const initialTo = sp.get("endDate") ?? undefined;
  const onlyDed = sp.get("only_deducted_from_profit") === "true";
  const urlType = sp.get("type");
  const def = urlType === "payment" || urlType === "receipt" ? urlType : "all";
  const extra = { initialFrom, initialTo };
  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader title="السندات المالية" subtitle="كل سندات القبض والصرف من جميع الفروع" />
      <div className="mb-3"><PermButton label="إيداع رصيد تحت الحساب"><CreditDepositButton /></PermButton></div>
      <Tabs defaultValue={def}>
        <TabsList>
          <TabsTrigger value="all">الكل</TabsTrigger>
          <TabsTrigger value="receipt">قبض</TabsTrigger>
          <TabsTrigger value="payment">صرف</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">
          <VouchersTable adminAllBranches tenantId={tenantId ?? undefined} {...extra} />
        </TabsContent>
        <TabsContent value="receipt" className="mt-4">
          <VouchersTable adminAllBranches tenantId={tenantId ?? undefined} type="receipt" {...extra} />
        </TabsContent>
        <TabsContent value="payment" className="mt-4">
          <VouchersTable adminAllBranches tenantId={tenantId ?? undefined} type="payment" {...extra} onlyDeductedFromProfit={onlyDed} />
        </TabsContent>
      </Tabs>
    </ConditionalLayout>
  );
}
