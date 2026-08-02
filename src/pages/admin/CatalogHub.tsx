import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Branches from "./Branches";
import Categories from "./Categories";
import PriceList from "./PriceList";
import AllInventory from "./AllInventory";

export default function CatalogHub() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const show = {
    branches: can("admin_catalog_branches.view"),
    categories: can("admin_catalog_categories.view"),
    pricelist: can("admin_catalog_pricelist.view"),
    inventory: can("admin_catalog_inventory.view"),
  };
  const first = (Object.keys(show) as (keyof typeof show)[]).find((k) => show[k]) ?? "branches";
  const requested = params.get("tab") as keyof typeof show | null;
  const tab = requested && show[requested] ? requested : first;
  return (
    <AdminLayout>
      <PageHeader title="الفروع والمخزون" subtitle="إدارة الفروع والتصنيفات وقوائم الأسعار والمخزون" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          {show.branches && <TabsTrigger value="branches">إدارة الفروع</TabsTrigger>}
          {show.categories && <TabsTrigger value="categories">التصنيفات</TabsTrigger>}
          {show.pricelist && <TabsTrigger value="pricelist">قائمة الأسعار</TabsTrigger>}
          {show.inventory && <TabsTrigger value="inventory">مخزون كل الفروع</TabsTrigger>}
        </TabsList>
        {show.branches && <TabsContent value="branches" className="mt-4"><Branches embedded /></TabsContent>}
        {show.categories && <TabsContent value="categories" className="mt-4"><Categories embedded /></TabsContent>}
        {show.pricelist && <TabsContent value="pricelist" className="mt-4"><PriceList embedded /></TabsContent>}
        {show.inventory && <TabsContent value="inventory" className="mt-4"><AllInventory embedded /></TabsContent>}
      </Tabs>
    </AdminLayout>
  );
}
