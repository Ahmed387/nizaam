import { useEffect, useState, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Upload, RefreshCw, Pencil, Trash2, ArrowUp, ArrowDown, Minus } from "lucide-react";

type PriceRow = {
  id: string;
  sku: string | null;
  product_name: string;
  category_name: string | null;
  description: string | null;
  old_price: number;
  new_price: number;
  market_price: number;
  uploaded_at: string;
};

const emptyForm = { id: "", sku: "", product_name: "", category_name: "", description: "", old_price: "", new_price: "", market_price: "" };

export default function PriceList() {
  const { user, tenantId } = useAuth();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);
  const [applying, setApplying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("price_list").select("*").order("uploaded_at", { ascending: false });
    setRows((data ?? []) as PriceRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.product_name.toLowerCase().includes(q) ||
      (r.sku ?? "").toLowerCase().includes(q) ||
      (r.category_name ?? "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const openNew = () => { setForm(emptyForm); setOpen(true); };
  const openEdit = (r: PriceRow) => {
    setForm({
      id: r.id, sku: r.sku ?? "", product_name: r.product_name, category_name: r.category_name ?? "",
      description: r.description ?? "", old_price: String(r.old_price ?? 0),
      new_price: String(r.new_price ?? 0), market_price: String(r.market_price ?? 0),
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.product_name) return toast.error("أدخل اسم المنتج");
    const payload = {
      sku: form.sku || null,
      product_name: form.product_name,
      category_name: form.category_name || null,
      description: form.description || null,
      old_price: Number(form.old_price) || 0,
      new_price: Number(form.new_price) || 0,
      market_price: Number(form.market_price) || 0,
      uploaded_by: user!.id,
    };
    if (form.id) {
      const { error } = await supabase.from("price_list").update(payload).eq("id", form.id);
      if (error) return toast.error(error.message);
      toast.success("تم التحديث");
    } else {
      const { error } = await supabase.from("price_list").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("تمت الإضافة");
    }
    setOpen(false); setForm(emptyForm); load();
  };

  const remove = async (r: PriceRow) => {
    if (!confirm(`حذف ${r.product_name}؟`)) return;
    const { error } = await supabase.from("price_list").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    load();
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<any>(sheet);
    const records = json
      .map((r) => {
        const newP = Number(r["السعر الجديد"] ?? r["new_price"] ?? r["السعر"] ?? r["price"] ?? r["market_price"] ?? r["سعر السوق"] ?? 0);
        const oldP = Number(r["السعر القديم"] ?? r["old_price"] ?? 0);
        const market = Number(r["سعر السوق"] ?? r["market_price"] ?? newP);
        return {
          sku: (r["SKU"] ?? r["sku"] ?? r["كود"] ?? null)?.toString() || null,
          product_name: r["اسم المنتج"] ?? r["product_name"] ?? r["name"],
          category_name: r["التصنيف"] ?? r["category"] ?? r["category_name"] ?? null,
          description: r["الوصف"] ?? r["description"] ?? null,
          old_price: isNaN(oldP) ? 0 : oldP,
          new_price: isNaN(newP) ? 0 : newP,
          market_price: isNaN(market) ? 0 : market,
          uploaded_by: user!.id,
        };
      })
      .filter((r) => r.product_name);
    if (!records.length) return toast.error("لم يتم العثور على بيانات صحيحة");
    const { error } = await supabase.from("price_list").insert(records);
    if (error) toast.error(error.message);
    else toast.success(`تم رفع ${records.length} منتج`);
    if (fileRef.current) fileRef.current.value = "";
    load();
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { "SKU": "SKU-001", "اسم المنتج": "موبايل سامسونج A15", "التصنيف": "موبايلات", "الوصف": "128GB / 6GB RAM", "السعر القديم": 5500, "السعر الجديد": 6000, "سعر السوق": 6200 },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Prices");
    XLSX.writeFile(wb, "price_list_template.xlsx");
  };

  /**
   * تطبيق قائمة الأسعار على كل الفروع:
   * - يحدّث products.old_price, products.market_price في كل الفروع للمنتجات المطابقة بالـ SKU أو الاسم.
   * - selling_price لا يُلمس (الكاشير/المدير يحدده وقت البيع).
   */
  const applyToAllBranches = async () => {
    if (!tenantId) return;
    setApplying(true);
    try {
      let matched = 0;
      let scanned = 0;
      for (const r of rows) {
        scanned++;
        const newP = Number(r.new_price) || 0;
        const oldP = Number(r.old_price) || 0;
        const market = Number(r.market_price) || newP;

        // Match by SKU first, fallback to exact name match within tenant
        let q = supabase.from("products").update({
          old_price: oldP || newP,
          market_price: market,
        }).eq("tenant_id", tenantId);

        if (r.sku) {
          const { data, error } = await q.eq("sku", r.sku).select("id");
          if (!error && data) matched += data.length;
        } else {
          const { data, error } = await q.eq("name", r.product_name).select("id");
          if (!error && data) matched += data.length;
        }
      }
      toast.success(`تم تحديث ${matched} منتج في كل الفروع (من ${scanned} عنصر)`);
    } catch (e: any) {
      toast.error(e.message ?? "خطأ في التطبيق");
    } finally {
      setApplying(false);
      setConfirmApply(false);
    }
  };

  const renderDelta = (r: PriceRow) => {
    const o = Number(r.old_price) || 0;
    const n = Number(r.new_price) || 0;
    if (!o || o === n) return <span className="text-muted-foreground inline-flex items-center gap-1"><Minus className="w-3 h-3" /> —</span>;
    const diff = n - o;
    const pct = (diff / o) * 100;
    const up = diff > 0;
    return (
      <span className={`inline-flex items-center gap-1 font-semibold ${up ? "text-destructive" : "text-success"}`}>
        {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
        {Math.abs(pct).toFixed(1)}%
      </span>
    );
  };

  return (
    <AdminLayout>
      <PageHeader
        title="قائمة الأسعار الرسمية"
        subtitle="السعر القديم والجديد للكاشير + التطبيق على كل الفروع"
        actions={
          <div className="flex gap-2 flex-wrap">
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={upload} className="hidden" />
            <Button variant="ghost" onClick={downloadTemplate}>قالب Excel</Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4 ml-1" /> رفع Excel</Button>
            <Button variant="outline" onClick={() => setConfirmApply(true)} disabled={!rows.length || applying}>
              <RefreshCw className={`w-4 h-4 ml-1 ${applying ? "animate-spin" : ""}`} /> تطبيق على كل الفروع
            </Button>
            <Button className="btn-gradient" onClick={openNew}><Plus className="w-4 h-4 ml-1" /> إضافة منتج</Button>
          </div>
        }
      />

      <div className="mb-4">
        <Input placeholder="بحث بالاسم أو الـ SKU أو التصنيف..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <DataTable
        loading={loading} rows={filtered}
        empty="لا توجد منتجات في القائمة"
        columns={[
          { key: "sku", header: "SKU", render: (r: PriceRow) => <span className="text-xs text-muted-foreground" dir="ltr">{r.sku ?? "—"}</span> },
          { key: "product_name", header: "اسم المنتج", render: (r: PriceRow) => (
            <div>
              <div className="font-semibold">{r.product_name}</div>
              {r.category_name && <div className="text-xs text-muted-foreground">{r.category_name}</div>}
            </div>
          )},
          { key: "old_price", header: "السعر القديم", render: (r: PriceRow) => <span className="text-muted-foreground line-through">{formatEGP(r.old_price)}</span> },
          { key: "new_price", header: "السعر الجديد", render: (r: PriceRow) => <span className="text-primary font-bold">{formatEGP(r.new_price)}</span> },
          { key: "delta", header: "التغير", render: renderDelta },
          { key: "market_price", header: "سعر السوق", render: (r: PriceRow) => formatEGP(r.market_price) },
          { key: "uploaded_at", header: "آخر تحديث", render: (r: PriceRow) => <span className="text-xs">{formatDateTime(r.uploaded_at)}</span> },
          { key: "actions", header: "", render: (r: PriceRow) => (
            <div className="flex gap-1 justify-end">
              <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => remove(r)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
            </div>
          )},
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "تعديل منتج" : "إضافة منتج للقائمة"}</DialogTitle>
            <DialogDescription>السعر القديم والجديد سيظهروا للكاشير وقت البيع.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>SKU</Label><Input dir="ltr" className="text-right mt-1.5" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            <div><Label>التصنيف</Label><Input value={form.category_name} onChange={(e) => setForm({ ...form, category_name: e.target.value })} className="mt-1.5" /></div>
            <div className="col-span-2"><Label>اسم المنتج *</Label><Input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} className="mt-1.5" /></div>
            <div className="col-span-2"><Label>الوصف</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1.5" /></div>
            <div><Label>السعر القديم</Label><Input type="number" value={form.old_price} onChange={(e) => setForm({ ...form, old_price: e.target.value })} className="mt-1.5" /></div>
            <div><Label>السعر الجديد *</Label><Input type="number" value={form.new_price} onChange={(e) => setForm({ ...form, new_price: e.target.value })} className="mt-1.5" /></div>
            <div className="col-span-2"><Label>سعر السوق المرجعي</Label><Input type="number" value={form.market_price} onChange={(e) => setForm({ ...form, market_price: e.target.value })} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submit}>{form.id ? "حفظ" : "إضافة"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmApply} onOpenChange={setConfirmApply}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تطبيق القائمة على كل الفروع</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم تحديث السعر القديم وسعر السوق في جميع المنتجات المطابقة (بالـ SKU أو الاسم) عبر كل الفروع.
              <br />
              <b>سعر البيع لن يتغير</b> - الكاشير هو من يحدده وقت البيع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={applyToAllBranches} disabled={applying}>تطبيق الآن</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
