import { useEffect, useMemo, useRef, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Wallet, Plus, Search, Pencil, Trash2, FileDown, CalendarDays, Tag, TrendingUp, Filter, X } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

interface Row {
  id: string;
  owner_user_id: string;
  amount: number;
  description: string;
  category: string | null;
  expense_datetime: string;
  notes: string | null;
}

const OWNER_EMAIL = "an.ayoub98@gmail.com";
const monthColors = [
  "from-rose-500/15 to-rose-500/5 border-rose-400/30 text-rose-700 dark:text-rose-300",
  "from-amber-500/15 to-amber-500/5 border-amber-400/30 text-amber-700 dark:text-amber-300",
  "from-emerald-500/15 to-emerald-500/5 border-emerald-400/30 text-emerald-700 dark:text-emerald-300",
  "from-sky-500/15 to-sky-500/5 border-sky-400/30 text-sky-700 dark:text-sky-300",
  "from-violet-500/15 to-violet-500/5 border-violet-400/30 text-violet-700 dark:text-violet-300",
  "from-teal-500/15 to-teal-500/5 border-teal-400/30 text-teal-700 dark:text-teal-300",
];

function fmtDT(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function monthKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("ar-EG", { month: "long", year: "numeric" });
}

export default function PersonalExpenses() {
  const { user } = useAuth();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  // filters
  const [q, setQ] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("__all__");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  // dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({
    amount: "",
    description: "",
    category: "",
    expense_datetime: toLocalInput(new Date().toISOString()),
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [delRow, setDelRow] = useState<Row | null>(null);
  const pdfRef = useRef<HTMLDivElement>(null);
  const [pdfMonth, setPdfMonth] = useState<string | null>(null);

  // Resolve owner + access
  useEffect(() => {
    if (!user) return;
    (async () => {
      const isPersonalOwner = (user.email || "").toLowerCase() === OWNER_EMAIL;
      if (isPersonalOwner) {
        setOwnerId(user.id);
        setCanEdit(true);
      } else {
        const { data } = await supabase
          .from("owner_expenses_access" as any)
          .select("owner_user_id, can_edit")
          .eq("granted_user_id", user.id)
          .maybeSingle();
        if (data) {
          setOwnerId((data as any).owner_user_id);
          setCanEdit(!!(data as any).can_edit);
        }
      }
    })();
  }, [user]);

  const load = async () => {
    if (!ownerId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("owner_personal_expenses" as any)
      .select("*")
      .eq("owner_user_id", ownerId)
      .order("expense_datetime", { ascending: false });
    if (error) toast.error(error.message);
    else setRows((data || []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ownerId]);

  // realtime
  useEffect(() => {
    if (!ownerId) return;
    const ch = supabase
      .channel(`ope-${ownerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "owner_personal_expenses", filter: `owner_user_id=eq.${ownerId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [ownerId]);

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => { if (r.category && r.category.trim()) s.add(r.category.trim()); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ar"));
  }, [rows]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const min = minAmount ? Number(minAmount) : null;
    const max = maxAmount ? Number(maxAmount) : null;
    const from = fromDate ? new Date(fromDate).getTime() : null;
    const to = toDate ? new Date(toDate + "T23:59:59").getTime() : null;
    return rows.filter(r => {
      if (qq) {
        const hay = `${r.description} ${r.category ?? ""} ${r.notes ?? ""}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      if (filterCategory !== "__all__" && (r.category ?? "") !== filterCategory) return false;
      const t = new Date(r.expense_datetime).getTime();
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      if (min !== null && r.amount < min) return false;
      if (max !== null && r.amount > max) return false;
      return true;
    });
  }, [rows, q, fromDate, toDate, filterCategory, minAmount, maxAmount]);

  const monthlyTotals = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    filtered.forEach(r => {
      const k = monthKey(r.expense_datetime);
      const cur = map.get(k) || { total: 0, count: 0 };
      cur.total += Number(r.amount);
      cur.count += 1;
      map.set(k, cur);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([k, v]) => ({ key: k, ...v }));
  }, [filtered]);

  const grandTotal = useMemo(() => filtered.reduce((s, r) => s + Number(r.amount), 0), [filtered]);

  const openAdd = () => {
    setEditing(null);
    setForm({
      amount: "",
      description: "",
      category: "",
      expense_datetime: toLocalInput(new Date().toISOString()),
      notes: "",
    });
    setDialogOpen(true);
  };
  const openEdit = (r: Row) => {
    setEditing(r);
    setForm({
      amount: String(r.amount),
      description: r.description,
      category: r.category ?? "",
      expense_datetime: toLocalInput(r.expense_datetime),
      notes: r.notes ?? "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!ownerId) return;
    const amt = Number(form.amount);
    if (!amt || amt < 0) return toast.error("أدخل مبلغ صحيح");
    if (!form.description.trim()) return toast.error("أدخل وصف");
    if (!form.expense_datetime) return toast.error("أدخل التاريخ والوقت");
    setSaving(true);
    const payload: any = {
      owner_user_id: ownerId,
      amount: amt,
      description: form.description.trim(),
      category: form.category.trim() || null,
      expense_datetime: new Date(form.expense_datetime).toISOString(),
      notes: form.notes.trim() || null,
    };
    let res;
    if (editing) res = await supabase.from("owner_personal_expenses" as any).update(payload).eq("id", editing.id);
    else res = await supabase.from("owner_personal_expenses" as any).insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success(editing ? "تم التعديل" : "تمت الإضافة");
    setDialogOpen(false);
    load();
  };

  const remove = async () => {
    if (!delRow) return;
    const { error } = await supabase.from("owner_personal_expenses" as any).delete().eq("id", delRow.id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    setDelRow(null);
    load();
  };

  const exportMonthPDF = async (mkey: string) => {
    setPdfMonth(mkey);
    // wait for offscreen render
    await new Promise(r => setTimeout(r, 60));
    const node = pdfRef.current;
    if (!node) { setPdfMonth(null); return; }
    try {
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW - 40;
      const imgH = (canvas.height * imgW) / canvas.width;
      let y = 20;
      if (imgH <= pageH - 40) {
        pdf.addImage(img, "PNG", 20, y, imgW, imgH);
      } else {
        // slice
        let remaining = imgH;
        let sY = 0;
        const pageContentH = pageH - 40;
        const ratio = imgW / canvas.width;
        const slicePx = pageContentH / ratio;
        while (remaining > 0) {
          const sliceCanvas = document.createElement("canvas");
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = Math.min(slicePx, canvas.height - sY);
          const ctx = sliceCanvas.getContext("2d")!;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(canvas, 0, sY, canvas.width, sliceCanvas.height, 0, 0, canvas.width, sliceCanvas.height);
          const sImg = sliceCanvas.toDataURL("image/png");
          const sH = sliceCanvas.height * ratio;
          pdf.addImage(sImg, "PNG", 20, 20, imgW, sH);
          sY += sliceCanvas.height;
          remaining -= sliceCanvas.height;
          if (remaining > 0) pdf.addPage();
        }
      }
      pdf.save(`personal-expenses-${mkey}.pdf`);
    } catch (e: any) {
      toast.error("فشل تصدير PDF: " + (e?.message || ""));
    } finally {
      setPdfMonth(null);
    }
  };

  const pdfMonthRows = useMemo(() => pdfMonth ? filtered.filter(r => monthKey(r.expense_datetime) === pdfMonth) : [], [pdfMonth, filtered]);
  const pdfMonthTotal = useMemo(() => pdfMonthRows.reduce((s, r) => s + Number(r.amount), 0), [pdfMonthRows]);

  const clearFilters = () => {
    setQ(""); setFromDate(""); setToDate(""); setFilterCategory("__all__"); setMinAmount(""); setMaxAmount("");
  };

  if (!user) return null;

  if (!ownerId) {
    return (
      <AdminLayout>
        <PageHeader title="المصاريف الشخصية" subtitle="سجل خاص بصاحب الشركة" />
        <Card className="p-8 text-center text-muted-foreground">
          ليس لديك صلاحية الاطلاع على هذا السجل. لطلب الوصول تواصل مع صاحب الشركة.
        </Card>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <PageHeader
        title="المصاريف الشخصية"
        subtitle="دفتر خاص بصاحب الشركة — منفصل تماماً عن حسابات النظام"
      />

      {/* Summary strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5 bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">إجمالي (بعد الفلاتر)</div>
              <div className="text-3xl font-extrabold mt-1">{grandTotal.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} <span className="text-base font-semibold text-muted-foreground">ج.م</span></div>
            </div>
            <TrendingUp className="w-10 h-10 text-primary/60" />
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-muted-foreground">عدد المصاريف</div>
          <div className="text-3xl font-extrabold mt-1">{filtered.length.toLocaleString("ar-EG")}</div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-muted-foreground">عدد الشهور النشطة</div>
          <div className="text-3xl font-extrabold mt-1">{monthlyTotals.length.toLocaleString("ar-EG")}</div>
        </Card>
      </div>

      {/* Actions + Filters */}
      <Card className="p-4 mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Filter className="w-4 h-4 text-primary" /> بحث متقدم
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={clearFilters}><X className="w-4 h-4 ml-1" />مسح الفلاتر</Button>
            {canEdit && (
              <Button size="sm" onClick={openAdd} className="bg-primary"><Plus className="w-4 h-4 ml-1" />إضافة مصروف</Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="ابحث في الوصف / الملاحظات / التصنيف" value={q} onChange={e => setQ(e.target.value)} className="pr-9" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">من تاريخ</Label>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">التصنيف</Label>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">كل التصنيفات</SelectItem>
                {allCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">من مبلغ</Label>
              <Input type="number" value={minAmount} onChange={e => setMinAmount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">إلى مبلغ</Label>
              <Input type="number" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} />
            </div>
          </div>
        </div>
      </Card>

      {/* Monthly totals */}
      {monthlyTotals.length > 0 && (
        <div className="mb-6">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-primary" /> الإجماليات الشهرية</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {monthlyTotals.map((m, idx) => (
              <Card key={m.key} className={`p-4 bg-gradient-to-br border ${monthColors[idx % monthColors.length]}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs opacity-80">{monthLabel(m.key)}</div>
                    <div className="text-2xl font-extrabold mt-1">{m.total.toLocaleString("ar-EG", { maximumFractionDigits: 2 })}<span className="text-sm mr-1">ج.م</span></div>
                    <div className="text-xs mt-1 opacity-70">{m.count} مصروف</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => exportMonthPDF(m.key)} title="تصدير PDF لهذا الشهر">
                    <FileDown className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-3 font-semibold">التاريخ والوقت</th>
                <th className="p-3 font-semibold">الوصف</th>
                <th className="p-3 font-semibold">التصنيف</th>
                <th className="p-3 font-semibold">المبلغ</th>
                <th className="p-3 font-semibold">ملاحظات</th>
                {canEdit && <th className="p-3 font-semibold text-center">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">جاري التحميل...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">لا توجد مصاريف</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 whitespace-nowrap">{fmtDT(r.expense_datetime)}</td>
                  <td className="p-3 font-medium">{r.description}</td>
                  <td className="p-3">
                    {r.category ? <Badge variant="secondary" className="gap-1"><Tag className="w-3 h-3" />{r.category}</Badge> : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="p-3 font-bold text-primary whitespace-nowrap">{Number(r.amount).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</td>
                  <td className="p-3 text-muted-foreground text-xs max-w-[240px] truncate" title={r.notes || ""}>{r.notes || "—"}</td>
                  {canEdit && (
                    <td className="p-3 text-center whitespace-nowrap">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setDelRow(r)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل مصروف" : "إضافة مصروف جديد"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>المبلغ (ج.م) *</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <Label>التاريخ والوقت *</Label>
                <Input type="datetime-local" value={form.expense_datetime} onChange={e => setForm({ ...form, expense_datetime: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>الوصف *</Label>
              <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="مثال: عشاء عائلة" />
            </div>
            <div>
              <Label>التصنيف</Label>
              <Input
                list="ope-categories"
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                placeholder="اكتب تصنيف جديد أو اختر من السابق"
              />
              <datalist id="ope-categories">
                {allCategories.map(c => <option key={c} value={c} />)}
              </datalist>
              {allCategories.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {allCategories.slice(0, 12).map(c => (
                    <button key={c} type="button" onClick={() => setForm({ ...form, category: c })}
                      className="text-xs px-2 py-1 rounded-full bg-muted hover:bg-primary/10 border">
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!delRow} onOpenChange={o => !o && setDelRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المصروف؟</AlertDialogTitle>
            <AlertDialogDescription>
              هيتم حذف "{delRow?.description}" بمبلغ {delRow ? Number(delRow.amount).toLocaleString("ar-EG") : ""} ج.م. الحذف نهائي.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Offscreen PDF template */}
      <div style={{ position: "fixed", left: -99999, top: 0, width: 800 }}>
        {pdfMonth && (
          <div ref={pdfRef} dir="rtl" style={{ background: "#fff", padding: 28, fontFamily: "system-ui, 'Segoe UI', Tahoma, Arial" }}>
            <div style={{ borderBottom: "3px solid #0f766e", paddingBottom: 12, marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f2c3f" }}>المصاريف الشخصية</div>
                <div style={{ fontSize: 13, color: "#6b7a86", marginTop: 4 }}>{monthLabel(pdfMonth)}</div>
              </div>
              <div style={{ fontSize: 11, color: "#6b7a86" }}>تاريخ الطباعة: {new Date().toLocaleString("ar-EG")}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div style={{ background: "#e6f4f1", border: "1px solid #99d3c9", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#0f766e" }}>إجمالي الشهر</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f2c3f" }}>{pdfMonthTotal.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</div>
              </div>
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8ee", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#6b7a86" }}>عدد المصاريف</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f2c3f" }}>{pdfMonthRows.length.toLocaleString("ar-EG")}</div>
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#0f766e", color: "#fff" }}>
                  <th style={{ padding: 8, textAlign: "right" }}>التاريخ والوقت</th>
                  <th style={{ padding: 8, textAlign: "right" }}>الوصف</th>
                  <th style={{ padding: 8, textAlign: "right" }}>التصنيف</th>
                  <th style={{ padding: 8, textAlign: "right" }}>المبلغ</th>
                  <th style={{ padding: 8, textAlign: "right" }}>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {pdfMonthRows.map((r, i) => (
                  <tr key={r.id} style={{ background: i % 2 ? "#f8fafc" : "#fff", borderBottom: "1px solid #e2e8ee" }}>
                    <td style={{ padding: 8 }}>{fmtDT(r.expense_datetime)}</td>
                    <td style={{ padding: 8, fontWeight: 600 }}>{r.description}</td>
                    <td style={{ padding: 8 }}>{r.category || "—"}</td>
                    <td style={{ padding: 8, color: "#0f766e", fontWeight: 700 }}>{Number(r.amount).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</td>
                    <td style={{ padding: 8, color: "#6b7a86" }}>{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "#eef7f5" }}>
                  <td colSpan={3} style={{ padding: 10, fontWeight: 800, textAlign: "left", color: "#0f2c3f" }}>الإجمالي</td>
                  <td style={{ padding: 10, fontWeight: 800, color: "#0f766e" }}>{pdfMonthTotal.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
