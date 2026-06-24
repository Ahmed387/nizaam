import { useEffect, useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Plus, Upload, Trash2, Loader2, Search, X, FileUp } from "lucide-react";

type Source = {
  id: string;
  supplier_name: string;
  last_updated: string | null;
  updated_by_name: string | null;
  is_active: boolean;
};

type Item = {
  id: string;
  source_id: string;
  category: string | null;
  product_name: string;
  model_code: string | null;
  cost_price: number;
  suggested_sell_price: number;
  display_price: number;
  is_active: boolean;
  updated_at: string;
};

type ParsedItem = {
  product_name: string;
  model_code?: string;
  category?: string;
  cost_price: number;
  suggested_sell_price?: number;
};

type DiffRow = {
  parsed: ParsedItem;
  existing: Item | null;
  diff: number; // new - old
  status: "new" | "changed" | "same";
};

export default function PriceList({ embedded }: { embedded?: boolean } = {}) {
  const { tenantId, user, profile } = useAuth();
  const [sources, setSources] = useState<Source[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("");
  const [search, setSearch] = useState("");

  const [addSupplierOpen, setAddSupplierOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [deleteSupplierId, setDeleteSupplierId] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [parsedDiff, setParsedDiff] = useState<DiffRow[] | null>(null);
  const [applying, setApplying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const [s, i] = await Promise.all([
      supabase.from("price_list_sources").select("*").order("supplier_name"),
      supabase.from("price_list_items").select("*").order("product_name"),
    ]);
    setSources((s.data ?? []) as Source[]);
    setItems((i.data ?? []) as Item[]);
    setLoading(false);
    if (!activeTab && s.data?.length) setActiveTab(s.data[0].id);
  };

  useEffect(() => { load(); }, []);
  useRealtimeRefresh(["price_list_sources", "price_list_items"], () => load());

  const currentSource = useMemo(() => sources.find((s) => s.id === activeTab), [sources, activeTab]);
  const currentItems = useMemo(() => {
    const list = items.filter((i) => i.source_id === activeTab);
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((i) =>
      i.product_name.toLowerCase().includes(q) ||
      (i.model_code ?? "").toLowerCase().includes(q) ||
      (i.category ?? "").toLowerCase().includes(q)
    );
  }, [items, activeTab, search]);

  // -------- supplier CRUD --------
  const addSupplier = async () => {
    const n = newSupplierName.trim();
    if (!n) return toast.error("اكتب اسم المورد");
    const { error } = await supabase.from("price_list_sources").insert({ supplier_name: n, tenant_id: tenantId });
    if (error) return toast.error(error.message);
    toast.success("تمت إضافة المورد");
    setNewSupplierName("");
    setAddSupplierOpen(false);
    load();
  };

  const deleteSupplier = async () => {
    if (!deleteSupplierId) return;
    const has = items.some((i) => i.source_id === deleteSupplierId);
    if (has) {
      toast.error("احذف منتجات المورد أولاً");
      setDeleteSupplierId(null);
      return;
    }
    const { error } = await supabase.from("price_list_sources").delete().eq("id", deleteSupplierId);
    if (error) return toast.error(error.message);
    toast.success("تم حذف المورد");
    setDeleteSupplierId(null);
    if (activeTab === deleteSupplierId) setActiveTab(sources.find((s) => s.id !== deleteSupplierId)?.id ?? "");
    load();
  };

  // -------- item edits --------
  const updateItemField = async (id: string, patch: Partial<Item>) => {
    const before = items.find((i) => i.id === id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    const { error } = await supabase.from("price_list_items").update(patch).eq("id", id);
    if (error) { toast.error(error.message); load(); return; }
    // Audit price changes
    const priceFields = ["cost_price", "suggested_sell_price", "display_price"] as const;
    const changed: Record<string, { from: any; to: any }> = {};
    for (const f of priceFields) {
      if (f in patch && before && (patch as any)[f] !== (before as any)[f]) {
        changed[f] = { from: (before as any)[f], to: (patch as any)[f] };
      }
    }
    if (Object.keys(changed).length && user && profile) {
      await logAudit({
        userId: user.id, userName: profile.name, tenantId,
        action: "UPDATE", entity: "price_list_item", entityId: id,
        details: { item: before?.product_name, changes: changed },
      });
    }
  };

  const deleteItem = async (id: string) => {
    if (!confirm("حذف هذا الصنف؟")) return;
    const { error } = await supabase.from("price_list_items").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  // -------- file upload + AI parse --------
  const handleFile = async (file: File) => {
    if (!currentSource) return;
    setUploadingFile(true);
    setParsedDiff(null);
    try {
      let parsed: ParsedItem[] = [];
      if (file.name.toLowerCase().endsWith(".pdf")) {
        // Native FileReader: أسرع بكتير من التحويل اليدوي ومش بيوقف الـ UI
        const b64: string = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => {
            const s = r.result as string;
            resolve(s.slice(s.indexOf(",") + 1));
          };
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        const { data, error } = await supabase.functions.invoke("parse-price-list-pdf", {
          body: { pdfBase64: b64, supplierName: currentSource.supplier_name },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        parsed = (data?.products ?? []) as ParsedItem[];
      } else {
        // Excel parse client-side
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        parsed = rows
          .map((r) => {
            const get = (keys: string[]) => {
              for (const k of keys) {
                const found = Object.keys(r).find((rk) => rk.toLowerCase().trim() === k.toLowerCase());
                if (found && r[found] !== "") return r[found];
              }
              return undefined;
            };
            const cost = Number(get(["cost_price", "سعر الشراء", "التكلفة", "السعر", "price"])) || 0;
            return {
              product_name: String(get(["product_name", "اسم المنتج", "المنتج", "name"]) ?? "").trim(),
              model_code: String(get(["model_code", "model", "الموديل", "كود", "sku"]) ?? "").trim() || undefined,
              category: String(get(["category", "الفئة", "التصنيف"]) ?? "").trim() || undefined,
              cost_price: cost,
              suggested_sell_price: Number(get(["suggested_sell_price", "سعر البيع", "البيع المقترح"])) || 0,
            } as ParsedItem;
          })
          .filter((p) => p.product_name && p.cost_price > 0);
      }

      if (!parsed.length) {
        toast.error("لم يتم استخراج أي منتج من الملف");
        setUploadingFile(false);
        return;
      }

      // Build diff
      const sourceItems = items.filter((i) => i.source_id === currentSource.id);
      const diff: DiffRow[] = parsed.map((p) => {
        const existing = sourceItems.find(
          (e) => e.product_name === p.product_name && (e.model_code ?? "") === (p.model_code ?? "")
        ) ?? null;
        const oldPrice = existing?.cost_price ?? 0;
        const d = p.cost_price - oldPrice;
        const status: DiffRow["status"] = !existing ? "new" : Math.abs(d) > 0.01 ? "changed" : "same";
        return { parsed: p, existing, diff: d, status };
      });
      setParsedDiff(diff);
    } catch (e: any) {
      toast.error(e?.message ?? "فشل قراءة الملف");
    } finally {
      setUploadingFile(false);
    }
  };

  const confirmUpdate = async () => {
    if (!currentSource || !parsedDiff) return;
    setApplying(true);
    const { data, error } = await supabase.rpc("apply_price_list_update", {
      p_source_id: currentSource.id,
      p_items: parsedDiff.map((d) => d.parsed) as any,
    });
    setApplying(false);
    if (error) return toast.error(error.message);
    const r = data as any;
    toast.success(`تم التحديث: ${r?.inserted ?? 0} جديد، ${r?.updated ?? 0} معدل`);
    setUploadOpen(false);
    setParsedDiff(null);
    load();
  };

  const newCount = parsedDiff?.filter((d) => d.status === "new").length ?? 0;
  const changedCount = parsedDiff?.filter((d) => d.status === "changed").length ?? 0;
  const sameCount = parsedDiff?.filter((d) => d.status === "same").length ?? 0;

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader
        title="قائمة الأسعار"
        actions={
          <Button onClick={() => setAddSupplierOpen(true)}>
            <Plus className="h-4 w-4 ml-1" /> إضافة مورد
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : sources.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">لا يوجد موردين — أضف مورد للبدء</div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto">
            <TabsList className="flex w-max h-auto flex-wrap gap-1">
              {sources.map((s) => (
                <TabsTrigger key={s.id} value={s.id}>{s.supplier_name}</TabsTrigger>
              ))}
            </TabsList>
          </div>

          {sources.map((s) => (
            <TabsContent key={s.id} value={s.id} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
                <div className="text-sm text-muted-foreground">
                  {s.last_updated ? (
                    <>آخر تحديث: <strong>{formatDateTime(s.last_updated)}</strong> بواسطة {s.updated_by_name ?? "—"}</>
                  ) : (
                    "لم يتم تحديث القائمة بعد"
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { setUploadOpen(true); setParsedDiff(null); }}>
                    <Upload className="h-4 w-4 ml-1" /> تحديث القائمة
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteSupplierId(s.id)} title="حذف المورد">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="بحث في المنتجات..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" />
              </div>

              <div className="border rounded-lg bg-card" dir="rtl">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="text-right font-semibold">اسم المنتج</TableHead>
                      <TableHead className="text-right font-semibold">الموديل</TableHead>
                      <TableHead className="text-center font-semibold">سعر الشراء</TableHead>
                      <TableHead className="text-center font-semibold">سعر البيع المقترح</TableHead>
                      <TableHead className="text-center font-semibold">السعر المعروض للكاشير</TableHead>
                      <TableHead className="text-center font-semibold">ظاهر</TableHead>
                      <TableHead className="text-right font-semibold">الفئة</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentItems.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">لا توجد منتجات — حدّث القائمة من الزر أعلاه</TableCell></TableRow>
                    ) : currentItems.map((item) => (
                      <TableRow key={item.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="text-right font-medium">{item.product_name}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground font-mono">{item.model_code ?? "—"}</TableCell>
                        <TableCell className="text-center tabular-nums">{formatEGP(item.cost_price)}</TableCell>
                        <TableCell className="text-center tabular-nums text-muted-foreground">{formatEGP(item.suggested_sell_price)}</TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            className="w-28 mx-auto text-center tabular-nums font-semibold"
                            defaultValue={item.display_price}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (!isNaN(v) && v !== item.display_price) updateItemField(item.id, { display_price: v });
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <Switch variant="premium" checked={item.is_active} onCheckedChange={(v) => updateItemField(item.id, { is_active: v })} />
                            <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium transition-colors", item.is_active ? "bg-success/10 border-success/30 text-success" : "bg-muted/50 border-border text-muted-foreground")}>
                              <span className={cn("w-1.5 h-1.5 rounded-full", item.is_active ? "bg-success animate-pulse" : "bg-muted-foreground")} />
                              <span>{item.is_active ? "ظاهر" : "مخفي"}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">{item.category ?? "—"}</TableCell>
                        <TableCell className="text-center">
                          <Button variant="ghost" size="icon" onClick={() => deleteItem(item.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Add supplier dialog */}
      <Dialog open={addSupplierOpen} onOpenChange={setAddSupplierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة مورد جديد</DialogTitle>
            <DialogDescription>سيظهر المورد كتاب جديد في قائمة الأسعار</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>اسم المورد</Label>
            <Input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="مثال: Samsung" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSupplierOpen(false)}>إلغاء</Button>
            <Button onClick={addSupplier}>إضافة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete supplier confirm */}
      <AlertDialog open={!!deleteSupplierId} onOpenChange={(o) => !o && setDeleteSupplierId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المورد؟</AlertDialogTitle>
            <AlertDialogDescription>لا يمكن التراجع. لو فيه منتجات مرتبطة احذفها أولاً.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSupplier} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Upload + diff dialog */}
      <Dialog open={uploadOpen} onOpenChange={(o) => { setUploadOpen(o); if (!o) setParsedDiff(null); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>تحديث قائمة {currentSource?.supplier_name}</DialogTitle>
            <DialogDescription>ارفع PDF أو Excel — الذكاء الاصطناعي يستخرج البيانات ويعرض المقارنة قبل الحفظ</DialogDescription>
          </DialogHeader>

          {!parsedDiff ? (
            <div className="space-y-3">
              <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <Button onClick={() => fileRef.current?.click()} disabled={uploadingFile} className="w-full" size="lg">
                {uploadingFile ? <><Loader2 className="h-4 w-4 ml-2 animate-spin" /> جاري قراءة الملف...</> : <><FileUp className="h-4 w-4 ml-2" /> اختر ملف PDF أو Excel</>}
              </Button>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/30">جديد: {newCount}</Badge>
                <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30">تغير سعر: {changedCount}</Badge>
                <Badge variant="outline">بدون تغيير: {sameCount}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">يمكنك تعديل السعر الجديد لأي صنف قبل الحفظ بالضغط على الخانة.</p>
              <div className="flex-1 overflow-auto border rounded-lg">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead>الحالة</TableHead>
                      <TableHead>المنتج</TableHead>
                      <TableHead>الموديل</TableHead>
                      <TableHead>السعر القديم</TableHead>
                      <TableHead>السعر الجديد (قابل للتعديل)</TableHead>
                      <TableHead>الفرق</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedDiff.map((d, idx) => (
                      <TableRow key={idx} className={d.status === "changed" ? "bg-amber-500/5" : d.status === "new" ? "bg-green-500/5" : ""}>
                        <TableCell>
                          {d.status === "new" && <Badge className="bg-green-600">جديد</Badge>}
                          {d.status === "changed" && <Badge className="bg-amber-600">تغير</Badge>}
                          {d.status === "same" && <Badge variant="secondary">ثابت</Badge>}
                        </TableCell>
                        <TableCell>{d.parsed.product_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{d.parsed.model_code ?? "—"}</TableCell>
                        <TableCell>{d.existing ? formatEGP(d.existing.cost_price) : "—"}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="w-28 h-8"
                            defaultValue={d.parsed.cost_price}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (isNaN(v) || v < 0) return;
                              setParsedDiff((prev) => {
                                if (!prev) return prev;
                                const next = [...prev];
                                const row = { ...next[idx] };
                                row.parsed = { ...row.parsed, cost_price: v };
                                const oldPrice = row.existing?.cost_price ?? 0;
                                row.diff = v - oldPrice;
                                row.status = !row.existing ? "new" : Math.abs(row.diff) > 0.01 ? "changed" : "same";
                                next[idx] = row;
                                return next;
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell className={d.diff > 0 ? "text-red-600" : d.diff < 0 ? "text-green-600" : ""}>
                          {d.status === "new" ? "—" : d.diff > 0 ? `+${formatEGP(d.diff)}` : d.diff < 0 ? formatEGP(d.diff) : "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="استبعاد هذا الصنف من التحديث"
                            onClick={() => setParsedDiff((prev) => prev?.filter((_, i) => i !== idx) ?? null)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            {parsedDiff && (
              <Button variant="outline" onClick={() => setParsedDiff(null)} title="إلغاء هذا الملف ورفع ملف مختلف">
                <X className="h-4 w-4 ml-1" /> رفع ملف مختلف
              </Button>
            )}

            <Button variant="outline" onClick={() => setUploadOpen(false)}>إلغاء</Button>
            {parsedDiff && (
              <Button onClick={confirmUpdate} disabled={applying}>
                {applying ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : null}
                تأكيد التحديث ({parsedDiff.length})
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConditionalLayout>
  );
}
