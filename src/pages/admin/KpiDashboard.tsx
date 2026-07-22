import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Activity, DollarSign, PiggyBank, Scale, Percent, TrendingUp,
  Wallet, Package, Receipt, RefreshCw, Target, Landmark,
  AlertTriangle, AlertOctagon, ShieldCheck
} from "lucide-react";

import { buildKpiAlerts } from "@/lib/kpiAlerts";

type Alert = ReturnType<typeof buildKpiAlerts>[number];
const buildAlerts = buildKpiAlerts;

const fmt = (n: number | null | undefined) => n == null ? "—" : Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });
const pct = (n: number | null | undefined) => n == null ? "—" : `${Number(n).toFixed(2)}%`;
const ratio = (n: number | null | undefined) => n == null ? "—" : Number(n).toFixed(2);

type KPI = {
  revenue: number; cogs: number; gross_profit: number; gross_margin_pct: number;
  expenses: number; net_profit: number; net_margin_pct: number;
  total_assets: number; total_liabilities: number; total_equity: number;
  cash_balance: number; accounts_receivable: number; accounts_payable: number; inventory_value: number;
  current_ratio: number | null; quick_ratio: number | null; debt_to_equity: number | null;
  roa_pct: number; roe_pct: number;
  inventory_turnover: number | null; break_even_revenue: number | null;
};

function KpiCard({ icon: Icon, label, value, tone = "default", hint }: {
  icon: any; label: string; value: string; tone?: "default" | "success" | "warning" | "destructive" | "primary"; hint?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    primary: "text-primary",
  }[tone];
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs text-muted-foreground">{label}</div>
          <Icon className={`w-4 h-4 ${toneClass}`} />
        </div>
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function KpiDashboard() {
  const { tenantId } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const y = new Date().getFullYear();
  const [start, setStart] = useState(`${y}-01-01`);
  const [end, setEnd] = useState(today);
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("get_financial_kpis" as any, { _start_date: start, _end_date: end });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setKpi(data as any);
  };

  useEffect(() => { load(); }, [tenantId]);

  return (
    <AdminLayout>
      <PageHeader title="مؤشرات الأداء المالي" subtitle="نظرة شاملة على الربحية والسيولة والكفاءة" />

      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>من تاريخ</Label>
              <Input type="date" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div>
              <Label>إلى تاريخ</Label>
              <Input type="date" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
            <Button onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ml-2 ${loading ? "animate-spin" : ""}`} />تحديث
            </Button>
          </div>
        </CardContent>
      </Card>

      {!kpi ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">جاري التحميل...</CardContent></Card>
      ) : (
        <div className="space-y-6">
          {/* Health Alerts */}
          {(() => {
            const alerts = buildAlerts(kpi);
            if (alerts.length === 0) {
              return (
                <Card className="border-success/40 bg-success/5">
                  <CardContent className="py-4 flex items-center gap-3">
                    <ShieldCheck className="w-6 h-6 text-success" />
                    <div>
                      <div className="font-semibold text-success">لا توجد تنبيهات — المؤشرات ضمن النطاق الصحي</div>
                      <div className="text-xs text-muted-foreground">راجع الأرقام بانتظام لأي تغيّرات جوهرية.</div>
                    </div>
                  </CardContent>
                </Card>
              );
            }
            return (
              <Card className="border-destructive/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-destructive">
                    <AlertOctagon className="w-5 h-5" />
                    تنبيهات المخاطر ({alerts.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {alerts.map((al, i) => {
                    const isDanger = al.level === "danger";
                    return (
                      <div key={i} className={`rounded-lg border p-3 flex gap-3 ${isDanger ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5"}`}>
                        {isDanger
                          ? <AlertOctagon className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                          : <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />}
                        <div className="space-y-1 flex-1">
                          <div className={`font-bold text-sm ${isDanger ? "text-destructive" : "text-warning"}`}>{al.title}</div>
                          <div className="text-xs text-muted-foreground">{al.detail}</div>
                          <div className="text-xs"><span className="font-semibold">التوصية:</span> {al.advice}</div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })()}

          {/* Profitability */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" />الربحية</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={DollarSign} label="الإيرادات" value={fmt(kpi.revenue)} tone="primary" />
              <KpiCard icon={Package} label="تكلفة البضاعة" value={fmt(kpi.cogs)} />
              <KpiCard icon={PiggyBank} label="مجمل الربح" value={fmt(kpi.gross_profit)} tone={kpi.gross_profit >= 0 ? "success" : "destructive"} hint={pct(kpi.gross_margin_pct)} />
              <KpiCard icon={Percent} label="صافي الربح" value={fmt(kpi.net_profit)} tone={kpi.net_profit >= 0 ? "success" : "destructive"} hint={pct(kpi.net_margin_pct)} />
            </div>
          </div>

          {/* Financial Position */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><Scale className="w-5 h-5 text-primary" />المركز المالي</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={Landmark} label="إجمالي الأصول" value={fmt(kpi.total_assets)} />
              <KpiCard icon={Receipt} label="إجمالي الخصوم" value={fmt(kpi.total_liabilities)} tone="warning" />
              <KpiCard icon={PiggyBank} label="حقوق الملكية" value={fmt(kpi.total_equity)} tone="success" />
              <KpiCard icon={Wallet} label="الرصيد النقدي" value={fmt(kpi.cash_balance)} tone="primary" />
            </div>
          </div>

          {/* Working Capital */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><Activity className="w-5 h-5 text-primary" />رأس المال العامل</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={Receipt} label="عملاء (مدينون)" value={fmt(kpi.accounts_receivable)} />
              <KpiCard icon={Receipt} label="موردون (دائنون)" value={fmt(kpi.accounts_payable)} tone="warning" />
              <KpiCard icon={Package} label="قيمة المخزون" value={fmt(kpi.inventory_value)} />
              <KpiCard icon={Scale} label="النسبة الجارية" value={ratio(kpi.current_ratio)} tone={kpi.current_ratio && kpi.current_ratio >= 1 ? "success" : "warning"} hint="الأصول المتداولة ÷ الخصوم المتداولة" />
              <KpiCard icon={Activity} label="النسبة السريعة" value={ratio(kpi.quick_ratio)} tone={kpi.quick_ratio && kpi.quick_ratio >= 1 ? "success" : "warning"} hint="(الأصول المتداولة − المخزون) ÷ الخصوم المتداولة" />
            </div>
          </div>

          {/* Ratios */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><Target className="w-5 h-5 text-primary" />نسب الأداء</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={Percent} label="العائد على الأصول (ROA)" value={pct(kpi.roa_pct)} tone={kpi.roa_pct >= 0 ? "success" : "destructive"} />
              <KpiCard icon={Percent} label="العائد على حقوق الملكية (ROE)" value={pct(kpi.roe_pct)} tone={kpi.roe_pct >= 0 ? "success" : "destructive"} />
              <KpiCard icon={Scale} label="الرافعة المالية" value={ratio(kpi.debt_to_equity)} tone={kpi.debt_to_equity && kpi.debt_to_equity > 2 ? "warning" : "default"} hint="الخصوم ÷ حقوق الملكية" />
              <KpiCard icon={RefreshCw} label="معدل دوران المخزون" value={ratio(kpi.inventory_turnover)} hint="تكلفة البضاعة ÷ المخزون" />
            </div>
          </div>

          {/* Break-even */}
          <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Target className="w-5 h-5 text-primary" />نقطة التعادل</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-baseline gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">إيرادات التعادل المطلوبة</div>
                  <div className="text-3xl font-bold text-primary">{fmt(kpi.break_even_revenue)}</div>
                </div>
                <Badge variant="outline" className="text-sm">
                  الإيرادات الحالية: {fmt(kpi.revenue)}
                </Badge>
                {kpi.break_even_revenue && (
                  <Badge className={kpi.revenue >= kpi.break_even_revenue ? "bg-success" : "bg-warning"}>
                    {kpi.revenue >= kpi.break_even_revenue ? "تخطيت نقطة التعادل" : `متبقي ${fmt(kpi.break_even_revenue - kpi.revenue)}`}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                نقطة التعادل = إجمالي المصروفات ÷ نسبة مجمل الربح. الوصول إليها يعني تغطية كل المصروفات دون ربح أو خسارة.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}
