import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FinancialAmount } from "@/components/FinancialAmount";
import { Loader2, Lock, TrendingUp, TrendingDown } from "lucide-react";

/**
 * Super Admin: monthly net profit per company, from the general ledger
 * (RPC super_tenants_monthly_profit — the same source as fiscal closing).
 *
 * The figures are switched off in the database (platform_flags.super_profit_card) until the
 * ledger fixes of Phase 5 are complete. While off, the RPC returns {enabled:false} and this
 * section shows each company with a "pending activation" state — never an estimated number.
 */

interface TenantLite { id: string; name: string; is_suspended: boolean }
interface ProfitRow {
  tenant_id: string; name: string; is_suspended: boolean;
  revenue: number; cogs: number; expenses: number; net_profit: number; prev_net_profit: number;
}

const FIRST_MONTH = "2026-01"; // all documents date from January 2026 onward
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

function cairoMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date());
}

function monthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  let [y, m] = cairoMonth().split("-").map(Number);
  const [fy, fm] = FIRST_MONTH.split("-").map(Number);
  while (y > fy || (y === fy && m >= fm)) {
    out.push({ value: `${y}-${String(m).padStart(2, "0")}`, label: `${MONTHS_AR[m - 1]} ${y}` });
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

export function TenantsProfitSection({ tenants }: { tenants: TenantLite[] }) {
  const options = useMemo(monthOptions, []);
  const [month, setMonth] = useState(options[0]?.value ?? cairoMonth());
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<ProfitRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    (supabase.rpc as any)("super_tenants_monthly_profit", { p_month: `${month}-01` }).then(({ data, error }: any) => {
      if (cancelled) return;
      if (error) { setError(error.message); setEnabled(false); setRows([]); }
      else { setEnabled(!!data?.enabled); setRows((data?.rows ?? []) as ProfitRow[]); }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [month]);

  const byTenant = new Map(rows.map((r) => [r.tenant_id, r]));

  return (
    <div className="card-elevated p-4 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <h3 className="font-bold">صافي الربح لكل شركة</h3>
          <p className="text-xs text-muted-foreground">من القيود المرحّلة في دفتر الأستاذ — نفس مصدر الإقفال المالي</p>
        </div>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {!loading && !enabled && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm mb-3">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <span>الأرقام هتظهر بعد اكتمال تصحيح القيود المحاسبية (المرحلة 5) ومطابقتها، عشان تكون دقيقة 100%.{error ? ` (${error})` : ""}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tenants.map((t) => {
            const r = enabled ? byTenant.get(t.id) : undefined;
            const net = r?.net_profit ?? 0;
            const margin = r && r.revenue > 0 ? (net / r.revenue) * 100 : null;
            const change = r && r.prev_net_profit !== 0 ? ((net - r.prev_net_profit) / Math.abs(r.prev_net_profit)) * 100 : null;
            return (
              <div key={t.id} className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="font-semibold truncate">{t.name}</div>
                  {t.is_suspended && <Badge className="bg-destructive text-destructive-foreground">موقوفة</Badge>}
                </div>
                {!enabled ? (
                  <div className="text-sm text-muted-foreground py-4 flex items-center gap-2"><Lock className="w-4 h-4" /> بانتظار التفعيل</div>
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground">صافي الربح</div>
                    <FinancialAmount value={net} size="lg" className={`justify-start font-extrabold ${net < 0 ? "text-destructive" : "text-success"}`} />
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <span className="text-muted-foreground">الإيرادات</span><FinancialAmount value={r?.revenue ?? 0} size="sm" />
                      <span className="text-muted-foreground">تكلفة البضاعة المباعة</span><FinancialAmount value={r?.cogs ?? 0} size="sm" />
                      <span className="text-muted-foreground">المصروفات</span><FinancialAmount value={r?.expenses ?? 0} size="sm" />
                      <span className="text-muted-foreground">هامش الربح</span><span className="tabular-nums">{margin === null ? "—" : `${margin.toFixed(1)}%`}</span>
                    </div>
                    {change !== null && (
                      <div className={`mt-2 text-xs flex items-center gap-1 ${change >= 0 ? "text-success" : "text-destructive"}`}>
                        {change >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        {`${Math.abs(change).toFixed(1)}% مقارنة بالشهر السابق`}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {tenants.length === 0 && <div className="text-sm text-muted-foreground">لا توجد شركات</div>}
        </div>
      )}
    </div>
  );
}
