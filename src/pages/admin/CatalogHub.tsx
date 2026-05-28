import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import Branches from "./Branches";
import Categories from "./Categories";
import PriceList from "./PriceList";
import AllInventory from "./AllInventory";

export default function CatalogHub() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "branches";
  return (
    <AdminLayout>
      <PageHeader title="الفروع والمخزون" subtitle="إدارة الفروع والتصنيفات وقوائم الأسعار والمخزون" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="branches">إدارة الفروع</TabsTrigger>
          <TabsTrigger value="categories">التصنيفات</TabsTrigger>
          <TabsTrigger value="pricelist">قائمة الأسعار</TabsTrigger>
          <TabsTrigger value="inventory">مخزون كل الفروع</TabsTrigger>
        </TabsList>
        <TabsContent value="branches" className="mt-4"><Branches embedded /></TabsContent>
        <TabsContent value="categories" className="mt-4"><Categories embedded /></TabsContent>
        <TabsContent value="pricelist" className="mt-4"><PriceList embedded /></TabsContent>
        <TabsContent value="inventory" className="mt-4"><AllInventory embedded /></TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
