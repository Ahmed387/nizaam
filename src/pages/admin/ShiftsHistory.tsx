import { Fragment, useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { Loader2, RefreshCw, AlarmClock, TrendingDown, Layers, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { shiftPaymentBreakdown, ShiftPaymentLine } from "@/lib/shifts";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";

interface Row {
  id: string;
  branch_id: string;
  branch_name: string | null;
  cashier_id: string;
  cashier_name: string | null;
  closed_by_name: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  cash_sales: number | null;
  expected_cash: number | null;
  closing_cash: number | null;
  variance: number | null;
  status: string;
}

export default function ShiftsHistory() {
  const { branches } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [branchId, setBranchId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [breakdowns, setBreakdowns] = useState<Record<string, ShiftPaymentLine[]>>({});

  const toggleRow = async (id: string) => {
    if (expanded === id) return setExpanded(null);
    setExpanded(id);
    if (!breakdowns[id]) {
      try {
        const lines = await shiftPaymentBreakdown(id);
        setBreakdowns((p) => ({ ...p, [id]: lines }));
      } catch (e: any) {
        toast.error(e.message ?? "تعذر تحميل تفاصيل الوردية");
      }
    }
  };


  const load = async () => {
    setLoading(true);
    let q = supabase.from("v_shifts_history" as any).select("*").order("opened_at", { ascending: false }).limit(500);
    if (branchId) q = q.eq("branch_id", branchId);
    if (from) q = q.gte("opened_at", `${from}T00:00:00`);
    if (to) q = q.lte("opened_at", `${to}T23:59:59`);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, [branchId, from, to]);

  useEffect(() => {
    const ch = supabase
      .channel("shifts-history")
      .on("postgres_changes", { event: "*", schema: "public", table: "cashier_shifts" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [branchId, from, to]);

  const stats = useMemo(() => {
    const closed = rows.filter((r) => r.status !== "open");
    const totalVar = closed.reduce((s, r) => s + Number(r.variance ?? 0), 0);
    const auto = rows.filter((r) => r.status === "auto_closed").length;
    const open = rows.filter((r) => r.status === "open").length;
    const byCashier = new Map<string, { name: string; variance: number; count: number; auto: number; shortages: number; months: Set<string> }>();
    for (const r of closed) {
      const k = r.cashier_id;
      const cur = byCashier.get(k) ?? { name: r.cashier_name ?? "—", variance: 0, count: 0, auto: 0, shortages: 0, months: new Set<string>() };
      const v = Number(r.variance ?? 0);
      cur.variance += v;
      cur.count += 1;
      if (r.status === "auto_closed") cur.auto += 1;
      if (v < -0.01) cur.shortages += 1;
      cur.months.add(r.opened_at.slice(0, 7));
      byCashier.set(k, cur);
    }
    return {
      totalVar, auto, open,
      ranking: Array.from(byCashier.values())
        .map((c) => ({ ...c, avg: c.count ? c.variance / c.count : 0, monthsCount: c.months.size }))
        .sort((a, b) => a.variance - b.variance),
    };
  }, [rows]);

  const statusBadge = (s: string) =>
    s === "open" ? <Badge className="bg-warning text-warning-foreground">مفتوحة</Badge>
    : s === "auto_closed" ? <Badge variant="destructive">قفل تلقائي</Badge>
    : <Badge className="bg-success text-success-foreground">مقفولة</Badge>;

  return (
    <AdminLayout>
      <PageHeader title="سجل الورديات" subtitle="كل الورديات والعجز/الزيادة لكل كاشير" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5" /> إجمالي العجز/الزيادة</div>
          <div className={`text-2xl font-extrabold mt-1 ${stats.totalVar < 0 ? "text-destructive" : "text-success"}`}>{formatEGP(stats.totalVar)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><AlarmClock className="w-3.5 h-3.5" /> ورديات قُفلت تلقائيًا</div>
          <div className="text-2xl font-extrabold mt-1 text-destructive">{stats.auto}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> ورديات مفتوحة الآن</div>
          <div className="text-2xl font-extrabold mt-1 text-warning">{stats.open}</div>
        </Card>
      </div>

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <Label className="text-xs">الفرع</Label>
            <select className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">كل الفروع</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div><Label className="text-xs">من</Label><Input type="date" className="mt-1.5" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">إلى</Label><Input type="date" className="mt-1.5" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 me-1" />تحديث</Button>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        {loading ? (
          <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-3">الكاشير</th>
                <th className="p-3">الفرع</th>
                <th className="p-3">الفتح</th>
                <th className="p-3">القفل</th>
                <th className="p-3">قفلها</th>
                <th className="p-3">افتتاحي</th>
                <th className="p-3">مبيعات نقدية</th>
                <th className="p-3">متوقع</th>
                <th className="p-3">فعلي</th>
                <th className="p-3">الفرق</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">تفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">لا توجد ورديات</td></tr>}
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="border-t border-border">
                    <td className="p-3 font-semibold">{r.cashier_name ?? "—"}</td>
                    <td className="p-3">{r.branch_name ?? "—"}</td>
                    <td className="p-3 text-xs">{formatDateTime(r.opened_at)}</td>
                    <td className="p-3 text-xs">{r.closed_at ? formatDateTime(r.closed_at) : "—"}</td>
                    <td className="p-3 text-xs">{r.closed_by_name ?? (r.status === "auto_closed" ? "النظام (تلقائي)" : "—")}</td>
                    <td className="p-3">{formatEGP(r.opening_cash)}</td>
                    <td className="p-3">{r.cash_sales != null ? formatEGP(r.cash_sales) : "—"}</td>
                    <td className="p-3">{r.expected_cash != null ? formatEGP(r.expected_cash) : "—"}</td>
                    <td className="p-3">{r.closing_cash != null ? formatEGP(r.closing_cash) : "—"}</td>
                    <td className={`p-3 font-bold ${Number(r.variance ?? 0) < 0 ? "text-destructive" : Number(r.variance ?? 0) > 0 ? "text-success" : ""}`}>
                      {r.variance != null ? formatEGP(r.variance) : "—"}
                    </td>
                    <td className="p-3">{statusBadge(r.status)}</td>
                    <td className="p-3">
                      <Button variant="ghost" size="sm" onClick={() => toggleRow(r.id)}>
                        <ChevronDown className={`w-4 h-4 transition-transform ${expanded === r.id ? "rotate-180" : ""}`} />
                        وسائل الدفع
                      </Button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="bg-muted/30 border-t border-border">
                      <td colSpan={12} className="p-3">
                        {!breakdowns[r.id] ? (
                          <div className="text-xs text-muted-foreground">جاري التحميل…</div>
                        ) : breakdowns[r.id].length === 0 ? (
                          <div className="text-xs text-muted-foreground">مفيش تحصيلات في الوردية دي</div>
                        ) : (
                          <div className="flex flex-wrap gap-3">
                            {breakdowns[r.id].map((b) => (
                              <div key={b.payment_method} className="rounded-lg border border-border bg-background px-3 py-2 text-xs">
                                <div className="text-muted-foreground">
                                  {(PAYMENT_METHOD_LABELS as Record<string, string>)[b.payment_method] ?? b.payment_method}
                                  {" "}({b.payments_count})
                                </div>
                                <div className="font-bold text-sm">{formatEGP(b.total)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>

          </table>
        )}
      </Card>

      {stats.ranking.length > 0 && (
        <Card className="p-4 mt-4 overflow-x-auto">
          <div className="font-bold mb-3">مقارنة أداء الكاشيرية</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-2">الكاشير</th>
                <th className="p-2">ورديات</th>
                <th className="p-2">شهور</th>
                <th className="p-2">إجمالي الفرق</th>
                <th className="p-2">متوسط الفرق / وردية</th>
                <th className="p-2">مرات عجز</th>
                <th className="p-2">قفل تلقائي</th>
              </tr>
            </thead>
            <tbody>
              {stats.ranking.map((c) => (
                <tr key={c.name} className="border-t border-border">
                  <td className="p-2 font-semibold">{c.name}</td>
                  <td className="p-2">{c.count}</td>
                  <td className="p-2">{c.monthsCount}</td>
                  <td className={`p-2 font-bold ${c.variance < 0 ? "text-destructive" : c.variance > 0 ? "text-success" : ""}`}>{formatEGP(c.variance)}</td>
                  <td className={`p-2 font-bold ${c.avg < 0 ? "text-destructive" : c.avg > 0 ? "text-success" : ""}`}>{formatEGP(c.avg)}</td>
                  <td className="p-2">{c.shortages > 0 ? <Badge variant="destructive">{c.shortages}</Badge> : "—"}</td>
                  <td className="p-2">{c.auto > 0 ? <Badge className="bg-warning text-warning-foreground">{c.auto}</Badge> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </AdminLayout>
  );
}
