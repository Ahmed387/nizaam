import { Fragment, useEffect, useMemo, useState } from "react";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { Loader2, RefreshCw, AlarmClock, TrendingDown, Layers, ChevronDown, HandCoins } from "lucide-react";
import { toast } from "sonner";
import { shiftPaymentBreakdown, ShiftPaymentLine, overrideShiftOpening, fetchShiftHandovers, recordMidShiftHandover, ShiftHandover } from "@/lib/shifts";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FinancialAmount } from "@/components/FinancialAmount";

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

export default function ShiftsHistory({ embedded = false }: { embedded?: boolean } = {}) {
  const { branches } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [branchId, setBranchId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [breakdowns, setBreakdowns] = useState<Record<string, ShiftPaymentLine[]>>({});
  const [handovers, setHandovers] = useState<Record<string, ShiftHandover[]>>({});
  const [hoShift, setHoShift] = useState<Row | null>(null);
  const [hoAmount, setHoAmount] = useState<number>(0);
  const [hoNotes, setHoNotes] = useState("");
  const [hoBusy, setHoBusy] = useState(false);

  const loadHandovers = async (id: string) => {
    try {
      const list = await fetchShiftHandovers(id);
      setHandovers((p) => ({ ...p, [id]: list }));
    } catch { /* ignore */ }
  };

  const submitHandover = async () => {
    if (!hoShift) return;
    setHoBusy(true);
    try {
      await recordMidShiftHandover(hoShift.id, Number(hoAmount) || 0, hoNotes || undefined);
      toast.success("تم تسجيل تسليم العهدة — الوردية مستمرة وتم إبلاغ الأونر");
      await loadHandovers(hoShift.id);
      setHoShift(null); setHoAmount(0); setHoNotes("");
    } catch (e: any) {
      toast.error(e.message ?? "تعذر تسجيل التسليم");
    } finally {
      setHoBusy(false);
    }
  };

  const toggleRow = async (id: string) => {
    if (expanded === id) return setExpanded(null);
    setExpanded(id);
    if (!handovers[id]) loadHandovers(id);
    if (!breakdowns[id]) {
      try {
        const lines = await shiftPaymentBreakdown(id);
        setBreakdowns((p) => ({ ...p, [id]: lines }));
      } catch (e: any) {
        toast.error(e.message ?? "تعذر تحميل تفاصيل الوردية");
      }
    }
  };




  const [pending, setPending] = useState<any[]>([]);
  const [approving, setApproving] = useState<string | null>(null);

  const loadPending = async () => {
    const { data } = await supabase
      .from("cashier_shifts")
      .select("id,branch_id,cashier_id,opened_at,opening_cash,reported_opening_cash,expected_opening_cash,opening_status")
      .neq("opening_status", "accepted")
      .eq("status", "open")
      .order("opened_at", { ascending: false });
    setPending((data ?? []) as any[]);
  };

  const approve = async (id: string) => {
    setApproving(id);
    try {
      await overrideShiftOpening(id, "اعتماد إداري من سجل الورديات");
      toast.success("تم اعتماد العهدة — الكاشير يقدر يبيع دلوقتي");
      await Promise.all([loadPending(), load()]);
    } catch (e: any) {
      toast.error(e.message ?? "تعذر الاعتماد");
    } finally {
      setApproving(null);
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
  useEffect(() => { loadPending(); }, []);

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
    <ConditionalLayout embedded={embedded} variant="admin" title="سجل الورديات" subtitle="كل الورديات والعجز/الزيادة لكل كاشير">

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5" /> إجمالي العجز/الزيادة</div>
          <FinancialAmount value={stats.totalVar} size="md" className={`mt-1 justify-start font-extrabold ${stats.totalVar < 0 ? "text-destructive" : "text-success"}`} />
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

      {pending.length > 0 && (
        <Card className="p-4 mb-4 border-destructive/40 bg-destructive/5">
          <div className="font-bold text-sm text-destructive mb-2">ورديات مرفوضة العهدة — محتاجة اعتماد</div>
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 bg-background">
                <div className="text-sm">
                  <span className="font-semibold">{branches.find((b) => b.id === p.branch_id)?.name ?? "فرع"}</span>
                  <span className="text-muted-foreground"> — متوقع {formatEGP(p.expected_opening_cash ?? 0)} / معدود {formatEGP(p.reported_opening_cash ?? p.opening_cash)}</span>
                  <span className="text-muted-foreground"> — {formatDateTime(p.opened_at)}</span>
                </div>
                <Button size="sm" className="h-8" disabled={approving === p.id} onClick={() => approve(p.id)}>
                  {approving === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "اعتماد وتشغيل الفرع"}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

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
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => toggleRow(r.id)}>
                          <ChevronDown className={`w-4 h-4 transition-transform ${expanded === r.id ? "rotate-180" : ""}`} />
                          وسائل الدفع
                        </Button>
                        {r.status === "open" && (
                          <Button variant="ghost" size="sm" onClick={() => { setHoShift(r); setHoAmount(0); setHoNotes(""); }}>
                            <HandCoins className="w-4 h-4 me-1" />
                            تسليم عهدة طارئ
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="bg-muted/30 border-t border-border">
                      <td colSpan={12} className="p-3 space-y-3">
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
                        {(handovers[r.id]?.length ?? 0) > 0 && (
                          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                            <div className="font-bold text-xs mb-1.5">تسليم عهدة طارئ أثناء الوردية</div>
                            <div className="space-y-1">
                              {handovers[r.id].map((h) => (
                                <div key={h.id} className="text-xs flex flex-wrap items-center justify-between gap-2">
                                  <span>
                                    {h.cashier_name ?? "—"} ← {h.manager_name ?? "—"} — {formatDateTime(h.occurred_at)}
                                    {h.notes ? ` — ${h.notes}` : ""}
                                  </span>
                                  <span className="font-bold">{formatEGP(h.amount)}</span>
                                </div>
                              ))}
                            </div>
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

      <Dialog open={!!hoShift} onOpenChange={(o) => !hoBusy && !o && setHoShift(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تسليم عهدة طارئ أثناء الوردية</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-3 text-sm space-y-1 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">الكاشير</span>
                <span className="font-semibold">{hoShift?.cashier_name ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">الفرع</span>
                <span className="font-semibold">{hoShift?.branch_name ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">فُتحت في</span>
                <span className="font-semibold">{hoShift ? formatDateTime(hoShift.opened_at) : "—"}</span>
              </div>
            </div>
            <div>
              <Label>المبلغ المستلم من الكاشير (جنيه)</Label>
              <Input type="number" min={0} step="0.01" className="mt-1.5 text-lg"
                value={hoAmount} onChange={(e) => setHoAmount(Number(e.target.value))} autoFocus />
            </div>
            <div>
              <Label>سبب المغادرة / ملاحظات</Label>
              <Textarea rows={2} className="mt-1.5" value={hoNotes} onChange={(e) => setHoNotes(e.target.value)} />
            </div>
            <div className="text-xs text-muted-foreground">
              الوردية هتفضل مفتوحة وحساباتها زي ما هي — ده إقرار استلام عهدة داخلي مش مبيعات ولا مصروف، وهيتبعت إشعار فوري للأونر.
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setHoShift(null)} disabled={hoBusy}>إلغاء</Button>
            <Button onClick={submitHandover} disabled={hoBusy} className="min-w-[150px]">
              {hoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><HandCoins className="w-4 h-4 me-2" />تسجيل الاستلام</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConditionalLayout>

  );
}
