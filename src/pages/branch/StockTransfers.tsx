import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DataTable } from "@/components/DataTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { notifyMany, getBranchManagers } from "@/lib/notifications";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Check, X, ArrowLeftRight } from "lucide-react";

export default function StockTransfers() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile, isAdmin } = useAuth();
  const [branches, setBranches] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [outgoing, setOutgoing] = useState<any[]>([]);
  const [incoming, setIncoming] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ to_branch_id: "", product_id: "", quantity: "", reason: "" });

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    const [b, p, out, inc] = await Promise.all([
      supabase.from("branches").select("*").eq("is_active", true).neq("id", branchId),
      supabase.from("products").select("*").eq("branch_id", branchId).order("name"),
      supabase.from("stock_transfers").select("*, to_branch:branches!to_branch_id(name), products(name)").eq("from_branch_id", branchId).order("created_at", { ascending: false }),
      supabase.from("stock_transfers").select("*, from_branch:branches!from_branch_id(name), products(name)").eq("to_branch_id", branchId).order("created_at", { ascending: false }),
    ]);
    setBranches(b.data ?? []);
    setProducts(p.data ?? []);
    setOutgoing(out.data ?? []);
    setIncoming(inc.data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);

  const submit = async () => {
    const qty = Number(form.quantity);
    if (!form.to_branch_id) return toast.error("اختر الفرع المستلم");
    if (!form.product_id) return toast.error("اختر المنتج");
    if (!qty || qty <= 0) return toast.error("أدخل كمية صحيحة");
    const prod = products.find((p) => p.id === form.product_id);
    if (!prod) return;
    if (qty > prod.quantity) return toast.error(`الكمية المتاحة: ${prod.quantity} فقط`);

    // Create transfer (pending) + decrement source stock immediately
    const { data: tr, error } = await supabase.from("stock_transfers").insert({
      from_branch_id: branchId!, to_branch_id: form.to_branch_id, product_id: form.product_id,
      quantity: qty, reason: form.reason || null, transferred_by: user!.id, status: "pending",
    }).select().single();
    if (error) return toast.error(error.message);

    await supabase.from("products").update({ quantity: prod.quantity - qty }).eq("id", form.product_id);

    // Notify branch managers of receiving branch
    const toBranch = branches.find((b) => b.id === form.to_branch_id);
    const fromBranch = branches.find((b) => b.id === branchId) ?? { name: "فرع آخر" };
    const recipients = await getBranchManagers(form.to_branch_id);
    await notifyMany(recipients, {
      title: "طلب نقل بضاعة جديد",
      body: `من ${fromBranch.name ?? "فرع آخر"}: ${prod.name} × ${qty}`,
      type: "general",
      link: `/branch/${form.to_branch_id}/transfers`,
      relatedEntity: "stock_transfer",
      relatedEntityId: tr.id,
    });

    await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId, action: "CREATE", entity: "stock_transfer", entityId: tr.id, details: { product: prod.name, qty, to: form.to_branch_id } });
    toast.success("تم إرسال طلب النقل وانتظار التأكيد من الفرع المستلم");
    setOpen(false);
    setForm({ to_branch_id: "", product_id: "", quantity: "", reason: "" });
    load();
  };


  const confirmTransfer = async (t: any) => {
    // Add to destination product (or create if not exists)
    const { data: existing } = await supabase
      .from("products")
      .select("*")
      .eq("branch_id", t.to_branch_id)
      .eq("name", t.products?.name)
      .maybeSingle();

    if (existing) {
      await supabase.from("products").update({ quantity: (existing.quantity ?? 0) + t.quantity }).eq("id", existing.id);
    } else {
      // Fetch source product to copy specs
      const { data: src } = await supabase.from("products").select("*").eq("id", t.product_id).maybeSingle();
      if (src) {
        const sku = `T-${Date.now().toString().slice(-6)}`;
        await supabase.from("products").insert({
          branch_id: t.to_branch_id, name: src.name, sku,
          category_id: src.category_id, image: src.image,
          cost_price: src.cost_price, selling_price: src.selling_price, market_price: src.market_price,
          quantity: t.quantity, low_stock_alert: src.low_stock_alert,
        });
      }
    }

    await supabase.from("stock_transfers").update({ status: "confirmed", confirmed_by: user!.id }).eq("id", t.id);
    await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId, action: "UPDATE", entity: "stock_transfer", entityId: t.id, details: { confirmed: true } });
    toast.success("تم تأكيد الاستلام وإضافة الكمية للمخزون");
    load();
  };

  const rejectTransfer = async (t: any) => {
    if (!confirm("رفض الطلب وإرجاع الكمية لفرع المرسل؟")) return;
    // Restore source stock
    const { data: src } = await supabase.from("products").select("quantity").eq("id", t.product_id).maybeSingle();
    if (src) await supabase.from("products").update({ quantity: src.quantity + t.quantity }).eq("id", t.product_id);
    await supabase.from("stock_transfers").update({ status: "rejected", confirmed_by: user!.id }).eq("id", t.id);
    await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId, action: "UPDATE", entity: "stock_transfer", entityId: t.id, details: { rejected: true } });
    toast.info("تم رفض الطلب وإرجاع الكمية");
    load();
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = { pending: "text-warning", confirmed: "text-success", rejected: "text-destructive" };
    const lbl: Record<string, string> = { pending: "قيد الانتظار", confirmed: "تم الاستلام", rejected: "مرفوض" };
    return <span className={`font-bold ${map[s]}`}>{lbl[s] ?? s}</span>;
  };

  return (
    <BranchLayout>
      <PageHeader
        title="نقل المخزون"
        subtitle="إرسال واستقبال البضاعة بين الفروع"
        actions={<Button onClick={() => setOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> طلب نقل جديد</Button>}
      />

      <Tabs defaultValue="incoming">
        <TabsList>
          <TabsTrigger value="incoming">واردة ({incoming.filter((t) => t.status === "pending").length})</TabsTrigger>
          <TabsTrigger value="outgoing">صادرة</TabsTrigger>
        </TabsList>

        <TabsContent value="incoming" className="mt-4">
          <DataTable rows={incoming} loading={loading} empty="لا توجد طلبات واردة"
            columns={[
              { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
              { key: "from", header: "من فرع", render: (r: any) => <b>{r.from_branch?.name}</b> },
              { key: "product", header: "المنتج", render: (r: any) => r.products?.name ?? "—" },
              { key: "quantity", header: "الكمية", render: (r: any) => <b>{r.quantity}</b> },
              { key: "reason", header: "السبب", render: (r: any) => r.reason ?? "—" },
              { key: "status", header: "الحالة", render: (r: any) => statusBadge(r.status) },
              { key: "actions", header: "", render: (r: any) => r.status === "pending" ? (
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => confirmTransfer(r)} className="gap-1"><Check className="w-3 h-3" /> استلام</Button>
                  <Button size="sm" variant="outline" onClick={() => rejectTransfer(r)} className="gap-1 text-destructive"><X className="w-3 h-3" /> رفض</Button>
                </div>
              ) : null },
            ]} />
        </TabsContent>

        <TabsContent value="outgoing" className="mt-4">
          <DataTable rows={outgoing} loading={loading} empty="لا توجد طلبات صادرة"
            columns={[
              { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
              { key: "to", header: "إلى فرع", render: (r: any) => <b>{r.to_branch?.name}</b> },
              { key: "product", header: "المنتج", render: (r: any) => r.products?.name ?? "—" },
              { key: "quantity", header: "الكمية", render: (r: any) => <b>{r.quantity}</b> },
              { key: "reason", header: "السبب", render: (r: any) => r.reason ?? "—" },
              { key: "status", header: "الحالة", render: (r: any) => statusBadge(r.status) },
            ]} />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="w-5 h-5" /> طلب نقل بضاعة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الفرع المستلم *</Label>
              <select value={form.to_branch_id} onChange={(e) => setForm({ ...form, to_branch_id: e.target.value })}
                className="w-full mt-1 bg-surface border border-border rounded-md px-3 py-2 text-sm">
                <option value="">— اختر —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </select>
            </div>
            <div>
              <Label>المنتج *</Label>
              <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}
                className="w-full mt-1 bg-surface border border-border rounded-md px-3 py-2 text-sm">
                <option value="">— اختر —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} (متاح: {p.quantity})</option>)}
              </select>
            </div>
            <div><Label>الكمية *</Label><Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="mt-1.5" /></div>
            <div><Label>السبب</Label><Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit}>إرسال الطلب</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
