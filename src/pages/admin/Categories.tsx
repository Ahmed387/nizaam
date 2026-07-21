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
      .select("id,name,sku,quantity,cost_price,selling_price,image,branch_id,category_id,low_stock_alert,color")
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

      <Dialog open={!!viewCat} onOpenChange={(o) => !o && setViewCat(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              منتجات: {viewCat?.name}
              <span className="text-sm font-normal text-muted-foreground mr-2">
                ({viewProducts.length} منتج — إجمالي الكمية: {viewProducts.reduce((s, p) => s + (p.quantity || 0), 0)})
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="relative mb-3">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="بحث بالاسم أو SKU..."
              value={viewSearch}
              onChange={(e) => setViewSearch(e.target.value)}
              className="pr-9"
            />
          </div>

          {viewLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : viewProducts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">لا توجد منتجات في هذا التصنيف</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 border-b-2 border-border">
                  <tr>
                    <th className="p-2 text-right">الصورة</th>
                    <th className="p-2 text-right">اسم المنتج</th>
                    <th className="p-2 text-right">SKU</th>
                    <th className="p-2 text-right">اللون</th>
                    <th className="p-2 text-right">الفرع</th>
                    <th className="p-2 text-center">الكمية</th>
                    <th className="p-2 text-right">سعر التكلفة</th>
                    <th className="p-2 text-right">سعر البيع</th>
                    <th className="p-2 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {viewProducts
                    .filter((p) => {
                      const q = viewSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (p.name || "").toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q);
                    })
                    .map((p) => {
                      const branch = branches.find((b) => b.id === p.branch_id);
                      const low = (p.quantity || 0) <= (p.low_stock_alert || 0);
                      const out = (p.quantity || 0) === 0;
                      return (
                        <tr key={p.id} className="border-b border-border/40 hover:bg-primary/5">
                          <td className="p-2">
                            {p.image ? (
                              <img src={p.image} alt={p.name} className="w-10 h-10 object-cover rounded" />
                            ) : (
                              <div className="w-10 h-10 rounded bg-surface-2 flex items-center justify-center">
                                <Package className="w-4 h-4 text-muted-foreground" />
                              </div>
                            )}
                          </td>
                          <td className="p-2 font-semibold">{p.name}</td>
                          <td className="p-2 text-muted-foreground font-mono text-xs">{p.sku}</td>
                          <td className="p-2"><ColorChip name={p.color} /></td>
                          <td className="p-2 text-xs">{branch?.name ?? "—"}</td>
                          <td className="p-2 text-center tabular-nums font-bold">{p.quantity}</td>
                          <td className="p-2 tabular-nums">{formatEGP(p.cost_price)}</td>
                          <td className="p-2 tabular-nums">{formatEGP(p.selling_price)}</td>
                          <td className="p-2 text-center">
                            {out ? (
                              <span className="text-xs px-2 py-1 rounded bg-destructive/15 text-destructive font-semibold">نفذ</span>
                            ) : low ? (
                              <span className="text-xs px-2 py-1 rounded bg-amber-500/15 text-amber-600 font-semibold">منخفض</span>
                            ) : (
                              <span className="text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-600 font-semibold">متوفر</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ConditionalLayout>
  );
}
