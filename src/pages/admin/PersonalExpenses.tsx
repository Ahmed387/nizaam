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
import { Wallet, Plus, Search, Pencil, Trash2, FileDown, FileSpreadsheet, CalendarDays, Tag, TrendingUp, TrendingDown, Filter, X, Sparkles, Receipt, Bell, PartyPopper, Flame, Crown, Minus, PiggyBank, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";


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
function monthKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("ar-EG", { month: "long", year: "numeric" });
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
  const [filterCategory, setFilterCategory] = useState<string>("__all__");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  // month tab ("__all__" = الإجمالي)
  const [activeTab, setActiveTab] = useState<string>("__all__");

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
  const [depForm, setDepForm] = useState({ amount: "", description: "", deposit_datetime: toLocalInput(new Date().toISOString()), notes: "" });
  const [savingDep, setSavingDep] = useState(false);
  const [delDep, setDelDep] = useState<Deposit | null>(null);
  const pdfRef = useRef<HTMLDivElement>(null);
  const [pdfMonth, setPdfMonth] = useState<string | null>(null);

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

  // رصيد المحفظة (مش متأثر بالفلاتر — بيتبع تبويب الشهر بس)
  const balSpent = useMemo(() => {
    const list = activeTab === "__all__" ? rows : rows.filter(r => monthKey(r.expense_datetime) === activeTab);
    return list.reduce((s, r) => s + Number(r.amount), 0);
  }, [rows, activeTab]);
  const balDeposited = activeTab === "__all__"
    ? deposits.reduce((s, d) => s + Number(d.amount), 0)
    : (depositMonthTotals.get(activeTab) || 0);
  const balRemaining = balDeposited - balSpent;

  const visibleDeposits = useMemo(
    () => activeTab === "__all__" ? deposits : deposits.filter(d => monthKey(d.deposit_datetime) === activeTab),
    [deposits, activeTab]
  );

  // Rows shown in the table = filters + active month tab
  const visible = useMemo(
    () => activeTab === "__all__" ? filtered : filtered.filter(r => monthKey(r.expense_datetime) === activeTab),
    [filtered, activeTab]
  );

  const grandTotal = useMemo(() => visible.reduce((s, r) => s + Number(r.amount), 0), [visible]);
  const attachmentCounts = useAttachmentCounts("personal_expense", visible.map(r => r.id));

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
    const now = new Date();
    let dt = now;
    if (activeTab !== "__all__" && activeTab !== monthKey(now.toISOString())) {
      const [y, m] = activeTab.split("-").map(Number);
      dt = new Date(y, m - 1, 1, now.getHours(), now.getMinutes());
    }
    setDepForm({ amount: "", description: "", deposit_datetime: toLocalInput(dt.toISOString()), notes: "" });
    setDepDialogOpen(true);
  };
  const openEditDep = (d: Deposit) => {
    setEditingDep(d);
    setDepForm({ amount: String(d.amount), description: d.description ?? "", deposit_datetime: toLocalInput(d.deposit_datetime), notes: d.notes ?? "" });
    setDepDialogOpen(true);
  };
  const saveDep = async () => {
    if (!ownerId) return;
    const amt = Number(depForm.amount);
    if (!amt || amt <= 0) return toast.error("أدخل مبلغ صحيح");
    if (!depForm.deposit_datetime) return toast.error("أدخل التاريخ والوقت");
    setSavingDep(true);
    const payload: any = {
      owner_user_id: ownerId,
      amount: amt,
      description: depForm.description.trim() || "إيداع",
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

  /** تصدير Excel — شهر محدد أو كل الصفوف الظاهرة */
  const exportExcel = (mkey: string | null) => {
    try {
      const data = mkey ? filtered.filter(r => monthKey(r.expense_datetime) === mkey) : visible;
      if (data.length === 0) return toast.error("مفيش بيانات للتصدير");
      const sorted = [...data].sort((a, b) => a.expense_datetime.localeCompare(b.expense_datetime));
      const aoa: (string | number)[][] = [
        ["التاريخ", "الوقت", "الوصف", "التصنيف", "المبلغ (ج.م)", "ملاحظات"],
        ...sorted.map(r => {
          const d = new Date(r.expense_datetime);
          return [
            d.toLocaleDateString("ar-EG"),
            d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
            r.description || "",
            r.category || "بدون تصنيف",
            Number(r.amount),
            r.notes || "",
          ];
        }),
      ];
      const total = sorted.reduce((s, r) => s + Number(r.amount), 0);
      aoa.push([]);
      aoa.push(["", "", "", "الإجمالي", total, ""]);

      if (mkey) {
        const depTotal = depositMonthTotals.get(mkey) || 0;
        if (depTotal > 0) {
          aoa.push(["", "", "", "إجمالي الإيداعات", depTotal, ""]);
          aoa.push(["", "", "", "الباقي من الشهر", Number((depTotal - total).toFixed(2)), depTotal - total < 0 ? "صرفت أكتر من إيداعك" : ""]);
        }
        const d = monthDelta(mkey);
        if (d) aoa.push(["", "", "", `مقارنة بـ ${monthLabel(d.prevKey)}`, Number(d.diff.toFixed(2)), `${d.pct >= 0 ? "+" : ""}${d.pct.toFixed(1)}%`]);
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 14 }, { wch: 10 }, { wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 30 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, mkey ? mkey : "الكل");
      XLSX.writeFile(wb, `personal-expenses-${mkey || "all"}.xlsx`);
      toast.success("تم تصدير ملف Excel");
    } catch (e: any) {
      toast.error("فشل تصدير Excel: " + (e?.message || ""));
    }
  };

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
                <PiggyBank className="w-5 h-5 ml-1" /> إيداع جديد
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


      {/* Month tabs — تبويب لكل شهر/سنة + تبويب الإجمالي */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("__all__")}
          className={`px-4 py-2 rounded-xl border text-sm font-bold transition-all ${
            activeTab === "__all__"
              ? "bg-gradient-to-l from-primary to-primary/80 text-primary-foreground border-primary shadow-md"
              : "bg-muted/40 hover:bg-muted border-border text-muted-foreground"
          }`}
        >
          الإجمالي
        </button>
        {monthTabs.map((m, idx) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setActiveTab(m.key)}
            className={`px-4 py-2 rounded-xl border text-sm font-bold transition-all flex items-center gap-2 ${
              activeTab === m.key
                ? `bg-gradient-to-br shadow-md ${monthColors[idx % monthColors.length]} ring-2 ring-primary/40`
                : "bg-muted/40 hover:bg-muted border-border text-muted-foreground"
            }`}
          >
            <CalendarDays className="w-4 h-4 opacity-70" />
            {monthLabel(m.key)}
            <span className="text-xs font-extrabold tabular-nums opacity-90">
              {m.total.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ج.م
            </span>
          </button>
        ))}
      </div>

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
                  {activeTab === "__all__" ? "إجمالي كل الشهور" : `مصاريف ${monthLabel(activeTab)}`}
                  {(q || fromDate || toDate || filterCategory !== "__all__" || minAmount || maxAmount) ? " (بعد الفلاتر)" : ""}
                </div>
                <div className="text-4xl font-extrabold mt-1 text-rose-700 dark:text-rose-200 tabular-nums">
                  {grandTotal.toLocaleString("ar-EG", { maximumFractionDigits: 2 })}
                  <span className="text-lg font-semibold opacity-70 mr-1">ج.م</span>
                </div>
                {activeTab !== "__all__" && (() => {
                  const d = monthDelta(activeTab);
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
                {activeTab === "__all__" ? ` · ${monthlyTotals.length} شهر` : ""}
              </div>
              {activeTab !== "__all__" && (
                <Button size="sm" variant="outline" onClick={() => exportMonthPDF(activeTab)}>
                  <FileDown className="w-4 h-4 ml-1" /> PDF الشهر
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => exportExcel(activeTab === "__all__" ? null : activeTab)}>
                <FileSpreadsheet className="w-4 h-4 ml-1" /> {activeTab === "__all__" ? "Excel (الكل)" : "Excel الشهر"}
              </Button>
            </div>

          </div>
        </Card>
      </div>




      {/* رصيد المحفظة الشخصية */}
      <Card className="p-5 mb-6 border-emerald-400/40 bg-gradient-to-l from-emerald-500/15 via-emerald-500/5 to-transparent animate-fade-in">
        <div className="flex items-center gap-2 mb-3 text-sm font-bold text-emerald-700 dark:text-emerald-300">
          <PiggyBank className="w-4 h-4" />
          محفظتك الشخصية {activeTab === "__all__" ? "(كل الشهور)" : `— ${monthLabel(activeTab)}`}
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
            ⚠️ صرفت أكتر من اللي أودعته بـ {EGP(Math.abs(balRemaining))} {activeTab !== "__all__" ? "في الشهر ده" : "إجمالاً"}
          </div>
        )}
        {balDeposited === 0 && (
          <div className="mt-3 text-xs text-muted-foreground">لسه مسجلتش أي إيداع — دوس «إيداع جديد» وسجّل ميزانية الشهر 👆</div>
        )}
      </Card>

      {/* Actions + Filters */}
      <Card className="p-4 mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Filter className="w-4 h-4 text-primary" /> بحث متقدم
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
            <Label className="text-xs text-muted-foreground">التصنيف</Label>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">كل التصنيفات</SelectItem>
                {allCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
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

      {/* Monthly totals — تظهر في تبويب الإجمالي فقط */}
      {activeTab === "__all__" && monthlyTotals.length > 0 && (
        <div className="mb-6">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-primary" /> الإجماليات الشهرية</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {monthlyTotals.map((m, idx) => (
              <Card key={m.key} onClick={() => setActiveTab(m.key)} className={`p-4 cursor-pointer hover:shadow-md transition-shadow bg-gradient-to-br border ${monthColors[idx % monthColors.length]}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs opacity-80">{monthLabel(m.key)}</div>
                    <div className="text-2xl font-extrabold mt-1">{m.total.toLocaleString("ar-EG", { maximumFractionDigits: 2 })}<span className="text-sm mr-1">ج.م</span></div>
                    <div className="text-xs mt-1 opacity-70">{m.count} مصروف</div>
                    {(() => {
                      const dep = depositMonthTotals.get(m.key) || 0;
                      if (dep <= 0) return null;
                      const rem = dep - m.total;
                      return (
                        <div className="mt-2 space-y-0.5 text-[11px] font-bold">
                          <div className="opacity-80 flex items-center gap-1"><PiggyBank className="w-3 h-3" /> أودعت: {dep.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ج.م</div>
                          <div className={rem < 0 ? "text-red-600 dark:text-red-300" : "opacity-90"}>الباقي: {rem.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ج.م</div>
                        </div>
                      );
                    })()}
                    {(() => {
                      const d = monthDelta(m.key);
                      if (!d) return null;
                      const up = d.diff > 0, flat = Math.abs(d.diff) < 0.005;
                      return (
                        <div className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          flat ? "bg-background/60 text-muted-foreground"
                            : up ? "bg-rose-500/20 text-rose-700 dark:text-rose-300"
                            : "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                        }`}>
                          {flat ? <Minus className="w-3 h-3" /> : up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {flat ? "بدون تغيير" : `${up ? "+" : "−"}${Math.abs(d.pct).toFixed(1)}%`}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); exportMonthPDF(m.key); }} title="تصدير PDF لهذا الشهر">
                      <FileDown className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); exportExcel(m.key); }} title="تصدير Excel لهذا الشهر">
                      <FileSpreadsheet className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>

            ))}
          </div>
        </div>
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
                <tr key={r.id} className="border-t hover:bg-primary/5 transition-colors">
                  <td className="p-3 whitespace-nowrap text-muted-foreground">{fmtDT(r.expense_datetime)}</td>
                  <td className="p-3 font-semibold">{r.description}</td>
                  <td className="p-3">
                    {r.category
                      ? <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border shadow-sm ${categoryColor(r.category)}`}><Tag className="w-3 h-3" />{r.category}</span>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </td>

                  <td className="p-3 font-extrabold text-rose-600 dark:text-rose-400 whitespace-nowrap">{Number(r.amount).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</td>
                  <td className="p-3 text-muted-foreground text-xs max-w-[240px] truncate" title={r.notes || ""}>{r.notes || "—"}</td>
                  <td className="p-3 text-center">
                    <AttachmentsDialogButton
                      recordType="personal_expense"
                      recordId={r.id}
                      canEdit={canEdit}
                      count={attachmentCounts[r.id] || 0}
                      label={`مرفقات — ${r.description}`}
                    />
                  </td>
                  {canEdit && (
                    <td className="p-3 text-center whitespace-nowrap">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)} title="تعديل"><Pencil className="w-4 h-4 text-sky-600" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setDelRow(r)} title="حذف"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
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
                <th className="p-3 font-bold">المبلغ</th>
                <th className="p-3 font-bold">ملاحظات</th>
                {canEdit && <th className="p-3 font-bold text-center">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">جاري التحميل...</td></tr>
              ) : visibleDeposits.length === 0 ? (
                <tr><td colSpan={5} className="p-10 text-center">
                  <div className="inline-flex flex-col items-center gap-2 text-muted-foreground">
                    <PiggyBank className="w-10 h-10 opacity-40" />
                    <div>لا توجد إيداعات مسجلة</div>
                    {canEdit && <Button size="sm" variant="outline" onClick={openAddDep}><Plus className="w-4 h-4 ml-1" />سجّل أول إيداع</Button>}
                  </div>
                </td></tr>
              ) : visibleDeposits.map(d => (
                <tr key={d.id} className="border-t hover:bg-emerald-500/5 transition-colors">
                  <td className="p-3 whitespace-nowrap text-muted-foreground">{fmtDT(d.deposit_datetime)}</td>
                  <td className="p-3 font-semibold">{d.description || "إيداع"}</td>
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
            {/* Amount + Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-3 bg-rose-500/5 border border-rose-400/30 hover:border-rose-400/60 transition-colors">
                <Label className="text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1">
                  <Wallet className="w-3.5 h-3.5" /> المبلغ (ج.م) *
                </Label>
                <Input
                  type="number" step="0.01" inputMode="decimal"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  className="mt-1.5 h-11 text-lg font-bold border-rose-300/50 focus-visible:ring-rose-400 bg-background"
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
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="مثال: عشاء عائلة"
                className="mt-1.5 h-11 border-primary/30 focus-visible:ring-primary bg-background"
              />
            </div>

            {/* Category */}
            <div className="rounded-xl p-3 bg-violet-500/5 border border-violet-400/30 hover:border-violet-400/60 transition-colors">
              <Label className="text-xs font-bold text-violet-700 dark:text-violet-300 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5" /> التصنيف
              </Label>
              <Input
                list="ope-categories"
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                placeholder="اكتب تصنيف جديد أو اختر من السابق"
                className="mt-1.5 h-11 border-violet-300/50 focus-visible:ring-violet-400 bg-background"
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
                        onClick={() => setForm({ ...form, category: c })}
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
                  {editingDep ? <Pencil className="w-5 h-5 text-white" /> : <PiggyBank className="w-5 h-5 text-white" />}
                </div>
                <div>
                  <div>{editingDep ? "تعديل إيداع" : "إيداع جديد"}</div>
                  <div className="text-xs font-normal text-muted-foreground mt-0.5">ميزانية المحفظة الشخصية — منفصلة عن حسابات النظام</div>
                </div>
              </DialogTitle>
            </DialogHeader>
          </div>

          <div className="p-5 space-y-4 animate-fade-in">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-3 bg-emerald-500/5 border border-emerald-400/30 hover:border-emerald-400/60 transition-colors">
                <Label className="text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                  <PiggyBank className="w-3.5 h-3.5" /> مبلغ الإيداع (ج.م) *
                </Label>
                <Input
                  type="number" step="0.01" inputMode="decimal"
                  value={depForm.amount}
                  onChange={e => setDepForm({ ...depForm, amount: e.target.value })}
                  className="mt-1.5 h-11 text-lg font-bold border-emerald-300/50 focus-visible:ring-emerald-400 bg-background"
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
