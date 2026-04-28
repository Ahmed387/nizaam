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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Upload, RefreshCw, Pencil, Trash2, ArrowUp, ArrowDown, Minus, Eraser } from "lucide-react";

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
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const [confirmApply, setConfirmApply] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const clearAll = async () => {
    if (!tenantId) return;
    setClearing(true);
    const { error } = await supabase.from("price_list").delete().eq("tenant_id", tenantId);
    setClearing(false);
    setConfirmClear(false);
    if (error) return toast.error(error.message);
    toast.success("تم مسح كل قائمة الأسعار");
    load();
  };

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("price_list").select("*").order("uploaded_at", { ascending: false });
    setRows((data ?? []) as PriceRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { if (r.category_name) set.add(r.category_name); });
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (categoryFilter !== "__all__" && (r.category_name ?? "") !== categoryFilter) return false;
      if (!q) return true;
      return (
        r.product_name.toLowerCase().includes(q) ||
        (r.sku ?? "").toLowerCase().includes(q) ||
        (r.category_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, categoryFilter]);

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

  const parsePdfWithAI = async (file: File): Promise<any[]> => {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    }
    const base64 = btoa(binary);
    const { data, error } = await supabase.functions.invoke("parse-price-list-pdf", { body: { pdfBase64: base64 } });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data?.products ?? [];
  };

  const parsePdfSimple = async (file: File): Promise<any[]> => {
    const pdfjs: any = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const lines: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Group items by approximate Y position to reconstruct rows
      const rows: Record<number, string[]> = {};
      for (const item of content.items as any[]) {
        const y = Math.round(item.transform[5]);
        if (!rows[y]) rows[y] = [];
        rows[y].push(item.str);
      }
      Object.keys(rows).sort((a, b) => Number(b) - Number(a)).forEach(y => {
        lines.push(rows[Number(y)].join(" ").trim());
      });
    }
    // Try to parse rows: looking for "name ... price"
    const records: any[] = [];
    for (const line of lines) {
      if (!line || line.length < 3) continue;
      // Match trailing number(s) as prices
      const numMatches = [...line.matchAll(/(\d+(?:[.,]\d+)?)/g)].map(m => Number(m[1].replace(",", ".")));
      if (numMatches.length === 0) continue;
      // Strip prices from name
      const name = line.replace(/\d+(?:[.,]\d+)?/g, "").replace(/\s+/g, " ").trim();
      if (!name || name.length < 2) continue;
      const newP = numMatches[numMatches.length - 1];
      const oldP = numMatches.length > 1 ? numMatches[numMatches.length - 2] : 0;
      if (!newP || newP < 1) continue;
      records.push({
        sku: null,
        product_name: name,
        category_name: null,
        description: null,
        old_price: oldP,
        new_price: newP,
        market_price: newP,
      });
    }
    return records;
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    let records: any[] = [];

    try {
      if (isPdf) {
        toast.info("جاري قراءة الـ PDF بالذكاء الاصطناعي...");
        records = await parsePdfWithAI(file);
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<any>(sheet);
        records = json
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
            };
          })
          .filter((r) => r.product_name);
      }

      const finalRecords = records
        .filter((r) => r.product_name)
        .map((r) => ({ ...r, uploaded_by: user!.id }));

      if (!finalRecords.length) {
        toast.error("لم يتم العثور على بيانات صحيحة");
        if (fileRef.current) fileRef.current.value = "";
        return;
      }

      const { error } = await supabase.from("price_list").insert(finalRecords);
      if (error) toast.error(error.message);
      else toast.success(`تم رفع ${finalRecords.length} منتج`);
    } catch (err: any) {
      toast.error(err.message ?? "فشل قراءة الملف");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      load();
    }
  };

  /** يولّد SKU فريد داخل الشركة، يجرّب أكتر من مرة لو حصل تكرار */
  const generateUniqueSku = async (): Promise<string> => {
    if (!tenantId) throw new Error("no tenant");
    for (let i = 0; i < 8; i++) {
      const candidate = `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const { data } = await supabase
        .from("products")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("sku", candidate)
        .limit(1)
        .maybeSingle();
      if (!data) return candidate;
      await new Promise(r => setTimeout(r, 5));
    }
    throw new Error("تعذّر توليد SKU فريد");
  };


  /**
   * تطبيق قائمة الأسعار على كل الفروع:
   * - لكل منتج في القائمة، يتأكد إنه موجود في كل فرع.
   * - لو موجود (بالـ SKU أو الاسم) → يحدّث old_price و market_price (الكمية و selling_price ما يتغيروش).
   * - لو ناقص في فرع → يضيفه بكمية 0 عشان يبقى ظاهر في مخزون الفرع.
   */
  const applyToAllBranches = async () => {
    if (!tenantId) return;
    setApplying(true);
    try {
      // اجلب كل الفروع التابعة للشركة
      const { data: branches, error: brErr } = await supabase
        .from("branches")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_active", true);
      if (brErr) throw brErr;
      if (!branches || branches.length === 0) {
        toast.error("لا توجد فروع");
        return;
      }

      let updated = 0;
      let created = 0;
      let scanned = 0;

      for (const r of rows) {
        scanned++;
        const newP = Number(r.new_price) || 0;
        const oldP = Number(r.old_price) || 0;
        const market = Number(r.market_price) || newP;

        for (const b of branches) {
          // ابحث عن المنتج في الفرع: بالـ SKU لو موجود، وإلا بالاسم
          let existingId: string | null = null;
          if (r.sku) {
            const { data: bySku } = await supabase
              .from("products")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("branch_id", b.id)
              .eq("sku", r.sku)
              .maybeSingle();
            if (bySku?.id) existingId = bySku.id;
          }
          if (!existingId) {
            const { data: byName } = await supabase
              .from("products")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("branch_id", b.id)
              .eq("name", r.product_name)
              .maybeSingle();
            if (byName?.id) existingId = byName.id;
          }

          if (existingId) {
            // تحديث الأسعار فقط (الكمية و selling_price ما يتغيروش)
            const { error: upErr } = await supabase
              .from("products")
              .update({ old_price: oldP || newP, market_price: market })
              .eq("id", existingId);
            if (!upErr) updated++;
          } else {
            // تحديد SKU: لو القائمة فيها SKU وغير مستخدم في منتج آخر بنفس الشركة → استخدمه
            // وإلا ولّد SKU فريد تلقائياً
            let skuToUse = r.sku?.trim() || "";
            if (skuToUse) {
              const { data: clash } = await supabase
                .from("products")
                .select("id, name")
                .eq("tenant_id", tenantId)
                .eq("sku", skuToUse)
                .neq("name", r.product_name)
                .limit(1)
                .maybeSingle();
              if (clash) skuToUse = await generateUniqueSku();
            } else {
              skuToUse = await generateUniqueSku();
            }

            // إضافة المنتج للفرع بكمية 0
            const { error: insErr } = await supabase.from("products").insert({
              tenant_id: tenantId,
              branch_id: b.id,
              name: r.product_name,
              sku: skuToUse,
              old_price: oldP || newP,
              selling_price: newP,
              market_price: market,
              cost_price: 0,
              quantity: 0,
            });
            if (!insErr) created++;
          }
        }
      }
      toast.success(
        `تم! ${created} منتج أُضيف للفروع الناقصة، و${updated} منتج تم تحديث سعره (من ${scanned} عنصر × ${branches.length} فرع)`
      );
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
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" onChange={upload} className="hidden" />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4 ml-1" /> رفع Excel / PDF</Button>
            <Button variant="outline" onClick={() => setConfirmApply(true)} disabled={!rows.length || applying}>
              <RefreshCw className={`w-4 h-4 ml-1 ${applying ? "animate-spin" : ""}`} /> تطبيق على كل الفروع
            </Button>
            <Button variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30" onClick={() => setConfirmClear(true)} disabled={!rows.length || clearing}>
              <Eraser className="w-4 h-4 ml-1" /> مسح القائمة
            </Button>
            <Button className="btn-gradient" onClick={openNew}><Plus className="w-4 h-4 ml-1" /> إضافة منتج</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-col sm:flex-row gap-2">
        <Input placeholder="بحث بالاسم أو الـ SKU أو التصنيف..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="sm:w-64"><SelectValue placeholder="كل التصنيفات" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">كل التصنيفات ({rows.length})</SelectItem>
            {categories.map(c => (
              <SelectItem key={c} value={c}>{c} ({rows.filter(r => r.category_name === c).length})</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
              سيتم توزيع منتجات القائمة على <b>كل الفروع</b>:
              <br />• المنتج الموجود في الفرع → يتم تحديث السعر القديم وسعر السوق فقط.
              <br />• المنتج الناقص في الفرع → يتم إضافته بكمية <b>صفر</b> ليظهر في مخزون الفرع.
              <br />• <b>سعر البيع والكميات الحالية لن تتغير</b>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={applyToAllBranches} disabled={applying}>تطبيق الآن</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>مسح كل قائمة الأسعار؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف جميع الأسعار ({rows.length} عنصر) من القائمة الرسمية.
              <br />
              <b className="text-destructive">هذا الإجراء لا يمكن التراجع عنه.</b>
              <br />
              ملاحظة: أسعار المنتجات في الفروع لن تتأثر — فقط القائمة المرجعية هنا.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={clearAll}
              disabled={clearing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearing ? "جاري المسح..." : "نعم، امسح الكل"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
