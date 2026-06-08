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
import { Plus, Upload, Loader2, Activity, Barcode, FileSpreadsheet, ClipboardList, ClipboardCheck } from "lucide-react";
import { uploadProductImage } from "@/lib/uploadImage";
import { ExcelImportDialog } from "@/components/ExcelImportDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StockTransfers from "./StockTransfers";
import Sessions from "./inventory-count/Sessions";
import { formatDateTime } from "@/lib/format";

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
    if (search && !p.name.includes(search) && !p.sku.includes(search)) return false;
    if (filter === "low" && p.quantity > p.low_stock_alert) return false;
    if (filter === "out" && p.quantity > 0) return false;
    if (filter === "ok" && p.quantity <= p.low_stock_alert) return false;
    return true;
  });

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

    const { data, error } = await supabase.from("products").insert({
      name: form.name,
      sku,
      category_id: form.category_id || null,
      cost_price: Number(form.cost_price) || 0,
      selling_price: Number(form.selling_price) || 0,
      market_price: Number(form.market_price) || 0,
      low_stock_alert: parseInt(form.low_stock_alert) || defaultLowStock,
      quantity: parseInt(form.quantity) || 0,
      image: form.image || null,
      branch_id: branchId!,
    }).select().single();
    if (error) return toast.error(error.message);
    await logAudit({ userId: user!.id, userName: profile!.name, branchId, action: "CREATE", entity: "Product", entityId: data.id, details: { name: form.name } });
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
          <TabsTrigger value="adjustments"><ClipboardList className="w-4 h-4 ml-1" /> تسوية المخزون</TabsTrigger>
          <TabsTrigger value="count"><ClipboardCheck className="w-4 h-4 ml-1" /> جرد المخزن</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4">
          <div className="flex gap-3 mb-4 flex-wrap">
            <Input placeholder="ابحث بالاسم أو الكود" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
            <Select value={filter} onValueChange={setFilter}>
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
              { key: "image", header: "صورة", render: (r: any) => r.image ? <img src={r.image} alt={r.name} className="w-10 h-10 rounded object-cover" /> : <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">—</div> },
              { key: "sku", header: "الكود", render: (r: any) => <span className="font-mono text-xs text-muted-foreground">{r.sku}</span> },
              { key: "name", header: "الاسم", render: (r: any) => <span className="font-semibold">{r.name}</span> },
              { key: "category", header: "التصنيف", render: (r: any) => r.categories?.name ?? "—" },
              { key: "quantity", header: "الكمية", render: (r: any) => <span className="font-bold">{r.quantity}</span> },
              { key: "cost_price", header: "شراء", render: (r: any) => formatEGP(r.cost_price) },
              { key: "selling_price", header: "بيع", render: (r: any) => <span className="text-success">{formatEGP(r.selling_price)}</span> },
              { key: "market_price", header: "سوق", render: (r: any) => <span className="text-primary">{formatEGP(r.market_price)}</span> },
              { key: "status", header: "الحالة", render: (r: any) => {
                if (r.quantity === 0) return <span className="px-2 py-1 rounded text-xs bg-destructive/15 text-destructive">🔴 نفد</span>;
                if (r.quantity <= r.low_stock_alert) return <span className="px-2 py-1 rounded text-xs bg-warning/15 text-warning">🟡 منخفض</span>;
                return <span className="px-2 py-1 rounded text-xs bg-success/15 text-success">🟢 متوفر</span>;
              }},
              { key: "actions", header: "حركة", render: (r: any) => (
                canManageInventory ? (
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); nav(`/branch/${branchId}/inventory/${r.id}/movements`); }}>
                    <Activity className="w-3.5 h-3.5 ml-1" /> عرض
                  </Button>
                ) : null
              )},
            ]}
          />
        </TabsContent>

        <TabsContent value="transfers" className="mt-4">
          <StockTransfers embedded />
        </TabsContent>

        <TabsContent value="adjustments" className="mt-4">
          <AdjustmentsList branchId={branchId!} />
        </TabsContent>

        <TabsContent value="count" className="mt-4">
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
            const { error } = await supabase.from("products").insert({
              tenant_id: tenantId, branch_id: branchId!, name: r.name, sku,
              category_id: cat?.id ?? null,
              cost_price: r.cost_price ?? 0, selling_price: r.selling_price ?? 0,
              market_price: r.market_price ?? 0, quantity: r.quantity ?? 0,
              low_stock_alert: r.low_stock_alert ?? 5,
            });
            if (!error) inserted++;
          }
          load();
          return { inserted };
        }}
      />
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
