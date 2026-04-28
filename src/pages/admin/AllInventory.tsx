import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Upload, Loader2, Image as ImageIcon, Pencil, Plus } from "lucide-react";

interface Row {
  id: string;
  name: string;
  sku: string;
  image: string | null;
  quantity: number;
  cost_price: number;
  selling_price: number;
  market_price: number;
  old_price: number;
  low_stock_alert: number;
  branch_id: string;
  branch_name?: string;
  category_id: string | null;
  category_name?: string;
}

export default function AllInventory() {
  const { user, profile, tenantId } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: prods }, { data: brs }, { data: cs }] = await Promise.all([
      supabase.from("products").select("*, branches(name), categories(name)").order("created_at", { ascending: false }),
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
      supabase.from("categories").select("id, name").order("name"),
    ]);
    setRows(
      (prods ?? []).map((p: any) => ({
        ...p,
        branch_name: p.branches?.name ?? "—",
        category_name: p.categories?.name ?? "—",
      }))
    );
    setBranches(brs ?? []);
    setCats(cs ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((p) => {
    if (search && !p.name.includes(search) && !p.sku.includes(search)) return false;
    if (branchFilter !== "all" && p.branch_id !== branchFilter) return false;
    if (catFilter !== "all" && p.category_id !== catFilter) return false;
    if (stockFilter === "low" && p.quantity > p.low_stock_alert) return false;
    if (stockFilter === "out" && p.quantity > 0) return false;
    if (stockFilter === "ok" && p.quantity <= p.low_stock_alert) return false;
    return true;
  }), [rows, search, branchFilter, catFilter, stockFilter]);

  const stats = useMemo(() => ({
    total: rows.length,
    out: rows.filter((r) => r.quantity === 0).length,
    low: rows.filter((r) => r.quantity > 0 && r.quantity <= r.low_stock_alert).length,
    value: rows.reduce((s, r) => s + r.quantity * Number(r.cost_price || 0), 0),
  }), [rows]);

  const uploadImage = async (file: File, branchId: string): Promise<string | null> => {
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${branchId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: false });
    setUploading(false);
    if (error) { toast.error(error.message); return null; }
    return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  };

  const saveEdit = async () => {
    if (!editing) return;
    const { error } = await supabase.from("products").update({
      name: editing.name,
      quantity: Number(editing.quantity) || 0,
      cost_price: Number(editing.cost_price) || 0,
      selling_price: Number(editing.selling_price) || 0,
      market_price: Number(editing.market_price) || 0,
      low_stock_alert: Number(editing.low_stock_alert) || 5,
      image: editing.image,
      category_id: editing.category_id || null,
    }).eq("id", editing.id);
    if (error) return toast.error(error.message);
    await logAudit({
      userId: user!.id, userName: profile!.name, tenantId, branchId: editing.branch_id,
      action: "UPDATE", entity: "Product", entityId: editing.id,
      details: { name: editing.name, qty: editing.quantity },
    });
    toast.success("تم الحفظ");
    setEditing(null);
    load();
  };

  return (
    <AdminLayout>
      <PageHeader
        title="إدارة المنتجات لكل الفروع"
        subtitle={`${stats.total} منتج · ${stats.out} نافد · ${stats.low} منخفض · قيمة المخزون: ${formatEGP(stats.value)}`}
        actions={<Button className="btn-gradient" onClick={() => setAdding(true)}><Plus className="w-4 h-4 ml-1" /> منتج جديد</Button>}
      />

      <div className="flex gap-3 mb-4 flex-wrap">
        <Input placeholder="ابحث بالاسم أو الكود" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="الفرع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفروع</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="التصنيف" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل التصنيفات</SelectItem>
            {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={stockFilter} onValueChange={setStockFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="ok">متوفر</SelectItem>
            <SelectItem value="low">منخفض</SelectItem>
            <SelectItem value="out">نفد</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable loading={loading} rows={filtered}
        columns={[
          { key: "image", header: "صورة", render: (r: Row) => r.image
              ? <img src={r.image} alt={r.name} className="w-10 h-10 rounded object-cover" />
              : <div className="w-10 h-10 rounded bg-muted flex items-center justify-center"><ImageIcon className="w-4 h-4 text-muted-foreground" /></div> },
          { key: "sku", header: "الكود", render: (r: Row) => <span className="font-mono text-xs text-muted-foreground">{r.sku}</span> },
          { key: "name", header: "الاسم", render: (r: Row) => <span className="font-semibold">{r.name}</span> },
          { key: "branch", header: "الفرع", render: (r: Row) => <span className="px-2 py-1 rounded text-xs bg-primary/10 text-primary">{r.branch_name}</span> },
          { key: "category", header: "التصنيف", render: (r: Row) => r.category_name },
          { key: "quantity", header: "الكمية", render: (r: Row) => <span className="font-bold">{r.quantity}</span> },
          { key: "cost_price", header: "شراء", render: (r: Row) => formatEGP(r.cost_price) },
          { key: "selling_price", header: "بيع", render: (r: Row) => <span className="text-success">{formatEGP(r.selling_price)}</span> },
          { key: "market_price", header: "سوق", render: (r: Row) => <span className="text-primary">{formatEGP(r.market_price)}</span> },
          { key: "status", header: "الحالة", render: (r: Row) => {
            if (r.quantity === 0) return <span className="px-2 py-1 rounded text-xs bg-destructive/15 text-destructive">🔴 نفد</span>;
            if (r.quantity <= r.low_stock_alert) return <span className="px-2 py-1 rounded text-xs bg-warning/15 text-warning">🟡 منخفض</span>;
            return <span className="px-2 py-1 rounded text-xs bg-success/15 text-success">🟢 متوفر</span>;
          }},
          { key: "actions", header: "تعديل", render: (r: Row) => (
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setEditing({ ...r }); }}>
              <Pencil className="w-3.5 h-3.5 ml-1" /> تعديل
            </Button>
          )},
        ]}
      />

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>تعديل: {editing?.name} <span className="text-sm text-muted-foreground mr-2">— {editing?.branch_name}</span></DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>صورة المنتج</Label>
                <div className="mt-1.5 flex items-center gap-3">
                  {editing.image && <img src={editing.image} alt="" className="w-16 h-16 rounded object-cover border" />}
                  <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-md border hover:bg-muted">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    <span className="text-sm">{editing.image ? "تغيير" : "رفع"}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                      const f = e.target.files?.[0]; if (!f) return;
                      const url = await uploadImage(f, editing.branch_id);
                      if (url) setEditing({ ...editing, image: url });
                    }} />
                  </label>
                  {editing.image && <Button variant="ghost" size="sm" onClick={() => setEditing({ ...editing, image: null })}>إزالة</Button>}
                </div>
              </div>
              <div className="col-span-2"><Label>الاسم</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="mt-1.5" /></div>
              <div className="col-span-2">
                <Label>التصنيف</Label>
                <Select value={editing.category_id || "none"} onValueChange={(v) => setEditing({ ...editing, category_id: v === "none" ? null : v })}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون —</SelectItem>
                    {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>الكمية</Label><Input type="number" value={editing.quantity} onChange={(e) => setEditing({ ...editing, quantity: Number(e.target.value) })} className="mt-1.5" /></div>
              <div><Label>الحد التنبيهي</Label><Input type="number" value={editing.low_stock_alert} onChange={(e) => setEditing({ ...editing, low_stock_alert: Number(e.target.value) })} className="mt-1.5" /></div>
              <div><Label>سعر الشراء</Label><Input type="number" value={editing.cost_price} onChange={(e) => setEditing({ ...editing, cost_price: Number(e.target.value) })} className="mt-1.5" /></div>
              <div><Label>سعر البيع</Label><Input type="number" value={editing.selling_price} onChange={(e) => setEditing({ ...editing, selling_price: Number(e.target.value) })} className="mt-1.5" /></div>
              <div><Label>سعر السوق</Label><Input type="number" value={editing.market_price} onChange={(e) => setEditing({ ...editing, market_price: Number(e.target.value) })} className="mt-1.5" /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={saveEdit}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add product dialog */}
      <AddProductDialog
        open={adding}
        onClose={() => setAdding(false)}
        branches={branches}
        cats={cats}
        onSaved={load}
      />
    </AdminLayout>
  );
}

function AddProductDialog({ open, onClose, branches, cats, onSaved }: {
  open: boolean; onClose: () => void;
  branches: { id: string; name: string }[];
  cats: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const { user, profile, tenantId } = useAuth();
  const [form, setForm] = useState({
    name: "", category_id: "", branch_ids: [] as string[],
    cost_price: "", selling_price: "", market_price: "",
    low_stock_alert: "5", quantity: "0", image: "",
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!open) setForm({ name: "", category_id: "", branch_ids: [], cost_price: "", selling_price: "", market_price: "", low_stock_alert: "5", quantity: "0", image: "" }); }, [open]);

  const toggleBranch = (id: string) => {
    setForm((f) => ({ ...f, branch_ids: f.branch_ids.includes(id) ? f.branch_ids.filter((x) => x !== id) : [...f.branch_ids, id] }));
  };
  const allBranches = () => setForm((f) => ({ ...f, branch_ids: branches.map((b) => b.id) }));

  const upload = async (file: File) => {
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `shared/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file);
    setUploading(false);
    if (error) return toast.error(error.message);
    setForm((f) => ({ ...f, image: supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl }));
  };

  const submit = async () => {
    if (!form.name) return toast.error("اسم المنتج مطلوب");
    if (!form.branch_ids.length) return toast.error("اختر فرعاً واحداً على الأقل");
    setSaving(true);
    // ولّد SKU واحد للمنتج، يتأكد إنه فريد داخل الشركة، ويُستخدم في كل الفروع
    let sharedSku = "";
    for (let i = 0; i < 10; i++) {
      const { data: skuRes } = await supabase.rpc("next_sku");
      const candidate = skuRes as string;
      if (!candidate) continue;
      const { data: clash } = await supabase
        .from("products")
        .select("id")
        .eq("tenant_id", tenantId!)
        .eq("sku", candidate)
        .limit(1)
        .maybeSingle();
      if (!clash) { sharedSku = candidate; break; }
    }
    if (!sharedSku) {
      setSaving(false);
      return toast.error("تعذّر توليد كود منتج فريد، حاول مرة أخرى");
    }

    let ok = 0;
    for (const branchId of form.branch_ids) {
      const { data, error } = await supabase.from("products").insert({
        name: form.name,
        sku: sharedSku,
        category_id: form.category_id || null,
        cost_price: Number(form.cost_price) || 0,
        selling_price: Number(form.selling_price) || 0,
        market_price: Number(form.market_price) || 0,
        low_stock_alert: parseInt(form.low_stock_alert) || 5,
        quantity: parseInt(form.quantity) || 0,
        image: form.image || null,
        branch_id: branchId,
      }).select().single();
      if (!error && data) {
        ok++;
        await logAudit({ userId: user!.id, userName: profile!.name, tenantId, branchId, action: "CREATE", entity: "Product", entityId: data.id, details: { name: form.name } });
      }
    }
    setSaving(false);
    toast.success(`تمت إضافة المنتج في ${ok} فرع`);
    onClose();
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>إضافة منتج جديد لعدة فروع</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>صورة المنتج</Label>
            <div className="mt-1.5 flex items-center gap-3">
              {form.image && <img src={form.image} alt="" className="w-16 h-16 rounded object-cover border" />}
              <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-md border hover:bg-muted">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span className="text-sm">{form.image ? "تغيير" : "رفع"}</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
            </div>
          </div>
          <div className="col-span-2"><Label>اسم المنتج *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
          <div className="col-span-2">
            <Label>التصنيف</Label>
            <Select value={form.category_id || "none"} onValueChange={(v) => setForm({ ...form, category_id: v === "none" ? "" : v })}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="بدون" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— بدون —</SelectItem>
                {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <div className="flex items-center justify-between">
              <Label>الفروع المستهدفة *</Label>
              <Button variant="ghost" size="sm" onClick={allBranches}>تحديد الكل</Button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {branches.map((b) => (
                <button key={b.id} type="button" onClick={() => toggleBranch(b.id)}
                  className={`px-3 py-1.5 rounded-md text-sm border transition ${form.branch_ids.includes(b.id) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>
                  {b.name}
                </button>
              ))}
            </div>
          </div>
          <div><Label>سعر الشراء</Label><Input type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} className="mt-1.5" /></div>
          <div><Label>سعر البيع</Label><Input type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} className="mt-1.5" /></div>
          <div><Label>سعر السوق</Label><Input type="number" value={form.market_price} onChange={(e) => setForm({ ...form, market_price: e.target.value })} className="mt-1.5" /></div>
          <div><Label>الكمية لكل فرع</Label><Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="mt-1.5" /></div>
          <div className="col-span-2"><Label>الحد التنبيهي</Label><Input type="number" value={form.low_stock_alert} onChange={(e) => setForm({ ...form, low_stock_alert: e.target.value })} className="mt-1.5" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button className="btn-gradient" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
            إضافة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
