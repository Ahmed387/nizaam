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
import { Wallet, Plus, Search, Pencil, Trash2, FileDown, FileSpreadsheet, CalendarDays, Tag, TrendingUp, TrendingDown, Filter, X, Sparkles, Receipt, Bell, PartyPopper, Flame, Crown, Minus, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, BarChart3 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";
import { RankBars, ShareBreakdown } from "@/components/charts/RankBars";
import { HighlightTiles, StackedBars } from "@/components/charts/HighlightPanel";
import { Checkbox } from "@/components/ui/checkbox";


interface Row {
  id: string;
  owner_user_id: string;
  amount: number;
  description: string;
  category: string | null;
  expense_datetime: string;
  notes: string | null;
}

interface Deposit {
  id: string;
  owner_user_id: string;
  amount: number;
  description: string | null;
  category: string | null;
  deposit_datetime: string;
  notes: string | null;
}

const OWNER_EMAIL = "an.ayoub98@gmail.com";
const OWNER_NAME = "حج ناصر";

/** تحية حسب وقت اليوم */
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "ليلة هادية يا";
  if (h < 12) return "صباح الخير يا";
  if (h < 16) return "نهارك سعيد يا";
  if (h < 19) return "مساء الخير يا";
  if (h < 23) return "مساء الفل يا";
  return "تصبح على خير يا";
}


const EGP = (n: number) => `${n.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;

/** توست ملوّن */
const fancyToast = {
  success: (title: string, description?: string) =>
    toast.success(title, {
      description,
      duration: 4000,
      className: "border-emerald-400/50",
      style: {
        background: "linear-gradient(90deg, hsl(152 60% 42% / 0.16), hsl(152 60% 42% / 0.04))",
        borderInlineStartWidth: "5px",
        borderInlineStartColor: "hsl(152 60% 42%)",
      },
    }),
  info: (title: string, description?: string) =>
    toast(title, {
      description,
      duration: 5000,
      style: {
        background: "linear-gradient(90deg, hsl(217 91% 60% / 0.16), hsl(217 91% 60% / 0.04))",
        borderInlineStartWidth: "5px",
        borderInlineStartColor: "hsl(217 91% 60%)",
      },
    }),
  warn: (title: string, description?: string) =>
    toast.warning(title, {
      description,
      duration: 6000,
      style: {
        background: "linear-gradient(90deg, hsl(38 92% 50% / 0.18), hsl(38 92% 50% / 0.04))",
        borderInlineStartWidth: "5px",
        borderInlineStartColor: "hsl(38 92% 50%)",
      },
    }),
  danger: (title: string, description?: string) =>
    toast.error(title, {
      description,
      duration: 5000,
      style: {
        background: "linear-gradient(90deg, hsl(0 84% 60% / 0.16), hsl(0 84% 60% / 0.04))",
        borderInlineStartWidth: "5px",
        borderInlineStartColor: "hsl(0 84% 60%)",
      },
    }),
};

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
function toDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
function monthShort(key: string) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("ar-EG", { month: "short" });
}

const CATEGORY_PALETTES = [
  "bg-rose-500 text-white border-rose-600",
  "bg-amber-500 text-white border-amber-600",
  "bg-emerald-500 text-white border-emerald-600",
  "bg-sky-500 text-white border-sky-600",
  "bg-violet-500 text-white border-violet-600",
  "bg-teal-500 text-white border-teal-600",
  "bg-fuchsia-500 text-white border-fuchsia-600",
  "bg-orange-500 text-white border-orange-600",
  "bg-indigo-500 text-white border-indigo-600",
  "bg-lime-600 text-white border-lime-700",
];
function categoryColor(cat: string) {
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTES[h % CATEGORY_PALETTES.length];
}


export default function PersonalExpenses() {
  const { user, profile, isOwner } = useAuth();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [view, setView] = useState<"expenses" | "deposits">("expenses");

  // filters
  const [q, setQ] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  /** فلتر التصنيفات — فاضي = كل التصنيفات، وممكن تختار أكتر من تصنيف */
  const [filterCats, setFilterCats] = useState<string[]>([]);
  const [catFilterOpen, setCatFilterOpen] = useState(false);
  const toggleFilterCat = (c: string) =>
    setFilterCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  /** فلتر السنة — جزء من البحث المتقدم ("" = كل السنين) */
  const [filterYear, setFilterYear] = useState("");


  // اختيار الشهور — فاضية = كل الشهور (الإجمالي). ممكن تختار أكتر من شهر وأكتر من سنة
  const [selMonths, setSelMonths] = useState<string[]>([]);
  const [periodOpen, setPeriodOpen] = useState(false);
  const isAll = selMonths.length === 0;
  const singleMonth = selMonths.length === 1 ? selMonths[0] : null;
  /** للتوافق مع باقي الشاشة: شهر واحد مختار أو "__all__" */
  const activeTab = singleMonth ?? "__all__";
  const inSel = (iso: string) => isAll || selMonths.includes(monthKey(iso));
  const toggleMonth = (k: string) =>
    setSelMonths(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k].sort((a, b) => b.localeCompare(a)));

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

  // deposits dialog
  const [depDialogOpen, setDepDialogOpen] = useState(false);
  const [editingDep, setEditingDep] = useState<Deposit | null>(null);
  const [depForm, setDepForm] = useState({ amount: "", description: "", category: "", deposit_datetime: toLocalInput(new Date().toISOString()), notes: "" });
  const [savingDep, setSavingDep] = useState(false);
  const [delDep, setDelDep] = useState<Deposit | null>(null);
  // حقول ناقصة في الفورم (بتتعرض في Alert شيك جوه الديالوج)
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [depErrors, setDepErrors] = useState<string[]>([]);
  const pdfRef = useRef<HTMLDivElement>(null);
  const [pdfMonth, setPdfMonth] = useState<string | null>(null);

  // عرض تفاصيل تصنيف معين (يفتح بالضغط على أي صف في جدول المصروفات) — "" تعني "بدون تصنيف"
  const [catDetail, setCatDetail] = useState<string | null>(null);
  const [catFrom, setCatFrom] = useState("");
  const [catTo, setCatTo] = useState("");

  // تخصيص صاحب الشركة
  // صاحب الشركة = دور owner (أو الإيميل المسجّل كصاحب الدفتر الشخصي)
  const isPersonalOwner = isOwner || (user?.email || "").toLowerCase() === OWNER_EMAIL;
  const ownerDisplayName = isPersonalOwner ? OWNER_NAME : (profile?.name?.trim() || OWNER_NAME);

  const greetedRef = useRef(false);
  const [celebrate, setCelebrate] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [bellRing, setBellRing] = useState(false);
  const [seenAlerts, setSeenAlerts] = useState<string[]>([]);

  // Resolve owner + access
  useEffect(() => {
    if (!user) return;
    (async () => {
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
  }, [user, isPersonalOwner]);

  const load = async () => {
    if (!ownerId) return;
    setLoading(true);
    const [expRes, depRes] = await Promise.all([
      supabase.from("owner_personal_expenses" as any).select("*").eq("owner_user_id", ownerId).order("expense_datetime", { ascending: false }),
      supabase.from("owner_personal_deposits" as any).select("*").eq("owner_user_id", ownerId).order("deposit_datetime", { ascending: false }),
    ]);
    if (expRes.error) toast.error(expRes.error.message);
    else setRows((expRes.data || []) as any);
    if (depRes.error) toast.error(depRes.error.message);
    else setDeposits((depRes.data || []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ownerId]);

  // تحية ترحيبية لصاحب الشركة (مرة واحدة كل جلسة فتح للصفحة)
  useEffect(() => {
    if (!isPersonalOwner || !ownerId || greetedRef.current) return;
    greetedRef.current = true;
    setCelebrate(true);
    const t1 = setTimeout(() => {
      fancyToast.info(`${greeting()} ${ownerDisplayName} 👋`, "دفترك الشخصي جاهز — كل حاجة هنا خاصة بيك لوحدك");
    }, 500);
    const t2 = setTimeout(() => setCelebrate(false), 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line
  }, [isPersonalOwner, ownerId]);

  // realtime + إشعارات فورية
  useEffect(() => {
    if (!ownerId) return;
    const ch = supabase
      .channel(`ope-${ownerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "owner_personal_expenses", filter: `owner_user_id=eq.${ownerId}` },
        (payload: any) => {
          if (isPersonalOwner) {
            const rec: any = payload.new || payload.old;
            const amt = Number(rec?.amount || 0);
            setBellRing(true);
            setTimeout(() => setBellRing(false), 1200);
            if (payload.eventType === "INSERT") {
              fancyToast.success(`مصروف جديد: ${EGP(amt)}`, rec?.description || undefined);
            } else if (payload.eventType === "UPDATE") {
              fancyToast.info("تم تعديل مصروف", rec?.description || undefined);
            } else if (payload.eventType === "DELETE") {
              fancyToast.warn("تم حذف مصروف", rec?.description || undefined);
            }
          }
          load();
        }
      )
      .subscribe();
    const ch2 = supabase
      .channel(`opd-${ownerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "owner_personal_deposits", filter: `owner_user_id=eq.${ownerId}` },
        (payload: any) => {
          if (isPersonalOwner) {
            const rec: any = payload.new || payload.old;
            setBellRing(true);
            setTimeout(() => setBellRing(false), 1200);
            if (payload.eventType === "INSERT") {
              fancyToast.success(`إيداع جديد: ${EGP(Number(rec?.amount || 0))}`, rec?.description || undefined);
            } else if (payload.eventType === "UPDATE") {
              fancyToast.info("تم تعديل إيداع", rec?.description || undefined);
            } else if (payload.eventType === "DELETE") {
              fancyToast.warn("تم حذف إيداع", rec?.description || undefined);
            }
          }
          load();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); supabase.removeChannel(ch2); };
    // eslint-disable-next-line
  }, [ownerId, isPersonalOwner]);


  const allCategories = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => { if (r.category && r.category.trim()) s.add(r.category.trim()); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ar"));
  }, [rows]);

  const allDepCategories = useMemo(() => {
    const s = new Set<string>(["ميزانية شهرية", "راتب", "أرباح", "هدية", "مدخرات"]);
    deposits.forEach(d => { if (d.category && d.category.trim()) s.add(d.category.trim()); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ar"));
  }, [deposits]);

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
      if (filterCats.length > 0 && !filterCats.includes(r.category ?? "")) return false;
      const t = new Date(r.expense_datetime).getTime();
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      if (min !== null && r.amount < min) return false;
      if (max !== null && r.amount > max) return false;
      return true;
    });
  }, [rows, q, fromDate, toDate, filterCats, minAmount, maxAmount]);

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

  // Month tabs: every month that has data + current month (auto-created each month)
  const monthTabs = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    const cur = monthKey(new Date().toISOString());
    map.set(cur, { total: 0, count: 0 });
    rows.forEach(r => {
      const k = monthKey(r.expense_datetime);
      const v = map.get(k) || { total: 0, count: 0 };
      v.total += Number(r.amount);
      v.count += 1;
      map.set(k, v);
    });
    deposits.forEach(d => {
      const k = monthKey(d.deposit_datetime);
      if (!map.has(k)) map.set(k, { total: 0, count: 0 });
    });
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([k, v]) => ({ key: k, ...v }));
  }, [rows, deposits]);

  // إيداعات كل شهر
  const depositMonthTotals = useMemo(() => {
    const m = new Map<string, number>();
    deposits.forEach(d => {
      const k = monthKey(d.deposit_datetime);
      m.set(k, (m.get(k) || 0) + Number(d.amount));
    });
    return m;
  }, [deposits]);

  // رصيد المحفظة (مش متأثر بالفلاتر — بيتبع الشهور المختارة)
  const balSpent = useMemo(
    () => rows.filter(r => inSel(r.expense_datetime)).reduce((s, r) => s + Number(r.amount), 0),
    [rows, selMonths]
  );
  const balDeposited = useMemo(
    () => deposits.filter(d => inSel(d.deposit_datetime)).reduce((s, d) => s + Number(d.amount), 0),
    [deposits, selMonths]
  );
  const balRemaining = balDeposited - balSpent;

  const visibleDeposits = useMemo(
    () => deposits.filter(d => inSel(d.deposit_datetime)),
    [deposits, selMonths]
  );

  // Rows shown in the table = filters + الشهور المختارة
  const visible = useMemo(
    () => filtered.filter(r => inSel(r.expense_datetime)),
    [filtered, selMonths]
  );

  const grandTotal = useMemo(() => visible.reduce((s, r) => s + Number(r.amount), 0), [visible]);
  const grandTotalAllLabel = useMemo(
    () => rows.reduce((s, r) => s + Number(r.amount), 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 }) + " ج.م",
    [rows]
  );

  // ===== تفاصيل تصنيف معين: كل العمليات (كل التواريخ) + فلتر حر بالتاريخ =====
  const openCategory = (cat: string | null) => {
    setCatDetail((cat ?? "").trim());
    setCatFrom("");
    setCatTo("");
  };

  const catRows = useMemo(() => {
    if (catDetail === null) return [] as Row[];
    const from = catFrom ? new Date(catFrom + "T00:00:00").getTime() : null;
    const to = catTo ? new Date(catTo + "T23:59:59").getTime() : null;
    return rows
      .filter(r => (r.category?.trim() || "") === catDetail)
      .filter(r => {
        const t = new Date(r.expense_datetime).getTime();
        if (from !== null && t < from) return false;
        if (to !== null && t > to) return false;
        return true;
      })
      .sort((a, b) => new Date(b.expense_datetime).getTime() - new Date(a.expense_datetime).getTime());
  }, [rows, catDetail, catFrom, catTo]);

  const catStats = useMemo(() => {
    const total = catRows.reduce((s, r) => s + Number(r.amount), 0);
    const max = catRows.reduce((m, r) => Math.max(m, Number(r.amount)), 0);
    return { total, count: catRows.length, avg: catRows.length ? total / catRows.length : 0, max };
  }, [catRows]);

  // اختصارات فترات جاهزة للفلتر
  const catPresetThisMonth = () => {
    const d = new Date();
    setCatFrom(toDateInput(new Date(d.getFullYear(), d.getMonth(), 1)));
    setCatTo(toDateInput(new Date(d.getFullYear(), d.getMonth() + 1, 0)));
  };
  const catPresetLast3M = () => {
    const d = new Date();
    setCatFrom(toDateInput(new Date(d.getFullYear(), d.getMonth() - 2, 1)));
    setCatTo(toDateInput(d));
  };
  const catPresetAll = () => { setCatFrom(""); setCatTo(""); };

  const exportCategoryExcel = () => {
    if (catDetail === null || !catRows.length) return;
    const name = catDetail || "بدون تصنيف";
    const data = catRows.map(r => ({
      "التاريخ والوقت": fmtDT(r.expense_datetime),
      "الوصف": r.description,
      "المبلغ (ج.م)": Number(r.amount),
      "ملاحظات": r.notes || "",
    }));
    data.push({ "التاريخ والوقت": "", "الوصف": "الإجمالي", "المبلغ (ج.م)": catStats.total, "ملاحظات": `${catStats.count} عملية` });
    const ws = XLSX.utils.json_to_sheet(data);
    (ws as any)["!cols"] = [{ wch: 22 }, { wch: 40 }, { wch: 14 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 28));
    XLSX.writeFile(wb, `مصاريف-${name}.xlsx`);
  };
  const attachmentCounts = useAttachmentCounts("personal_expense", visible.map(r => r.id));
  const catAttachmentCounts = useAttachmentCounts("personal_expense", catRows.map(r => r.id));

  /** إشعارات ذكية لصاحب الشركة (محسوبة من نفس البيانات — من غير أي تغيير في المنطق المالي) */
  const alerts = useMemo(() => {
    if (!isPersonalOwner) return [] as { id: string; tone: "good" | "warn" | "info" | "hot"; title: string; body: string }[];
    const out: { id: string; tone: "good" | "warn" | "info" | "hot"; title: string; body: string }[] = [];
    const now = new Date();
    const curKey = monthKey(now.toISOString());
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = monthKey(prev.toISOString());
    const sum = (k: string) => rows.filter(r => monthKey(r.expense_datetime) === k).reduce((s, r) => s + Number(r.amount), 0);
    const curT = sum(curKey);
    const prevT = sum(prevKey);

    if (prevT > 0) {
      const diff = ((curT - prevT) / prevT) * 100;
      if (diff >= 15) out.push({ id: `up-${curKey}-${Math.round(diff)}`, tone: "warn", title: `مصاريف الشهر أعلى بـ ${Math.round(diff)}%`, body: `${EGP(curT)} مقابل ${EGP(prevT)} الشهر اللي فات` });
      else if (diff <= -15) out.push({ id: `down-${curKey}-${Math.round(diff)}`, tone: "good", title: `وفّرت ${Math.round(Math.abs(diff))}% الشهر ده 👏`, body: `${EGP(curT)} مقابل ${EGP(prevT)} الشهر اللي فات` });
    }

    // أعلى تصنيف في الشهر الحالي
    const catMap = new Map<string, number>();
    rows.filter(r => monthKey(r.expense_datetime) === curKey).forEach(r => {
      const c = (r.category || "بدون تصنيف").trim();
      catMap.set(c, (catMap.get(c) || 0) + Number(r.amount));
    });
    const top = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1])[0];
    if (top && curT > 0) out.push({ id: `top-${curKey}-${top[0]}`, tone: "hot", title: `أكتر بند صرف: ${top[0]}`, body: `${EGP(top[1])} — ${Math.round((top[1] / curT) * 100)}% من مصاريف الشهر` });

    // مصروف كبير (أعلى من 3 أضعاف المتوسط)
    if (rows.length >= 5) {
      const avg = rows.reduce((s, r) => s + Number(r.amount), 0) / rows.length;
      const big = rows.filter(r => monthKey(r.expense_datetime) === curKey && Number(r.amount) > avg * 3)
        .sort((a, b) => Number(b.amount) - Number(a.amount))[0];
      if (big) out.push({ id: `big-${big.id}`, tone: "warn", title: `مصروف كبير: ${EGP(Number(big.amount))}`, body: `${big.description} — أعلى بكتير من متوسط صرفك` });
    }

    // مصاريف النهارده
    const todayStr = now.toDateString();
    const today = rows.filter(r => new Date(r.expense_datetime).toDateString() === todayStr);
    if (today.length) {
      const t = today.reduce((s, r) => s + Number(r.amount), 0);
      out.push({ id: `today-${todayStr}-${today.length}`, tone: "info", title: `صرفت النهارده ${EGP(t)}`, body: `${today.length} عملية مسجّلة اليوم` });
    }
    // تنبيهات الإيداعات والرصيد
    const totDep = deposits.reduce((s, d) => s + Number(d.amount), 0);
    if (totDep > 0) {
      const allSpent = rows.reduce((s, r) => s + Number(r.amount), 0);
      const rem = totDep - allSpent;
      if (rem < 0) out.push({ id: `dep-neg-${Math.round(rem)}`, tone: "hot", title: "صرفت أكتر من اللي أودعته 😅", body: `إيداعاتك ${EGP(totDep)} وصرفت ${EGP(allSpent)} — عليك ${EGP(Math.abs(rem))}` });
      else if (rem <= totDep * 0.1) out.push({ id: `dep-low-${Math.round(rem)}`, tone: "warn", title: "رصيدك الشخصي قرب يخلص", body: `باقيلك ${EGP(rem)} بس من إجمالي ${EGP(totDep)}` });
    }
    const curDep = depositMonthTotals.get(curKey) || 0;
    if (curDep > 0 && curT > curDep) {
      out.push({ id: `dep-over-${curKey}`, tone: "warn", title: "اتجاوزت ميزانية الشهر", body: `أودعت ${EGP(curDep)} وصرفت ${EGP(curT)} لحد دلوقتي` });
    } else if (curDep > 0) {
      out.push({ id: `dep-rem-${curKey}-${Math.round(curDep - curT)}`, tone: "good", title: `باقيلك ${EGP(curDep - curT)} من ميزانية الشهر`, body: `أودعت ${EGP(curDep)} وصرفت ${EGP(curT)}` });
    }
    return out;
  }, [rows, deposits, depositMonthTotals, isPersonalOwner]);

  const unseenAlerts = useMemo(() => alerts.filter(a => !seenAlerts.includes(a.id)), [alerts, seenAlerts]);

  // إشعار تلقائي لأهم تنبيه عند فتح الصفحة
  const alertToastedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPersonalOwner || !alerts.length) return;
    const a = alerts.find(x => x.tone === "warn") || alerts[0];
    if (alertToastedRef.current === a.id) return;
    alertToastedRef.current = a.id;
    const t = setTimeout(() => {
      if (a.tone === "warn") fancyToast.warn(a.title, a.body);
      else if (a.tone === "good") fancyToast.success(a.title, a.body);
      else fancyToast.info(a.title, a.body);
    }, 1600);
    return () => clearTimeout(t);
  }, [alerts, isPersonalOwner]);


  const openAdd = () => {
    setEditing(null);
    setFormErrors([]);
    // Prefill with the currently opened month tab (now if it's the current month)
    const now = new Date();
    let dt = now;
    if (activeTab !== "__all__" && activeTab !== monthKey(now.toISOString())) {
      const [y, m] = activeTab.split("-").map(Number);
      dt = new Date(y, m - 1, 1, now.getHours(), now.getMinutes());
    }
    setForm({
      amount: "",
      description: "",
      category: "",
      expense_datetime: toLocalInput(dt.toISOString()),
      notes: "",
    });
    setDialogOpen(true);
  };
  const openEdit = (r: Row) => {
    setEditing(r);
    setFormErrors([]);
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
    // تجميع كل الحقول الناقصة مرة واحدة في Alert شيك
    const missing: string[] = [];
    if (!amt || amt <= 0) missing.push("المبلغ — اكتب مبلغ صحيح أكبر من صفر");
    if (!form.category.trim()) missing.push("التصنيف — اختر تصنيف من اللي تحت أو اكتب تصنيف جديد");
    if (!form.description.trim()) missing.push("الوصف — اكتب وصف مختصر للمصروف");
    if (!form.expense_datetime) missing.push("التاريخ والوقت");
    if (missing.length) { setFormErrors(missing); return; }
    setFormErrors([]);
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
    if (!isPersonalOwner) toast.success(editing ? "تم التعديل" : "تمت الإضافة");
    setDialogOpen(false);
    load();
  };

  const remove = async () => {
    if (!delRow) return;
    const { error } = await supabase.from("owner_personal_expenses" as any).delete().eq("id", delRow.id);
    if (error) return toast.error(error.message);
    if (!isPersonalOwner) toast.success("تم الحذف");
    setDelRow(null);
    load();
  };

  // ===== الإيداعات =====
  const openAddDep = () => {
    setEditingDep(null);
    setDepErrors([]);
    const now = new Date();
    let dt = now;
    if (activeTab !== "__all__" && activeTab !== monthKey(now.toISOString())) {
      const [y, m] = activeTab.split("-").map(Number);
      dt = new Date(y, m - 1, 1, now.getHours(), now.getMinutes());
    }
    setDepForm({ amount: "", description: "", category: "", deposit_datetime: toLocalInput(dt.toISOString()), notes: "" });
    setDepDialogOpen(true);
  };
  const openEditDep = (d: Deposit) => {
    setEditingDep(d);
    setDepErrors([]);
    setDepForm({ amount: String(d.amount), description: d.description ?? "", category: d.category ?? "", deposit_datetime: toLocalInput(d.deposit_datetime), notes: d.notes ?? "" });
    setDepDialogOpen(true);
  };
  const saveDep = async () => {
    if (!ownerId) return;
    const amt = Number(depForm.amount);
    const missing: string[] = [];
    if (!amt || amt <= 0) missing.push("مبلغ الإيداع — اكتب مبلغ صحيح أكبر من صفر");
    if (!depForm.category.trim()) missing.push("التصنيف — حدد مصدر الإيداع (مثلاً: ميزانية شهرية)");
    if (!depForm.deposit_datetime) missing.push("التاريخ والوقت");
    if (missing.length) { setDepErrors(missing); return; }
    setDepErrors([]);
    setSavingDep(true);
    const payload: any = {
      owner_user_id: ownerId,
      amount: amt,
      description: depForm.description.trim() || "إيداع",
      category: depForm.category.trim() || null,
      deposit_datetime: new Date(depForm.deposit_datetime).toISOString(),
      notes: depForm.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    let res;
    if (editingDep) res = await supabase.from("owner_personal_deposits" as any).update(payload).eq("id", editingDep.id);
    else res = await supabase.from("owner_personal_deposits" as any).insert(payload);
    setSavingDep(false);
    if (res.error) return toast.error(res.error.message);
    if (!isPersonalOwner) toast.success(editingDep ? "تم تعديل الإيداع" : "تم تسجيل الإيداع");
    setDepDialogOpen(false);
    load();
  };
  const removeDep = async () => {
    if (!delDep) return;
    const { error } = await supabase.from("owner_personal_deposits" as any).delete().eq("id", delDep.id);
    if (error) return toast.error(error.message);
    if (!isPersonalOwner) toast.success("تم حذف الإيداع");
    setDelDep(null);
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
  const pdfMonthDep = pdfMonth ? (depositMonthTotals.get(pdfMonth) || 0) : 0;

  /** إجماليات كل شهر من كل البيانات (بدون فلاتر) — لمقارنة شهر بشهر */
  const rawMonthTotals = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => {
      const k = monthKey(r.expense_datetime);
      m.set(k, (m.get(k) || 0) + Number(r.amount));
    });
    return m;
  }, [rows]);

  /** مقارنة شهر بالشهر اللي قبله: الفرق بالجنيه ونسبة التغيير */
  const monthDelta = (key: string) => {
    const [y, mo] = key.split("-").map(Number);
    const prevDate = new Date(y, mo - 2, 1);
    const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
    const cur = rawMonthTotals.get(key) || 0;
    const prev = rawMonthTotals.get(prevKey) || 0;
    if (!rawMonthTotals.has(prevKey)) return null;
    const diff = cur - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : (cur > 0 ? 100 : 0);
    return { prevKey, prev, cur, diff, pct };
  };

  /** اسم الفترة المختارة بالعامية */
  const periodLabel = isAll
    ? "كل الشهور"
    : singleMonth
      ? monthLabel(singleMonth)
      : `${selMonths.length.toLocaleString("ar-EG")} شهور مختارة`;

  // ===== تحليلات ورسومات أساسية (بتتبع الشهور المختارة أو الإجمالي) =====
  // الصفوف المعروضة في الرسومات — بتتأثر بالبحث المتقدم عشان الصفحة كلها تبقى على نفس الفلترة
  const chartRows = useMemo(
    () => filtered.filter(r => inSel(r.expense_datetime)),
    [filtered, selMonths]
  );

  // ١) فلوسك راحت فين؟ — توزيع حسب التصنيف
  const categoryBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    chartRows.forEach(r => {
      const c = (r.category || "بدون تصنيف").trim();
      m.set(c, (m.get(c) || 0) + Number(r.amount));
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [chartRows]);
  // ٢) أكبر ٥ مصروفات
  const topExpenses = useMemo(
    () => [...chartRows].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5)
      .map(r => ({ name: r.description, value: Number(r.amount), sub: r.category || undefined })),
    [chartRows]
  );
  // ٣) إيداع مقابل صرف — الشهور المختارة أو آخر ٦ شهور
  const monthlyCompare = useMemo(() => {
    const keys = (isAll ? monthTabs.map(m => m.key).slice(0, 6) : [...selMonths]).sort((a, b) => a.localeCompare(b));
    return keys.map(k => ({ key: k, label: monthShort(k), dep: depositMonthTotals.get(k) || 0, spent: rawMonthTotals.get(k) || 0 }));
  }, [monthTabs, depositMonthTotals, rawMonthTotals, selMonths, isAll]);

  // إحصائيات الفترة المختارة (للكارت الكبير)
  const selectedMonthStats = useMemo(() => {
    if (isAll) return null;
    const spent = selMonths.reduce((s, k) => s + (rawMonthTotals.get(k) || 0), 0);
    const count = rows.filter(r => selMonths.includes(monthKey(r.expense_datetime))).length;
    const dep = selMonths.reduce((s, k) => s + (depositMonthTotals.get(k) || 0), 0);
    return { spent, count, dep, remaining: dep - spent };
  }, [isAll, selMonths, rawMonthTotals, rows, depositMonthTotals]);

  /** متوسط المصاريف الشهرية لكل سنة — إجمالي السنة ÷ عدد الشهور اللي فيها حركة */
  const yearlyAverages = useMemo(() => {
    const perYear = new Map<string, { total: number; months: Set<string>; count: number; dep: number }>();
    rows.forEach(r => {
      const k = monthKey(r.expense_datetime);
      const y = k.slice(0, 4);
      const e = perYear.get(y) ?? { total: 0, months: new Set<string>(), count: 0, dep: 0 };
      e.total += Number(r.amount);
      e.count += 1;
      e.months.add(k);
      perYear.set(y, e);
    });
    deposits.forEach(d => {
      const y = monthKey(d.deposit_datetime).slice(0, 4);
      const e = perYear.get(y) ?? { total: 0, months: new Set<string>(), count: 0, dep: 0 };
      e.dep += Number(d.amount);
      perYear.set(y, e);
    });
    return Array.from(perYear.entries())
      .map(([year, e]) => ({
        year,
        total: e.total,
        dep: e.dep,
        months: e.months.size,
        count: e.count,
        avg: e.months.size > 0 ? e.total / e.months.size : 0,
      }))
      .sort((a, b) => b.year.localeCompare(a.year));
  }, [rows, deposits]);

  /** السنين المتاحة في الداتا */
  const availableYears = useMemo(
    () => Array.from(new Set(rows.map(r => monthKey(r.expense_datetime).slice(0, 4)))).sort((a, b) => b.localeCompare(a)),
    [rows]
  );

  /** متوسط تصنيف معيّن في سنة معيّنة */
  const catYearAvg = useMemo(() => {
    if (!catAvgCat || !catAvgYear) return null;
    const yearRows = rows.filter(r => monthKey(r.expense_datetime).startsWith(catAvgYear));
    const catRows = yearRows.filter(r => (r.category ?? "") === catAvgCat);
    if (catRows.length === 0) return null;
    const total = catRows.reduce((s, r) => s + Number(r.amount), 0);
    const perMonth = new Map<string, number>();
    catRows.forEach(r => {
      const k = monthKey(r.expense_datetime);
      perMonth.set(k, (perMonth.get(k) || 0) + Number(r.amount));
    });
    const activeMonths = perMonth.size;
    const yearTotal = yearRows.reduce((s, r) => s + Number(r.amount), 0);
    const top = Array.from(perMonth.entries()).sort((a, b) => b[1] - a[1])[0];
    return {
      total,
      count: catRows.length,
      activeMonths,
      avgActive: activeMonths > 0 ? total / activeMonths : 0,
      avg12: total / 12,
      share: yearTotal > 0 ? (total / yearTotal) * 100 : 0,
      maxMonthLabel: top ? `${monthLabel(top[0])} (${EGP(top[1])})` : "—",
    };
  }, [rows, catAvgCat, catAvgYear]);




  /** تصدير Excel — شهر محدد أو كل الصفوف الظاهرة (ملخص + حركة المحفظة + الإيداعات + المصروفات، كلها بالتواريخ) */
  const exportExcel = (mkey: string | null) => {
    try {
      const expData = mkey ? filtered.filter(r => monthKey(r.expense_datetime) === mkey) : visible;
      // الإيداعات لازم تتفلتر بنفس الشهور المختارة زي المصروفات، عشان الإجماليات والباقي يطلعوا صح
      const depData = mkey
        ? deposits.filter(d => monthKey(d.deposit_datetime) === mkey)
        : deposits.filter(d => inSel(d.deposit_datetime));
      if (expData.length === 0 && depData.length === 0) return toast.error("مفيش بيانات للتصدير");

      const fmtD = (iso: string) => new Date(iso).toLocaleDateString("ar-EG");
      const fmtT = (iso: string) => new Date(iso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });

      const expSorted = [...expData].sort((a, b) => a.expense_datetime.localeCompare(b.expense_datetime));
      const depSorted = [...depData].sort((a, b) => a.deposit_datetime.localeCompare(b.deposit_datetime));
      const totExp = expSorted.reduce((s, r) => s + Number(r.amount), 0);
      const totDep = depSorted.reduce((s, d) => s + Number(d.amount), 0);

      // رصيد أول الفترة (لو التصدير لشهر محدد): كل اللي اتودع واتصرف قبل بداية الشهر
      let opening = 0;
      if (mkey) {
        const startIso = `${mkey}-01T00:00:00`;
        opening =
          deposits.filter(d => d.deposit_datetime < startIso).reduce((s, d) => s + Number(d.amount), 0) -
          rows.filter(r => r.expense_datetime < startIso).reduce((s, r) => s + Number(r.amount), 0);
      }

      // ١) الملخص
      const summaryAoa: (string | number)[][] = [
        ["البند", "القيمة (ج.م)"],
        ["الفترة", mkey ? monthLabel(mkey) : "كل الفترة"],
        ...(mkey ? [["رصيد أول الشهر (الباقي من الشهور اللي قبلها)", Number(opening.toFixed(2))]] : []),
        ["إجمالي اللي أودعته", totDep],
        ["إجمالي اللي صرفته", totExp],
        ["الباقي في المحفظة", Number((opening + totDep - totExp).toFixed(2))],
      ];
      if (mkey) {
        const d = monthDelta(mkey);
        if (d) summaryAoa.push([`مقارنة مصروفات الشهر بـ ${monthLabel(d.prevKey)}`, Number(d.diff.toFixed(2)), `${d.pct >= 0 ? "+" : ""}${d.pct.toFixed(1)}%`]);
      }

      // ٢) حركة المحفظة — إيداعات ومصاريف مرتبة بالتاريخ مع الباقي بعد كل حركة
      const moves = [
        ...depSorted.map(d => ({ dt: d.deposit_datetime, kind: "dep" as const, desc: `${d.description || "إيداع"}${d.category ? ` (${d.category})` : ""}`, amount: Number(d.amount) })),
        ...expSorted.map(r => ({ dt: r.expense_datetime, kind: "exp" as const, desc: `${r.description || ""}${r.category ? ` (${r.category})` : ""}`, amount: Number(r.amount) })),
      ].sort((a, b) => a.dt.localeCompare(b.dt));

      let balance = opening;
      const walletAoa: (string | number)[][] = [
        ["التاريخ", "الوقت", "النوع", "البيان", "أودعت (ج.م)", "صرفت (ج.م)", "الباقي بعد الحركة (ج.م)"],
      ];
      if (mkey && opening !== 0) walletAoa.push([`01/${mkey.split("-")[1]}/${mkey.split("-")[0]}`, "", "رصيد سابق", "الباقي من الشهور اللي قبلها", "", "", Number(opening.toFixed(2))]);
      for (const mv of moves) {
        balance += mv.kind === "dep" ? mv.amount : -mv.amount;
        walletAoa.push([
          fmtD(mv.dt), fmtT(mv.dt),
          mv.kind === "dep" ? "إيداع 💰" : "مصروف 💸",
          mv.desc,
          mv.kind === "dep" ? mv.amount : "",
          mv.kind === "exp" ? mv.amount : "",
          Number(balance.toFixed(2)),
        ]);
      }
      walletAoa.push([]);
      walletAoa.push(["", "", "", "الإجمالي", totDep, totExp, Number(balance.toFixed(2))]);

      // ٣) الإيداعات
      const depAoa: (string | number)[][] = [
        ["التاريخ", "الوقت", "الوصف", "التصنيف", "المبلغ (ج.م)", "ملاحظات"],
        ...depSorted.map(d => [fmtD(d.deposit_datetime), fmtT(d.deposit_datetime), d.description || "إيداع", d.category || "بدون تصنيف", Number(d.amount), d.notes || ""]),
        [],
        ["", "", "", "الإجمالي", totDep, ""],
      ];

      // ٤) المصروفات
      const expAoa: (string | number)[][] = [
        ["التاريخ", "الوقت", "الوصف", "التصنيف", "المبلغ (ج.م)", "ملاحظات"],
        ...expSorted.map(r => [fmtD(r.expense_datetime), fmtT(r.expense_datetime), r.description || "", r.category || "بدون تصنيف", Number(r.amount), r.notes || ""]),
        [],
        ["", "", "", "الإجمالي", totExp, ""],
      ];

      const mkSheet = (aoa: (string | number)[][], cols: number[]) => {
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!views"] = [{ RTL: true }];
        ws["!cols"] = cols.map(wch => ({ wch }));
        return ws;
      };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, mkSheet(summaryAoa, [40, 18, 14]), "الملخص");
      XLSX.utils.book_append_sheet(wb, mkSheet(walletAoa, [14, 10, 12, 36, 14, 14, 20]), "حركة المحفظة");
      XLSX.utils.book_append_sheet(wb, mkSheet(depAoa, [14, 10, 34, 18, 14, 30]), "الإيداعات");
      XLSX.utils.book_append_sheet(wb, mkSheet(expAoa, [14, 10, 34, 18, 14, 30]), "المصروفات");
      XLSX.writeFile(wb, `personal-wallet-${mkey || "all"}.xlsx`);
      toast.success("تم تصدير ملف Excel");
    } catch (e: any) {
      toast.error("فشل تصدير Excel: " + (e?.message || ""));
    }
  };

  const clearFilters = () => {
    setQ(""); setFromDate(""); setToDate(""); setFilterCats([]); setMinAmount(""); setMaxAmount("");
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
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl mb-6 p-6 border border-primary/20 bg-[length:200%_200%] bg-gradient-to-l from-primary/25 via-fuchsia-500/10 to-emerald-500/15 animate-gradient-x animate-fade-in">
        <div className="absolute -left-10 -top-10 w-40 h-40 rounded-full bg-primary/25 blur-3xl animate-float" />
        <div className="absolute -right-10 -bottom-10 w-40 h-40 rounded-full bg-emerald-500/25 blur-3xl animate-float [animation-delay:1.2s]" />
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-y-0 w-1/3 bg-gradient-to-l from-transparent via-white/20 to-transparent animate-shimmer" />
        </div>
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 flex items-center justify-center shadow-lg animate-pop-in ${celebrate ? "animate-wiggle" : ""}`}>
              <Wallet className="w-7 h-7 text-primary-foreground" />
            </div>
            <div className="animate-fade-in [animation-delay:120ms]">
              {isPersonalOwner ? (
                <>
                  <div className="text-2xl md:text-3xl font-extrabold flex items-center gap-2 flex-wrap">
                    <span className="bg-[length:200%_auto] bg-gradient-to-l from-primary via-fuchsia-500 to-emerald-500 bg-clip-text text-transparent animate-gradient-x">
                      {greeting()} {ownerDisplayName}
                    </span>
                    <Crown className="w-6 h-6 text-amber-500 animate-float" />
                    {celebrate && <PartyPopper className="w-6 h-6 text-fuchsia-500 animate-pop-in" />}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    دفترك الشخصي — منفصل تماماً عن حسابات النظام
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-extrabold flex items-center gap-2">
                    المصاريف الشخصية
                    <Sparkles className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    دفتر خاص بصاحب الشركة — منفصل تماماً عن حسابات النظام
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 animate-fade-in [animation-delay:220ms]">
            {isPersonalOwner && (
              <Popover open={bellOpen} onOpenChange={(o) => { setBellOpen(o); if (o) setSeenAlerts(alerts.map(a => a.id)); }}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="إشعاراتي"
                    className="relative w-12 h-12 rounded-2xl bg-background/70 backdrop-blur border border-primary/30 flex items-center justify-center hover:scale-105 hover:border-primary transition-transform shadow-sm"
                  >
                    {unseenAlerts.length > 0 && (
                      <span className="absolute inset-0 rounded-2xl border-2 border-primary/50 animate-pulse-ring" />
                    )}
                    <Bell className={`w-5 h-5 text-primary ${bellRing ? "animate-wiggle" : ""}`} />
                    {unseenAlerts.length > 0 && (
                      <span className="absolute -top-1.5 -left-1.5 min-w-[20px] h-5 px-1 rounded-full bg-gradient-to-br from-rose-500 to-fuchsia-600 text-white text-[11px] font-extrabold flex items-center justify-center shadow animate-pop-in">
                        {unseenAlerts.length}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-0 overflow-hidden">
                  <div className="p-3 border-b bg-gradient-to-l from-primary/15 to-transparent font-bold text-sm flex items-center gap-2">
                    <Bell className="w-4 h-4 text-primary" /> إشعارات {ownerDisplayName}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {alerts.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">مفيش تنبيهات دلوقتي 🎉</div>
                    ) : alerts.map((a, i) => {
                      const tone =
                        a.tone === "good" ? "from-emerald-500/15 border-r-emerald-500 text-emerald-700 dark:text-emerald-300"
                        : a.tone === "warn" ? "from-amber-500/15 border-r-amber-500 text-amber-700 dark:text-amber-300"
                        : a.tone === "hot" ? "from-rose-500/15 border-r-rose-500 text-rose-700 dark:text-rose-300"
                        : "from-sky-500/15 border-r-sky-500 text-sky-700 dark:text-sky-300";
                      const Icon = a.tone === "good" ? TrendingDown : a.tone === "warn" ? TrendingUp : a.tone === "hot" ? Flame : Sparkles;
                      return (
                        <div
                          key={a.id}
                          style={{ animationDelay: `${i * 70}ms` }}
                          className={`p-3 border-b border-r-4 bg-gradient-to-l to-transparent ${tone} animate-fade-in`}
                        >
                          <div className="flex items-start gap-2">
                            <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-bold text-sm">{a.title}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">{a.body}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {canEdit && (
              <Button onClick={openAddDep} size="lg" variant="outline" className="border-emerald-500/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 shadow-md hover:scale-105 transition-transform">
                <ArrowDownToLine className="w-5 h-5 ml-1" /> إيداع جديد
              </Button>
            )}
            {canEdit && (
              <Button onClick={openAdd} size="lg" className="bg-gradient-to-r from-primary to-fuchsia-600 shadow-md hover:scale-105 transition-transform">
                <Plus className="w-5 h-5 ml-1" /> إضافة مصروف
              </Button>
            )}
          </div>
        </div>
      </div>


      {/* اختيار الفترة — تقدر تختار شهر أو أكتر ومن أكتر من سنة */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <CalendarDays className="w-4 h-4 text-primary" /> عرض بيانات:
        </div>

        <Popover open={periodOpen} onOpenChange={setPeriodOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="min-w-[280px] h-11 font-bold rounded-xl border-primary/30 justify-between">
              <span className="truncate">
                {isAll ? `الإجمالي (كل الشهور) — ${grandTotalAllLabel}` : periodLabel}
              </span>
              <CalendarDays className="w-4 h-4 opacity-60 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[320px] max-w-[calc(100vw-2rem)] p-0 pointer-events-auto">
            {/* اختيارات سريعة */}
            <div className="p-3 border-b flex flex-wrap gap-2">
              <Button size="sm" variant={isAll ? "default" : "outline"} className="h-8 text-xs" onClick={() => setSelMonths([])}>
                كل الشهور
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setSelMonths(monthTabs.map(m => m.key).slice(0, 3))}>
                آخر ٣ شهور
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setSelMonths(monthTabs.map(m => m.key).slice(0, 6))}>
                آخر ٦ شهور
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => {
                  const y = String(new Date().getFullYear());
                  setSelMonths(monthTabs.filter(m => m.key.startsWith(y)).map(m => m.key));
                }}
              >
                السنة الحالية
              </Button>
            </div>

            {/* الشهور مجمّعة بالسنة */}
            <div className="max-h-[300px] overflow-y-auto p-2">
              {Array.from(new Set(monthTabs.map(m => m.key.slice(0, 4)))).map(year => {
                const months = monthTabs.filter(m => m.key.startsWith(year));
                const allYear = months.every(m => selMonths.includes(m.key));
                return (
                  <div key={year} className="mb-2">
                    <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-muted/60">
                      <span className="text-xs font-extrabold">{Number(year).toLocaleString("ar-EG", { useGrouping: false })}</span>
                      <button
                        type="button"
                        className="text-[11px] font-bold text-primary hover:underline"
                        onClick={() =>
                          setSelMonths(prev =>
                            allYear
                              ? prev.filter(k => !k.startsWith(year))
                              : Array.from(new Set([...prev, ...months.map(m => m.key)])).sort((a, b) => b.localeCompare(a))
                          )
                        }
                      >
                        {allYear ? "إلغاء السنة" : "اختار السنة كلها"}
                      </button>
                    </div>
                    {months.map(m => (
                      <label
                        key={m.key}
                        className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-accent/30 cursor-pointer"
                      >
                        <Checkbox checked={selMonths.includes(m.key)} onCheckedChange={() => toggleMonth(m.key)} />
                        <span className="text-[13px] font-semibold flex-1 min-w-0 truncate">{monthLabel(m.key)}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {m.total.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ج.م
                        </span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="p-2 border-t flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                {isAll ? "مفيش شهور محددة = الإجمالي" : `${selMonths.length.toLocaleString("ar-EG")} شهر مختار`}
              </span>
              <Button size="sm" className="h-8 text-xs" onClick={() => setPeriodOpen(false)}>تم</Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* شيبس الشهور المختارة */}
        {!isAll && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {selMonths.map(k => (
              <Badge key={k} variant="secondary" className="gap-1 py-1">
                {monthLabel(k)}
                <button type="button" onClick={() => toggleMonth(k)} className="hover:text-destructive" aria-label={`شيل ${monthLabel(k)}`}>
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelMonths([])}>مسح الكل</Button>
          </div>
        )}
      </div>

      {/* بحث متقدم — الفلاتر دي بتأثر على الصفحة كلها (الإجماليات والتحليلات والجدول) */}
      <Card className="p-4 mb-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Filter className="w-4 h-4 text-primary" /> بحث متقدم
            <span className="text-[11px] font-normal text-muted-foreground">— أي فلتر هنا بيتطبق على الصفحة كلها</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={clearFilters}><X className="w-4 h-4 ml-1" />مسح الفلاتر</Button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 items-end">
          <div className="lg:col-span-2 flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">بحث</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input placeholder="ابحث في الوصف / الملاحظات / التصنيف" value={q} onChange={e => setQ(e.target.value)} className="pr-9 h-10" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">من تاريخ</Label>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-10" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-10" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">التصنيف (تقدر تختار أكتر من واحد)</Label>
            <Popover open={catFilterOpen} onOpenChange={setCatFilterOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 justify-between font-semibold">
                  <span className="truncate">
                    {filterCats.length === 0
                      ? "كل التصنيفات"
                      : filterCats.length === 1
                        ? filterCats[0]
                        : `${filterCats.length.toLocaleString("ar-EG")} تصنيفات`}
                  </span>
                  <Tag className="w-4 h-4 opacity-60 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[260px] max-w-[calc(100vw-2rem)] p-0 pointer-events-auto">
                <div className="p-2 border-b flex items-center justify-between">
                  <Button size="sm" variant={filterCats.length === 0 ? "default" : "outline"} className="h-8 text-xs" onClick={() => setFilterCats([])}>
                    كل التصنيفات
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setFilterCats([...allCategories])}>
                    اختار الكل
                  </Button>
                </div>
                <div className="max-h-[280px] overflow-y-auto p-2">
                  {allCategories.length === 0 && (
                    <div className="text-xs text-muted-foreground p-2">مفيش تصنيفات لسه</div>
                  )}
                  {allCategories.map(c => (
                    <label key={c} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-accent/30 cursor-pointer">
                      <Checkbox checked={filterCats.includes(c)} onCheckedChange={() => toggleFilterCat(c)} />
                      <span className="text-[13px] font-semibold flex-1 min-w-0 truncate">{c}</span>
                    </label>
                  ))}
                </div>
                <div className="p-2 border-t flex justify-end">
                  <Button size="sm" className="h-8 text-xs" onClick={() => setCatFilterOpen(false)}>تم</Button>
                </div>
              </PopoverContent>
            </Popover>
            {filterCats.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                {filterCats.map(c => (
                  <Badge key={c} variant="secondary" className="gap-1 py-1">
                    {c}
                    <button type="button" onClick={() => toggleFilterCat(c)} className="hover:text-destructive" aria-label={`شيل ${c}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">من مبلغ</Label>
            <Input type="number" value={minAmount} onChange={e => setMinAmount(e.target.value)} className="h-10" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">إلى مبلغ</Label>
            <Input type="number" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} className="h-10" />
          </div>
        </div>
      </Card>


      {/* Grand total (respects active filters + month tab) */}
      <div className="mb-6">
        <Card className="p-6 bg-gradient-to-l from-rose-500/20 via-rose-500/10 to-transparent border-rose-400/40 animate-fade-in">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center shadow-lg">
                <TrendingUp className="w-7 h-7 text-white" />
              </div>
              <div>
                <div className="text-sm text-rose-700 dark:text-rose-300 font-semibold">
                  {isAll ? "إجمالي كل الشهور" : `مصاريف ${periodLabel}`}
                  {(q || fromDate || toDate || filterCats.length > 0 || minAmount || maxAmount) ? " (بعد الفلاتر)" : ""}
                </div>
                <div className="text-4xl font-extrabold mt-1 text-rose-700 dark:text-rose-200 tabular-nums">
                  {grandTotal.toLocaleString("ar-EG", { maximumFractionDigits: 2 })}
                  <span className="text-lg font-semibold opacity-70 mr-1">ج.م</span>
                </div>
                {singleMonth && (() => {
                  const d = monthDelta(singleMonth);
                  if (!d) return null;
                  const up = d.diff > 0, flat = Math.abs(d.diff) < 0.005;
                  return (
                    <div className={`mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
                      flat ? "bg-muted text-muted-foreground"
                        : up ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    }`}>
                      {flat ? <Minus className="w-3.5 h-3.5" /> : up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {flat ? "زي الشهر اللي فات" : `${up ? "+" : "−"}${Math.abs(d.pct).toFixed(1)}% (${EGP(Math.abs(d.diff))}) عن ${monthLabel(d.prevKey)}`}
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-xs text-muted-foreground">
                {visible.length.toLocaleString("ar-EG")} مصروف
                {isAll ? ` · ${monthlyTotals.length} شهر` : ` · ${selMonths.length.toLocaleString("ar-EG")} شهر`}
              </div>
              {singleMonth && (
                <Button size="sm" variant="outline" onClick={() => exportMonthPDF(singleMonth)}>
                  <FileDown className="w-4 h-4 ml-1" /> PDF الشهر
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => exportExcel(singleMonth)}>
                <FileSpreadsheet className="w-4 h-4 ml-1" /> {singleMonth ? "Excel الشهر" : "Excel (الظاهر)"}
              </Button>
            </div>

          </div>
        </Card>
      </div>




      {/* رصيد المحفظة الشخصية */}
      <Card className="p-5 mb-6 border-emerald-400/40 bg-gradient-to-l from-emerald-500/15 via-emerald-500/5 to-transparent animate-fade-in">
        <div className="flex items-center gap-2 mb-3 text-sm font-bold text-emerald-700 dark:text-emerald-300">
          <Wallet className="w-4 h-4" />
          محفظتك الشخصية {isAll ? "(كل الشهور)" : `— ${periodLabel}`}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-3">
            <div className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1"><ArrowDownToLine className="w-3.5 h-3.5" /> أودعت</div>
            <div className="text-2xl font-extrabold mt-1 text-emerald-700 dark:text-emerald-200 tabular-nums">
              {balDeposited.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} <span className="text-sm font-semibold opacity-70">ج.م</span>
            </div>
          </div>
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-3">
            <div className="text-xs text-rose-700 dark:text-rose-300 flex items-center gap-1"><ArrowUpFromLine className="w-3.5 h-3.5" /> صرفت</div>
            <div className="text-2xl font-extrabold mt-1 text-rose-700 dark:text-rose-200 tabular-nums">
              {balSpent.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} <span className="text-sm font-semibold opacity-70">ج.م</span>
            </div>
          </div>
          <div className={`rounded-xl border p-3 ${balRemaining < 0 ? "border-red-500/50 bg-red-500/10" : "border-sky-400/40 bg-sky-500/10"}`}>
            <div className={`text-xs flex items-center gap-1 ${balRemaining < 0 ? "text-red-700 dark:text-red-300" : "text-sky-700 dark:text-sky-300"}`}><Wallet className="w-3.5 h-3.5" /> الباقي في جيبك</div>
            <div className={`text-2xl font-extrabold mt-1 tabular-nums ${balRemaining < 0 ? "text-red-700 dark:text-red-200" : "text-sky-700 dark:text-sky-200"}`}>
              {balRemaining.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} <span className="text-sm font-semibold opacity-70">ج.م</span>
            </div>
          </div>
        </div>
        {balRemaining < 0 && (
          <div className="mt-3 text-xs font-bold text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
            ⚠️ صرفت أكتر من اللي أودعته بـ {EGP(Math.abs(balRemaining))} {isAll ? "إجمالاً" : "في الفترة دي"}
          </div>
        )}
        {balDeposited === 0 && (
          <div className="mt-3 text-xs text-muted-foreground">لسه مسجلتش أي إيداع — دوس «إيداع جديد» وسجّل ميزانية الشهر 👆</div>
        )}
      </Card>

      {/* تحليل سريع — رسومات أساسية بتجاوب على الأسئلة المهمة (بتتبع الشهر المختار) */}
      {(rows.length > 0 || deposits.length > 0) && (
        <div className="mb-6 space-y-4 animate-fade-in">
          <div className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            تحليل سريع {isAll ? "(كل الشهور)" : `— ${periodLabel}`}
          </div>

          {/* ١) استهلاك الميزانية — صرفت قد إيه من اللي أودعته؟ */}
          {balDeposited > 0 && (() => {
            const pct = Math.min(100, (balSpent / balDeposited) * 100);
            const over = balRemaining < 0;
            return (
              <Card className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div className="text-sm font-bold">قد إيه صرفت من ميزانيتك؟</div>
                  <div className={`text-xs font-extrabold ${over ? "text-red-600 dark:text-red-300" : pct >= 80 ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300"}`}>
                    {over ? `اتجاوزت الميزانية بـ ${EGP(Math.abs(balRemaining))}` : `استهلكت ${pct.toFixed(0)}% — فاضل ${EGP(balRemaining)}`}
                  </div>
                </div>
                <div className="h-4 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${over ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${over ? 100 : Math.max(2, pct)}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground font-semibold">
                  <span>أودعت: {EGP(balDeposited)}</span>
                  <span>صرفت: {EGP(balSpent)}</span>
                </div>
              </Card>
            );
          })()}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* ٢) فلوسك راحت فين؟ — حسب التصنيف */}
            {categoryBreakdown.length > 0 && (
              <Card className="p-4">
                <div className="text-sm font-bold mb-3">فلوسك راحت فين؟ (حسب التصنيف)</div>
                <ShareBreakdown items={categoryBreakdown} format={(v) => EGP(v)} />
              </Card>
            )}
            {/* ٣) أكبر مصروفاتك */}
            {topExpenses.length > 0 && (
              <Card className="p-4">
                <div className="text-sm font-bold mb-3">أكبر مصروفاتك</div>
                <RankBars items={topExpenses} tone="destructive" format={(v) => EGP(v)} />
              </Card>
            )}
          </div>

          {/* ٤) ملخص الأرقام + أعمدة مجمّعة (Financial Highlights) */}
          {monthlyCompare.length > 0 && (
            <Card className="p-5">
              <div className="text-sm font-bold mb-4">ملخص أرقامك</div>

              <HighlightTiles
                tiles={[
                  { label: `أودعت — ${periodLabel}`, value: EGP(balDeposited), tone: "primary", up: true },
                  { label: `صرفت — ${periodLabel}`, value: EGP(balSpent), tone: "accent", up: false },
                  {
                    label: balRemaining < 0 ? "متجاوز الميزانية" : "الباقي في جيبك",
                    value: EGP(balRemaining),
                    tone: balRemaining < 0 ? "destructive" : "success",
                    up: balRemaining >= 0,
                  },
                ]}
                className="mb-6"
              />

              <div className="text-xs font-bold text-muted-foreground mb-2">
                {isAll ? `آخر ${monthlyCompare.length} شهور` : "الشهور المختارة"} — الإيداع مقسوم بين المصروف والباقي
              </div>
              <StackedBars
                bars={monthlyCompare.map(m => {
                  const spent = Math.min(m.spent, m.dep);
                  const over = Math.max(0, m.spent - m.dep);
                  const rest = Math.max(0, m.dep - m.spent);
                  return {
                    label: m.label,
                    segments: [
                      { name: "صرفت", value: spent, tone: "accent" as const },
                      { name: "الباقي", value: rest, tone: "success" as const },
                      { name: "فوق الميزانية", value: over, tone: "destructive" as const },
                    ],
                  };
                })}
                format={(v) => EGP(v)}
              />
            </Card>
          )}

          {/* ٥) متوسط المصاريف الشهرية لكل سنة */}
          {yearlyAverages.length > 0 && (
            <Card className="p-5">
              <div className="text-sm font-bold mb-1">متوسط المصاريف الشهرية — لكل سنة</div>
              <div className="text-xs text-muted-foreground mb-4">
                بنقسم إجمالي مصاريف السنة على عدد الشهور اللي فيها حركة فعلاً
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {yearlyAverages.map(y => {
                  const rest = y.dep - y.total;
                  const pct = y.dep > 0 ? Math.min(100, (y.total / y.dep) * 100) : 0;
                  return (
                    <div
                      key={y.year}
                      className="group relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4 transition-all hover:shadow-lg hover:-translate-y-0.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="rounded-lg bg-primary/15 px-2.5 py-1 text-xs font-extrabold text-primary">
                          سنة {y.year}
                        </div>
                        <div className="text-[11px] text-muted-foreground text-end leading-4">
                          {y.months.toLocaleString("ar-EG")} شهر
                          <br />
                          {y.count.toLocaleString("ar-EG")} مصروف
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="text-[11px] font-semibold text-muted-foreground">متوسط الشهر</div>
                        <div className="text-2xl font-extrabold text-primary leading-tight">{EGP(y.avg)}</div>
                      </div>

                      <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-warning to-destructive transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        صرفت {pct.toFixed(0)}% من اللي أودعته السنة دي
                      </div>

                      <div className="mt-3 pt-3 border-t grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                        <div>
                          <div className="text-[10px] text-muted-foreground">أودعت</div>
                          <div className="text-xs font-bold text-success">{EGP(y.dep)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">صرفت</div>
                          <div className="text-xs font-bold text-destructive">{EGP(y.total)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">الباقي</div>
                          <div className={`text-xs font-bold ${rest >= 0 ? "text-primary" : "text-destructive"}`}>{EGP(rest)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ٦) متوسط تصنيف معين في سنة معينة */}
          {allCategories.length > 0 && availableYears.length > 0 && (
            <Card className="p-5">
              <div className="text-sm font-bold mb-1 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" /> متوسط تصنيف في سنة
              </div>
              <div className="text-xs text-muted-foreground mb-4">
                اختار التصنيف والسنة، وهنقولك بتصرف عليه كام في الشهر في المتوسط
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">التصنيف</Label>
                  <Select value={catAvgCat} onValueChange={setCatAvgCat}>
                    <SelectTrigger className="h-10"><SelectValue placeholder="اختار التصنيف" /></SelectTrigger>
                    <SelectContent>
                      {allCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">السنة</Label>
                  <Select value={catAvgYear} onValueChange={setCatAvgYear}>
                    <SelectTrigger className="h-10"><SelectValue placeholder="اختار السنة" /></SelectTrigger>
                    <SelectContent>
                      {availableYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {catYearAvg ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
                    <div className="text-[11px] font-semibold text-muted-foreground">متوسط الشهر</div>
                    <div className="text-2xl font-extrabold text-primary leading-tight mt-1">{EGP(catYearAvg.avgActive)}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">على {catYearAvg.activeMonths.toLocaleString("ar-EG")} شهر فيهم صرف</div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="text-[11px] font-semibold text-muted-foreground">متوسط على ١٢ شهر</div>
                    <div className="text-2xl font-extrabold leading-tight mt-1">{EGP(catYearAvg.avg12)}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">لو وزعناه على السنة كلها</div>
                  </div>
                  <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-4">
                    <div className="text-[11px] font-semibold text-muted-foreground">إجمالي السنة</div>
                    <div className="text-2xl font-extrabold text-rose-700 dark:text-rose-200 leading-tight mt-1">{EGP(catYearAvg.total)}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{catYearAvg.count.toLocaleString("ar-EG")} عملية</div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="text-[11px] font-semibold text-muted-foreground">نسبته من مصاريف السنة</div>
                    <div className="text-2xl font-extrabold leading-tight mt-1">{catYearAvg.share.toFixed(1)}%</div>
                    <div className="text-[10px] text-muted-foreground mt-1">أعلى شهر: {catYearAvg.maxMonthLabel}</div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">مفيش مصاريف للتصنيف ده في السنة دي</div>
              )}
            </Card>
          )}


        </div>
      )}




      {/* ملخص الفترة المختارة — كارت واحد كبير بدل الكروت الصغيرة المتراصة */}
      {!isAll && selectedMonthStats && (
        <Card className="p-5 mb-6 border-primary/30 bg-gradient-to-l from-primary/10 via-primary/5 to-transparent animate-fade-in">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2 text-sm font-bold text-primary">
              <CalendarDays className="w-4 h-4" />
              ملخص {periodLabel}
            </div>
            <div className="flex items-center gap-2">
              {singleMonth && (
                <Button size="sm" variant="outline" onClick={() => exportMonthPDF(singleMonth)}>
                  <FileDown className="w-4 h-4 ml-1" /> PDF
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => exportExcel(singleMonth)}>
                <FileSpreadsheet className="w-4 h-4 ml-1" /> Excel
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-4">
              <div className="text-xs text-rose-700 dark:text-rose-300 flex items-center gap-1"><ArrowUpFromLine className="w-3.5 h-3.5" /> إجمالي المصروفات</div>
              <div className="text-2xl font-extrabold mt-2 text-rose-700 dark:text-rose-200 tabular-nums">
                {selectedMonthStats.spent.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} <span className="text-sm font-semibold opacity-70">ج.م</span>
              </div>
              <div className="text-xs text-rose-700/80 dark:text-rose-300/80 mt-1">
                {selectedMonthStats.count.toLocaleString("ar-EG")} مصروف
              </div>
            </div>
            <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-4">
              <div className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1"><ArrowDownToLine className="w-3.5 h-3.5" /> إجمالي الإيداعات</div>
              <div className="text-2xl font-extrabold mt-2 text-emerald-700 dark:text-emerald-200 tabular-nums">
                {selectedMonthStats.dep.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} <span className="text-sm font-semibold opacity-70">ج.م</span>
              </div>
            </div>
            <div className={`rounded-xl border p-4 ${selectedMonthStats.remaining < 0 ? "border-red-500/50 bg-red-500/10" : "border-sky-400/40 bg-sky-500/10"}`}>
              <div className={`text-xs flex items-center gap-1 ${selectedMonthStats.remaining < 0 ? "text-red-700 dark:text-red-300" : "text-sky-700 dark:text-sky-300"}`}><Wallet className="w-3.5 h-3.5" /> الباقي</div>
              <div className={`text-2xl font-extrabold mt-2 tabular-nums ${selectedMonthStats.remaining < 0 ? "text-red-700 dark:text-red-200" : "text-sky-700 dark:text-sky-200"}`}>
                {selectedMonthStats.remaining.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} <span className="text-sm font-semibold opacity-70">ج.م</span>
              </div>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
              <div className="text-xs text-primary flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> مقارنة بالشهر اللي فات</div>
              <div className="mt-2">
                {(() => {
                  const d = singleMonth ? monthDelta(singleMonth) : null;
                  if (!d) return <div className="text-sm text-muted-foreground">المقارنة بتظهر لما تختار شهر واحد</div>;
                  const up = d.diff > 0, flat = Math.abs(d.diff) < 0.005;
                  return (
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
                      flat ? "bg-muted text-muted-foreground"
                        : up ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    }`}>
                      {flat ? <Minus className="w-3.5 h-3.5" /> : up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {flat ? "زي الشهر اللي فات" : `${up ? "+" : "−"}${Math.abs(d.pct).toFixed(1)}% (${EGP(Math.abs(d.diff))})`}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* تبديل العرض: مصروفات / إيداعات */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setView("expenses")}
          className={`px-4 py-2 rounded-xl border text-sm font-bold transition-all flex items-center gap-2 ${
            view === "expenses"
              ? "bg-gradient-to-l from-rose-500 to-rose-600 text-white border-rose-500 shadow-md"
              : "bg-muted/40 hover:bg-muted border-border text-muted-foreground"
          }`}
        >
          <ArrowUpFromLine className="w-4 h-4" /> المصروفات
          <span className="text-xs opacity-80 tabular-nums">{visible.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setView("deposits")}
          className={`px-4 py-2 rounded-xl border text-sm font-bold transition-all flex items-center gap-2 ${
            view === "deposits"
              ? "bg-gradient-to-l from-emerald-500 to-emerald-600 text-white border-emerald-500 shadow-md"
              : "bg-muted/40 hover:bg-muted border-border text-muted-foreground"
          }`}
        >
          <ArrowDownToLine className="w-4 h-4" /> الإيداعات
          <span className="text-xs opacity-80 tabular-nums">{visibleDeposits.length}</span>
        </button>
      </div>

      {/* Expenses table */}
      {view === "expenses" && (
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gradient-to-l from-primary/10 to-primary/5">
              <tr className="text-right">
                <th className="p-3 font-bold">التاريخ والوقت</th>
                <th className="p-3 font-bold">الوصف</th>
                <th className="p-3 font-bold">التصنيف</th>
                <th className="p-3 font-bold">المبلغ</th>
                <th className="p-3 font-bold">ملاحظات</th>
                <th className="p-3 font-bold text-center">مرفقات</th>
                {canEdit && <th className="p-3 font-bold text-center">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">جاري التحميل...</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={7} className="p-10 text-center">
                  <div className="inline-flex flex-col items-center gap-2 text-muted-foreground">
                    <Receipt className="w-10 h-10 opacity-40" />
                    <div>لا توجد مصاريف مطابقة</div>
                    {canEdit && <Button size="sm" variant="outline" onClick={openAdd}><Plus className="w-4 h-4 ml-1" />أضف أول مصروف</Button>}
                  </div>
                </td></tr>
              ) : visible.map(r => (
                <tr key={r.id} onClick={() => openCategory(r.category)} title="دوس عشان تشوف كل مصاريف التصنيف ده" className="border-t hover:bg-primary/5 transition-colors cursor-pointer">
                  <td className="p-3 whitespace-nowrap text-muted-foreground">{fmtDT(r.expense_datetime)}</td>
                  <td className="p-3 font-semibold">{r.description}</td>
                  <td className="p-3">
                    {r.category
                      ? <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border shadow-sm ${categoryColor(r.category)}`}><Tag className="w-3 h-3" />{r.category}</span>
                      : <span className="text-muted-foreground text-xs">بدون تصنيف</span>}
                  </td>

                  <td className="p-3 font-extrabold text-rose-600 dark:text-rose-400 whitespace-nowrap">{Number(r.amount).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</td>
                  <td className="p-3 text-muted-foreground text-xs max-w-[240px] truncate" title={r.notes || ""}>{r.notes || "—"}</td>
                  <td className="p-3 text-center" onClick={e => e.stopPropagation()}>
                    <AttachmentsDialogButton
                      recordType="personal_expense"
                      recordId={r.id}
                      canEdit={canEdit}
                      count={attachmentCounts[r.id] || 0}
                      label={`مرفقات — ${r.description}`}
                    />
                  </td>
                  {canEdit && (
                    <td className="p-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)} title="تعديل"><Pencil className="w-4 h-4 text-sky-600" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setDelRow(r)} title="حذف"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 text-[11px] text-muted-foreground border-t bg-muted/30 flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 shrink-0" />
          دوس على أي صف عشان تفتح كل مصاريف التصنيف ده وتفلترها بالتاريخ براحتك
        </div>
      </Card>
      )}

      {/* Deposits table */}
      {view === "deposits" && (
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gradient-to-l from-emerald-500/15 to-emerald-500/5">
              <tr className="text-right">
                <th className="p-3 font-bold">التاريخ والوقت</th>
                <th className="p-3 font-bold">الوصف</th>
                <th className="p-3 font-bold">التصنيف</th>
                <th className="p-3 font-bold">المبلغ</th>
                <th className="p-3 font-bold">ملاحظات</th>
                {canEdit && <th className="p-3 font-bold text-center">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">جاري التحميل...</td></tr>
              ) : visibleDeposits.length === 0 ? (
                <tr><td colSpan={6} className="p-10 text-center">
                  <div className="inline-flex flex-col items-center gap-2 text-muted-foreground">
                    <ArrowDownToLine className="w-10 h-10 opacity-40" />
                    <div>لا توجد إيداعات مسجلة</div>
                    {canEdit && <Button size="sm" variant="outline" onClick={openAddDep}><Plus className="w-4 h-4 ml-1" />سجّل أول إيداع</Button>}
                  </div>
                </td></tr>
              ) : visibleDeposits.map(d => (
                <tr key={d.id} className="border-t hover:bg-emerald-500/5 transition-colors">
                  <td className="p-3 whitespace-nowrap text-muted-foreground">{fmtDT(d.deposit_datetime)}</td>
                  <td className="p-3 font-semibold">{d.description || "إيداع"}</td>
                  <td className="p-3">
                    {d.category
                      ? <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border shadow-sm ${categoryColor(d.category)}`}><Tag className="w-3 h-3" />{d.category}</span>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="p-3 font-extrabold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">{Number(d.amount).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</td>
                  <td className="p-3 text-muted-foreground text-xs max-w-[240px] truncate" title={d.notes || ""}>{d.notes || "—"}</td>
                  {canEdit && (
                    <td className="p-3 text-center whitespace-nowrap">
                      <Button size="icon" variant="ghost" onClick={() => openEditDep(d)} title="تعديل"><Pencil className="w-4 h-4 text-sky-600" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setDelDep(d)} title="حذف"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      {/* Category Detail Dialog — كل مصاريف تصنيف معين + فلترة حرة بالتاريخ */}
      <Dialog open={catDetail !== null} onOpenChange={(o) => { if (!o) setCatDetail(null); }}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden gap-0" dir="rtl">
          {/* Header */}
          <div className="relative p-5 bg-gradient-to-l from-violet-500/15 via-primary/10 to-sky-500/10 border-b overflow-hidden">
            <div className="absolute -left-8 -top-8 w-32 h-32 rounded-full bg-violet-500/20 blur-2xl" />
            <div className="absolute -right-8 -bottom-8 w-32 h-32 rounded-full bg-sky-500/20 blur-2xl" />
            <DialogHeader className="relative">
              <DialogTitle className="flex items-center gap-3 text-xl">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-md border ${catDetail ? categoryColor(catDetail) : "bg-muted text-muted-foreground border-border"}`}>
                  <Tag className="w-5 h-5" />
                </div>
                <div>
                  <div>{catDetail || "بدون تصنيف"}</div>
                  <div className="text-xs font-normal text-muted-foreground mt-0.5">كل مصاريف التصنيف ده من أول يوم — فلتر بالتاريخ براحتك</div>
                </div>
              </DialogTitle>
            </DialogHeader>
          </div>

          {/* ملخص سريع: صرفت كام؟ */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 pb-2">
            <Card className="p-3 bg-gradient-to-br from-rose-500/15 to-rose-500/5 border-rose-400/30">
              <div className="text-[11px] text-muted-foreground font-bold">إجمالي اللي اتصرف</div>
              <div className="text-lg font-extrabold text-rose-600 dark:text-rose-400 mt-0.5 tabular-nums">{catStats.total.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} <span className="text-xs">ج.م</span></div>
            </Card>
            <Card className="p-3 bg-gradient-to-br from-sky-500/15 to-sky-500/5 border-sky-400/30">
              <div className="text-[11px] text-muted-foreground font-bold">عدد العمليات</div>
              <div className="text-lg font-extrabold text-sky-600 dark:text-sky-400 mt-0.5 tabular-nums">{catStats.count}</div>
            </Card>
            <Card className="p-3 bg-gradient-to-br from-amber-500/15 to-amber-500/5 border-amber-400/30">
              <div className="text-[11px] text-muted-foreground font-bold">متوسط العملية</div>
              <div className="text-lg font-extrabold text-amber-600 dark:text-amber-400 mt-0.5 tabular-nums">{catStats.avg.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} <span className="text-xs">ج.م</span></div>
            </Card>
            <Card className="p-3 bg-gradient-to-br from-violet-500/15 to-violet-500/5 border-violet-400/30">
              <div className="text-[11px] text-muted-foreground font-bold">أكبر مصروف</div>
              <div className="text-lg font-extrabold text-violet-600 dark:text-violet-400 mt-0.5 tabular-nums">{catStats.max.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} <span className="text-xs">ج.م</span></div>
            </Card>
          </div>

          {/* فلتر التاريخ */}
          <div className="px-4 pb-3 flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">من تاريخ</Label>
              <Input type="date" value={catFrom} onChange={e => setCatFrom(e.target.value)} className="h-9 w-36" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">إلى تاريخ</Label>
              <Input type="date" value={catTo} onChange={e => setCatTo(e.target.value)} className="h-9 w-36" />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <Button size="sm" variant="outline" className="h-9 text-xs" onClick={catPresetThisMonth}>الشهر ده</Button>
              <Button size="sm" variant="outline" className="h-9 text-xs" onClick={catPresetLast3M}>آخر ٣ شهور</Button>
              <Button size="sm" variant={!catFrom && !catTo ? "default" : "ghost"} className="h-9 text-xs" onClick={catPresetAll}>كل التواريخ</Button>
            </div>
            <div className="flex-1" />
            <Button size="sm" variant="outline" className="h-9 text-xs gap-1" onClick={exportCategoryExcel} disabled={!catRows.length}>
              <FileSpreadsheet className="w-3.5 h-3.5" /> تصدير Excel
            </Button>
          </div>

          {/* جدول العمليات */}
          <div className="px-4 pb-4">
            <div className="max-h-[42vh] overflow-y-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                  <tr className="text-right border-b">
                    <th className="p-2.5 font-bold">التاريخ والوقت</th>
                    <th className="p-2.5 font-bold">الوصف</th>
                    <th className="p-2.5 font-bold">المبلغ</th>
                    <th className="p-2.5 font-bold">ملاحظات</th>
                    <th className="p-2.5 font-bold text-center">مرفقات</th>
                    {canEdit && <th className="p-2.5 font-bold text-center">إجراءات</th>}
                  </tr>
                </thead>
                <tbody>
                  {catRows.length === 0 ? (
                    <tr><td colSpan={canEdit ? 6 : 5} className="p-8 text-center text-muted-foreground">
                      <Receipt className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      مفيش مصاريف في الفترة دي للتصنيف ده
                    </td></tr>
                  ) : catRows.map(r => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-primary/5 transition-colors">
                      <td className="p-2.5 whitespace-nowrap text-muted-foreground">{fmtDT(r.expense_datetime)}</td>
                      <td className="p-2.5 font-semibold">{r.description}</td>
                      <td className="p-2.5 font-extrabold text-rose-600 dark:text-rose-400 whitespace-nowrap tabular-nums">{Number(r.amount).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</td>
                      <td className="p-2.5 text-muted-foreground text-xs max-w-[200px] truncate" title={r.notes || ""}>{r.notes || "—"}</td>
                      <td className="p-2.5 text-center">
                        <AttachmentsDialogButton
                          recordType="personal_expense"
                          recordId={r.id}
                          canEdit={canEdit}
                          count={catAttachmentCounts[r.id] || 0}
                          label={`مرفقات — ${r.description}`}
                        />
                      </td>
                      {canEdit && (
                        <td className="p-2.5 text-center whitespace-nowrap">
                          <Button size="icon" variant="ghost" onClick={() => { setCatDetail(null); openEdit(r); }} title="تعديل"><Pencil className="w-4 h-4 text-sky-600" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => setDelRow(r)} title="حذف"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                {catRows.length > 0 && (
                  <tfoot className="sticky bottom-0 bg-muted/95 backdrop-blur border-t-2">
                    <tr>
                      <td colSpan={2} className="p-2.5 font-extrabold">الإجمالي {(catFrom || catTo) ? "في الفترة المختارة" : "(كل التواريخ)"}</td>
                      <td className="p-2.5 font-extrabold text-rose-600 dark:text-rose-400 whitespace-nowrap tabular-nums">{catStats.total.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</td>
                      <td className="p-2.5 text-xs text-muted-foreground tabular-nums">{catStats.count} عملية</td>
                      <td colSpan={canEdit ? 2 : 1} />
                    </tr>
                  </tfoot>
                )}

              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl p-0 overflow-hidden gap-0" dir="rtl">
          {/* Colorful header */}
          <div className="relative p-5 bg-gradient-to-l from-primary/25 via-primary/10 to-emerald-500/15 border-b">
            <div className="absolute -left-8 -top-8 w-32 h-32 rounded-full bg-primary/20 blur-2xl" />
            <div className="absolute -right-8 -bottom-8 w-32 h-32 rounded-full bg-emerald-500/20 blur-2xl" />
            <DialogHeader className="relative">
              <DialogTitle className="flex items-center gap-3 text-xl">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-md ${editing ? "bg-gradient-to-br from-sky-500 to-sky-600" : "bg-gradient-to-br from-emerald-500 to-emerald-600"}`}>
                  {editing ? <Pencil className="w-5 h-5 text-white" /> : <Plus className="w-5 h-5 text-white" />}
                </div>
                <div>
                  <div>{editing ? "تعديل مصروف" : "إضافة مصروف جديد"}</div>
                  <div className="text-xs font-normal text-muted-foreground mt-0.5">مصاريف شخصية — منفصلة عن حسابات النظام</div>
                </div>
              </DialogTitle>
            </DialogHeader>
          </div>

          <div className="p-5 space-y-4 animate-fade-in">
            {/* تنبيه الحقول الناقصة */}
            {formErrors.length > 0 && (
              <div className="rounded-xl border border-red-400/60 bg-gradient-to-l from-red-500/15 to-red-500/5 p-3.5 animate-fade-in shadow-sm">
                <div className="flex items-center gap-2 font-extrabold text-red-700 dark:text-red-300 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> ناقصك شوية حاجات قبل الحفظ:
                </div>
                <ul className="mt-2 space-y-1.5">
                  {formErrors.map(e => (
                    <li key={e} className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" /> {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Amount + Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-3 bg-rose-500/5 border border-rose-400/30 hover:border-rose-400/60 transition-colors">
                <Label className="text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1">
                  <Wallet className="w-3.5 h-3.5" /> المبلغ (ج.م) *
                </Label>
                <Input
                  type="number" step="0.01" inputMode="decimal"
                  value={form.amount}
                  onChange={e => { setForm({ ...form, amount: e.target.value }); setFormErrors(p => p.filter(x => !x.startsWith("المبلغ"))); }}
                  className={`mt-1.5 h-11 text-lg font-bold bg-background ${formErrors.some(x => x.startsWith("المبلغ")) ? "border-red-500 ring-1 ring-red-500" : "border-rose-300/50 focus-visible:ring-rose-400"}`}
                  placeholder="0.00"
                />
              </div>
              <div className="rounded-xl p-3 bg-sky-500/5 border border-sky-400/30 hover:border-sky-400/60 transition-colors">
                <Label className="text-xs font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" /> التاريخ والوقت *
                </Label>
                <Input
                  type="datetime-local"
                  value={form.expense_datetime}
                  onChange={e => setForm({ ...form, expense_datetime: e.target.value })}
                  className="mt-1.5 h-11 border-sky-300/50 focus-visible:ring-sky-400 bg-background"
                />
              </div>
            </div>

            {/* Description */}
            <div className="rounded-xl p-3 bg-primary/5 border border-primary/25 hover:border-primary/50 transition-colors">
              <Label className="text-xs font-bold text-primary flex items-center gap-1">
                <Receipt className="w-3.5 h-3.5" /> الوصف *
              </Label>
              <Input
                value={form.description}
                onChange={e => { setForm({ ...form, description: e.target.value }); setFormErrors(p => p.filter(x => !x.startsWith("الوصف"))); }}
                placeholder="مثال: عشاء عائلة"
                className={`mt-1.5 h-11 bg-background ${formErrors.some(x => x.startsWith("الوصف")) ? "border-red-500 ring-1 ring-red-500" : "border-primary/30 focus-visible:ring-primary"}`}
              />
            </div>

            {/* Category */}
            <div className="rounded-xl p-3 bg-violet-500/5 border border-violet-400/30 hover:border-violet-400/60 transition-colors">
              <Label className="text-xs font-bold text-violet-700 dark:text-violet-300 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5" /> التصنيف *
              </Label>
              <Input
                list="ope-categories"
                value={form.category}
                onChange={e => { setForm({ ...form, category: e.target.value }); setFormErrors(p => p.filter(x => !x.startsWith("التصنيف"))); }}
                placeholder="اكتب تصنيف جديد أو اختر من السابق"
                className={`mt-1.5 h-11 bg-background ${formErrors.some(x => x.startsWith("التصنيف")) ? "border-red-500 ring-1 ring-red-500" : "border-violet-300/50 focus-visible:ring-violet-400"}`}
              />
              <datalist id="ope-categories">
                {allCategories.map(c => <option key={c} value={c} />)}
              </datalist>
              {allCategories.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {allCategories.slice(0, 12).map(c => {
                    const active = form.category === c;
                    return (
                      <button
                        key={c} type="button"
                        onClick={() => { setForm({ ...form, category: c }); setFormErrors(p => p.filter(x => !x.startsWith("التصنيف"))); }}
                        className={`text-xs px-2.5 py-1 rounded-full border font-bold transition-all hover-scale ${
                          active ? categoryColor(c) + " shadow" : "bg-background hover:bg-muted border-border text-foreground"
                        }`}
                      >
                        <Tag className="w-3 h-3 inline ml-1" />{c}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="rounded-xl p-3 bg-amber-500/5 border border-amber-400/30 hover:border-amber-400/60 transition-colors">
              <Label className="text-xs font-bold text-amber-700 dark:text-amber-300">ملاحظات</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className="mt-1.5 border-amber-300/50 focus-visible:ring-amber-400 bg-background resize-none"
                placeholder="أي تفاصيل إضافية..."
              />
            </div>
          </div>

          <DialogFooter className="p-4 bg-muted/30 border-t gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="min-w-[100px]">
              <X className="w-4 h-4 ml-1" /> إلغاء
            </Button>
            <Button
              onClick={save} disabled={saving}
              className={`min-w-[140px] shadow-md ${editing ? "bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700" : "bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"} text-white`}
            >
              {saving ? "جاري الحفظ..." : (editing ? <><Pencil className="w-4 h-4 ml-1" />حفظ التعديل</> : <><Plus className="w-4 h-4 ml-1" />إضافة</>)}
            </Button>
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

      {/* Add/Edit Deposit Dialog */}
      <Dialog open={depDialogOpen} onOpenChange={setDepDialogOpen}>
        <DialogContent className="max-w-xl p-0 overflow-hidden gap-0" dir="rtl">
          <div className="relative p-5 bg-gradient-to-l from-emerald-500/25 via-emerald-500/10 to-teal-500/15 border-b">
            <div className="absolute -left-8 -top-8 w-32 h-32 rounded-full bg-emerald-500/20 blur-2xl" />
            <div className="absolute -right-8 -bottom-8 w-32 h-32 rounded-full bg-teal-500/20 blur-2xl" />
            <DialogHeader className="relative">
              <DialogTitle className="flex items-center gap-3 text-xl">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-md ${editingDep ? "bg-gradient-to-br from-sky-500 to-sky-600" : "bg-gradient-to-br from-emerald-500 to-emerald-600"}`}>
                  {editingDep ? <Pencil className="w-5 h-5 text-white" /> : <ArrowDownToLine className="w-5 h-5 text-white" />}
                </div>
                <div>
                  <div>{editingDep ? "تعديل إيداع" : "إيداع جديد"}</div>
                  <div className="text-xs font-normal text-muted-foreground mt-0.5">ميزانية المحفظة الشخصية — منفصلة عن حسابات النظام</div>
                </div>
              </DialogTitle>
            </DialogHeader>
          </div>

          <div className="p-5 space-y-4 animate-fade-in">
            {/* تنبيه الحقول الناقصة */}
            {depErrors.length > 0 && (
              <div className="rounded-xl border border-red-400/60 bg-gradient-to-l from-red-500/15 to-red-500/5 p-3.5 animate-fade-in shadow-sm">
                <div className="flex items-center gap-2 font-extrabold text-red-700 dark:text-red-300 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> ناقصك شوية حاجات قبل الحفظ:
                </div>
                <ul className="mt-2 space-y-1.5">
                  {depErrors.map(e => (
                    <li key={e} className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" /> {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-3 bg-emerald-500/5 border border-emerald-400/30 hover:border-emerald-400/60 transition-colors">
                <Label className="text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                  <ArrowDownToLine className="w-3.5 h-3.5" /> مبلغ الإيداع (ج.م) *
                </Label>
                <Input
                  type="number" step="0.01" inputMode="decimal"
                  value={depForm.amount}
                  onChange={e => { setDepForm({ ...depForm, amount: e.target.value }); setDepErrors(p => p.filter(x => !x.startsWith("مبلغ الإيداع"))); }}
                  className={`mt-1.5 h-11 text-lg font-bold bg-background ${depErrors.some(x => x.startsWith("مبلغ الإيداع")) ? "border-red-500 ring-1 ring-red-500" : "border-emerald-300/50 focus-visible:ring-emerald-400"}`}
                  placeholder="0.00"
                />
              </div>
              <div className="rounded-xl p-3 bg-sky-500/5 border border-sky-400/30 hover:border-sky-400/60 transition-colors">
                <Label className="text-xs font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" /> التاريخ والوقت *
                </Label>
                <Input
                  type="datetime-local"
                  value={depForm.deposit_datetime}
                  onChange={e => setDepForm({ ...depForm, deposit_datetime: e.target.value })}
                  className="mt-1.5 h-11 border-sky-300/50 focus-visible:ring-sky-400 bg-background"
                />
              </div>
            </div>

            <div className="rounded-xl p-3 bg-primary/5 border border-primary/25 hover:border-primary/50 transition-colors">
              <Label className="text-xs font-bold text-primary flex items-center gap-1">
                <Receipt className="w-3.5 h-3.5" /> الوصف
              </Label>
              <Input
                value={depForm.description}
                onChange={e => setDepForm({ ...depForm, description: e.target.value })}
                placeholder="مثال: ميزانية شهر رمضان"
                className="mt-1.5 h-11 border-primary/30 focus-visible:ring-primary bg-background"
              />
            </div>

            {/* تصنيف الإيداع — زي تصنيف المصروف بالظبط */}
            <div className="rounded-xl p-3 bg-violet-500/5 border border-violet-400/30 hover:border-violet-400/60 transition-colors">
              <Label className="text-xs font-bold text-violet-700 dark:text-violet-300 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5" /> التصنيف *
              </Label>
              <Input
                list="opd-categories"
                value={depForm.category}
                onChange={e => { setDepForm({ ...depForm, category: e.target.value }); setDepErrors(p => p.filter(x => !x.startsWith("التصنيف"))); }}
                placeholder="مثال: ميزانية شهرية، راتب، أرباح..."
                className={`mt-1.5 h-11 bg-background ${depErrors.some(x => x.startsWith("التصنيف")) ? "border-red-500 ring-1 ring-red-500" : "border-violet-300/50 focus-visible:ring-violet-400"}`}
              />
              <datalist id="opd-categories">
                {allDepCategories.map(c => <option key={c} value={c} />)}
              </datalist>
              {allDepCategories.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {allDepCategories.slice(0, 12).map(c => {
                    const active = depForm.category === c;
                    return (
                      <button
                        key={c} type="button"
                        onClick={() => { setDepForm({ ...depForm, category: c }); setDepErrors(p => p.filter(x => !x.startsWith("التصنيف"))); }}
                        className={`text-xs px-2.5 py-1 rounded-full border font-bold transition-all hover-scale ${
                          active ? categoryColor(c) + " shadow" : "bg-background hover:bg-muted border-border text-foreground"
                        }`}
                      >
                        <Tag className="w-3 h-3 inline ml-1" />{c}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-xl p-3 bg-amber-500/5 border border-amber-400/30 hover:border-amber-400/60 transition-colors">
              <Label className="text-xs font-bold text-amber-700 dark:text-amber-300">ملاحظات</Label>
              <Textarea
                rows={2}
                value={depForm.notes}
                onChange={e => setDepForm({ ...depForm, notes: e.target.value })}
                className="mt-1.5 border-amber-300/50 focus-visible:ring-amber-400 bg-background resize-none"
                placeholder="أي تفاصيل إضافية..."
              />
            </div>
          </div>

          <DialogFooter className="p-4 bg-muted/30 border-t gap-2">
            <Button variant="outline" onClick={() => setDepDialogOpen(false)} className="min-w-[100px]">
              <X className="w-4 h-4 ml-1" /> إلغاء
            </Button>
            <Button
              onClick={saveDep} disabled={savingDep}
              className={`min-w-[140px] shadow-md ${editingDep ? "bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700" : "bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"} text-white`}
            >
              {savingDep ? "جاري الحفظ..." : (editingDep ? <><Pencil className="w-4 h-4 ml-1" />حفظ التعديل</> : <><Plus className="w-4 h-4 ml-1" />إيداع</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete deposit confirm */}
      <AlertDialog open={!!delDep} onOpenChange={o => !o && setDelDep(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الإيداع؟</AlertDialogTitle>
            <AlertDialogDescription>
              هيتم حذف "{delDep?.description || "إيداع"}" بمبلغ {delDep ? Number(delDep.amount).toLocaleString("ar-EG") : ""} ج.م. الحذف نهائي.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={removeDep} className="bg-destructive text-destructive-foreground">حذف</AlertDialogAction>
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
                <div style={{ fontSize: 12, color: "#0f766e" }}>إجمالي مصروفات الشهر</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f2c3f" }}>{pdfMonthTotal.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</div>
              </div>
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8ee", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#6b7a86" }}>عدد المصاريف</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f2c3f" }}>{pdfMonthRows.length.toLocaleString("ar-EG")}</div>
              </div>
              <div style={{ background: "#e8f6ee", border: "1px solid #a7dcc0", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#15803d" }}>إيداعات الشهر</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0f2c3f" }}>{pdfMonthDep.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</div>
              </div>
              <div style={{ background: pdfMonthDep - pdfMonthTotal < 0 ? "#fdecec" : "#eef4fb", border: `1px solid ${pdfMonthDep - pdfMonthTotal < 0 ? "#f2b6b6" : "#b9d2ea"}`, borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: pdfMonthDep - pdfMonthTotal < 0 ? "#b91c1c" : "#1d4ed8" }}>الباقي من الشهر</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: pdfMonthDep - pdfMonthTotal < 0 ? "#b91c1c" : "#0f2c3f" }}>{(pdfMonthDep - pdfMonthTotal).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</div>
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
