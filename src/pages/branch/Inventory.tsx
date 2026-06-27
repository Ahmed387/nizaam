import { useEffect, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP } from "@/lib/format";
import { searchMatch } from "@/lib/search";
import { toast } from "sonner";
import { Plus, Upload, Loader2, Activity, Barcode, FileSpreadsheet, ClipboardList, ClipboardCheck, HelpCircle, Tag, History, Edit3, Settings2, Hash, Type, Package, Pencil, X, Trash2, Archive, ArchiveRestore, AlertTriangle } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { uploadProductImage } from "@/lib/uploadImage";
import { ExcelImportDialog } from "@/components/ExcelImportDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import StockTransfers from "./StockTransfers";
import Sessions from "./inventory-count/Sessions";
import { HistoricalStockPanel } from "@/components/HistoricalStockPanel";
import { formatDateTime } from "@/lib/format";
import { PriceEditDialog } from "@/components/PriceEditDialog";
import { ProductPriceHistory } from "@/components/ProductPriceHistory";
import { Dialog as Dlg, DialogContent as DlgContent, DialogHeader as DlgHeader, DialogTitle as DlgTitle } from "@/components/ui/dialog";

export default function Inventory() {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = ["products", "transfers", "adjustments", "count"].includes(tabParam ?? "") ? tabParam! : "products";
  const { user, profile, tenantId, isAdmin, hasRole } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [defaultLowStock, setDefaultLowStock] = useState<number>(5);
  const [form, setForm] = useState({
    name: "", category_id: "", cost_price: "", selling_price: "", market_price: "",
    low_stock_alert: "5", quantity: "0", image: "",
  });
  const [uploading, setUploading] = useState(false);
  const [historyFor, setHistoryFor] = useState<any>(null);
  const [editAll, setEditAll] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    name: "", sku: "", quantity: "0",
    cost_price: "", selling_price: "", market_price: "",
    qty_notes: "", price_reason: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete / Archive flow
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteRefs, setDeleteRefs] = useState<any>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const canManageInventory = isAdmin || hasRole("branch_manager") || hasRole("warehouse");
  const canHardDelete = isAdmin;

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadProductImage(file, branchId!);
      setForm((f) => ({ ...f, image: url }));
      toast.success("تم رفع الصورة");
    } catch (e: any) {
      toast.error(e.message ?? "فشل رفع الصورة");
    } finally {
      setUploading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("products").select("*, categories(name)").eq("branch_id", branchId).order("created_at", { ascending: false });
    setRows(data ?? []); setLoading(false);
  };
  useEffect(() => {
    load();
    supabase.from("categories").select("*").then(({ data }) => setCats(data ?? []));
    supabase.from("settings").select("value").eq("key", "inventory").maybeSingle().then(({ data }) => {
      const v = Number((data?.value as any)?.default_low_stock_alert);
      if (Number.isFinite(v) && v >= 0) {
        setDefaultLowStock(v);
        setForm((f) => ({ ...f, low_stock_alert: String(v) }));
      }
    });
  }, [branchId]);
  useRealtimeRefresh(["products", "categories", "stock_adjustments", "product_batches"], load);

  const openEditAll = (r: any) => {
    setEditAll(r);
    setEditForm({
      name: String(r.name ?? ""),
      sku: String(r.sku ?? ""),
      quantity: String(r.quantity ?? 0),
      cost_price: String(r.cost_price ?? ""),
      selling_price: String(r.selling_price ?? ""),
      market_price: String(r.market_price ?? ""),
      qty_notes: "",
      price_reason: "",
    });
  };

  const saveEditAll = async () => {
    if (!editAll) return;
    const name = editForm.name.trim();
    const sku = editForm.sku.trim();
    if (!name) return toast.error("اسم المنتج مطلوب");
    if (!sku) return toast.error("كود الصنف مطلوب");

    const newQty = Number(editForm.quantity);
    if (!Number.isFinite(newQty) || newQty < 0) return toast.error("الكمية غير صالحة");

    const nameChanged = name !== String(editAll.name ?? "");
    const skuChanged = sku !== String(editAll.sku ?? "");
    const qtyChanged = newQty !== Number(editAll.quantity);
    const costChanged = Number(editForm.cost_price) !== Number(editAll.cost_price ?? 0);
    const sellChanged = Number(editForm.selling_price) !== Number(editAll.selling_price ?? 0);
    const marketChanged = Number(editForm.market_price) !== Number(editAll.market_price ?? 0);
    const priceChanged = costChanged || sellChanged || marketChanged;

    if (!nameChanged && !skuChanged && !qtyChanged && !priceChanged) {
      setEditAll(null);
      return;
    }
    if (priceChanged && editForm.price_reason.trim().length < 10) {
      return toast.error("يجب إدخال سبب تعديل السعر (10 أحرف على الأقل)");
    }

    setSavingEdit(true);

    // 1) Name / SKU
    if (nameChanged || skuChanged) {
      const patch: any = {};
      if (nameChanged) patch.name = name;
      if (skuChanged) patch.sku = sku;
      const { error } = await supabase.from("products").update(patch).eq("id", editAll.id);
      if (error) {
        setSavingEdit(false);
        if (String(error.message).toLowerCase().includes("duplicate") || (error as any).code === "23505") {
          return toast.error("كود الصنف مستخدم بالفعل، اختر كود مختلف");
        }
        return toast.error(error.message);
      }
      await logAudit({
        userId: user!.id, userName: profile!.name, branchId,
        action: "UPDATE", entity: "Product", entityId: editAll.id,
        details: { name_old: editAll.name, name_new: nameChanged ? name : undefined, sku_old: editAll.sku, sku_new: skuChanged ? sku : undefined },
      });
    }

    // 2) Prices
    if (priceChanged) {
      const { error } = await supabase.rpc("update_product_price_with_reason" as any, {
        _product_id: editAll.id,
        _selling_price: editForm.selling_price === "" ? null : Number(editForm.selling_price),
        _cost_price: editForm.cost_price === "" ? null : Number(editForm.cost_price),
        _market_price: editForm.market_price === "" ? null : Number(editForm.market_price),
        _reason: editForm.price_reason.trim(),
      });
      if (error) { setSavingEdit(false); return toast.error(error.message); }
    }

    // 3) Quantity (last — triggers stock adjustment)
    if (qtyChanged) {
      const { error } = await supabase.rpc("admin_set_product_quantity", {
        p_product_id: editAll.id,
        p_actual_quantity: newQty,
        p_reason: "manual_edit",
        p_notes: editForm.qty_notes || null,
      });
      if (error) { setSavingEdit(false); return toast.error(error.message); }
      await logAudit({
        userId: user!.id, userName: profile!.name, branchId,
        action: "UPDATE", entity: "Product", entityId: editAll.id,
        details: { name: editAll.name, old_qty: editAll.quantity, new_qty: newQty, reason: "manual_edit" },
      });
    }

    setSavingEdit(false);
    toast.success("تم حفظ تعديلات المنتج");
    setEditAll(null);
    load();
  };


  const openDelete = async (r: any) => {
    setDeleteTarget(r);
    setDeleteRefs(null);
    setDeleteConfirmName("");
    const { data, error } = await supabase.rpc("get_product_references_count" as any, { _product_id: r.id });
    if (error) { toast.error(error.message); setDeleteTarget(null); return; }
    setDeleteRefs(data);
  };

  const doArchive = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    const { error } = await supabase.rpc("archive_product" as any, { _product_id: deleteTarget.id });
    setDeleteBusy(false);
    if (error) return toast.error(error.message);
    await logAudit({ userId: user!.id, userName: profile!.name, branchId, action: "UPDATE", entity: "Product", entityId: deleteTarget.id, details: { action: "archive", name: deleteTarget.name } });
    toast.success("تم أرشفة المنتج. الفواتير القديمة سليمة 100%.");
    setDeleteTarget(null); setEditAll(null); load();
  };

  const doRestore = async (r: any) => {
    const { error } = await supabase.rpc("restore_product" as any, { _product_id: r.id });
    if (error) return toast.error(error.message);
    await logAudit({ userId: user!.id, userName: profile!.name, branchId, action: "UPDATE", entity: "Product", entityId: r.id, details: { action: "restore", name: r.name } });
    toast.success("تم استرجاع المنتج");
    load();
  };

  const doHardDelete = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmName.trim() !== deleteTarget.name.trim()) return toast.error("اكتب اسم المنتج بالظبط للتأكيد");
    setDeleteBusy(true);
    const { error } = await supabase.rpc("safe_delete_product" as any, { _product_id: deleteTarget.id });
    setDeleteBusy(false);
    if (error) return toast.error(error.message);
    await logAudit({ userId: user!.id, userName: profile!.name, branchId, action: "DELETE", entity: "Product", entityId: deleteTarget.id, details: { name: deleteTarget.name, sku: deleteTarget.sku } });
    toast.success("تم حذف المنتج نهائياً");
    setDeleteTarget(null); setEditAll(null); load();
  };

  const filtered = rows.filter((p) => {
    const isArchived = !!p.archived_at;
    if (showArchived ? !isArchived : isArchived) return false;
    if (search && !searchMatch(search, p.name, p.sku, p.legacy_code)) return false;
    if (filter === "low" && !(p.quantity > 0 && p.quantity <= p.low_stock_alert)) return false;
    if (filter === "out" && p.quantity > 0) return false;
    if (filter === "ok" && p.quantity <= p.low_stock_alert) return false;
    return true;
  });

  const archivedCount = rows.filter((p) => p.archived_at).length;
  const activeRows = rows.filter((p) => !p.archived_at);

  // Counts per status (active products only)
  const statusCounts = {
    all: activeRows.length,
    ok: activeRows.filter((p) => p.quantity > p.low_stock_alert).length,
    low: activeRows.filter((p) => p.quantity > 0 && p.quantity <= p.low_stock_alert).length,
    out: activeRows.filter((p) => p.quantity <= 0).length,
  };

  const submit = async () => {
    if (!form.name) return toast.error("اسم المنتج مطلوب");
    // ولّد SKU فريد داخل الشركة
    let sku = "";
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
      if (!clash) { sku = candidate; break; }
    }
    if (!sku) return toast.error("تعذّر توليد كود منتج فريد");

    const qty = parseInt(form.quantity) || 0;
    const cost = Number(form.cost_price) || 0;
    const { data, error } = await supabase.rpc("create_product_with_opening_stock", {
      p_product: {
        name: form.name,
        sku,
        branch_id: branchId!,
        category_id: form.category_id || null,
        cost_price: cost,
        selling_price: Number(form.selling_price) || 0,
        market_price: Number(form.market_price) || 0,
        low_stock_alert: parseInt(form.low_stock_alert) || defaultLowStock,
        quantity: qty,
        image: form.image || null,
      },
    });
    if (error) return toast.error(error.message);
    const newId = (data as any)?.product_id;
    await logAudit({ userId: user!.id, userName: profile!.name, branchId, action: "CREATE", entity: "Product", entityId: newId, details: { name: form.name } });
    if (qty > 0 && cost <= 0) {
      toast.warning("تنبيه: تم إنشاء دفعة افتتاحية بدون سعر تكلفة. تتبع FIFO سيكون غير دقيق حتى أول شحنة شراء.");
    }
    toast.success("تمت إضافة المنتج");

    setOpen(false);
    setForm({ name: "", category_id: "", cost_price: "", selling_price: "", market_price: "", low_stock_alert: String(defaultLowStock), quantity: "0", image: "" });
    load();
  };

  return (
    <BranchLayout>
      <PageHeader title="المخزون" subtitle={`${rows.length} منتج`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setImportOpen(true)}><FileSpreadsheet className="w-4 h-4 ml-1" /> استيراد Excel</Button>
            {canManageInventory && (
              <>
                <Button variant="outline" onClick={() => nav(`/branch/${branchId}/inventory/barcodes`)}>
                  <Barcode className="w-4 h-4 ml-1" /> طباعة باركود
                </Button>
                <Button variant="outline" onClick={() => nav(`/branch/${branchId}/inventory/barcodes?all=1`)}>
                  <Barcode className="w-4 h-4 ml-1" /> طباعة باركود الكل
                </Button>
              </>
            )}
            <Button className="btn-gradient" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" /> منتج جديد</Button>
          </div>
        }
      />

      <Tabs value={initialTab} onValueChange={(v) => setSearchParams(v === "products" ? {} : { tab: v })}>
        <TabsList className="flex flex-wrap gap-1 h-auto p-1.5">
          <TabsTrigger value="products" className="text-base font-bold px-4 py-2">الأصناف المتاحة في المخزن</TabsTrigger>
          <TabsTrigger value="transfers" className="text-base font-bold px-4 py-2">نقل المخزون بين الفروع</TabsTrigger>
          <div className="inline-flex items-center">
            <TabsTrigger value="adjustments" className="text-base font-bold px-4 py-2 rounded-l-none">
              <ClipboardList className="w-5 h-5 ml-1.5" /> تسوية المخزن في الفرع
            </TabsTrigger>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="h-10 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-primary rounded-r-md border border-r-0 border-border bg-muted/30 hover:bg-muted/60 transition-colors"
                  aria-label="ما هي تسوية المخزن في الفرع؟"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent dir="rtl" className="w-[320px] text-right p-0 overflow-hidden" side="bottom" align="start" sideOffset={8}>
                <div className="bg-primary/10 border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-primary" />
                    <div className="text-sm font-bold text-foreground">تسوية المخزن في الفرع</div>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm text-foreground leading-relaxed">
                    حركة تصحيحية لتعديل كمية المنتج في النظام حتى تطابق الكمية الفعلية على أرض الواقع.
                  </p>
                  <div className="rounded-md bg-muted/50 border border-border p-3 text-xs leading-relaxed">
                    <div className="font-semibold text-foreground mb-1">مثال:</div>
                    <div className="text-muted-foreground">النظام يسجّل 100 قطعة، والفعلي 95 → تسوية تنقص 5 قطع لتصحيح الرصيد.</div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    تُستخدم بعد الجرد لمعالجة الفروقات (هالك، سرقة، خطأ إدخال...).
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="inline-flex items-center">
            <TabsTrigger value="count" className="text-base font-bold px-4 py-2 rounded-l-none">
              <ClipboardCheck className="w-5 h-5 ml-1.5" /> جرد الفرع
            </TabsTrigger>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="h-10 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-primary rounded-r-md border border-r-0 border-border bg-muted/30 hover:bg-muted/60 transition-colors"
                  aria-label="ما هو جرد الفرع؟"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent dir="rtl" className="w-[320px] text-right p-0 overflow-hidden" side="bottom" align="start" sideOffset={8}>
                <div className="bg-primary/10 border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-primary" />
                    <div className="text-sm font-bold text-foreground">جرد الفرع</div>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm text-foreground leading-relaxed">
                    عملية عدّ فعلي للبضاعة في المخزن ومقارنتها بأرصدة النظام لاكتشاف أي فروقات.
                  </p>
                  <div className="rounded-md bg-muted/50 border border-border p-3 text-xs leading-relaxed">
                    <div className="font-semibold text-foreground mb-1">مثال:</div>
                    <div className="text-muted-foreground">أمين المخزن يعد 95 قطعة، والنظام يسجّل 100 → فرق -5 يُراجع ثم تُسوّى.</div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    يمكنك أيضاً عرض الرصيد التاريخي لأي منتج ومقارنته بالواقع.
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </TabsList>

        <TabsContent value="products" className="mt-4">
          <div className="flex gap-3 mb-4 flex-wrap items-center">
            <Input placeholder="ابحث بالاسم أو الكود" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات ({statusCounts.all})</SelectItem>
                <SelectItem value="ok">🟢 متوفر ({statusCounts.ok})</SelectItem>
                <SelectItem value="low">🟡 منخفض ({statusCounts.low})</SelectItem>
                <SelectItem value="out">🔴 نفد ({statusCounts.out})</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">عرض {filtered.length} من {rows.length}</span>
          </div>

          {/* Desktop table — compact, no horizontal scroll */}
          <div className="hidden lg:block card-elevated overflow-hidden">
            {loading ? (
              <div className="p-12 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">لا توجد منتجات</div>
            ) : (
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-[44%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[22%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead>
                  <tr className="bg-surface-2 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 text-right font-semibold">المنتج</th>
                    <th className="px-3 py-3 text-right font-semibold">التصنيف</th>
                    <th className="px-3 py-3 text-center font-semibold">الكمية</th>
                    <th className="px-3 py-3 text-right font-semibold">الأسعار (شراء / بيع / سوق)</th>
                    <th className="px-3 py-3 text-center font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r: any, i: number) => {
                    const status =
                      r.quantity === 0
                        ? { cls: "bg-destructive/15 text-destructive", label: "🔴 نفد" }
                        : r.quantity <= r.low_stock_alert
                        ? { cls: "bg-warning/15 text-warning", label: "🟡 منخفض" }
                        : { cls: "bg-success/15 text-success", label: "🟢 متوفر" };
                    return (
                      <tr
                        key={r.id}
                        className={`border-b border-border last:border-0 hover:bg-muted/40 ${i % 2 ? "bg-surface/20" : "bg-card"}`}
                        onDoubleClick={() => nav(`/branch/${branchId}/inventory/${r.id}/movements`)}
                      >
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-3 min-w-0">
                            {r.image ? (
                              <img src={r.image} alt={r.name} className="w-11 h-11 rounded object-cover shrink-0" />
                            ) : (
                              <div className="w-11 h-11 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground shrink-0">—</div>
                            )}
                            <div className="min-w-0">
                              <div className="font-semibold truncate" title={r.name}>{r.name}</div>
                              <div className="font-mono text-[11px] text-muted-foreground flex items-center gap-1.5">
                                <span>{r.sku}</span>
                                {r.legacy_code && (
                                  <span className="px-1 py-0.5 rounded bg-muted/60 text-[10px]" title="رمز الصنف في النظام القديم">قديم: {r.legacy_code}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle text-muted-foreground truncate" title={r.categories?.name ?? ""}>
                          {r.categories?.name ?? "—"}
                        </td>
                        <td className="px-3 py-3 align-middle text-center">
                          <div className="font-bold">{r.quantity}</div>
                          <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] ${status.cls}`}>{status.label}</span>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                            <span className="text-muted-foreground">شراء: <span className="text-foreground">{formatEGP(r.cost_price)}</span></span>
                            <span className="text-muted-foreground">بيع: <span className="text-success font-medium">{formatEGP(r.selling_price)}</span></span>
                            <span className="text-muted-foreground">سوق: <span className="text-primary">{formatEGP(r.market_price)}</span></span>
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          {canManageInventory && (
                            <div className="flex items-center justify-center gap-1" onDoubleClick={(e) => e.stopPropagation()}>
                              <Button size="icon" variant="outline" className="h-8 w-8" title="تعديل بيانات المنتج" onClick={() => openEditAll(r)}>
                                <Pencil className="w-4 h-4" />
                              </Button>

                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setHistoryFor(r)} title="تاريخ الأسعار">
                                <History className="w-4 h-4" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => nav(`/branch/${branchId}/inventory/${r.id}/movements`)} title="حركة المنتج">
                                <Activity className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Mobile / tablet — card list */}
          <div className="lg:hidden space-y-2">
            {loading ? (
              <div className="card-elevated p-12 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : filtered.length === 0 ? (
              <div className="card-elevated p-12 text-center text-muted-foreground">لا توجد منتجات</div>
            ) : (
              filtered.map((r: any) => {
                const status =
                  r.quantity === 0
                    ? { cls: "bg-destructive/15 text-destructive", label: "🔴 نفد" }
                    : r.quantity <= r.low_stock_alert
                    ? { cls: "bg-warning/15 text-warning", label: "🟡 منخفض" }
                    : { cls: "bg-success/15 text-success", label: "🟢 متوفر" };
                  return (
                    <div
                      key={r.id}
                      className="card-elevated p-3 flex gap-3"
                      onDoubleClick={() => nav(`/branch/${branchId}/inventory/${r.id}/movements`)}
                    >
                      {r.image ? (
                        <img src={r.image} alt={r.name} className="w-14 h-14 rounded object-cover shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground shrink-0">—</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{r.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {r.sku} {r.categories?.name ? `· ${r.categories.name}` : ""}
                              {r.legacy_code && <span className="mr-1 px-1 py-0.5 rounded bg-muted/60">قديم: {r.legacy_code}</span>}
                            </div>
                          </div>
                          <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] ${status.cls}`}>{status.label}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          <span>الكمية: <span className="font-bold">{r.quantity}</span></span>
                          <span className="text-muted-foreground">شراء: {formatEGP(r.cost_price)}</span>
                          <span className="text-success">بيع: {formatEGP(r.selling_price)}</span>
                          <span className="text-primary">سوق: {formatEGP(r.market_price)}</span>
                        </div>
                        {canManageInventory && (
                          <div className="mt-2 flex gap-1 flex-wrap" onDoubleClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="outline" className="h-8" onClick={() => openEditAll(r)}>
                              <Pencil className="w-3.5 h-3.5 ml-1" /> تعديل
                            </Button>

                            <Button size="sm" variant="outline" className="h-8" onClick={() => setHistoryFor(r)}>
                              <History className="w-3.5 h-3.5 ml-1" /> تاريخ
                            </Button>
                            <Button size="sm" variant="outline" className="h-8" onClick={() => nav(`/branch/${branchId}/inventory/${r.id}/movements`)}>
                              <Activity className="w-3.5 h-3.5 ml-1" /> حركة
                            </Button>
                          </div>
                        )}

                      </div>
                    </div>
                  );
              })
            )}
          </div>

        </TabsContent>

        <TabsContent value="transfers" className="mt-4">
          <StockTransfers embedded />
        </TabsContent>

        <TabsContent value="adjustments" className="mt-4">
          <AdjustmentsList branchId={branchId!} />
        </TabsContent>

        <TabsContent value="count" className="mt-4">
          <HistoricalStockPanel branchId={branchId!} />
          <Sessions embedded />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={(o) => {
        if (!o) {
          const dirty = !!(form.name || form.cost_price || form.selling_price || form.market_price || form.image || (form.quantity && form.quantity !== "0") || form.category_id);
          if (dirty && !window.confirm("لديك بيانات منتج لم يتم حفظها. هل تريد الإغلاق وفقدانها؟")) return;
        }
        setOpen(o);
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>إضافة منتج جديد</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>صورة المنتج</Label>
              <div className="mt-1.5 flex items-center gap-3">
                {form.image && <img src={form.image} alt="" className="w-16 h-16 rounded object-cover border" />}
                <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-md border hover:bg-muted">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  <span className="text-sm">{form.image ? "تغيير الصورة" : "رفع صورة"}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
                </label>
                {form.image && <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, image: "" })}>إزالة</Button>}
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
            <div><Label>سعر الشراء</Label><Input type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} className="mt-1.5" /></div>
            <div><Label>سعر البيع</Label><Input type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} className="mt-1.5" /></div>
            <div><Label>سعر السوق</Label><Input type="number" value={form.market_price} onChange={(e) => setForm({ ...form, market_price: e.target.value })} className="mt-1.5" /></div>
            <div><Label>الكمية الأولية</Label><Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="mt-1.5" /></div>
            
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setForm({ name: "", category_id: "", cost_price: "", selling_price: "", market_price: "", low_stock_alert: String(defaultLowStock), quantity: "0", image: "" }); setOpen(false); }}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submit}>إضافة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExcelImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="استيراد منتجات من Excel"
        templateName="products-template"
        columns={[
          { key: "name", header: "اسم المنتج", required: true },
          { key: "category", header: "التصنيف" },
          { key: "cost_price", header: "سعر الشراء", type: "number" },
          { key: "selling_price", header: "سعر البيع", type: "number" },
          { key: "market_price", header: "سعر السوق", type: "number" },
          { key: "quantity", header: "الكمية", type: "number" },
          { key: "low_stock_alert", header: "حد التنبيه", type: "number" },
        ]}
        sampleRow={{ name: "منتج مثال", cost_price: 10, selling_price: 15, market_price: 18, quantity: 100, low_stock_alert: 5 }}
        onImport={async (rows) => {
          let inserted = 0;
          for (const r of rows) {
            const { data: skuRes } = await supabase.rpc("next_sku");
            const sku = (skuRes as string) ?? `P-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const cat = r.category ? cats.find((c: any) => c.name === r.category) : null;
            const { error } = await supabase.rpc("create_product_with_opening_stock", {
              p_product: {
                name: r.name, sku,
                branch_id: branchId!,
                category_id: cat?.id ?? null,
                cost_price: r.cost_price ?? 0,
                selling_price: r.selling_price ?? 0,
                market_price: r.market_price ?? 0,
                quantity: r.quantity ?? 0,
                low_stock_alert: r.low_stock_alert ?? 5,
              },
            });
            if (!error) inserted++;

          }
          load();
          return { inserted };
        }}
      />

      <Dlg open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DlgContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DlgHeader><DlgTitle>تاريخ أسعار: {historyFor?.name}</DlgTitle></DlgHeader>
          {historyFor && <ProductPriceHistory productId={historyFor.id} />}
        </DlgContent>
      </Dlg>

      {/* Unified Product Edit Form */}
      <Dialog open={!!editAll} onOpenChange={(o) => !o && !savingEdit && setEditAll(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0 [&>button]:hidden">
          {/* Custom header bar with red-hover close */}
          <div className="relative px-5 py-4 border-b bg-gradient-to-l from-primary/10 to-transparent rounded-t-lg">
            <DialogClose
              disabled={savingEdit}
              className="absolute top-3 left-3 h-9 w-9 inline-flex items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground hover:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive disabled:pointer-events-none disabled:opacity-50"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </DialogClose>
            <DialogHeader className="text-center space-y-2">
              <DialogTitle className="flex items-center justify-center gap-2 text-lg font-bold">
                <Pencil className="w-5 h-5 text-primary" />
                تعديل بيانات المنتج
              </DialogTitle>
              {editAll && (
                <div className="flex items-center justify-center gap-2 flex-wrap text-sm">
                  <span className="font-bold text-foreground">{editAll.name}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                    {editAll.sku}
                  </span>
                </div>
              )}
            </DialogHeader>
          </div>


          {editAll && (() => {
            const newQtyNum = Number(editForm.quantity);
            const diff = Number.isFinite(newQtyNum) ? newQtyNum - Number(editAll.quantity) : 0;
            const qtyChanged = diff !== 0;
            const costChanged = Number(editForm.cost_price) !== Number(editAll.cost_price ?? 0);
            const sellChanged = Number(editForm.selling_price) !== Number(editAll.selling_price ?? 0);
            const marketChanged = Number(editForm.market_price) !== Number(editAll.market_price ?? 0);
            const priceChanged = costChanged || sellChanged || marketChanged;
            return (
              <div className="px-5 py-4 space-y-5">
                {/* Section: Basic info */}
                <section className="rounded-lg border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b">
                    <Type className="w-4 h-4 text-primary" />
                    <span className="text-sm font-bold text-primary">البيانات الأساسية</span>
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs font-semibold mb-1.5 block">اسم المنتج <span className="text-destructive">*</span></Label>
                      <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="مثال: جوافة" />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold mb-1.5 block">كود الصنف (SKU) <span className="text-destructive">*</span></Label>
                      <Input value={editForm.sku} onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })} className="font-mono" placeholder="SKU-100029" />
                    </div>
                  </div>
                </section>

                {/* Section: Quantity */}
                <section className="rounded-lg border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b">
                    <Package className="w-4 h-4 text-primary" />
                    <span className="text-sm font-bold text-primary">الكمية في المخزن</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                      <div>
                        <Label className="text-xs font-semibold mb-1.5 block text-muted-foreground">الكمية الحالية</Label>
                        <Input value={editAll.quantity} disabled className="bg-muted/60 font-bold text-center" />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold mb-1.5 block">الكمية الجديدة</Label>
                        <Input type="number" min="0" value={editForm.quantity} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })} className="text-center font-bold" />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold mb-1.5 block text-muted-foreground">الفرق</Label>
                        <div className={`h-10 rounded-md border flex items-center justify-center font-bold text-sm ${qtyChanged ? (diff > 0 ? "bg-success/10 border-success/30 text-success" : "bg-destructive/10 border-destructive/30 text-destructive") : "bg-muted/30 text-muted-foreground"}`}>
                          {qtyChanged ? `${diff > 0 ? "+" : ""}${diff}` : "بدون تغيير"}
                        </div>
                      </div>
                    </div>
                    {qtyChanged && (
                      <>
                        <div>
                          <Label className="text-xs font-semibold mb-1.5 block">ملاحظات (اختياري)</Label>
                          <Textarea value={editForm.qty_notes} onChange={(e) => setEditForm({ ...editForm, qty_notes: e.target.value })} rows={2} placeholder="سبب تعديل الكمية…" />
                        </div>
                        <div className="text-[11px] text-warning bg-warning/10 border border-warning/30 rounded px-3 py-2 leading-relaxed">
                          ⚠️ هيتم تسجيل تسوية مخزون رسمية — FIFO عند النقص، دفعة جديدة عند الزيادة.
                        </div>
                      </>
                    )}
                  </div>
                </section>

                {/* Section: Prices */}
                <section className="rounded-lg border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b">
                    <Tag className="w-4 h-4 text-primary" />
                    <span className="text-sm font-bold text-primary">الأسعار</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs font-semibold mb-1.5 block">سعر الشراء</Label>
                        <Input type="number" step="0.01" value={editForm.cost_price} onChange={(e) => setEditForm({ ...editForm, cost_price: e.target.value })} className="text-center" />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold mb-1.5 block text-success">سعر البيع</Label>
                        <Input type="number" step="0.01" value={editForm.selling_price} onChange={(e) => setEditForm({ ...editForm, selling_price: e.target.value })} className="text-center" />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold mb-1.5 block">سعر السوق</Label>
                        <Input type="number" step="0.01" value={editForm.market_price} onChange={(e) => setEditForm({ ...editForm, market_price: e.target.value })} className="text-center" />
                      </div>
                    </div>
                    {priceChanged && (
                      <div>
                        <Label className="text-xs font-semibold mb-1.5 block">
                          سبب تعديل السعر <span className="text-destructive">*</span>
                          <span className="text-[10px] text-muted-foreground mr-1 font-normal">(10 أحرف على الأقل)</span>
                        </Label>
                        <Textarea value={editForm.price_reason} onChange={(e) => setEditForm({ ...editForm, price_reason: e.target.value })} rows={2} placeholder="مثال: تغيير من المورد، عرض موسمي…" />
                      </div>
                    )}
                  </div>
                </section>
              </div>
            );
          })()}

          <DialogFooter className="px-5 py-3 border-t bg-muted/30 rounded-b-lg gap-2">
            <Button variant="outline" onClick={() => setEditAll(null)} disabled={savingEdit}>إلغاء</Button>
            <Button className="btn-gradient min-w-[140px]" onClick={saveEditAll} disabled={savingEdit}>
              {savingEdit && <Loader2 className="w-4 h-4 animate-spin ml-1" />} حفظ التعديلات
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


    </BranchLayout>
  );
}

function AdjustmentsList({ branchId }: { branchId: string }) {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("stock_adjustments" as any).select("*").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
    setRows((data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);
  useRealtimeRefresh(["stock_adjustments"], load);
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button onClick={() => nav(`/branch/${branchId}/adjustments/new`)} className="gap-2">
          <Plus className="w-4 h-4" /> تسوية جديدة في الفرع
        </Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        empty="لا توجد تسويات"
        columns={[
          { key: "adjustment_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.adjustment_number}</span> },
          { key: "reason", header: "السبب" },
          { key: "notes", header: "ملاحظات", render: (r: any) => r.notes ?? "—" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ]}
      />
    </div>
  );
}
