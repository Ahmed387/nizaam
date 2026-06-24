import { useEffect, useMemo, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import * as XLSX from "xlsx";
import { useNavigate } from "react-router-dom";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { searchMatch } from "@/lib/search";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Upload, Loader2, Image as ImageIcon, Pencil, Plus, Trash2, FileSpreadsheet, Barcode, ArrowLeftRight, Edit3, Tag, History } from "lucide-react";
import { PriceEditDialog } from "@/components/PriceEditDialog";
import { ProductPriceHistory } from "@/components/ProductPriceHistory";

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

export default function AllInventory({ embedded }: { embedded?: boolean } = {}) {
  const { user, profile, tenantId } = useAuth();
  const navigate = useNavigate();
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<Row | null>(null);
  const [priceEdit, setPriceEdit] = useState<Row | null>(null);
  const [historyFor, setHistoryFor] = useState<Row | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

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
    setSelected(new Set());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useRealtimeRefresh(["products", "branches", "categories"], load);

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
    // Non-quantity fields update directly (guard only blocks quantity)
    const newQty = Number(editing.quantity) || 0;
    const { error } = await supabase.from("products").update({
      name: editing.name,
      cost_price: Number(editing.cost_price) || 0,
      selling_price: Number(editing.selling_price) || 0,
      market_price: Number(editing.market_price) || 0,
      low_stock_alert: Number(editing.low_stock_alert) || 5,
      image: editing.image,
      category_id: editing.category_id || null,
    }).eq("id", editing.id);
    if (error) return toast.error(error.message);

    // Quantity goes through the audited adjustment path (creates stock_adjustment + reconciles batches)
    const { error: qErr } = await supabase.rpc("admin_set_product_quantity", {
      p_product_id: editing.id,
      p_actual_quantity: newQty,
      p_reason: "admin_manual_edit",
      p_notes: null,
    });
    if (qErr) return toast.error(qErr.message);

    await logAudit({
      userId: user!.id, userName: profile!.name, tenantId, branchId: editing.branch_id,
      action: "UPDATE", entity: "Product", entityId: editing.id,
      details: { name: editing.name, qty: editing.quantity },
    });
    toast.success("تم الحفظ");
    setEditing(null);
    load();
  };


  /** حذف منتج واحد من فرع معيّن */
  const deleteOne = async (r: Row) => {
    const { error } = await supabase.from("products").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    await logAudit({ userId: user!.id, userName: profile!.name, tenantId, branchId: r.branch_id, action: "DELETE", entity: "Product", entityId: r.id, details: { name: r.name } });
    toast.success(`تم حذف ${r.name} من ${r.branch_name}`);
    setDeleteConfirm(null);
    load();
  };

  /** حذف جماعي للمنتجات المختارة */
  const deleteBulk = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const { error } = await supabase.from("products").delete().in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`تم حذف ${ids.length} منتج`);
    setBulkDeleteOpen(false);
    load();
  };

  /** تصدير المنتجات المعروضة (المفلترة) إلى Excel */
  const exportExcel = () => {
    const data = filtered.map((r) => ({
      "الكود (SKU)": r.sku,
      "اسم المنتج": r.name,
      "الفرع": r.branch_name,
      "التصنيف": r.category_name,
      "الكمية": r.quantity,
      "الحد التنبيهي": r.low_stock_alert,
      "سعر الشراء": Number(r.cost_price) || 0,
      "سعر البيع": Number(r.selling_price) || 0,
      "سعر السوق": Number(r.market_price) || 0,
      "قيمة المخزون": (Number(r.quantity) || 0) * (Number(r.cost_price) || 0),
      "الحالة": r.quantity === 0 ? "نفد" : r.quantity <= r.low_stock_alert ? "منخفض" : "متوفر",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "المخزون");
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `inventory-${date}.xlsx`);
    toast.success(`تم تصدير ${data.length} منتج`);
  };

  /** الذهاب لطباعة باركود لفرع المنتج المختار (لو واحد بس) */
  const goPrintBarcodes = () => {
    if (selected.size === 0) {
      toast.error("اختر منتج واحد على الأقل");
      return;
    }
    const selectedRows = rows.filter((r) => selected.has(r.id));
    const branchIds = new Set(selectedRows.map((r) => r.branch_id));
    if (branchIds.size > 1) {
      toast.error("اختر منتجات من فرع واحد فقط لطباعة الباركود");
      return;
    }
    const branchId = Array.from(branchIds)[0];
    navigate(`/branch/${branchId}/inventory/barcodes`);
  };

  /** الذهاب لصفحة النقل بين الفروع */
  const goTransfers = () => {
    if (selected.size === 0) {
      // لو مفيش حاجة مختارة، روح لأي فرع نشط
      if (branches[0]) navigate(`/branch/${branches[0].id}/transfers`);
      else toast.error("لا توجد فروع");
      return;
    }
    const selectedRows = rows.filter((r) => selected.has(r.id));
    const branchId = selectedRows[0].branch_id;
    navigate(`/branch/${branchId}/transfers`);
  };

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAllVisible = () => {
    if (filtered.every((r) => selected.has(r.id))) {
      const next = new Set(selected);
      filtered.forEach((r) => next.delete(r.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filtered.forEach((r) => next.add(r.id));
      setSelected(next);
    }
  };

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader
        title="إدارة المنتجات لكل الفروع"
        subtitle={`${stats.total} منتج · ${stats.out} نافد · ${stats.low} منخفض · قيمة المخزون: ${formatEGP(stats.value)}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>
            <Button variant="outline" onClick={goTransfers}><ArrowLeftRight className="w-4 h-4 ml-1" /> نقل بين الفروع</Button>
            <Button className="btn-gradient" onClick={() => setAdding(true)}><Plus className="w-4 h-4 ml-1" /> منتج جديد</Button>
          </div>
        }
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

      {/* شريط العمليات الجماعية */}
      {selected.size > 0 && (
        <div className="mb-3 p-3 rounded-lg bg-primary/5 border border-primary/20 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-semibold">
            تم تحديد <span className="text-primary">{selected.size}</span> منتج
          </span>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
              <Edit3 className="w-3.5 h-3.5 ml-1" /> تعديل جماعي
            </Button>
            <Button size="sm" variant="outline" onClick={goPrintBarcodes}>
              <Barcode className="w-3.5 h-3.5 ml-1" /> طباعة باركود
            </Button>
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="w-3.5 h-3.5 ml-1" /> حذف الكل
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>إلغاء التحديد</Button>
          </div>
        </div>
      )}

      <DataTable loading={loading} rows={filtered}
        columns={[
          {
            key: "select",
            header: (
              <Checkbox
                checked={filtered.length > 0 && filtered.every((r) => selected.has(r.id))}
                onCheckedChange={toggleAllVisible}
              />
            ) as any,
            render: (r: Row) => (
              <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleRow(r.id)} onClick={(e) => e.stopPropagation()} />
            ),
          },
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
          { key: "actions", header: "إجراءات", render: (r: Row) => (
            <div className="flex gap-1 flex-wrap">
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setPriceEdit(r); }} title="تعديل السعر">
                <Tag className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setHistoryFor(r); }} title="تاريخ الأسعار">
                <History className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setEditing({ ...r }); }} title="تعديل المنتج">
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(r); }}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          )},
        ]}
      />

      {priceEdit && (
        <PriceEditDialog
          open={!!priceEdit}
          onOpenChange={(o) => !o && setPriceEdit(null)}
          product={priceEdit as any}
          onSaved={load}
        />
      )}

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>تاريخ أسعار: {historyFor?.name}</DialogTitle></DialogHeader>
          {historyFor && <ProductPriceHistory productId={historyFor.id} />}
        </DialogContent>
      </Dialog>

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

      {/* Delete one confirm */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المنتج</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف <b>{deleteConfirm?.name}</b> من فرع <b>{deleteConfirm?.branch_name}</b> نهائياً.
              <br />هل أنت متأكد؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => deleteConfirm && deleteOne(deleteConfirm)}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirm */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف جماعي</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف <b>{selected.size}</b> منتج نهائياً من فروعهم. لا يمكن التراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={deleteBulk}>حذف الكل</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk edit dialog */}
      <BulkEditDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        selectedIds={Array.from(selected)}
        cats={cats}
        onSaved={load}
      />

      {/* Add product dialog */}
      <AddProductDialog
        open={adding}
        onClose={() => setAdding(false)}
        branches={branches}
        cats={cats}
        onSaved={load}
      />
    </ConditionalLayout>
  );
}

/* ====================== Bulk Edit Dialog ====================== */
function BulkEditDialog({ open, onClose, selectedIds, cats, onSaved }: {
  open: boolean; onClose: () => void; selectedIds: string[];
  cats: { id: string; name: string }[]; onSaved: () => void;
}) {
  const [fields, setFields] = useState({
    use_category: false, category_id: "none",
    use_cost: false, cost_price: "",
    use_selling: false, selling_price: "",
    use_market: false, market_price: "",
    use_alert: false, low_stock_alert: "",
    use_qty_op: false, qty_op: "set" as "set" | "add" | "sub", qty_value: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setFields({
      use_category: false, category_id: "none",
      use_cost: false, cost_price: "",
      use_selling: false, selling_price: "",
      use_market: false, market_price: "",
      use_alert: false, low_stock_alert: "",
      use_qty_op: false, qty_op: "set", qty_value: "",
    });
  }, [open]);

  const apply = async () => {
    const update: any = {};
    if (fields.use_category) update.category_id = fields.category_id === "none" ? null : fields.category_id;
    if (fields.use_cost) update.cost_price = Number(fields.cost_price) || 0;
    if (fields.use_selling) update.selling_price = Number(fields.selling_price) || 0;
    if (fields.use_market) update.market_price = Number(fields.market_price) || 0;
    if (fields.use_alert) update.low_stock_alert = Number(fields.low_stock_alert) || 5;

    setSaving(true);

    // التحديثات العادية تنطبق دفعة واحدة
    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from("products").update(update).in("id", selectedIds);
      if (error) { setSaving(false); return toast.error(error.message); }
    }

    // عمليات الكمية: محتاجة قراءة القيمة الحالية لو add/sub
    // عمليات الكمية: كل تعديل بيمر عبر admin_set_product_quantity (يخلق سجل تسوية + يصلّح الدفعات)
    if (fields.use_qty_op) {
      const value = Number(fields.qty_value) || 0;
      const { data: current } = await supabase.from("products").select("id, quantity").in("id", selectedIds);
      for (const p of current ?? []) {
        let newQty: number;
        if (fields.qty_op === "set") newQty = value;
        else if (fields.qty_op === "add") newQty = (p.quantity ?? 0) + value;
        else newQty = Math.max(0, (p.quantity ?? 0) - value);
        const { error } = await supabase.rpc("admin_set_product_quantity", {
          p_product_id: p.id,
          p_actual_quantity: newQty,
          p_reason: "admin_bulk_edit",
          p_notes: null,
        });
        if (error) { setSaving(false); return toast.error(error.message); }
      }
    }

    setSaving(false);
    toast.success(`تم تعديل ${selectedIds.length} منتج`);
    onClose();
    onSaved();
  };


  const anySelected = fields.use_category || fields.use_cost || fields.use_selling || fields.use_market || fields.use_alert || fields.use_qty_op;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>تعديل جماعي ({selectedIds.length} منتج)</DialogTitle>
          <DialogDescription>اختر الحقول التي تريد تعديلها فقط. الباقي لن يتغير.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-md border">
            <Checkbox checked={fields.use_category} onCheckedChange={(v) => setFields({ ...fields, use_category: !!v })} className="mt-2" />
            <div className="flex-1">
              <Label className="text-sm">التصنيف</Label>
              <Select disabled={!fields.use_category} value={fields.category_id} onValueChange={(v) => setFields({ ...fields, category_id: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— بدون —</SelectItem>
                  {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {[
            { key: "cost", label: "سعر الشراء", useKey: "use_cost", valueKey: "cost_price" },
            { key: "selling", label: "سعر البيع", useKey: "use_selling", valueKey: "selling_price" },
            { key: "market", label: "سعر السوق", useKey: "use_market", valueKey: "market_price" },
            { key: "alert", label: "الحد التنبيهي", useKey: "use_alert", valueKey: "low_stock_alert" },
          ].map((row) => (
            <div key={row.key} className="flex items-start gap-3 p-3 rounded-md border">
              <Checkbox checked={(fields as any)[row.useKey]} onCheckedChange={(v) => setFields({ ...fields, [row.useKey]: !!v })} className="mt-2" />
              <div className="flex-1">
                <Label className="text-sm">{row.label}</Label>
                <Input type="number" disabled={!(fields as any)[row.useKey]} value={(fields as any)[row.valueKey]}
                  onChange={(e) => setFields({ ...fields, [row.valueKey]: e.target.value })} className="mt-1.5" />
              </div>
            </div>
          ))}

          <div className="flex items-start gap-3 p-3 rounded-md border">
            <Checkbox checked={fields.use_qty_op} onCheckedChange={(v) => setFields({ ...fields, use_qty_op: !!v })} className="mt-2" />
            <div className="flex-1">
              <Label className="text-sm">الكمية</Label>
              <div className="flex gap-2 mt-1.5">
                <Select disabled={!fields.use_qty_op} value={fields.qty_op} onValueChange={(v: any) => setFields({ ...fields, qty_op: v })}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="set">تعيين إلى</SelectItem>
                    <SelectItem value="add">إضافة +</SelectItem>
                    <SelectItem value="sub">خصم −</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" disabled={!fields.use_qty_op} value={fields.qty_value}
                  onChange={(e) => setFields({ ...fields, qty_value: e.target.value })} placeholder="القيمة" />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button className="btn-gradient" onClick={apply} disabled={saving || !anySelected}>
            {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
            تطبيق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ====================== Add Product Dialog (نفس القديم) ====================== */
function AddProductDialog({ open, onClose, branches, cats, onSaved }: {
  open: boolean; onClose: () => void;
  branches: { id: string; name: string }[];
  cats: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const { user, profile, tenantId } = useAuth();
  const [defaultLowStock, setDefaultLowStock] = useState<number>(5);
  const [form, setForm] = useState({
    name: "", category_id: "", branch_ids: [] as string[],
    cost_price: "", selling_price: "", market_price: "",
    low_stock_alert: "5", quantity: "0", image: "",
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("settings").select("value").eq("key", "inventory").maybeSingle().then(({ data }) => {
      const v = Number((data?.value as any)?.default_low_stock_alert);
      if (Number.isFinite(v) && v >= 0) setDefaultLowStock(v);
    });
  }, []);
  useEffect(() => { if (!open) setForm({ name: "", category_id: "", branch_ids: [], cost_price: "", selling_price: "", market_price: "", low_stock_alert: String(defaultLowStock), quantity: "0", image: "" }); }, [open, defaultLowStock]);
  useEffect(() => { if (open) setForm((f) => ({ ...f, low_stock_alert: String(defaultLowStock) })); }, [open, defaultLowStock]);

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
    let sharedSku = "";
    for (let i = 0; i < 10; i++) {
      const { data: skuRes } = await supabase.rpc("next_sku");
      const candidate = skuRes as string;
      if (!candidate) continue;
      const { data: clash } = await supabase
        .from("products").select("id").eq("tenant_id", tenantId!).eq("sku", candidate).limit(1).maybeSingle();
      if (!clash) { sharedSku = candidate; break; }
    }
    if (!sharedSku) { setSaving(false); return toast.error("تعذّر توليد كود منتج فريد، حاول مرة أخرى"); }

    let ok = 0;
    for (const branchId of form.branch_ids) {
      const { data, error } = await supabase.from("products").insert({
        name: form.name, sku: sharedSku, category_id: form.category_id || null,
        cost_price: Number(form.cost_price) || 0, selling_price: Number(form.selling_price) || 0,
        market_price: Number(form.market_price) || 0, low_stock_alert: parseInt(form.low_stock_alert) || defaultLowStock,
        quantity: parseInt(form.quantity) || 0, image: form.image || null, branch_id: branchId,
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
