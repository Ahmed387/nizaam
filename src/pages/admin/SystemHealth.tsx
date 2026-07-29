import { useEffect, useRef, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, RefreshCcw, AlertTriangle, TrendingUp, Wallet, Radio, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { fetchProfitWindow } from "@/lib/profitEngine";

type Health = any;
type PartnerNet = { id: string; name: string; tenant_id: string; capital_pct: number; operating_pct: number; net_share: number };

const fmt = (n: any) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

const POLL_MS = 30_000;

function StatusPill({ ok, label }: { ok: boolean; label?: string }) {
  return ok ? (
    <Badge className="bg-success/15 text-success border-success/30 gap-1"><CheckCircle2 className="w-3 h-3" />{label ?? "تمام"}</Badge>
  ) : (
    <Badge className="bg-destructive/15 text-destructive border-destructive/30 gap-1"><XCircle className="w-3 h-3" />{label ?? "فيه مشكلة"}</Badge>
  );
}

// Friendly "how to fix" text per issue key
type IssueItem = { title: string; how: string };

export default function SystemHealth() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [netByTenant, setNetByTenant] = useState<Record<string, number>>({});
  const [partnerNets, setPartnerNets] = useState<PartnerNet[]>([]);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const runningRef = useRef(false);

  const loadPartnerNet = async () => {
    const from = new Date("2020-01-01");
    const to = new Date();
    const prevFrom = new Date("2019-01-01");
    const prevTo = new Date("2019-12-31");
    const { data: partners } = await supabase
      .from("equity_partners")
      .select("id, name, tenant_id, capital_share, operating_share, is_active")
      .eq("is_active", true);
    const tenantIds = Array.from(new Set((partners ?? []).map((p: any) => p.tenant_id)));
    const nets: Record<string, number> = {};
    await Promise.all(
      tenantIds.map(async (tid) => {
        try {
          const w = await fetchProfitWindow({ tenantId: tid, range: { from, to, prevFrom, prevTo } as any });
          nets[tid] = w.totals.net;
        } catch { nets[tid] = 0; }
      })
    );
    setNetByTenant(nets);
    setPartnerNets(
      (partners ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        tenant_id: p.tenant_id,
        capital_pct: Number(p.capital_share) * 100,
        operating_pct: Number(p.operating_share) * 100,
        net_share: (nets[p.tenant_id] ?? 0) * Number(p.operating_share),
      }))
    );
  };

  const load = async (silent = false) => {
    if (runningRef.current) return;
    runningRef.current = true;
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const [{ data, error }] = await Promise.all([
        supabase.rpc("system_health_check" as any),
        loadPartnerNet(),
      ]);
      if (error) {
        setErr(error.message);
        if (!silent) toast({ title: "الفحص وقع", description: error.message, variant: "destructive" });
      } else {
        setData(data);
        setLastRun(new Date());
      }
    } finally {
      runningRef.current = false;
      setLoading(false);
    }
  };

  // Initial + realtime
  useEffect(() => {
    load();

    // Realtime: refetch when any accounting-affecting table changes
    const channel = supabase
      .channel("system-health-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_entries" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_entry_lines" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "treasury" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_transactions" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "equity_partners" }, () => load(true))
      .subscribe();

    return () => {
      clearInterval(t);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shares = (data?.partner_shares ?? []) as any[];
  const tb = (data?.trial_balance ?? []) as any[];
  const pb = (data?.partner_balance_match ?? []) as any[];
  const inv = data?.invoices ?? {};
  const orphans = data?.orphans ?? {};
  const tenants = (data?.tenants ?? []) as any[];
  const profits = (data?.partner_profit_snapshot ?? []) as any[];
  const cashRec = (data?.cash_reconciliation ?? []) as any[];

  // Issues in colloquial Arabic + explicit "اعمل إيه"
  const issues: IssueItem[] = [
    ...shares.filter(s => !s.ok).map(s => ({
      title: `نسب الشركاء في الشركة ${s.tenant_id?.slice(0,8)} مش بتساوي 100% (رأس المال: ${s.capital_pct}%، التشغيل: ${s.operating_pct}%)`,
      how: "اعمل إيه؟ ادخل على «إدارة الشركاء» وعدّل النسب لحد ما مجموع رأس المال = 100% ومجموع التشغيل = 100%.",
    })),
    ...tb.filter(t => !t.ok).map(t => ({
      title: `ميزان المراجعة مش متوازن — فيه فرق ${fmt(t.diff)} جنيه بين المدين والدائن`,
      how: "اعمل إيه؟ روح على «القيود اليومية» ودوّر على آخر قيد اتسجل، غالباً فيه قيد ناقص طرف. لو مش عارف السبب، كلّم الدعم الفني.",
    })),
    ...pb.filter(p => !p.ok).map(p => ({
      title: `رصيد الشريك ${p.name} في الجدول (${fmt(p.stored_balance)}) مش بيساوي مجموع حركاته (${fmt(p.computed_from_tx)})`,
      how: "اعمل إيه؟ ادخل صفحة الشريك واعمل «إعادة حساب الرصيد» — لو المشكلة فضلت، معناها فيه حركة ناقصة أو مكررة، افتح كشف حساب الشريك وراجع الحركات.",
    })),
    ...cashRec.filter(c => !c.ok).map(c => ({
      title: `🚨 فرق في الكاش! الخزنة الفعلية معاها (${fmt(c.physical_cash)}) والدفاتر بتقول (${fmt(c.gl_cash)}) — الفرق ${fmt(c.diff)} جنيه`,
      how: "اعمل إيه؟ ده أخطر تنبيه. افتح «الخزنة الرئيسية» وراجع آخر الحركات، وقارنها بالقيود في الأستاذ العام حساب 1100. غالباً فيه حركة نقدية اتسجلت في مكان من غير التاني.",
    })),
    ...(Number(orphans.orphan_invoice_items||0) > 0 ? [{
      title: `فيه ${orphans.orphan_invoice_items} عناصر فواتير مالهاش فاتورة أصلية (يتيمة)`,
      how: "اعمل إيه؟ دي بيانات قديمة اتسابت بالغلط، كلّم الدعم الفني علشان يعمل تنظيف.",
    }] : []),
    ...(Number(orphans.orphan_journal_lines||0) > 0 ? [{
      title: `فيه ${orphans.orphan_journal_lines} سطور قيود يومية مالهاش قيد أصلي`,
      how: "اعمل إيه؟ نفس اللي فوق، دي بيانات محتاجة تنظيف من الدعم.",
    }] : []),
    ...(Number(orphans.orphan_payments||0) > 0 ? [{
      title: `فيه ${orphans.orphan_payments} دفعات مالهاش فاتورة`,
      how: "اعمل إيه؟ راجع صفحة الدفعات ودور على الدفعات اللي مش مربوطة بفاتورة، وإما تربطها أو تحذفها.",
    }] : []),
    ...(Number(orphans.orphan_partner_tx||0) > 0 ? [{
      title: `فيه ${orphans.orphan_partner_tx} حركات شركاء مالهاش شريك`,
      how: "اعمل إيه؟ كلّم الدعم علشان بيانات قديمة محتاجة تنظيف.",
    }] : []),
    ...(Number(orphans.products_without_tenant||0) > 0 ? [{
      title: `فيه ${orphans.products_without_tenant} منتجات مش مربوطة بشركة`,
      how: "اعمل إيه؟ ادخل على المخزون وراجع المنتجات دي، وإما تعدّلها أو تحذفها.",
    }] : []),
    ...(Number(inv.overpaid_invoices||0) > 0 ? [{
      title: `فيه ${inv.overpaid_invoices} فواتير مدفوعة أكتر من قيمتها`,
      how: "اعمل إيه؟ افتح «الفواتير» وفلتر على المدفوعة زيادة، وارجع للعميل الفلوس الزيادة أو صحح المبلغ المسجّل.",
    }] : []),
    ...(Number(inv.negative_total||0) > 0 ? [{
      title: `فيه ${inv.negative_total} فواتير إجماليها بالسالب`,
      how: "اعمل إيه؟ ده غلط منطقي، افتح الفواتير دي وصحح الكميات والأسعار.",
    }] : []),
  ];

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-4">
        <PageHeader
          title="فحص السيستم"
          subtitle="بيراجعلك كل حاجة تلقائي: الحسابات، الخزنة، الشركاء، الفواتير — لحظة بلحظة"
          actions={
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1.5 border-success/40 bg-success/5 text-success">
                <Radio className="w-3 h-3 animate-pulse" />
                تحديث تلقائي
              </Badge>
              <Button size="sm" variant="outline" onClick={() => load(false)} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <RefreshCcw className="w-4 h-4 ml-2" />}
                فحص دلوقتي
              </Button>
            </div>
          }
        />

        {/* Intro */}
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex items-start gap-3">
          <Lightbulb className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm leading-relaxed">
            <div className="font-bold text-primary mb-1">الصفحة دي بتعمل إيه؟</div>
            <p className="text-muted-foreground">
              بتفحص السيستم كل شوية لوحدها وبتقولك لو فيه أي حاجة غلط في الحسابات أو الخزنة أو أرصدة الشركاء.
              لو لقيت أي مشكلة، هتكتبهالك بالتفصيل و<span className="font-semibold text-foreground">هتقولك تعمل إيه علشان تحلها</span>.
              التحديث بيحصل تلقائي كل نص دقيقة، وكمان أول ما تحصل أي حركة في الفواتير أو القيود أو الخزنة.
            </p>
          </div>
        </div>

        {err && <Card><CardContent className="p-4 text-destructive">فيه مشكلة في الفحص: {err}</CardContent></Card>}

        {/* Summary */}
        <Card className={issues.length === 0 ? "border-success/40" : "border-warning/50"}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>الملخص العام</CardTitle>
            {loading && !data ? <Loader2 className="w-4 h-4 animate-spin" /> :
              <StatusPill ok={issues.length === 0} label={issues.length === 0 ? "كله تمام 👌" : `${issues.length} مشكلة محتاجة انتباه`} />}
          </CardHeader>
          <CardContent>
            {issues.length === 0 ? (
              <div className="text-success text-sm flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-semibold">مبروك — السيستم شغال زي الفل ومفيش أي مشاكل.</span>
              </div>
            ) : (
              <ul className="space-y-3">
                {issues.map((it, i) => (
                  <li key={i} className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                      <div className="space-y-1.5 flex-1">
                        <div className="font-semibold text-sm">{it.title}</div>
                        <div className="text-xs text-muted-foreground leading-relaxed">{it.how}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Partner shares */}
        <Card>
          <CardHeader>
            <CardTitle>1. نسب الشركاء</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">لازم مجموع نسب كل شركة = 100% (رأس مال + تشغيل).</p>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">الشركة</th><th className="p-2">رأس المال</th><th className="p-2">التشغيل</th><th className="p-2">عدد الشركاء</th><th className="p-2">الحالة</th></tr></thead>
              <tbody>
                {shares.map((s, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 font-mono text-xs">{s.tenant_id?.slice(0,8)}…</td>
                    <td className="p-2 font-mono">{s.capital_pct}%</td>
                    <td className="p-2 font-mono">{s.operating_pct}%</td>
                    <td className="p-2">{s.partners_count}</td>
                    <td className="p-2"><StatusPill ok={s.ok} /></td>
                  </tr>
                ))}
                {shares.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">مفيش شركاء لسه</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Trial balance */}
        <Card>
          <CardHeader>
            <CardTitle>2. ميزان المراجعة</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">في المحاسبة الصح: المدين لازم يساوي الدائن. لو فيه فرق يبقى فيه قيد غلط.</p>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">الشركة</th><th className="p-2">مدين</th><th className="p-2">دائن</th><th className="p-2">الفرق</th><th className="p-2">القيود</th><th className="p-2">الحالة</th></tr></thead>
              <tbody>
                {tb.map((t, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 font-mono text-xs">{t.tenant_id?.slice(0,8)}…</td>
                    <td className="p-2 font-mono">{fmt(t.debits)}</td>
                    <td className="p-2 font-mono">{fmt(t.credits)}</td>
                    <td className={`p-2 font-mono ${Number(t.diff)!==0 ? "text-destructive" : ""}`}>{fmt(t.diff)}</td>
                    <td className="p-2">{t.entries}</td>
                    <td className="p-2"><StatusPill ok={t.ok} /></td>
                  </tr>
                ))}
                {tb.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">مفيش قيود مرحّلة لسه</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Cash Reconciliation — CRITICAL */}
        <Card className={cashRec.some(c => !c.ok) ? "border-destructive border-2 shadow-lg shadow-destructive/20" : "border-success/40"}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Wallet className={`w-5 h-5 ${cashRec.some(c => !c.ok) ? "text-destructive animate-pulse" : "text-success"}`} />
              3. مطابقة الكاش (الخزنة الفعلية مع الدفاتر)
            </CardTitle>
            {cashRec.length > 0 && (
              <StatusPill ok={cashRec.every(c => c.ok)} label={cashRec.every(c => c.ok) ? "متطابق ✓" : "فيه فرق!"} />
            )}
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <div className="p-3 text-xs text-muted-foreground bg-muted/20 border-b">
              الفلوس اللي في الخزنة على أرض الواقع لازم تكون هي نفسها اللي مسجلة في دفتر الأستاذ (حساب 1100). أي فرق يعني فيه حركة اتسجلت في مكان ونسينا نسجلها في التاني.
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-right">
                  <th className="p-2">الشركة</th>
                  <th className="p-2">الدفاتر (1100)</th>
                  <th className="p-2">الخزنة الفعلية</th>
                  <th className="p-2">الفرق</th>
                  <th className="p-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {cashRec.map((c, i) => (
                  <tr key={i} className={`border-t ${!c.ok ? "bg-destructive/5" : ""}`}>
                    <td className="p-2 font-mono text-xs">{c.tenant_id?.slice(0, 8)}…</td>
                    <td className="p-2 font-mono">{fmt(c.gl_cash)}</td>
                    <td className="p-2 font-mono">{fmt(c.physical_cash)}</td>
                    <td className={`p-2 font-mono font-bold ${!c.ok ? "text-destructive" : "text-success"}`}>{fmt(c.diff)}</td>
                    <td className="p-2"><StatusPill ok={c.ok} /></td>
                  </tr>
                ))}
                {cashRec.length === 0 && (
                  <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">مفيش بيانات كاش لسه</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Partner balances */}
        <Card>
          <CardHeader>
            <CardTitle>4. أرصدة الشركاء (تطابق مع الحركات)</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">الرصيد المخزّن للشريك لازم يطابق مجموع حركاته (مساهمات - مسحوبات + أرباح).</p>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">الشريك</th><th className="p-2">الرصيد المسجّل</th><th className="p-2">المحسوب من الحركات</th><th className="p-2">الفرق</th><th className="p-2">الحالة</th></tr></thead>
              <tbody>
                {pb.map((p, i) => {
                  const diff = Number(p.stored_balance) - Number(p.computed_from_tx);
                  return (
                    <tr key={i} className="border-t">
                      <td className="p-2">{p.name}</td>
                      <td className="p-2 font-mono">{fmt(p.stored_balance)}</td>
                      <td className="p-2 font-mono">{fmt(p.computed_from_tx)}</td>
                      <td className={`p-2 font-mono ${diff!==0?"text-destructive":""}`}>{fmt(diff)}</td>
                      <td className="p-2"><StatusPill ok={p.ok} /></td>
                    </tr>
                  );
                })}
                {pb.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">مفيش شركاء لسه</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Invoices + orphans */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>5. الفواتير — سليمة ولا فيها مشكلة</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">لو فيه فواتير مدفوعة زيادة أو إجمالي بالسالب، لازم تتراجع.</p>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span>عدد الفواتير النشطة</span><span className="font-mono">{inv.total_active_invoices ?? 0}</span></div>
              <div className="flex justify-between"><span>مدفوعة أكتر من قيمتها</span><span className={`font-mono ${Number(inv.overpaid_invoices||0)>0?"text-destructive":"text-success"}`}>{inv.overpaid_invoices ?? 0}</span></div>
              <div className="flex justify-between"><span>إجماليها بالسالب</span><span className={`font-mono ${Number(inv.negative_total||0)>0?"text-destructive":"text-success"}`}>{inv.negative_total ?? 0}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>6. بيانات يتيمة</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">أي رقم أكبر من صفر معناه فيه بيانات قديمة محتاجة تنظيف.</p>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.entries(orphans as any).map(([k, v]: any) => (
                <div key={k} className="flex justify-between">
                  <span className="text-xs">{k}</span>
                  <span className={`font-mono ${Number(v)>0?"text-destructive":"text-success"}`}>{v}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Tenants overview */}
        <Card>
          <CardHeader>
            <CardTitle>7. نظرة سريعة على الشركات</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">كل شركة مسجّلة في السيستم وأرقامها الأساسية.</p>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">الشركة</th><th className="p-2">الفروع</th><th className="p-2">الشركاء</th><th className="p-2">الفواتير النشطة</th><th className="p-2">القيود المرحّلة</th></tr></thead>
              <tbody>
                {tenants.map((t: any) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2">{t.name}</td>
                    <td className="p-2">{t.active_branches}</td>
                    <td className="p-2">{t.active_partners}</td>
                    <td className="p-2">{t.active_invoices}</td>
                    <td className="p-2">{t.posted_entries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Partner profit snapshot */}
        <Card>
          <CardHeader>
            <CardTitle>8. أرباح الشركاء — الأرقام تفصيلي</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">اللي كل شريك حطه، سحبه، جاله أرباح، ورصيده دلوقتي.</p>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">الشريك</th><th className="p-2">نسبة التشغيل</th><th className="p-2">مساهمات</th><th className="p-2">مسحوبات</th><th className="p-2">أرباح موزّعة</th><th className="p-2">الرصيد دلوقتي</th></tr></thead>
              <tbody>
                {profits.map((p: any) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2">{p.name}</td>
                    <td className="p-2 font-mono">{Number(p.operating_pct).toFixed(2)}%</td>
                    <td className="p-2 font-mono">{fmt(p.contributions)}</td>
                    <td className="p-2 font-mono">{fmt(p.drawings)}</td>
                    <td className="p-2 font-mono">{fmt(p.profits_distributed)}</td>
                    <td className="p-2 font-mono">{fmt(p.current_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Partner net profit share */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" />9. حصة كل شريك من صافي الربح</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">لو الشركة عملت مكسب، ده اللي كل شريك مستحقه فعلياً.</p>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-right">
                  <th className="p-2">الشريك</th>
                  <th className="p-2">الشركة</th>
                  <th className="p-2">نسبة رأس المال</th>
                  <th className="p-2">نسبة التشغيل</th>
                  <th className="p-2">صافي ربح الشركة</th>
                  <th className="p-2">حصة الشريك</th>
                </tr>
              </thead>
              <tbody>
                {partnerNets.length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">مفيش شركاء نشطين</td></tr>
                )}
                {partnerNets.map((p) => {
                  const tenantNet = netByTenant[p.tenant_id] ?? 0;
                  return (
                    <tr key={p.id} className="border-t">
                      <td className="p-2 font-medium">{p.name}</td>
                      <td className="p-2 font-mono text-xs text-muted-foreground">{p.tenant_id?.slice(0, 8)}…</td>
                      <td className="p-2 font-mono">{p.capital_pct.toFixed(2)}%</td>
                      <td className="p-2 font-mono">{p.operating_pct.toFixed(2)}%</td>
                      <td className={`p-2 font-mono ${tenantNet < 0 ? "text-destructive" : ""}`}>{fmt(tenantNet)}</td>
                      <td className={`p-2 font-mono font-bold ${p.net_share < 0 ? "text-destructive" : "text-success"}`}>
                        {fmt(p.net_share)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="p-3 text-xs text-muted-foreground border-t bg-muted/20">
              حصة الشريك = صافي ربح الشركة × نسبة التشغيل. صافي الربح = المبيعات − التكلفة − المصاريف.
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
          <span>التحديث بيحصل تلقائي كل 30 ثانية، وكمان أول ما تحصل حركة في السيستم.</span>
          {lastRun && <span>آخر فحص: {lastRun.toLocaleTimeString("ar-EG")}</span>}
        </div>
      </div>
    </AdminLayout>
  );
}
