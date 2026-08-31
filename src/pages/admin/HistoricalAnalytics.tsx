import { Fragment, useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HistoricalUploadDialog } from "@/components/HistoricalUploadDialog";
import { HISTORICAL_BRANCHES } from "@/lib/historicalExcelImporter";
import { formatEGP, formatNumber } from "@/lib/format";
import { exportToExcel } from "@/lib/export";
import { toast } from "sonner";
import {
  Upload, Download, History, Loader2, TrendingUp, TrendingDown, Wallet, Coins,
  ChevronDown, ChevronLeft,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";

type Inv = {
  id: string; branch_name: string; doc_type: string; invoice_no: string | null;
  date: string; year: number; month: number; party_name: string | null;
  payment_method: string | null; total_qty: number; discount: number;
  total_amount: number; profit: number; paid_cash: number; credit: number; due: number;
};
type Item = {
  id: string; invoice_id: string | null; branch_name: string; year: number;
  item_code: string | null; item_name: string; qty: number; price: number; profit: number; total: number;
};
type Vch = {
  id: string; branch_name: string; voucher_type: string; voucher_no: string | null;
  date: string; year: number; month: number; amount: number; category: string | null;
  party_name: string | null; movement_name: string | null; treasury_name: string | null;
};

const PAGE = 1000;
async function fetchAllRows<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table as any).select(cols).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const PAY_GROUPS: Record<string, RegExp> = {
  cash: /نقد|كاش|cash/i,
  credit: /اجل|آجل|أجل|credit/i,
  bank: /بنك|محفظ|فودافون|انستا|instap|visa|فيزا|bank/i,
};

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const PIE_COLORS = ["#10b981", "#0ea5e9", "#f43f5e", "#f59e0b", "#6366f1", "#14b8a6", "#a855f7", "#ef4444", "#84cc16", "#eab308"];

/**
 * فلتر المصروفات التشغيلية الحقيقية:
 * - سند صرف بقيمة أكبر من صفر.
 * - يشترط تصنيفاً دفترياً صالحاً (ليس فارغاً وليس "غير مبوّب").
 * - يستبعد التحويلات/السداد للمخزن الرئيسي وبين الخزائن.
 */
const TRANSFER_RE = /تحويل|حواله|حوالة|المخزن الرئيسي|سيوله|سيولة|ايداع خزنه|تغذيه|تغذية/;
const UNCLASSIFIED_RE = /^(غير مبوّب|غير مبوب|بدون تصنيف|-|_)$/;

export function isOpexVoucher(v: { voucher_type: string; amount?: number | string | null; category?: string | null; party_name?: string | null; movement_name?: string | null; treasury_name?: string | null; notes?: string | null }): boolean {
  if (v.voucher_type !== "expense") return false;
  if (!(Number(v.amount ?? 0) > 0)) return false;
  const cat = (v.category ?? "").trim();
  if (!cat || UNCLASSIFIED_RE.test(cat)) return false; // بدون تصنيف = تحويل/سداد وليس مصروف تشغيلي
  const party = (v.party_name ?? "").trim();
  if (party === "المخزن الرئيسي") return false; // سداد/تحويل للمخزن الرئيسي
  const text = `${v.movement_name ?? ""} ${cat} ${v.treasury_name ?? ""}`;
  if (TRANSFER_RE.test(text)) return false;
  return true;
}


function KpiCard({ title, value, sub, badge, tone, icon }: {
  title: string; value: string; sub?: string; badge?: string;
  tone: "emerald" | "sky" | "rose" | "amber" | "indigo"; icon: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    emerald: "from-emerald-500/15 to-emerald-500/5 border-emerald-500/25 text-emerald-600 dark:text-emerald-400",
    sky: "from-sky-500/15 to-sky-500/5 border-sky-500/25 text-sky-600 dark:text-sky-400",
    rose: "from-rose-500/15 to-rose-500/5 border-rose-500/25 text-rose-600 dark:text-rose-400",
    amber: "from-amber-500/15 to-amber-500/5 border-amber-500/25 text-amber-600 dark:text-amber-400",
    indigo: "from-indigo-500/15 to-indigo-500/5 border-indigo-500/25 text-indigo-600 dark:text-indigo-400",
  };
  return (
    <div className={`rounded-2xl border bg-gradient-to-br backdrop-blur-sm p-4 shadow-sm ${tones[tone]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <span className="opacity-80">{icon}</span>
      </div>
      <div className="text-2xl font-extrabold tracking-tight">{value}</div>
      <div className="flex items-center gap-2 mt-1">
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
        {badge && <Badge variant="secondary" className="text-[10px]">{badge}</Badge>}
      </div>
    </div>
  );
}

export default function HistoricalAnalytics() {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [vouchers, setVouchers] = useState<Vch[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  // فلاتر معزولة عن التنقل بين التبويبات ونوافذ الرفع
  const [branch, setBranch] = useState<string>("all");
  const [year, setYear] = useState<string>("all");
  const [pay, setPay] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [inv, it, vc] = await Promise.all([
        fetchAllRows<Inv>("historical_invoices", "id,branch_name,doc_type,invoice_no,date,year,month,party_name,payment_method,total_qty,discount,total_amount,profit,paid_cash,credit,due"),
        fetchAllRows<Item>("historical_invoice_items", "id,invoice_id,branch_name,year,item_code,item_name,qty,price,profit,total"),
        fetchAllRows<Vch>("historical_vouchers", "id,branch_name,voucher_type,voucher_no,date,year,month,amount,category,party_name,movement_name,treasury_name"),
      ]);
      setInvoices(inv); setItems(it); setVouchers(vc);
    } catch (e: any) {
      toast.error("فشل تحميل الأرشيف: " + e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const years = useMemo(() => {
    const s = new Set<number>();
    invoices.forEach((i) => s.add(i.year));
    vouchers.forEach((v) => s.add(v.year));
    return Array.from(s).sort();
  }, [invoices, vouchers]);

  const matchPay = (m: string | null) => {
    if (pay === "all") return true;
    const re = PAY_GROUPS[pay];
    return re ? re.test(m ?? "") : true;
  };
  const baseMatch = (b: string, y: number) =>
    (branch === "all" || b === branch) && (year === "all" || y === +year);

  const fInv = useMemo(
    () => invoices.filter((i) => baseMatch(i.branch_name, i.year) && matchPay(i.payment_method)),
    [invoices, branch, year, pay],
  );
  const fVch = useMemo(
    () => vouchers.filter((v) => baseMatch(v.branch_name, v.year)),
    [vouchers, branch, year],
  );
  const invIds = useMemo(() => new Set(fInv.map((i) => i.id)), [fInv]);
  const fItems = useMemo(
    () => items.filter((it) => it.invoice_id && invIds.has(it.invoice_id)),
    [items, invIds],
  );

  const by = (t: string) => fInv.filter((i) => i.doc_type === t);
  const sum = (arr: any[], k: string) => arr.reduce((s, r) => s + Number(r[k] ?? 0), 0);

  const k = useMemo(() => {
    const sales = by("sales"), purch = by("purchases"), sRet = by("sales_returns"), pRet = by("purchase_returns");
    const salesTotal = sum(sales, "total_amount"), sRetTotal = sum(sRet, "total_amount");
    const purchTotal = sum(purch, "total_amount"), pRetTotal = sum(pRet, "total_amount");
    // المرتجعات مسجلة بقيم سالبة → نستخدم القيمة المطلقة لتجنب الجمع الخاطئ
    const netSales = salesTotal - Math.abs(sRetTotal);
    const netPurch = purchTotal - Math.abs(pRetTotal);
    const gross = sum(sales, "profit") - Math.abs(sum(sRet, "profit"));
    const opexRows = fVch.filter(isOpexVoucher);
    const opex = opexRows.reduce((s, v) => s + Number(v.amount ?? 0), 0);
    const receipts = fVch.filter((v) => v.voucher_type === "receipt").reduce((s, v) => s + Number(v.amount ?? 0), 0);
    const monthsCount = new Set(opexRows.map((v) => `${v.year}-${v.month}`)).size || 1;
    const due = sum(sales, "due") - Math.abs(sum(sRet, "due"));
    return {
      netSales, salesTotal, sRetTotal: Math.abs(sRetTotal), salesCount: sales.length, sRetCount: sRet.length,
      netPurch, purchTotal, pRetTotal: Math.abs(pRetTotal), purchCount: purch.length, pRetCount: pRet.length,
      gross, margin: netSales ? (gross / netSales) * 100 : 0,
      opex, opexAvg: opex / monthsCount, receipts,
      noi: gross - opex, due,
    };
  }, [fInv, fVch]);

  /* charts */
  const trend = useMemo(() => {
    const map = new Map<string, any>();
    const key = (y: number, m: number) => (year === "all" ? `${y}` : `${y}-${String(m).padStart(2, "0")}`);
    const label = (y: number, m: number) => (year === "all" ? `${y}` : MONTHS[m - 1]);
    for (const i of fInv) {
      const kk = key(i.year, i.month);
      const row = map.get(kk) ?? { key: kk, name: label(i.year, i.month), مبيعات: 0, مشتريات: 0, أرباح: 0, مصروفات: 0 };
      const amt = Number(i.total_amount ?? 0), pr = Number(i.profit ?? 0);
      if (i.doc_type === "sales") { row["مبيعات"] += amt; row["أرباح"] += pr; }
      if (i.doc_type === "sales_returns") { row["مبيعات"] -= Math.abs(amt); row["أرباح"] -= Math.abs(pr); }
      if (i.doc_type === "purchases") row["مشتريات"] += amt;
      if (i.doc_type === "purchase_returns") row["مشتريات"] -= Math.abs(amt);
      map.set(kk, row);
    }
    for (const v of fVch) {
      if (!isOpexVoucher(v)) continue;
      const kk = key(v.year, v.month);
      const row = map.get(kk) ?? { key: kk, name: label(v.year, v.month), مبيعات: 0, مشتريات: 0, أرباح: 0, مصروفات: 0 };
      row["مصروفات"] += Number(v.amount ?? 0);
      map.set(kk, row);
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [fInv, fVch, year]);

  const branchPerf = useMemo(
    () => HISTORICAL_BRANCHES.map((b) => {
      const rows = fInv.filter((i) => i.branch_name === b);
      const s = rows.filter((r) => r.doc_type === "sales");
      const sr = rows.filter((r) => r.doc_type === "sales_returns");
      return {
        name: b,
        مبيعات: sum(s, "total_amount") - Math.abs(sum(sr, "total_amount")),
        أرباح: sum(s, "profit") - Math.abs(sum(sr, "profit")),
      };
    }),
    [fInv],
  );

  const expenseCats = useMemo(() => {
    const m = new Map<string, number>();
    fVch.filter(isOpexVoucher).forEach((v) => {
      const c = v.category || "غير مبوّب";
      m.set(c, (m.get(c) ?? 0) + Number(v.amount ?? 0));
    });
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
  }, [fVch]);

  /* drill-down tables */
  const topSuppliers = useMemo(() => {
    const m = new Map<string, { name: string; purchases: number; returns: number; paid: number; due: number }>();
    fInv.forEach((i) => {
      if (i.doc_type !== "purchases" && i.doc_type !== "purchase_returns") return;
      const n = i.party_name || "غير محدد";
      const r = m.get(n) ?? { name: n, purchases: 0, returns: 0, paid: 0, due: 0 };
      const total = Number(i.total_amount ?? 0);
      const paid = Number(i.paid_cash ?? 0);
      const due = Number(i.due ?? 0);
      if (i.doc_type === "purchases") {
        r.purchases += total;
        r.paid += paid;
        r.due += due;
      } else {
        // المرتجعات مسجلة بقيم سالبة → نخصم قيمتها المطلقة
        r.returns += Math.abs(total);
        r.paid -= Math.abs(paid);
        r.due -= Math.abs(due);
      }
      m.set(n, r);
    });
    const rows = Array.from(m.values()).map((r) => ({ ...r, net: r.purchases - r.returns }));
    const total = rows.reduce((s, r) => s + r.net, 0) || 1;
    return rows.map((r) => ({ ...r, share: (r.net / total) * 100 })).sort((a, b) => b.net - a.net).slice(0, 50);
  }, [fInv]);

  const topCustomers = useMemo(() => {
    const m = new Map<string, { name: string; total: number; paid: number; due: number }>();
    fInv.forEach((i) => {
      if (i.doc_type !== "sales" && i.doc_type !== "sales_returns") return;
      const n = i.party_name || "غير محدد";
      const r = m.get(n) ?? { name: n, total: 0, paid: 0, due: 0 };
      const total = Number(i.total_amount ?? 0);
      const paid = Number(i.paid_cash ?? 0);
      const due = Number(i.due ?? 0);
      if (i.doc_type === "sales") {
        r.total += total;
        r.paid += paid;
        r.due += due;
      } else {
        // المرتجعات مسجلة بقيم سالبة → نخصم قيمتها المطلقة
        r.total -= Math.abs(total);
        r.paid -= Math.abs(paid);
        r.due -= Math.abs(due);
      }
      m.set(n, r);
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total).slice(0, 50);
  }, [fInv]);

  const topProducts = useMemo(() => {
    const docType = new Map(fInv.map((i) => [i.id, i.doc_type]));
    const m = new Map<string, { code: string; name: string; qty: number; revenue: number; profit: number }>();
    fItems.forEach((it) => {
      const kk = it.item_code || it.item_name;
      const r = m.get(kk) ?? { code: it.item_code || "—", name: it.item_name, qty: 0, revenue: 0, profit: 0 };
      const isReturn = (docType.get(it.invoice_id ?? "") ?? "").endsWith("_returns");
      const qty = Number(it.qty ?? 0);
      const total = Number(it.total ?? 0);
      const profit = Number(it.profit ?? 0);
      r.qty += isReturn ? -Math.abs(qty) : qty;
      r.revenue += isReturn ? -Math.abs(total) : total;
      r.profit += isReturn ? -Math.abs(profit) : profit;
      m.set(kk, r);
    });
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 50);
  }, [fItems, fInv]);

  const itemsByInvoice = useMemo(() => {
    const m = new Map<string, Item[]>();
    fItems.forEach((it) => {
      if (!it.invoice_id) return;
      const a = m.get(it.invoice_id) ?? [];
      a.push(it); m.set(it.invoice_id, a);
    });
    return m;
  }, [fItems]);

  const docs = useMemo(
    () => [...fInv].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 500),
    [fInv],
  );

  const DOC_LABEL: Record<string, string> = {
    sales: "فاتورة بيع", purchases: "فاتورة شراء",
    sales_returns: "مرتجع بيع", purchase_returns: "مرتجع شراء",
  };

  const doExport = () => {
    exportToExcel(`الأرشيف-التاريخي-${branch === "all" ? "كل-الفروع" : branch}-${year}`, [
      {
        name: "المستندات",
        rows: fInv.map((i) => ({
          "الفرع": i.branch_name, "النوع": DOC_LABEL[i.doc_type] ?? i.doc_type, "رقم الفاتورة": i.invoice_no,
          "التاريخ": i.date, "الطرف": i.party_name, "طريقة السداد": i.payment_method,
          "الإجمالي": i.total_amount, "الربح": i.profit, "المسدد": i.paid_cash, "الآجل": i.credit, "المستحق": i.due,
        })),
      },
      {
        name: "السندات",
        rows: fVch.map((v) => ({
          "الفرع": v.branch_name, "النوع": v.voucher_type === "expense" ? "صرف" : "قبض",
          "رقم السند": v.voucher_no, "التاريخ": v.date, "القيمة": v.amount,
          "التصنيف": v.category, "الطرف": v.party_name, "الخزينة": v.treasury_name,
        })),
      },
      { name: "الأصناف", rows: topProducts.map((p) => ({ "الكود": p.code, "الصنف": p.name, "الكمية": p.qty, "الإيراد": p.revenue, "الربح": p.profit })) },
    ]);
  };

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium border transition ${
      active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted border-border"
    }`;

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/20 to-sky-500/10 border border-indigo-500/20">
            <History className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">الأرشيف والتحليل المالي التاريخي</h1>
            <p className="text-xs text-muted-foreground">بيانات السنوات السابقة (2022 - 2025) — أرشيف للقراءة والتحليل فقط، معزول عن حسابات 2026.</p>
          </div>
        </div>

        {/* شريط الفلاتر */}
        <div className="sticky top-0 z-20 rounded-2xl border bg-card/80 backdrop-blur-md p-3 shadow-sm space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">الفرع:</span>
            <button className={chip(branch === "all")} onClick={() => setBranch("all")}>جميع الفروع</button>
            {HISTORICAL_BRANCHES.map((b) => (
              <button key={b} className={chip(branch === b)} onClick={() => setBranch(b)}>{b}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">السنة:</span>
            <button className={chip(year === "all")} onClick={() => setYear("all")}>كل السنوات</button>
            {(years.length ? years : [2022, 2023, 2024, 2025]).map((y) => (
              <button key={y} className={chip(year === String(y))} onClick={() => setYear(String(y))}>{y}</button>
            ))}
            <div className="w-px h-5 bg-border mx-1" />
            <Select value={pay} onValueChange={setPay}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل طرق الدفع</SelectItem>
                <SelectItem value="cash">نقدي</SelectItem>
                <SelectItem value="credit">آجل</SelectItem>
                <SelectItem value="bank">بنك ومحافظ إلكترونية</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="w-4 h-4 ml-1" /> رفع بيانات
            </Button>
            <Button size="sm" variant="outline" onClick={doExport} disabled={!fInv.length && !fVch.length}>
              <Download className="w-4 h-4 ml-1" /> تصدير Excel
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> جاري تحميل الأرشيف...
          </div>
        ) : !invoices.length && !vouchers.length ? (
          <div className="rounded-2xl border border-dashed p-12 text-center space-y-3">
            <History className="w-10 h-10 mx-auto text-muted-foreground" />
            <div className="font-semibold">الأرشيف فاضي</div>
            <p className="text-sm text-muted-foreground">ارفع ملفات الإكسيل التاريخية لكل فرع عشان تشوف التحليلات.</p>
            <Button onClick={() => setUploadOpen(true)}><Upload className="w-4 h-4 ml-1" /> رفع أول ملف</Button>
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
              <KpiCard tone="emerald" icon={<TrendingUp className="w-4 h-4" />} title="صافي المبيعات"
                value={formatEGP(k.netSales)}
                sub={`${formatNumber(k.salesCount)} فاتورة`}
                badge={`مرتجع مستبعد ${formatEGP(k.sRetTotal)}`} />
              <KpiCard tone="sky" icon={<TrendingDown className="w-4 h-4" />} title="صافي المشتريات"
                value={formatEGP(k.netPurch)}
                sub={`${formatNumber(k.purchCount)} فاتورة`}
                badge={`مرتجع شراء ${formatEGP(k.pRetTotal)}`} />
              <KpiCard tone="indigo" icon={<Coins className="w-4 h-4" />} title="مجمل الربح الحقيقي"
                value={formatEGP(k.gross)}
                badge={`هامش ${k.margin.toFixed(1)}%`} />
              <KpiCard tone="rose" icon={<Wallet className="w-4 h-4" />} title="المصروفات التشغيلية"
                value={formatEGP(k.opex)}
                sub={`متوسط شهري ${formatEGP(k.opexAvg)}`} />
              <KpiCard
                tone={k.noi >= 0 ? "emerald" : "rose"}
                icon={k.noi >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                title={k.noi >= 0 ? "صافي ربح نشاط" : "صافي خسارة نشاط"}
                value={formatEGP(Math.abs(k.noi))}
                sub="مجمل الربح الحقيقي − المصروفات التشغيلية"
                badge={k.noi >= 0 ? "ربح" : "خسارة"} />
            </div>

            {/* charts */}
            <div className="rounded-2xl border bg-card p-4">
              <div className="text-sm font-semibold mb-3">منحنى الأداء المالي</div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend}>
                    <defs>
                      {[["s", "#10b981"], ["p", "#0ea5e9"], ["g", "#6366f1"], ["e", "#f43f5e"]].map(([id, c]) => (
                        <linearGradient key={id} id={`hg-${id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={c} stopOpacity={0.5} />
                          <stop offset="95%" stopColor={c} stopOpacity={0.02} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => formatNumber(v)} />
                    <Tooltip formatter={(v: any, n: any) => [formatEGP(Number(v)), n]} />
                    <Legend />
                    <Area type="monotone" dataKey="مبيعات" stroke="#10b981" fill="url(#hg-s)" strokeWidth={2} />
                    <Area type="monotone" dataKey="مشتريات" stroke="#0ea5e9" fill="url(#hg-p)" strokeWidth={2} />
                    <Area type="monotone" dataKey="أرباح" stroke="#6366f1" fill="url(#hg-g)" strokeWidth={2} />
                    <Area type="monotone" dataKey="مصروفات" stroke="#f43f5e" fill="url(#hg-e)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border bg-card p-4">
                <div className="text-sm font-semibold mb-3">مساهمة الفروع</div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={branchPerf}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => formatNumber(v)} />
                      <Tooltip formatter={(v: any, n: any) => [formatEGP(Number(v)), n]} />
                      <Legend />
                      <Bar dataKey="مبيعات" fill="#10b981" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="أرباح" fill="#6366f1" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border bg-card p-4">
                <div className="text-sm font-semibold mb-3">خريطة المصروفات</div>
                <div className="h-64">
                  {expenseCats.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={expenseCats} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                          {expenseCats.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: any, n: any) => [formatEGP(Number(v)), n]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full grid place-items-center text-sm text-muted-foreground">لا توجد مصروفات مسجلة</div>
                  )}
                </div>
              </div>
            </div>

            {/* Drill-down tabs */}
            <Tabs defaultValue="suppliers" className="rounded-2xl border bg-card p-4">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="suppliers">كبار الموردين</TabsTrigger>
                <TabsTrigger value="customers">كبار العملاء</TabsTrigger>
                <TabsTrigger value="products">الأصناف الذهبية</TabsTrigger>
                <TabsTrigger value="docs">مستعرض المستندات</TabsTrigger>
              </TabsList>

              <TabsContent value="suppliers" className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>{["المورد", "إجمالي المشتريات", "المرتجعات", "الصافي", "المسدد", "المديونية المتبقية", "المساهمة"].map((h) => <th key={h} className="px-2 py-2 text-right">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {topSuppliers.map((r) => (
                      <tr key={r.name} className="border-t">
                        <td className="px-2 py-1.5 font-medium">{r.name}</td>
                        <td className="px-2 py-1.5">{formatEGP(r.purchases)}</td>
                        <td className="px-2 py-1.5 text-rose-600 dark:text-rose-400">{formatEGP(r.returns)}</td>
                        <td className="px-2 py-1.5 font-semibold">{formatEGP(r.net)}</td>
                        <td className="px-2 py-1.5 text-emerald-600 dark:text-emerald-400">{formatEGP(r.paid)}</td>
                        <td className="px-2 py-1.5 text-amber-600 dark:text-amber-400">{formatEGP(r.due)}</td>
                        <td className="px-2 py-1.5">{r.share.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TabsContent>

              <TabsContent value="customers" className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>{["العميل", "إجمالي المسحوبات", "المسدد", "الآجل المتبقي"].map((h) => <th key={h} className="px-2 py-2 text-right">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {topCustomers.map((r) => (
                      <tr key={r.name} className="border-t">
                        <td className="px-2 py-1.5 font-medium">{r.name}</td>
                        <td className="px-2 py-1.5">{formatEGP(r.total)}</td>
                        <td className="px-2 py-1.5 text-emerald-600 dark:text-emerald-400">{formatEGP(r.paid)}</td>
                        <td className="px-2 py-1.5 text-amber-600 dark:text-amber-400">{formatEGP(r.due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TabsContent>

              <TabsContent value="products" className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>{["كود الصنف", "اسم الصنف", "الكمية المباعة", "إجمالي الإيراد", "مجمل الربح"].map((h) => <th key={h} className="px-2 py-2 text-right">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {topProducts.map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1.5">{r.code}</td>
                        <td className="px-2 py-1.5 font-medium">{r.name}</td>
                        <td className="px-2 py-1.5">{formatNumber(r.qty)}</td>
                        <td className="px-2 py-1.5">{formatEGP(r.revenue)}</td>
                        <td className="px-2 py-1.5 text-emerald-600 dark:text-emerald-400">{formatEGP(r.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TabsContent>

              <TabsContent value="docs" className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>{["", "التاريخ", "النوع", "رقم", "الفرع", "الطرف", "السداد", "الإجمالي", "الربح", "الآجل"].map((h, i) => <th key={i} className="px-2 py-2 text-right">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => {
                      const its = itemsByInvoice.get(d.id) ?? [];
                      const open = expanded === d.id;
                      return (
                        <Fragment key={d.id}>
                          <tr className="border-t hover:bg-muted/40 cursor-pointer"
                            onClick={() => setExpanded(open ? null : d.id)}>
                            <td className="px-2 py-1.5">
                              {its.length > 0 && (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />)}
                            </td>
                            <td className="px-2 py-1.5">{d.date}</td>
                            <td className="px-2 py-1.5">
                              <Badge variant="secondary" className="text-[10px]">{DOC_LABEL[d.doc_type] ?? d.doc_type}</Badge>
                            </td>
                            <td className="px-2 py-1.5">{d.invoice_no}</td>
                            <td className="px-2 py-1.5">{d.branch_name}</td>
                            <td className="px-2 py-1.5">{d.party_name ?? "—"}</td>
                            <td className="px-2 py-1.5">{d.payment_method ?? "—"}</td>
                            <td className="px-2 py-1.5 font-semibold">{formatEGP(d.total_amount)}</td>
                            <td className="px-2 py-1.5 text-emerald-600 dark:text-emerald-400">{formatEGP(d.profit)}</td>
                            <td className="px-2 py-1.5 text-amber-600 dark:text-amber-400">{formatEGP(d.due)}</td>
                          </tr>
                          {open && its.length > 0 && (
                            <tr className="bg-muted/30">
                              <td colSpan={10} className="px-4 py-2">
                                <table className="w-full text-[11px]">
                                  <thead>
                                    <tr className="text-muted-foreground">
                                      {["الكود", "الصنف", "الكمية", "السعر", "الربح", "الإجمالي"].map((h) => <th key={h} className="px-2 py-1 text-right">{h}</th>)}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {its.map((it) => (
                                      <tr key={it.id} className="border-t border-border/50">
                                        <td className="px-2 py-1">{it.item_code ?? "—"}</td>
                                        <td className="px-2 py-1">{it.item_name}</td>
                                        <td className="px-2 py-1">{formatNumber(it.qty)}</td>
                                        <td className="px-2 py-1">{formatEGP(it.price)}</td>
                                        <td className="px-2 py-1">{formatEGP(it.profit)}</td>
                                        <td className="px-2 py-1">{formatEGP(it.total)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {docs.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">لا توجد مستندات مطابقة للفلاتر</div>}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <HistoricalUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onDone={load} />
    </AdminLayout>
  );
}
