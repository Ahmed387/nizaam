import { useParams, useSearchParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Customers from "./Customers";
import Suppliers from "./Suppliers";

export default function Contacts() {
  useParams<{ id: string }>();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "suppliers" ? "suppliers" : "customers";

  return (
    <BranchLayout>
      <PageHeader title="العملاء والموردين" />
      <Tabs value={tab} onValueChange={(v) => setSp({ tab: v })}>
        <TabsList>
          <TabsTrigger value="customers">العملاء</TabsTrigger>
          <TabsTrigger value="suppliers">الموردين</TabsTrigger>
        </TabsList>
        <TabsContent value="customers" className="mt-4">
          <Customers embedded />
        </TabsContent>
        <TabsContent value="suppliers" className="mt-4">
          <Suppliers embedded />
        </TabsContent>
      </Tabs>
    </BranchLayout>
  );
}
