import { useEffect, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, FolderTree, Folder, Trash2, Pencil, Loader2, Package, Search } from "lucide-react";
import { formatEGP } from "@/lib/format";

export default function Categories({ embedded }: { embedded?: boolean } = {}) {
  const [cats, setCats] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", parent_id: "" });
  const [viewCat, setViewCat] = useState<any>(null);
  const [viewProducts, setViewProducts] = useState<any[]>([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewSearch, setViewSearch] = useState("");

  const load = async () => {
    const [{ data: c }, { data: b }] = await Promise.all([
      supabase.from("categories").select("*").order("name"),
      supabase.from("branches").select("id,name").order("name"),
    ]);
    setCats(c ?? []);
    setBranches(b ?? []);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(["categories", "products"], load);

  const openView = async (c: any) => {
    setViewCat(c);
    setViewSearch("");
    setViewLoading(true);
    // include children category ids so parent shows all descendants
    const childIds = cats.filter((x) => x.parent_id === c.id).map((x) => x.id);
    const ids = [c.id, ...childIds];
    const { data } = await supabase
      .from("products")
      .select("id,name,sku,quantity,cost_price,selling_price,image,branch_id,category_id,low_stock_alert")
      .in("category_id", ids)
      .is("archived_at", null)
      .order("name");
    setViewProducts(data ?? []);
    setViewLoading(false);
  };

  const openNew = () => { setEditing(null); setForm({ name: "", parent_id: "" }); setOpen(true); };
  const openEdit = (c: any) => { setEditing(c); setForm({ name: c.name, parent_id: c.parent_id ?? "" }); setOpen(true); };

  const submit = async () => {
    if (!form.name.trim()) return toast.error("الاسم مطلوب");
    if (editing) {
      const { error } = await supabase.from("categories").update({ name: form.name, parent_id: form.parent_id || null }).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("تم التعديل");
    } else {
      const { error } = await supabase.from("categories").insert({ name: form.name, parent_id: form.parent_id || null });
      if (error) return toast.error(error.message);
      toast.success("تمت الإضافة");
    }
    setOpen(false); setEditing(null); setForm({ name: "", parent_id: "" }); load();
  };

  const remove = async (id: string) => {
    if (!confirm("تأكيد الحذف؟")) return;
    const { count } = await supabase.from("products").select("id", { head: true, count: "exact" }).eq("category_id", id);
    if ((count ?? 0) > 0) return toast.error("لا يمكن الحذف، يوجد منتجات بهذا التصنيف");
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    load();
  };

  const tree = cats.filter((c) => !c.parent_id);

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader
        title="التصنيفات"
        subtitle={`${cats.length} تصنيف`}
        actions={<Button className="btn-gradient" onClick={openNew}><Plus className="w-4 h-4 ml-1" /> إضافة تصنيف</Button>}
      />

      <div className="card-elevated p-5 space-y-2">
        {tree.length === 0 && <div className="text-muted-foreground text-center py-8">لا توجد تصنيفات بعد</div>}
        {tree.map((c) => (
          <div key={c.id}>
            <div className="flex items-center justify-between p-2 rounded hover:bg-surface-2 group cursor-pointer" onClick={() => openView(c)}>
              <div className="flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-primary" />
                <span className="font-semibold">{c.name}</span>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
            {cats.filter((x) => x.parent_id === c.id).map((child) => (
              <div key={child.id} className="flex items-center justify-between p-2 mr-8 rounded hover:bg-surface-2 group cursor-pointer" onClick={() => openView(child)}>
                <div className="flex items-center gap-2">
                  <Folder className="w-4 h-4 text-muted-foreground" />
                  <span>{child.name}</span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(child)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(child.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "تعديل تصنيف" : "إضافة تصنيف"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>اسم التصنيف *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
            <div>
              <Label>تصنيف رئيسي (اختياري)</Label>
              <Select value={form.parent_id || "none"} onValueChange={(v) => setForm({ ...form, parent_id: v === "none" ? "" : v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="بدون" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— تصنيف رئيسي —</SelectItem>
                  {cats.filter((c) => !c.parent_id && c.id !== editing?.id).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submit}>{editing ? "حفظ" : "إضافة"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConditionalLayout>
  );
}
