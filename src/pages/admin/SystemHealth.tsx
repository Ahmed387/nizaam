import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, RefreshCcw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Health = any;

const fmt = (n: any) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

function StatusPill({ ok, label }: { ok: boolean; label?: string }) {
  return ok ? (
    <Badge className="bg-success/15 text-success border-success/30 gap-1"><CheckCircle2 className="w-3 h-3" />{label ?? "سليم"}</Badge>
  ) : (
    <Badge className="bg-destructive/15 text-destructive border-destructive/30 gap-1"><XCircle className="w-3 h-3" />{label ?? "خلل"}</Badge>
  );
}

export default function SystemHealth() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase.rpc("system_health_check" as any);
    if (error) { setErr(error.message); toast({ title: "فشل الفحص", description: error.message, variant: "destructive" }); }
    else setData(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const shares = (data?.partner_shares ?? []) as any[];
  const tb = (data?.trial_balance ?? []) as any[];
  const pb = (data?.partner_balance_match ?? []) as any[];
  const inv = data?.invoices ?? {};
  const orphans = data?.orphans ?? {};
  const tenants = (data?.tenants ?? []) as any[];
  const profits = (data?.partner_profit_snapshot ?? []) as any[];

  const issues = [
    ...shares.filter(s => !s.ok).map(s => `نسب الشركاء لتينانت ${s.tenant_id?.slice(0,8)} ليست 100% (رأس المال: ${s.capital_pct}%، التشغيل: ${s.operating_pct}%)`),
    ...tb.filter(t => !t.ok).map(t => `ميزان المراجعة غير متزن — فرق: ${t.diff}`),
    ...pb.filter(p => !p.ok).map(p => `رصيد الشريك ${p.name} في الجدول (${fmt(p.stored_balance)}) ≠ المحسوب من الحركات (${fmt(p.computed_from_tx)})`),
    ...(Number(orphans.orphan_invoice_items||0) > 0 ? [`عناصر فواتير يتيمة: ${orphans.orphan_invoice_items}`] : []),
    ...(Number(orphans.orphan_journal_lines||0) > 0 ? [`قيود يومية يتيمة: ${orphans.orphan_journal_lines}`] : []),
    ...(Number(orphans.orphan_payments||0) > 0 ? [`دفعات يتيمة: ${orphans.orphan_payments}`] : []),
    ...(Number(orphans.orphan_partner_tx||0) > 0 ? [`حركات شركاء يتيمة: ${orphans.orphan_partner_tx}`] : []),
    ...(Number(orphans.products_without_tenant||0) > 0 ? [`منتجات بدون تينانت: ${orphans.products_without_tenant}`] : []),
    ...(Number(inv.overpaid_invoices||0) > 0 ? [`فواتير مدفوعة زيادة: ${inv.overpaid_invoices}`] : []),
    ...(Number(inv.negative_total||0) > 0 ? [`فواتير بإجمالي سالب: ${inv.negative_total}`] : []),
  ];

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-4">
        <PageHeader
          title="فحص السيستم (System Health)"
          subtitle="حالة قاعدة البيانات والمنطق المحاسبي ونظام الشركاء — لحظياً"
          right={
            <Button size="sm" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <RefreshCcw className="w-4 h-4 ml-2" />}
              إعادة الفحص
            </Button>
          }
        />

        {err && <Card><CardContent className="p-4 text-destructive">{err}</CardContent></Card>}

        {/* Summary */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>ملخص عام</CardTitle>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> :
              <StatusPill ok={issues.length === 0} label={issues.length === 0 ? "لا توجد مشاكل" : `${issues.length} تنبيه`} />}
          </CardHeader>
          <CardContent>
            {issues.length === 0 ? (
              <div className="text-success text-sm">كل الفحوصات ناجحة ✅</div>
            ) : (
              <ul className="space-y-1 text-sm">
                {issues.map((m, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Partner shares */}
        <Card>
          <CardHeader><CardTitle>1. نسب الشركاء (يجب = 100%)</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">التينانت</th><th className="p-2">رأس المال</th><th className="p-2">التشغيل</th><th className="p-2">عدد الشركاء</th><th className="p-2">الحالة</th></tr></thead>
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
                {shares.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">لا يوجد شركاء</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Trial balance */}
        <Card>
          <CardHeader><CardTitle>2. ميزان المراجعة (مدين = دائن)</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">التينانت</th><th className="p-2">مدين</th><th className="p-2">دائن</th><th className="p-2">الفرق</th><th className="p-2">القيود</th><th className="p-2">الحالة</th></tr></thead>
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
                {tb.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">لا توجد قيود مرحّلة</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Partner balances */}
        <Card>
          <CardHeader><CardTitle>3. تطابق أرصدة الشركاء مع الحركات</CardTitle></CardHeader>
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
                {pb.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">لا يوجد شركاء</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Invoices + orphans */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle>4. سلامة الفواتير</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span>فواتير نشطة</span><span className="font-mono">{inv.total_active_invoices ?? 0}</span></div>
              <div className="flex justify-between"><span>مدفوعة زيادة</span><span className={`font-mono ${Number(inv.overpaid_invoices||0)>0?"text-destructive":""}`}>{inv.overpaid_invoices ?? 0}</span></div>
              <div className="flex justify-between"><span>إجمالي سالب</span><span className={`font-mono ${Number(inv.negative_total||0)>0?"text-destructive":""}`}>{inv.negative_total ?? 0}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>5. السجلات اليتيمة</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.entries(orphans as any).map(([k, v]: any) => (
                <div key={k} className="flex justify-between">
                  <span>{k}</span>
                  <span className={`font-mono ${Number(v)>0?"text-destructive":"text-success"}`}>{v}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Tenants overview */}
        <Card>
          <CardHeader><CardTitle>6. نظرة على التينانتات</CardTitle></CardHeader>
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
          <CardHeader><CardTitle>7. ملخص أرباح الشركاء (تحقق من الأرقام)</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">الشريك</th><th className="p-2">نسبة التشغيل</th><th className="p-2">المساهمات</th><th className="p-2">المسحوبات</th><th className="p-2">الأرباح الموزّعة</th><th className="p-2">الرصيد الحالي</th></tr></thead>
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

        {data?.generated_at && (
          <div className="text-xs text-muted-foreground text-left">Generated: {new Date(data.generated_at).toLocaleString("en-EG")}</div>
        )}
      </div>
    </AdminLayout>
  );
}
