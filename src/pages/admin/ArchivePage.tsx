import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout, BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAllRows } from "@/lib/fetchAll";
import { formatDate } from "@/lib/format";

/**
 * «الأرشيف» (owner 2026-11-11): everything archived in one place — accounts (customers / suppliers) and item cards — with
 * «استرجاع». Nothing is ever hard-deleted. A branch page shows that branch's rows; the admin page shows the company's.
 * An account archived by a merge shows where it went and cannot be restored (migration 0202).
 */
export default function ArchivePage() {
  const { id: branchId } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const Layout = branchId ? BranchLayout : AdminLayout;
  const [contacts, setContacts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        fetchAllRows<any>(() => {
          let q: any = (supabase.from("contacts") as any).select("id, account_no, name, type, phone, branch_id, merged_into, created_at, branches:branch_id(name)").eq("is_archived", true);
          if (branchId) q = q.eq("branch_id", branchId);
          return q.order("id");
        }),
        fetchAllRows<any>(() => {
          let q: any = (supabase.from("products") as any).select("id, name, sku, quantity, archived_at, branch_id, branches(name), categories(name)").not("archived_at", "is", null);
          if (branchId) q = q.eq("branch_id", branchId);
          return q.order("id");
        }),
      ]);
      setContacts(c); setProducts(p);
    } catch (e: any) { toast.error(e?.message ?? "تعذر تحميل الأرشيف"); }
    finally { setLoading(false); }
  }, [branchId]);
  useEffect(() => { load(); }, [load]);

  const restoreContact = async (r: any) => {
    const { error } = await (supabase.rpc as any)("restore_contact", { p_id: r.id });
    if (error) return toast.error(error.message);
    toast.success(`رجع الحساب «${r.name}»`); load();
  };
  const restoreProduct = async (r: any) => {
    const { error } = await (supabase.rpc as any)("restore_product", { _product_id: r.id });
    if (error) return toast.error(error.message);
    toast.success(`رجع الصنف «${r.name}»`); load();
  };
  const typeName = (t: string) => (t === "customer" ? "عميل" : t === "supplier" ? "مورد" : "عميل ومورد");

  return (
    <Layout>
      <PageHeader title="الأرشيف" subtitle="كل المتأرشف من الحسابات وكروت الصنف — مفيش حاجة بتتمسح نهائي" />
      <Tabs defaultValue="contacts">
        <TabsList>
          <TabsTrigger value="contacts">الحسابات ({contacts.length})</TabsTrigger>
          <TabsTrigger value="products">كروت الصنف ({products.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="contacts" className="mt-3">
          <DataTable loading={loading} rows={contacts} indexColumn permTable="arc_c" getRowKey={(r: any) => r.id} empty="مفيش حسابات مؤرشفة"
            columns={[
              { key: "account_no", header: "رقم الحساب", render: (r: any) => <span className="font-mono text-xs">{r.account_no ?? "—"}</span> },
              { key: "name", header: "اسم الحساب", render: (r: any) => <b>{r.name}</b> },
              { key: "type", header: "طبيعة الحساب", render: (r: any) => typeName(r.type) },
              { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
              { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
              { key: "why", header: "السبب", render: (r: any) => (r.merged_into ? "اتدمج في حساب تاني" : "أرشفة") },
              { key: "act", header: "الإجراءات", filter: false, render: (r: any) => (isAdmin && !r.merged_into ? (
                <Button size="sm" variant="outline" className="h-8 gap-1 text-success border-success/40" onClick={() => restoreContact(r)}><ArchiveRestore className="w-4 h-4" /> استرجاع</Button>
              ) : null) },
            ]} />
        </TabsContent>
        <TabsContent value="products" className="mt-3">
          <DataTable loading={loading} rows={products} indexColumn permTable="arc_p" getRowKey={(r: any) => r.id} empty="مفيش كروت صنف مؤرشفة"
            columns={[
              { key: "sku", header: "الكود", render: (r: any) => <span className="font-mono text-xs">{r.sku}</span> },
              { key: "name", header: "اسم الصنف", render: (r: any) => <b>{r.name}</b> },
              { key: "cat", header: "التصنيف", render: (r: any) => r.categories?.name ?? "—" },
              { key: "quantity", header: "الكمية", total: false, render: (r: any) => r.quantity },
              { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
              { key: "archived_at", header: "تاريخ الأرشفة", render: (r: any) => (r.archived_at ? formatDate(r.archived_at) : "—") },
              { key: "act", header: "الإجراءات", filter: false, render: (r: any) => (
                <Button size="sm" variant="outline" className="h-8 gap-1 text-success border-success/40" onClick={() => restoreProduct(r)}><ArchiveRestore className="w-4 h-4" /> استرجاع</Button>
              ) },
            ]} />
        </TabsContent>
      </Tabs>
    </Layout>
  );
}
