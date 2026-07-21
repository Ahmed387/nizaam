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
import { ColorChip } from "@/components/ColorPicker";
import { AttributeChip } from "@/components/AttributePicker";

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
      .select("id,name,sku,quantity,cost_price,selling_price,image,branch_id,category_id,low_stock_alert,color,product_type,capacity,size")
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
              placeholder="بحث بالاسم، SKU، اللون، الفرع، السعر..."
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {viewProducts
                .filter((p) => {
                  const raw = viewSearch.trim();
                  if (!raw) return true;
                  const normalize = (s: string) =>
                    (s || "")
                      .toString()
                      .toLowerCase()
                      .normalize("NFKD")
                      .replace(/[\u064B-\u0652\u0670]/g, "")
                      .replace(/[إأآا]/g, "ا")
                      .replace(/ى/g, "ي")
                      .replace(/ة/g, "ه");
                  const branch = branches.find((b) => b.id === p.branch_id);
                  const haystack = normalize(
                    [p.name, p.sku, p.color, p.product_type, p.capacity, p.size, branch?.name, p.cost_price, p.selling_price, p.quantity]
                      .filter((x) => x !== null && x !== undefined)
                      .join(" ")
                  );
                  const tokens = normalize(raw).split(/\s+/).filter(Boolean);
                  return tokens.every((t) => haystack.includes(t));
                })
                .map((p) => {
                  const branch = branches.find((b) => b.id === p.branch_id);
                  const low = (p.quantity || 0) <= (p.low_stock_alert || 0);
                  const out = (p.quantity || 0) === 0;
                  return (
                    <div key={p.id} className="rounded-lg border border-border bg-card hover:border-primary/40 hover:shadow-sm transition p-3 flex gap-3">
                      {p.image ? (
                        <img src={p.image} alt={p.name} className="w-16 h-16 object-cover rounded-md shrink-0" />
                      ) : (
                        <div className="w-16 h-16 rounded-md bg-surface-2 flex items-center justify-center shrink-0">
                          <Package className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-sm leading-snug break-words" dir="auto" style={{ unicodeBidi: "plaintext" as any }}>{p.name}</div>
                            <div className="text-[11px] font-mono text-muted-foreground mt-0.5">{p.sku}</div>
                          </div>
                          {out ? (
                            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded bg-destructive/15 text-destructive font-semibold">نفذ</span>
                          ) : low ? (
                            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 font-semibold">منخفض</span>
                          ) : (
                            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 font-semibold">متوفر</span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1">
                          {p.color && <ColorChip name={p.color} />}
                          <AttributeChip label="نوع" value={p.product_type} tone="primary" />
                          <AttributeChip label="سعة" value={p.capacity} tone="success" />
                          <AttributeChip label="مقاس" value={p.size} tone="warning" />
                        </div>

                        <div className="flex items-center justify-between text-xs pt-1 border-t border-border/40">
                          <span className="text-muted-foreground truncate">{branch?.name ?? "—"}</span>
                          <div className="flex items-center gap-3 tabular-nums">
                            <span className="text-muted-foreground">تكلفة: <span className="text-foreground">{formatEGP(p.cost_price)}</span></span>
                            <span className="text-muted-foreground">بيع: <span className="font-semibold text-primary">{formatEGP(p.selling_price)}</span></span>
                            <span className="font-bold">×{p.quantity}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ConditionalLayout>
  );
}
