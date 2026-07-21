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
import { normalizeForSearch, searchMatch } from "@/lib/search";
import { toast } from "sonner";
import { Plus, Upload, Loader2, Activity, Barcode, FileSpreadsheet, ClipboardList, ClipboardCheck, HelpCircle, Tag, History, Edit3, Settings2, Hash, Type, Package, Pencil, X, Trash2, Archive, ArchiveRestore, AlertTriangle } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { uploadProductImage } from "@/lib/uploadImage";
import { ExcelImportDialog } from "@/components/ExcelImportDialog";
import { ColorPicker, ColorChip } from "@/components/ColorPicker";
import { AttributePicker } from "@/components/AttributePicker";
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
    low_stock_alert: "5", quantity: "0", image: "", color: "",
    product_type: "", capacity: "", size: "",
  });
  const [uploading, setUploading] = useState(false);
  const [historyFor, setHistoryFor] = useState<any>(null);
  const [editAll, setEditAll] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    name: "", sku: "", quantity: "0",
    cost_price: "", selling_price: "", market_price: "",
    qty_notes: "", price_reason: "", image: "", color: "",
    product_type: "", capacity: "", size: "",
  });
  const [editUploading, setEditUploading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete / Archive flow
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteRefs, setDeleteRefs] = useState<any>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  // Reference detail drill-down
  const [refDetail, setRefDetail] = useState<{ type: string; title: string; rows: any[]; loading: boolean } | null>(null);

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
      image: String(r.image ?? ""),
      color: String(r.color ?? ""),
      product_type: String(r.product_type ?? ""),
      capacity: String(r.capacity ?? ""),
      size: String(r.size ?? ""),
    });
  };

  const uploadEditImage = async (file: File) => {
    setEditUploading(true);
    try {
      const url = await uploadProductImage(file, branchId!);
      setEditForm((f) => ({ ...f, image: url }));
      toast.success("تم رفع الصورة");
    } catch (e: any) {
      toast.error(e.message ?? "فشل رفع الصورة");
    } finally {
      setEditUploading(false);
    }
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
    const imageChanged = (editForm.image || "") !== (editAll.image || "");
    const colorChanged = (editForm.color || "") !== (editAll.color || "");

    if (!nameChanged && !skuChanged && !qtyChanged && !priceChanged && !imageChanged && !colorChanged) {
      setEditAll(null);
      return;
    }
    if (priceChanged && editForm.price_reason.trim().length < 10) {
      return toast.error("يجب إدخال سبب تعديل السعر (10 أحرف على الأقل)");
    }

    setSavingEdit(true);

    // 1) Name / SKU / Image / Color
    if (nameChanged || skuChanged || imageChanged || colorChanged) {
      const patch: any = {};
      if (nameChanged) patch.name = name;
      if (skuChanged) patch.sku = sku;
      if (imageChanged) patch.image = editForm.image || null;
      if (colorChanged) patch.color = editForm.color || null;
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

  const loadRefDetails = async (type: string, productId: string) => {
    setRefDetail({ type, title: "جاري التحميل...", rows: [], loading: true });
    let rows: any[] = [];
    let title = "";
    try {
      if (type === "batches") {
        title = "الدفعات ذات الرصيد";
        const { data, error } = await supabase
          .from("product_batches" as any)
          .select("*")
          .eq("product_id", productId)
          .gt("quantity_remaining", 0)
          .order("created_at", { ascending: false });
        if (error) throw error;
        const batchRows = data ?? [];
        const shipmentIds = Array.from(new Set(batchRows.map((r: any) => r.shipment_id).filter(Boolean)));
        if (shipmentIds.length) {
          const { data: shipments, error: shipmentsError } = await supabase
            .from("shipments" as any)
            .select("id, shipment_number")
            .in("id", shipmentIds);
          if (shipmentsError) throw shipmentsError;
          const shipmentById = new Map((shipments ?? []).map((s: any) => [s.id, s]));
          rows = batchRows.map((r: any) => ({ ...r, shipment: shipmentById.get(r.shipment_id) ?? null }));
        } else {
          rows = batchRows;
        }
      } else if (type === "adjustments") {
        title = "تسويات المخزون";
        const { data, error } = await supabase
          .from("stock_adjustment_items" as any)
          .select("*, adjustment:stock_adjustments(adjustment_number, reason, notes, created_at)")
          .eq("product_id", productId);
        if (error) throw error;
        rows = data ?? [];
      } else if (type === "sales") {
        title = "فواتير البيع";
        const { data, error } = await supabase
          .from("invoice_items" as any)
          .select("*, invoice:invoices(id, invoice_number, contact:contacts(name), invoice_date, total)")
          .eq("product_id", productId);
        if (error) throw error;
        rows = data ?? [];
      } else if (type === "purchases") {
        title = "فواتير الشراء";
        const { data, error } = await supabase
          .from("invoice_items" as any)
          .select("*, invoice:invoices(id, invoice_number, contact:contacts(name), invoice_date, total)")
          .eq("product_id", productId);
        if (error) throw error;
        rows = data ?? [];
      } else if (type === "shipments") {
        title = "الشحنات / التحويلات";
        const { data, error } = await supabase
          .from("shipment_items" as any)
          .select("*")
          .eq("product_id", productId);
        if (error) throw error;
        const itemRows = data ?? [];
        const shipmentIds = Array.from(new Set(itemRows.map((r: any) => r.shipment_id).filter(Boolean)));
        if (shipmentIds.length) {
          const { data: shipments, error: shipmentsError } = await supabase
            .from("shipments" as any)
            .select("id, shipment_number, branch_id, arrival_date, created_at")
            .in("id", shipmentIds);
          if (shipmentsError) throw shipmentsError;
          const branchIds = Array.from(new Set((shipments ?? []).map((s: any) => s.branch_id).filter(Boolean)));
          let branchById = new Map<string, any>();
          if (branchIds.length) {
            const { data: branches, error: branchesError } = await supabase
              .from("branches" as any)
              .select("id, name")
              .in("id", branchIds);
            if (branchesError) throw branchesError;
            branchById = new Map((branches ?? []).map((b: any) => [b.id, b]));
          }
          const shipmentById = new Map((shipments ?? []).map((s: any) => [s.id, { ...s, destination_branch: branchById.get(s.branch_id) ?? null }]));
          rows = itemRows.map((r: any) => ({ ...r, shipment: shipmentById.get(r.shipment_id) ?? null }));
        } else {
          rows = itemRows;
        }
      } else if (type === "sale_returns") {
        title = "مرتجعات البيع";
        const { data, error } = await supabase
          .from("return_items" as any)
          .select("*, return:returns(id, return_number, contact:contacts(name), created_at, total)")
          .eq("product_id", productId);
        if (error) throw error;
        rows = data ?? [];
      } else if (type === "purchase_returns") {
        title = "مرتجعات الشراء";
        const { data, error } = await supabase
          .from("purchase_return_items" as any)
          .select("*, return:purchase_returns(id, return_number, contact:contacts(name), created_at, total)")
          .eq("product_id", productId);
        if (error) throw error;
        rows = data ?? [];
      } else if (type === "count_sessions") {
        title = "جلسات الجرد";
        const { data, error } = await supabase
          .from("inventory_session_items" as any)
          .select("*, session:inventory_sessions(session_number, status, created_at)")
          .eq("product_id", productId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        rows = data ?? [];
      } else if (type === "quotes") {
        title = "عروض الأسعار";
        const { data, error } = await supabase
          .from("quote_items" as any)
          .select("*, quote:quotes(id, quote_number, contact:contacts(name), created_at, total)")
          .eq("product_id", productId);
        if (error) throw error;
        rows = data ?? [];
      } else if (type === "reservations") {
        title = "الحجوزات النشطة";
        const { data, error } = await supabase
          .from("inventory_reservations" as any)
          .select("*, contact:contacts(name)")
          .eq("product_id", productId)
          .eq("status", "active")
          .order("created_at", { ascending: false });
        if (error) throw error;
        rows = data ?? [];
      }
      setRefDetail({ type, title, rows, loading: false });
    } catch (e: any) {
      toast.error(e.message ?? "فشل تحميل التفاصيل");
      setRefDetail(null);
    }
  };

  const doHardDelete = async () => {
    if (!deleteTarget) return;
    const normalizedConfirmName = normalizeForSearch(
      String(deleteConfirmName ?? "")
        .normalize("NFKC")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    const normalizedProductName = normalizeForSearch(
      String(deleteTarget.name ?? "")
        .normalize("NFKC")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (normalizedConfirmName !== normalizedProductName) {
      setDeleteConfirmName(deleteTarget.name ?? "");
      return toast.error("تم تجهيز اسم المنتج للتأكيد، اضغط حذف نهائي مرة أخرى");
    }
    setDeleteBusy(true);
    const { error } = await supabase.rpc("safe_delete_product" as any, { _product_id: deleteTarget.id });
    setDeleteBusy(false);
    if (error) {
      console.error("Hard delete product failed", { code: (error as any).code, message: error.message, details: (error as any).details, hint: (error as any).hint });
      return toast.error(error.message || "فشل الحذف النهائي، راجع سبب المنع في العمليات المرتبطة");
    }
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
        color: form.color || null,
      },
    });
    if (error) return toast.error(error.message);
    const newId = (data as any)?.product_id;
    if (newId && form.color) {
      await supabase.from("products").update({ color: form.color } as any).eq("id", newId);
    }
    await logAudit({ userId: user!.id, userName: profile!.name, branchId, action: "CREATE", entity: "Product", entityId: newId, details: { name: form.name } });
    if (qty > 0 && cost <= 0) {
      toast.warning("تنبيه: تم إنشاء دفعة افتتاحية بدون سعر تكلفة. تتبع FIFO سيكون غير دقيق حتى أول شحنة شراء.");
    }
    toast.success("تمت إضافة المنتج");

    setOpen(false);
    setForm({ name: "", category_id: "", cost_price: "", selling_price: "", market_price: "", low_stock_alert: String(defaultLowStock), quantity: "0", image: "", color: "" });
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
            <Button
              variant={showArchived ? "default" : "outline"}
              size="sm"
              onClick={() => setShowArchived((v) => !v)}
              className="gap-1.5"
              title="عرض المنتجات المؤرشفة"
            >
              <Archive className="w-4 h-4" />
              {showArchived ? "عرض النشطة" : `المؤرشفة (${archivedCount})`}
            </Button>
            <span className="text-xs text-muted-foreground">عرض {filtered.length} من {showArchived ? archivedCount : activeRows.length}</span>
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
                          <div className="flex flex-col gap-1">
                            <span>{r.categories?.name ?? "—"}</span>
                            {r.color && <ColorChip name={r.color} />}
                          </div>
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
                              {r.archived_at ? (
                                <Button size="sm" variant="outline" className="h-8 gap-1 text-success border-success/40 hover:bg-success/10" onClick={() => doRestore(r)} title="استرجاع المنتج">
                                  <ArchiveRestore className="w-4 h-4" /> استرجاع
                                </Button>
                              ) : (
                                <>
                                  <Button size="icon" variant="outline" className="h-8 w-8" title="تعديل بيانات المنتج" onClick={() => openEditAll(r)}>
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setHistoryFor(r)} title="تاريخ الأسعار">
                                    <History className="w-4 h-4" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => nav(`/branch/${branchId}/inventory/${r.id}/movements`)} title="حركة المنتج">
                                    <Activity className="w-4 h-4" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => openDelete(r)} title="حذف / أرشفة المنتج">
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
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
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs items-center">
                          <span>الكمية: <span className="font-bold">{r.quantity}</span></span>
                          <span className="text-muted-foreground">شراء: {formatEGP(r.cost_price)}</span>
                          <span className="text-success">بيع: {formatEGP(r.selling_price)}</span>
                          <span className="text-primary">سوق: {formatEGP(r.market_price)}</span>
                          {r.color && <ColorChip name={r.color} />}
                        </div>
                        {canManageInventory && (
                          <div className="mt-2 flex gap-1 flex-wrap" onDoubleClick={(e) => e.stopPropagation()}>
                            {r.archived_at ? (
                              <Button size="sm" variant="outline" className="h-8 text-success border-success/40" onClick={() => doRestore(r)}>
                                <ArchiveRestore className="w-3.5 h-3.5 ml-1" /> استرجاع
                              </Button>
                            ) : (
                              <>
                                <Button size="sm" variant="outline" className="h-8" onClick={() => openEditAll(r)}>
                                  <Pencil className="w-3.5 h-3.5 ml-1" /> تعديل
                                </Button>
                                <Button size="sm" variant="outline" className="h-8" onClick={() => setHistoryFor(r)}>
                                  <History className="w-3.5 h-3.5 ml-1" /> تاريخ
                                </Button>
                                <Button size="sm" variant="outline" className="h-8" onClick={() => nav(`/branch/${branchId}/inventory/${r.id}/movements`)}>
                                  <Activity className="w-3.5 h-3.5 ml-1" /> حركة
                                </Button>
                                <Button size="sm" variant="outline" className="h-8 text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => openDelete(r)}>
                                  <Trash2 className="w-3.5 h-3.5 ml-1" /> حذف
                                </Button>
                              </>
                            )}
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
            <div><Label>اللون</Label><div className="mt-1.5"><ColorPicker value={form.color} onChange={(v) => setForm({ ...form, color: v ?? "" })} /></div></div>
            
            
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setForm({ name: "", category_id: "", cost_price: "", selling_price: "", market_price: "", low_stock_alert: String(defaultLowStock), quantity: "0", image: "", color: "" }); setOpen(false); }}>إلغاء</Button>
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
                  <div className="px-4 pb-4">
                    <Label className="text-xs font-semibold mb-1.5 block">صورة المنتج</Label>
                    <div className="flex items-center gap-3 flex-wrap">
                      {editForm.image ? (
                        <img src={editForm.image} alt="" className="w-20 h-20 rounded-md object-cover border" />
                      ) : (
                        <div className="w-20 h-20 rounded-md border border-dashed flex items-center justify-center text-muted-foreground text-[10px] text-center px-1">لا توجد صورة</div>
                      )}
                      <label className={`inline-flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer hover:bg-muted ${editUploading ? "opacity-60 pointer-events-none" : ""}`}>
                        {editUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        <span className="text-sm">{editForm.image ? "تغيير الصورة" : "رفع صورة"}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadEditImage(e.target.files[0])} />
                      </label>
                      {editForm.image && (
                        <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setEditForm({ ...editForm, image: "" })}>
                          <Trash2 className="w-4 h-4 ml-1" /> حذف الصورة
                        </Button>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">يتم ضغط الصورة تلقائيًا (بحد أقصى 1200px، جودة 85%).</p>
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
                    <div>
                      <Label className="text-xs font-semibold mb-1.5 block">اللون</Label>
                      <ColorPicker value={editForm.color} onChange={(v) => setEditForm({ ...editForm, color: v ?? "" })} />
                    </div>
                  </div>
                </section>
              </div>
            );
          })()}

          <DialogFooter className="px-5 py-3 border-t bg-muted/30 rounded-b-lg gap-2 sm:justify-between">
            <Button variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive gap-1.5" onClick={() => editAll && openDelete(editAll)} disabled={savingEdit}>
              <Trash2 className="w-4 h-4" /> حذف / أرشفة
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditAll(null)} disabled={savingEdit}>إلغاء</Button>
              <Button className="btn-gradient min-w-[140px]" onClick={saveEditAll} disabled={savingEdit}>
                {savingEdit && <Loader2 className="w-4 h-4 animate-spin ml-1" />} حفظ التعديلات
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete / Archive Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleteBusy) { setDeleteTarget(null); setDeleteRefs(null); setDeleteConfirmName(""); } }}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden [&>button]:hidden">
          {(() => {
            const activeReservations = Number(deleteRefs?.active_reservations ?? deleteRefs?.reservations ?? 0);
            const remainingBatches = Number(deleteRefs?.remaining_batches ?? deleteRefs?.batches ?? 0);
            const hasActiveReservations = activeReservations > 0;
            const hasInternalSetupOnly = !deleteRefs?.has_any && !!deleteRefs?.has_internal_setup_only;
            const cleanConfirmName = String(deleteConfirmName ?? "").normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
            const cleanTargetName = String(deleteTarget?.name ?? "").normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
            const deleteNameConfirmed = !!deleteTarget && normalizeForSearch(cleanConfirmName) === normalizeForSearch(cleanTargetName);

            return (
              <>
                <div className="relative px-5 py-4 border-b bg-destructive/10">
                  <DialogClose
                    disabled={deleteBusy}
                    className="absolute top-3 left-3 h-9 w-9 inline-flex items-center justify-center rounded-md border border-destructive/20 bg-background/80 text-destructive shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground hover:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive disabled:pointer-events-none disabled:opacity-50"
                    aria-label="إغلاق"
                  >
                    <X className="w-5 h-5" />
                  </DialogClose>
                  <DialogHeader className="text-center space-y-2 pr-10 pl-10">
                    <DialogTitle className="flex items-center justify-center gap-2 text-destructive text-lg font-extrabold">
                      <AlertTriangle className="w-5 h-5" /> حذف / أرشفة المنتج
                    </DialogTitle>
                    {deleteTarget && (
                      <div className="flex items-center justify-center gap-2 flex-wrap text-sm">
                        <span className="font-extrabold text-foreground">{deleteTarget.name}</span>
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-background border text-muted-foreground">{deleteTarget.sku}</span>
                      </div>
                    )}
                  </DialogHeader>
                </div>

                <div className="px-5 py-4 space-y-3 bg-background">
                  {!deleteRefs ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      جاري فحص ارتباطات المنتج...
                    </div>
                  ) : deleteRefs.has_any ? (
                    <>
                      <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 space-y-3">
                        <div className="flex items-center gap-2 text-warning font-extrabold text-sm">
                          <AlertTriangle className="w-4 h-4 shrink-0" /> هذا المنتج مرتبط بسجلات حالية
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                          {deleteRefs.sales > 0 && <button type="button" onClick={() => loadRefDetails("sales", deleteTarget.id)} className="text-right rounded-md bg-background/70 border px-3 py-2 hover:bg-primary/5 hover:border-primary/30 transition-colors">{deleteRefs.sales} فاتورة بيع</button>}
                          {deleteRefs.purchases > 0 && <button type="button" onClick={() => loadRefDetails("purchases", deleteTarget.id)} className="text-right rounded-md bg-background/70 border px-3 py-2 hover:bg-primary/5 hover:border-primary/30 transition-colors">{deleteRefs.purchases} فاتورة شراء</button>}
                          {deleteRefs.sale_returns > 0 && <button type="button" onClick={() => loadRefDetails("sale_returns", deleteTarget.id)} className="text-right rounded-md bg-background/70 border px-3 py-2 hover:bg-primary/5 hover:border-primary/30 transition-colors">{deleteRefs.sale_returns} مرتجع بيع</button>}
                          {deleteRefs.purchase_returns > 0 && <button type="button" onClick={() => loadRefDetails("purchase_returns", deleteTarget.id)} className="text-right rounded-md bg-background/70 border px-3 py-2 hover:bg-primary/5 hover:border-primary/30 transition-colors">{deleteRefs.purchase_returns} مرتجع شراء</button>}
                          {deleteRefs.shipments > 0 && <button type="button" onClick={() => loadRefDetails("shipments", deleteTarget.id)} className="text-right rounded-md bg-background/70 border px-3 py-2 hover:bg-primary/5 hover:border-primary/30 transition-colors">{deleteRefs.shipments} شحنة / تحويل</button>}
                          {deleteRefs.adjustments > 0 && <button type="button" onClick={() => loadRefDetails("adjustments", deleteTarget.id)} className="text-right rounded-md bg-background/70 border px-3 py-2 hover:bg-primary/5 hover:border-primary/30 transition-colors">{deleteRefs.adjustments} تسوية مخزون</button>}
                          {deleteRefs.count_sessions > 0 && <button type="button" onClick={() => loadRefDetails("count_sessions", deleteTarget.id)} className="text-right rounded-md bg-background/70 border px-3 py-2 hover:bg-primary/5 hover:border-primary/30 transition-colors">{deleteRefs.count_sessions} جلسة جرد</button>}
                          {deleteRefs.quotes > 0 && <button type="button" onClick={() => loadRefDetails("quotes", deleteTarget.id)} className="text-right rounded-md bg-background/70 border px-3 py-2 hover:bg-primary/5 hover:border-primary/30 transition-colors">{deleteRefs.quotes} عرض سعر</button>}
                          {activeReservations > 0 && <button type="button" onClick={() => loadRefDetails("reservations", deleteTarget.id)} className="text-right rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-destructive font-bold hover:bg-destructive/20 transition-colors">{activeReservations} حجز نشط</button>}
                          {remainingBatches > 0 && <button type="button" onClick={() => loadRefDetails("batches", deleteTarget.id)} className="text-right rounded-md bg-background/70 border px-3 py-2 hover:bg-primary/5 hover:border-primary/30 transition-colors">{remainingBatches} دفعة لها رصيد</button>}
                        </div>
                      </div>

                      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm leading-relaxed text-foreground">
                        <span className="font-extrabold text-destructive">الحذف النهائي ممنوع</span> للحفاظ على سلامة السجلات المحاسبية والفواتير والتقارير التاريخية.
                      </div>

                      <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm leading-relaxed text-foreground">
                        <span className="font-extrabold text-success">الحل الآمن: أرشفة المنتج</span> — هيختفي من المخزون ومن شاشة البيع (الشاشة اللي الكاشير بيعمل منها فواتير البيع للعملاء)، والفواتير القديمة هتفضل سليمة ويمكن استرجاعه من تبويب المؤرشفة.
                      </div>

                      {hasActiveReservations && (
                        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive font-semibold">
                          يوجد حجوزات نشطة — قم بإلغائها أولاً قبل الأرشفة.
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm leading-relaxed text-foreground">
                        <span className="font-extrabold text-success">المنتج آمن للحذف</span> — لا توجد عليه فواتير أو حركات مسجلة.
                      </div>
                      {hasInternalSetupOnly && (
                        <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm leading-relaxed text-foreground">
                          يوجد رصيد/تسوية داخلية فقط للمنتج. ده لا يُعتبر فاتورة بيع أو شراء أو شحنة، والحذف النهائي مسموح وهيحذف السجلات الداخلية مع المنتج.
                        </div>
                      )}
                      {!canHardDelete && (
                        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
                          الحذف النهائي متاح لصاحب الشركة فقط. تقدر تأرشف المنتج بدلاً منه.
                        </div>
                      )}
                      {canHardDelete && deleteTarget && (
                        <div className="rounded-lg border bg-muted/30 p-4">
                          <Label className="text-xs font-semibold mb-2 block">
                            اكتب اسم المنتج <span className="font-bold text-foreground">"{deleteTarget.name}"</span> للتأكيد
                          </Label>
                          <div className="flex gap-2">
                            <Input value={deleteConfirmName} onChange={(e) => setDeleteConfirmName(e.target.value)} placeholder={deleteTarget.name} />
                            <Button type="button" variant="outline" onClick={() => setDeleteConfirmName(deleteTarget.name)} disabled={deleteBusy}>
                              تأكيد الاسم
                            </Button>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">لو الاسم اتكتب بشكل مختلف، اضغط حذف نهائي مرة واحدة وهيجهّز الاسم، واضغطه مرة تانية للتأكيد.</p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <DialogFooter className="px-5 py-3 border-t bg-muted/30 gap-2 sm:justify-between">
                  <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>إلغاء</Button>
                  {deleteRefs?.has_any ? (
                    <Button
                      className="bg-warning hover:bg-warning/90 text-warning-foreground gap-1.5 min-w-[140px]"
                      disabled={deleteBusy || hasActiveReservations}
                      onClick={doArchive}
                    >
                      {deleteBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                      أرشفة المنتج
                    </Button>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" className="gap-1.5" disabled={deleteBusy} onClick={doArchive}>
                        <Archive className="w-4 h-4" /> أرشفة بدلاً من الحذف
                      </Button>
                      {canHardDelete && (
                        <Button
                          variant="destructive"
                          className="gap-1.5 min-w-[120px]"
                          disabled={deleteBusy}
                          onClick={doHardDelete}
                        >
                          {deleteBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          حذف نهائي
                        </Button>
                      )}
                    </div>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Reference detail drill-down dialog */}
      <Dialog open={!!refDetail} onOpenChange={(o) => !o && setRefDetail(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto p-0 gap-0 [&>button]:hidden">
          <div className="relative px-5 py-4 border-b bg-primary/5">
            <DialogClose
              className="absolute top-3 left-3 h-9 w-9 inline-flex items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground hover:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </DialogClose>
            <DialogHeader className="text-center space-y-1 pr-10 pl-10">
              <DialogTitle className="text-lg font-bold text-primary">{refDetail?.title}</DialogTitle>
              <div className="text-sm text-muted-foreground">
                {deleteTarget?.name} <span className="font-mono text-xs">{deleteTarget?.sku}</span>
              </div>
            </DialogHeader>
          </div>
          <div className="px-5 py-4 bg-background">
            {refDetail?.loading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                جاري تحميل التفاصيل...
              </div>
            ) : (
              <DataTable
                loading={refDetail?.loading ?? false}
                rows={refDetail?.rows ?? []}
                empty="لا توجد تفاصيل"
                columns={(() => {
                  const type = refDetail?.type;
                  if (type === "batches") {
                    return [
                      { key: "created_at", header: "تاريخ الدفعة", render: (r: any) => formatDateTime(r.created_at) },
                      { key: "quantity_purchased", header: "الكمية الأصلية", render: (r: any) => Number(r.quantity_purchased).toLocaleString() },
                      { key: "quantity_remaining", header: "المتبقي (الرصيد)", render: (r: any) => <span className="font-bold text-success">{Number(r.quantity_remaining).toLocaleString()}</span> },
                      { key: "cost_price", header: "تكلفة الوحدة", render: (r: any) => formatEGP(Number(r.cost_price)) },
                      { key: "batch_type", header: "نوع الدفعة", render: (r: any) => r.batch_type === "transfer" ? "تحويل" : r.batch_type === "purchase" ? "شراء" : r.batch_type },
                    ];
                  }
                  if (type === "adjustments") {
                    return [
                      { key: "adjustment.adjustment_number", header: "رقم التسوية", render: (r: any) => <span className="font-mono text-primary">{r.adjustment?.adjustment_number}</span> },
                      { key: "adjustment.reason", header: "السبب", render: (r: any) => r.adjustment?.reason },
                      { key: "system_quantity", header: "الكمية في النظام", render: (r: any) => Number(r.system_quantity).toLocaleString() },
                      { key: "actual_quantity", header: "الكمية الفعلية", render: (r: any) => Number(r.actual_quantity).toLocaleString() },
                      { key: "difference", header: "الفرق", render: (r: any) => <span className={r.difference > 0 ? "text-success" : r.difference < 0 ? "text-destructive" : ""}>{r.difference > 0 ? "+" : ""}{Number(r.difference).toLocaleString()}</span> },
                      { key: "adjustment.created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.adjustment?.created_at) },
                    ];
                  }
                  if (type === "sales" || type === "purchases") {
                    return [
                      { key: "invoice.invoice_number", header: "رقم الفاتورة", render: (r: any) => r.invoice?.id ? (
                        <a href={`/branch/${branchId}/sales/${r.invoice.id}`} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline hover:opacity-80">{r.invoice?.invoice_number}</a>
                      ) : <span className="font-mono text-primary">{r.invoice?.invoice_number}</span> },
                      { key: "invoice.contact.name", header: "الطرف", render: (r: any) => r.invoice?.contact?.name ?? "—" },
                      { key: "quantity", header: "الكمية", render: (r: any) => Number(r.quantity).toLocaleString() },
                      { key: "unit_price", header: "سعر الوحدة", render: (r: any) => formatEGP(Number(r.unit_price)) },
                      { key: "invoice.invoice_date", header: "تاريخ الفاتورة", render: (r: any) => r.invoice?.invoice_date ? new Date(r.invoice.invoice_date).toLocaleDateString("ar-EG") : "—" },
                      { key: "invoice.total", header: "إجمالي الفاتورة", render: (r: any) => formatEGP(Number(r.invoice?.total ?? 0)) },
                    ];
                  }
                  if (type === "shipments") {
                    return [
                      { key: "shipment.shipment_number", header: "رقم الشحنة", render: (r: any) => r.shipment?.id ? (
                        <a href={`/branch/${branchId}/shipments/${r.shipment.id}`} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline hover:opacity-80">{r.shipment?.shipment_number}</a>
                      ) : <span className="font-mono text-primary">{r.shipment?.shipment_number}</span> },
                      { key: "from", header: "من", render: (r: any) => r.shipment?.source_branch?.name ?? "—" },
                      { key: "to", header: "إلى", render: (r: any) => r.shipment?.destination_branch?.name ?? "—" },
                      { key: "quantity", header: "الكمية المنقولة", render: (r: any) => Number(r.quantity).toLocaleString() },
                      { key: "shipment.arrival_date", header: "تاريخ الشحنة", render: (r: any) => r.shipment?.arrival_date ? new Date(r.shipment.arrival_date).toLocaleDateString("ar-EG") : "—" },
                      { key: "shipment.created_at", header: "تاريخ التسجيل", render: (r: any) => formatDateTime(r.shipment?.created_at) },
                    ];
                  }
                  if (type === "sale_returns" || type === "purchase_returns") {
                    const path = type === "sale_returns" ? "sale-returns" : "purchase-returns";
                    return [
                      { key: "return.return_number", header: "رقم المرتجع", render: (r: any) => r.return?.id ? (
                        <a href={`/branch/${branchId}/${path}/${r.return.id}`} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline hover:opacity-80">{r.return?.return_number}</a>
                      ) : <span className="font-mono text-primary">{r.return?.return_number}</span> },
                      { key: "return.contact.name", header: "الطرف", render: (r: any) => r.return?.contact?.name ?? "—" },
                      { key: "quantity", header: "الكمية المرتجعة", render: (r: any) => Number(r.quantity).toLocaleString() },
                      { key: "unit_price", header: "سعر الوحدة", render: (r: any) => formatEGP(Number(r.unit_price)) },
                      { key: "return.created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.return?.created_at) },
                      { key: "return.total", header: "إجمالي المرتجع", render: (r: any) => formatEGP(Number(r.return?.total ?? 0)) },
                    ];
                  }
                  if (type === "count_sessions") {
                    return [
                      { key: "session.session_number", header: "رقم الجلسة", render: (r: any) => <span className="font-mono text-primary">{r.session?.session_number}</span> },
                      { key: "system_quantity", header: "كمية النظام", render: (r: any) => Number(r.system_quantity).toLocaleString() },
                      { key: "counted_quantity", header: "الكمية المعدودة", render: (r: any) => Number(r.counted_quantity).toLocaleString() },
                      { key: "difference", header: "الفرق", render: (r: any) => <span className={r.difference > 0 ? "text-success" : r.difference < 0 ? "text-destructive" : ""}>{r.difference > 0 ? "+" : ""}{Number(r.difference).toLocaleString()}</span> },
                      { key: "session.status", header: "الحالة", render: (r: any) => r.session?.status === "approved" ? "معتمدة" : r.session?.status === "pending" ? "معلقة" : r.session?.status },
                      { key: "session.created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.session?.created_at) },
                    ];
                  }
                  if (type === "quotes") {
                    return [
                      { key: "quote.quote_number", header: "رقم العرض", render: (r: any) => r.quote?.id ? (
                        <a href={`/branch/${branchId}/quotes/${r.quote.id}`} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline hover:opacity-80">{r.quote?.quote_number}</a>
                      ) : <span className="font-mono text-primary">{r.quote?.quote_number}</span> },
                      { key: "quote.contact.name", header: "العميل", render: (r: any) => r.quote?.contact?.name ?? "—" },
                      { key: "quantity", header: "الكمية", render: (r: any) => Number(r.quantity).toLocaleString() },
                      { key: "unit_price", header: "سعر الوحدة", render: (r: any) => formatEGP(Number(r.unit_price)) },
                      { key: "quote.created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.quote?.created_at) },
                      { key: "quote.total", header: "إجمالي العرض", render: (r: any) => formatEGP(Number(r.quote?.total ?? 0)) },
                    ];
                  }
                  if (type === "reservations") {
                    return [
                      { key: "contact.name", header: "العميل/الحساب", render: (r: any) => r.contact?.name ?? "—" },
                      { key: "quantity", header: "الكمية المحجوزة", render: (r: any) => Number(r.quantity).toLocaleString() },
                      { key: "draft_id", header: "رقم المسودة", render: (r: any) => <span className="font-mono text-xs">{r.draft_id}</span> },
                      { key: "expires_at", header: "تنتهي في", render: (r: any) => r.expires_at ? new Date(r.expires_at).toLocaleString("ar-EG") : "—" },
                      { key: "created_at", header: "تاريخ الحجز", render: (r: any) => formatDateTime(r.created_at) },
                    ];
                  }
                  return [];
                })()}
              />
            )}
          </div>
          <DialogFooter className="px-5 py-3 border-t bg-muted/30 gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setRefDetail(null)}>إغلاق</Button>
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
