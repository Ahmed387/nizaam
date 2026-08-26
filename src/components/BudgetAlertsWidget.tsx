import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { AlertTriangle, TrendingUp, Target, ArrowRight, Flame } from "lucide-react";

type VarianceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  planned_amount: number;
  actual_amount: number;
  variance: number;
  variance_pct: number | null;
};

// Session guard so we don't spam toasts on every dashboard visit
const TOASTED_KEY = "budget_alerts_toasted_v1";

export function BudgetAlertsWidget() {
  const { tenantId } = useAuth();
  const [rows, setRows] = useState<VarianceRow[]>([]);
  const [periodName, setPeriodName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!tenantId) return;
      setLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      const { data: periods } = await supabase
        .from("fiscal_periods" as any)
        .select("id,name,period_start,period_end,status")
        .eq("tenant_id", tenantId)
        .lte("period_start", today)
        .gte("period_end", today)
        .order("period_end", { ascending: false })
        .limit(1);
      const period = (periods as any)?.[0];
      if (!period) { setLoading(false); return; }
      setPeriodName(period.name);

      const { data } = await supabase.rpc("get_budget_variance" as any, { _fiscal_period_id: period.id });
      const all = ((data as any) ?? []) as VarianceRow[];

      // Only expense accounts with a plan, sorted by highest overrun
      const overruns = all
        .filter(r => r.account_type === "expense" && Number(r.planned_amount) > 0)
        .map(r => ({
          ...r,
          overrun_pct: Number(r.planned_amount) > 0
            ? ((Number(r.actual_amount) - Number(r.planned_amount)) / Number(r.planned_amount)) * 100
            : 0,
        }))
        .filter(r => (r as any).overrun_pct > 0)
        .sort((a, b) => (b as any).overrun_pct - (a as any).overrun_pct)
        .slice(0, 5);

      setRows(overruns);
      setLoading(false);

      // Fire fancy colored toasts once per session for critical overruns (>25%)
      const already = sessionStorage.getItem(TOASTED_KEY);
      if (!already) {
        const critical = overruns.filter(r => (r as any).overrun_pct >= 25).slice(0, 3);
        critical.forEach((r, i) => {
          setTimeout(() => {
            const pct = Math.round((r as any).overrun_pct);
            const excess = Number(r.actual_amount) - Number(r.planned_amount);
            toast.custom((t) => (
              <div
                className="w-[360px] max-w-[92vw] rounded-xl overflow-hidden shadow-2xl border border-destructive/40 cursor-pointer"
                onClick={() => toast.dismiss(t)}
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--destructive)) 0%, hsl(var(--warning)) 100%)",
                }}
              >
                <div className="p-4 text-white">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center shrink-0">
                      <Flame className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-wide opacity-90 font-bold">
                        تنبيه تجاوز الموازنة
                      </div>
                      <div className="font-bold text-sm mt-0.5 truncate">
                        {r.account_name}
                      </div>
                      <div className="text-xs mt-1 opacity-95">
                        تعدّى المخطط بنسبة <span className="font-bold">{pct}%</span> (+{formatEGP(excess)})
                      </div>
                    </div>
                    <Badge className="bg-white/25 hover:bg-white/25 text-white border-0 shrink-0">
                      {pct}%
                    </Badge>
                  </div>
                </div>
                <div className="h-1 bg-white/30">
                  <div className="h-full bg-white" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            ), { duration: 6000 });
          }, i * 400);
        });
        if (critical.length > 0) sessionStorage.setItem(TOASTED_KEY, "1");
      }
    })();
  }, [tenantId]);

  if (loading || rows.length === 0) return null;

  return (
    <Card className="mb-6 border-destructive/30 overflow-hidden">
      <div className="h-1 bg-gradient-to-r from-destructive via-warning to-destructive" />
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="w-9 h-9 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div>بنود تجاوزت الموازنة</div>
              {periodName && <div className="text-xs font-normal text-muted-foreground">{periodName}</div>}
            </div>
          </CardTitle>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/admin/budgets">
              <Target className="w-4 h-4" /> إدارة الموازنة <ArrowRight className="w-3 h-3" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-3">
          {rows.map((r) => {
            const pct = Math.round((r as any).overrun_pct);
            const excess = Number(r.actual_amount) - Number(r.planned_amount);
            const severity: "critical" | "high" | "warn" =
              pct >= 50 ? "critical" : pct >= 25 ? "high" : "warn";
            const tone =
              severity === "critical"
                ? "from-destructive/15 to-destructive/5 border-destructive/40"
                : severity === "high"
                ? "from-warning/15 to-warning/5 border-warning/40"
                : "from-primary/10 to-primary/5 border-primary/30";
            const badgeTone =
              severity === "critical"
                ? "bg-destructive text-destructive-foreground"
                : severity === "high"
                ? "bg-warning text-warning-foreground"
                : "bg-primary text-primary-foreground";

            return (
              <div
                key={r.account_id}
                className={`rounded-lg border bg-gradient-to-l ${tone} p-3`}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <TrendingUp className="w-4 h-4 text-destructive shrink-0" />
                    <div className="font-semibold text-sm truncate">{r.account_name}</div>
                    <span className="text-[10px] text-muted-foreground font-mono">{r.account_code}</span>
                  </div>
                  <Badge className={`${badgeTone} shrink-0`}>+{pct}%</Badge>
                </div>
                <Progress value={Math.min(100, pct)} className="h-1.5 mb-2" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    الفعلي <span className="font-mono font-semibold text-foreground">{formatEGP(r.actual_amount)}</span>
                    {" / "}
                    المخطط <span className="font-mono">{formatEGP(r.planned_amount)}</span>
                  </span>
                  <span className="font-mono font-semibold text-destructive">+{formatEGP(excess)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
