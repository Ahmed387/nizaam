import { useEffect, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Upload, Loader2, Activity, Barcode, FileSpreadsheet, ClipboardList, ClipboardCheck, HelpCircle, Tag, History, Edit3 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { uploadProductImage } from "@/lib/uploadImage";
import { ExcelImportDialog } from "@/components/ExcelImportDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
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
  const [priceEdit, setPriceEdit] = useState<any>(null);
  const [historyFor, setHistoryFor] = useState<any>(null);
  const [qtyEdit, setQtyEdit] = useState<any>(null);
  const [qtyValue, setQtyValue] = useState<string>("0");
  const [qtyNotes, setQtyNotes] = useState<string>("");
  const [savingQty, setSavingQty] = useState(false);

  const canManageInventory = isAdmin || hasRole("branch_manager") || hasRole("warehouse");

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
  useRealtimeRefresh(["products", "categories"], load);

  const filtered = rows.filter((p) => {
    if (search && !p.name.includes(search) && !(p.sku ?? "").includes(search) && !(p.legacy_code ?? "").toString().includes(search)) return false;
    if (filter === "low" && !(p.quantity > 0 && p.quantity <= p.low_stock_alert)) return false;
    if (filter === "out" && p.quantity > 0) return false;
    if (filter === "ok" && p.quantity <= p.low_stock_alert) return false;
    return true;
  });

  // Counts per status (always reflect full rows, ignoring text search)
  const statusCounts = {
    all: rows.length,
    ok: rows.filter((p) => p.quantity > p.low_stock_alert).length,
    low: rows.filter((p) => p.quantity > 0 && p.quantity <= p.low_stock_alert).length,
    out: rows.filter((p) => p.quantity <= 0).length,
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
        <TabsList>
          <TabsTrigger value="products">الأصناف</TabsTrigger>
          <TabsTrigger value="transfers">نقل المخزون</TabsTrigger>
          <TabsTrigger value="adjustments">
            <ClipboardList className="w-4 h-4 ml-1" /> تسوية المخزون
            <HoverCard openDelay={150}>
              <HoverCardTrigger asChild>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center mr-1 text-muted-foreground hover:text-primary cursor-help"
                  aria-label="ما هي تسوية المخزون؟"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </span>
              </HoverCardTrigger>
              <HoverCardContent dir="rtl" className="w-80 text-right" side="bottom" align="end">
                <div className="space-y-2 text-sm">
                  <div className="font-bold text-primary">تسوية المخزون</div>
                  <p className="text-muted-foreground">
                    حركة تصحيحية بتعدّل كمية المنتج في النظام عشان توافق الكمية الفعلية على أرض الواقع.
                  </p>
                  <div className="bg-muted/50 rounded p-2 text-xs">
                    <span className="font-semibold">مثال:</span> النظام بيقول 100 قطعة، والموجود فعلياً 95. التسوية بتنقّص 5 عشان النظام يطابق الواقع.
                  </div>
                  <p className="text-xs text-muted-foreground">بتستخدمها بعد الجرد لما تلاقي فروقات (هالك، سرقة، خطأ إدخال…).</p>
                </div>
              </HoverCardContent>
            </HoverCard>
          </TabsTrigger>
          <TabsTrigger value="count">
            <ClipboardCheck className="w-4 h-4 ml-1" /> جرد المخزن
            <HoverCard openDelay={150}>
              <HoverCardTrigger asChild>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center mr-1 text-muted-foreground hover:text-primary cursor-help"
                  aria-label="ما هو جرد المخزن؟"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </span>
              </HoverCardTrigger>
              <HoverCardContent dir="rtl" className="w-80 text-right" side="bottom" align="end">
                <div className="space-y-2 text-sm">
                  <div className="font-bold text-primary">جرد المخزن</div>
                  <p className="text-muted-foreground">
                    عملية عدّ فعلي للبضاعة الموجودة في المخزن ومقارنتها بأرصدة النظام لاكتشاف الفروقات.
                  </p>
                  <div className="bg-muted/50 rounded p-2 text-xs">
                    <span className="font-semibold">مثال:</span> أمين المخزن يعد المنتج فيلاقي 95، النظام مسجّل 100 → فرق -5 يتراجع ويتعمله تسوية.
                  </div>
                  <p className="text-xs text-muted-foreground">
                    من هنا كمان تقدر تشوف <span className="font-semibold">رصيد أي منتج في تاريخ سابق</span> وتقارنه بالواقع.
                  </p>
                </div>
              </HoverCardContent>
            </HoverCard>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4">
          <div className="flex gap-3 mb-4 flex-wrap items-center">
            <Input placeholder="ابحث بالاسم أو الكود أو الكود القديم" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
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
                      <tr key={r.id} className={`border-b border-border last:border-0 hover:bg-muted/40 ${i % 2 ? "bg-surface/20" : "bg-card"}`}>
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
                            <div className="flex items-center justify-center gap-1">
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setPriceEdit(r)} title="تعديل السعر">
                                <Tag className="w-4 h-4" />
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
                  <div key={r.id} className="card-elevated p-3 flex gap-3">
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
                        <div className="mt-2 flex gap-1">
                          <Button size="sm" variant="outline" className="h-8" onClick={() => setPriceEdit(r)}>
                            <Tag className="w-3.5 h-3.5 ml-1" /> سعر
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

      <Dialog open={open} onOpenChange={setOpen}>
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
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
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

      {priceEdit && (
        <PriceEditDialog
          open={!!priceEdit}
          onOpenChange={(o) => !o && setPriceEdit(null)}
          product={priceEdit}
          onSaved={load}
        />
      )}

      <Dlg open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DlgContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DlgHeader><DlgTitle>تاريخ أسعار: {historyFor?.name}</DlgTitle></DlgHeader>
          {historyFor && <ProductPriceHistory productId={historyFor.id} />}
        </DlgContent>
      </Dlg>
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
          <Plus className="w-4 h-4" /> تسوية مخزون جديدة
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
