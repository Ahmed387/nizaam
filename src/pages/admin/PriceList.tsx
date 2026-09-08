import { edgeErrorMessage } from "@/lib/edgeError";
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
import { Plus, Upload, Trash2, Loader2, Search, X, FileUp, Pencil, Percent, CheckSquare } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { confirmAlert } from "@/components/ConfirmDialog";
import { normalizeSheetRow, decodeTextFile } from "@/lib/priceListColumns";

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
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [editForm, setEditForm] = useState<Partial<Item>>({});
  const [savingItem, setSavingItem] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState<"display_price" | "suggested_sell_price" | "cost_price">("display_price");
  const [bulkMode, setBulkMode] = useState<"percent" | "amount">("percent");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkScope, setBulkScope] = useState<"all" | "selected">("all");
  const [bulkBusy, setBulkBusy] = useState(false);


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
    if (!(await confirmAlert({ title: "حذف هذا الصنف؟", description: "الخطوة دي مش هتترجع تاني — متأكد؟", confirmLabel: "أيوه، امسح", cancelLabel: "لأ، سيبها", tone: "danger" }))) return;
    const { error } = await supabase.from("price_list_items").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  // -------- rename supplier --------
  const renameSupplier = async () => {
    if (!renameId) return;
    const n = renameValue.trim();
    if (!n) return toast.error("اكتب اسم المورد");
    const before = sources.find((s) => s.id === renameId);
    const { error } = await supabase.from("price_list_sources").update({ supplier_name: n }).eq("id", renameId);
    if (error) return toast.error(error.message);
    if (user && profile) {
      await logAudit({
        userId: user.id, userName: profile.name, tenantId,
        action: "UPDATE", entity: "price_list_source", entityId: renameId,
        details: { changes: { supplier_name: { from: before?.supplier_name, to: n } } },
      });
    }
    toast.success("تم تعديل اسم المورد");
    setRenameId(null);
    load();
  };

  // -------- edit single item --------
  const openEdit = (item: Item) => {
    setEditItem(item);
    setEditForm({
      product_name: item.product_name,
      model_code: item.model_code ?? "",
      category: item.category ?? "",
      cost_price: item.cost_price,
      suggested_sell_price: item.suggested_sell_price,
      display_price: item.display_price,
    });
  };

  const saveEdit = async () => {
    if (!editItem) return;
    const name = String(editForm.product_name ?? "").trim();
    if (!name) return toast.error("اسم المنتج مطلوب");
    setSavingItem(true);
    await updateItemField(editItem.id, {
      product_name: name,
      model_code: String(editForm.model_code ?? "").trim() || null,
      category: String(editForm.category ?? "").trim() || null,
      cost_price: Number(editForm.cost_price) || 0,
      suggested_sell_price: Number(editForm.suggested_sell_price) || 0,
      display_price: Number(editForm.display_price) || 0,
    });
    setSavingItem(false);
    setEditItem(null);
    toast.success("تم حفظ التعديل");
  };

  // -------- bulk price adjustment --------
  const bulkTargets = () =>
    bulkScope === "selected" ? currentItems.filter((i) => selected.has(i.id)) : currentItems;

  const applyBulk = async () => {
    const v = Number(bulkValue);
    if (isNaN(v) || v === 0) return toast.error("اكتب قيمة التعديل");
    const targets = bulkTargets();
    if (!targets.length) return toast.error("لا توجد أصناف مختارة");
    setBulkBusy(true);
    const updates = targets.map((it) => {
      const base = Number((it as any)[bulkField]) || 0;
      const next = bulkMode === "percent" ? base * (1 + v / 100) : base + v;
      return { id: it.id, value: Math.max(0, Math.round(next * 100) / 100) };
    });
    let failed = 0;
    for (const u of updates) {
      const { error } = await supabase.from("price_list_items").update({ [bulkField]: u.value } as any).eq("id", u.id);
      if (error) failed++;
    }
    if (user && profile) {
      await logAudit({
        userId: user.id, userName: profile.name, tenantId,
        action: "UPDATE", entity: "price_list_bulk", entityId: activeTab,
        details: { field: bulkField, mode: bulkMode, value: v, count: updates.length },
      });
    }
    setBulkBusy(false);
    setBulkOpen(false);
    setBulkValue("");
    if (failed) toast.error(`فشل تعديل ${failed} صنف`);
    else toast.success(`تم تعديل ${updates.length} صنف`);
    load();
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const allSelected = currentItems.length > 0 && currentItems.every((i) => selected.has(i.id));
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(currentItems.map((i) => i.id)));



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
        const plErr = await edgeErrorMessage(error, data);
        if (plErr) throw new Error(plErr);
        parsed = (data?.products ?? []) as ParsedItem[];
      } else {
        // Excel/CSV parse client-side through the unified column dictionary
        const isCsv = /\.(csv|txt)$/i.test(file.name);
        const wb = isCsv
          ? XLSX.read(await decodeTextFile(file), { type: "string", raw: false })
          : XLSX.read(await file.arrayBuffer(), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        parsed = rows
          .map((r) => normalizeSheetRow(r) as ParsedItem)
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
                <TabsTrigger
                  key={s.id}
                  value={s.id}
                  title="دبل كليك لتعديل الاسم"
                  onDoubleClick={() => { setRenameId(s.id); setRenameValue(s.supplier_name); }}
                >
                  {s.supplier_name}
                </TabsTrigger>
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
                  <Button variant="outline" onClick={() => { setBulkOpen(true); setBulkScope(selected.size ? "selected" : "all"); }}>
                    <Percent className="h-4 w-4 ml-1" /> تعديل جماعي للأسعار
                  </Button>
                  <Button variant="outline" onClick={() => { setUploadOpen(true); setParsedDiff(null); }}>
                    <Upload className="h-4 w-4 ml-1" /> تحديث القائمة
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => { setRenameId(s.id); setRenameValue(s.supplier_name); }} title="تعديل اسم المورد">
                    <Pencil className="h-4 w-4" />
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

              {selected.size > 0 && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  <span className="font-medium flex items-center gap-2"><CheckSquare className="h-4 w-4 text-primary" /> تم اختيار {selected.size} صنف</span>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { setBulkScope("selected"); setBulkOpen(true); }}>تعديل أسعار المختار</Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>إلغاء التحديد</Button>
                  </div>
                </div>
              )}

              <div className="border rounded-lg bg-card overflow-x-auto" dir="rtl">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-10 text-center">
                        <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="تحديد الكل" />
                      </TableHead>
                      <TableHead className="text-center font-semibold min-w-[220px]">اسم المنتج</TableHead>
                      <TableHead className="text-center font-semibold">الموديل</TableHead>
                      <TableHead className="text-center font-semibold">سعر الشراء</TableHead>
                      <TableHead className="text-center font-semibold">سعر البيع المقترح</TableHead>
                      <TableHead className="text-center font-semibold">السعر المعروض للكاشير</TableHead>
                      <TableHead className="text-center font-semibold">ظاهر</TableHead>
                      <TableHead className="text-center font-semibold">الفئة</TableHead>
                      <TableHead className="w-24 text-center font-semibold">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentItems.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">لا توجد منتجات — حدّث القائمة من الزر أعلاه</TableCell></TableRow>
                    ) : currentItems.map((item) => (
                      <TableRow
                        key={item.id}
                        className="hover:bg-muted/30 transition-colors align-middle"
                        onDoubleClick={() => openEdit(item)}
                        title="دبل كليك لتعديل الصنف"
                      >
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggleSelect(item.id)} />
                        </TableCell>
                        <TableCell
                          className="font-medium text-center align-middle"
                          style={{ unicodeBidi: "plaintext", whiteSpace: "normal", overflowWrap: "normal", wordBreak: "normal" }}
                        >
                          {item.product_name}
                        </TableCell>
                        <TableCell
                          className="text-center align-middle text-sm text-muted-foreground font-mono"
                          style={{ unicodeBidi: "plaintext", whiteSpace: "normal" }}
                        >
                          {item.model_code ?? "—"}
                        </TableCell>
                        <TableCell className="text-center align-middle tabular-nums whitespace-nowrap">{formatEGP(item.cost_price)}</TableCell>
                        <TableCell className="text-center align-middle tabular-nums text-muted-foreground whitespace-nowrap">{formatEGP(item.suggested_sell_price)}</TableCell>
                        <TableCell className="text-center align-middle" onClick={(e) => e.stopPropagation()}>
                          <Input
                            key={`${item.id}-${item.display_price}`}
                            type="number"
                            className="w-28 mx-auto text-center tabular-nums font-semibold"
                            defaultValue={item.display_price}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (!isNaN(v) && v !== item.display_price) updateItemField(item.id, { display_price: v });
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-center align-middle">
                          <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <Switch variant="premium" checked={item.is_active} onCheckedChange={(v) => updateItemField(item.id, { is_active: v })} />
                            <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium transition-colors", item.is_active ? "bg-success/10 border-success/30 text-success" : "bg-muted/50 border-border text-muted-foreground")}>
                              <span className={cn("w-1.5 h-1.5 rounded-full", item.is_active ? "bg-success animate-pulse" : "bg-muted-foreground")} />
                              <span>{item.is_active ? "ظاهر" : "مخفي"}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center align-middle text-sm">{item.category ?? "—"}</TableCell>
                        <TableCell className="text-center align-middle" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(item)} title="تعديل الصنف">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteItem(item.id)} title="حذف">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
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

      {/* Rename supplier dialog */}
      <Dialog open={!!renameId} onOpenChange={(o) => !o && setRenameId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تعديل اسم المورد</DialogTitle>
            <DialogDescription>الاسم الجديد هيظهر في كل الأماكن المرتبطة بالقائمة</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>اسم المورد</Label>
            <Input value={renameValue} autoFocus onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && renameSupplier()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameId(null)}>إلغاء</Button>
            <Button onClick={renameSupplier}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit item dialog */}
      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>تعديل الصنف</DialogTitle>
            <DialogDescription>تقدر تعدل الاسم أو الموديل أو الفئة أو الأسعار</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>اسم المنتج</Label>
              <Input value={String(editForm.product_name ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, product_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>الموديل</Label>
              <Input value={String(editForm.model_code ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, model_code: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>الفئة</Label>
              <Input value={String(editForm.category ?? "")} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>سعر الشراء</Label>
              <Input type="number" value={String(editForm.cost_price ?? 0)} onChange={(e) => setEditForm((f) => ({ ...f, cost_price: Number(e.target.value) }))} />
            </div>
            <div className="space-y-1.5">
              <Label>سعر البيع المقترح</Label>
              <Input type="number" value={String(editForm.suggested_sell_price ?? 0)} onChange={(e) => setEditForm((f) => ({ ...f, suggested_sell_price: Number(e.target.value) }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>السعر المعروض للكاشير</Label>
              <Input type="number" value={String(editForm.display_price ?? 0)} onChange={(e) => setEditForm((f) => ({ ...f, display_price: Number(e.target.value) }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>إلغاء</Button>
            <Button onClick={saveEdit} disabled={savingItem}>
              {savingItem && <Loader2 className="h-4 w-4 ml-2 animate-spin" />} حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk price adjustment dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل جماعي للأسعار</DialogTitle>
            <DialogDescription>زوّد أو قلّل الأسعار بنسبة مئوية أو بمبلغ ثابت</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>السعر المستهدف</Label>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                {([["display_price", "المعروض للكاشير"], ["suggested_sell_price", "البيع المقترح"], ["cost_price", "الشراء"]] as const).map(([k, l]) => (
                  <Button key={k} type="button" size="sm" variant={bulkField === k ? "default" : "ghost"} onClick={() => setBulkField(k)}>{l}</Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>النطاق</Label>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                <Button type="button" size="sm" variant={bulkScope === "all" ? "default" : "ghost"} onClick={() => setBulkScope("all")}>كل الأصناف ({currentItems.length})</Button>
                <Button type="button" size="sm" variant={bulkScope === "selected" ? "default" : "ghost"} onClick={() => setBulkScope("selected")} disabled={!selected.size}>المختار ({selected.size})</Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>طريقة التعديل</Label>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                <Button type="button" size="sm" variant={bulkMode === "percent" ? "default" : "ghost"} onClick={() => setBulkMode("percent")}>نسبة %</Button>
                <Button type="button" size="sm" variant={bulkMode === "amount" ? "default" : "ghost"} onClick={() => setBulkMode("amount")}>مبلغ ثابت</Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>القيمة ({bulkMode === "percent" ? "مثال: 2 للزيادة 2% أو -2 للتخفيض" : "مثال: 50 أو -50"})</Label>
              <Input type="number" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder={bulkMode === "percent" ? "2" : "50"} />
            </div>
            <p className="text-xs text-muted-foreground">هيتم التعديل على {bulkTargets().length} صنف.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>إلغاء</Button>
            <Button onClick={applyBulk} disabled={bulkBusy}>
              {bulkBusy && <Loader2 className="h-4 w-4 ml-2 animate-spin" />} تطبيق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


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
                        <TableCell dir="ltr" style={{ unicodeBidi: "plaintext", whiteSpace: "pre-wrap", textAlign: "start" }}>{d.parsed.product_name}</TableCell>
                        <TableCell dir="ltr" style={{ unicodeBidi: "plaintext", whiteSpace: "pre-wrap", textAlign: "start" }} className="text-sm text-muted-foreground">{d.parsed.model_code ?? "—"}</TableCell>
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
