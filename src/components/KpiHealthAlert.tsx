import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { buildKpiAlerts, KpiAlert, KpiSnapshot } from "@/lib/kpiAlerts";
import { notifyMany, getTenantAdmins } from "@/lib/notifications";
import { AlertOctagon, AlertTriangle, ShieldCheck, ArrowLeft } from "lucide-react";

const POLL_MS = 60_000;

export function KpiHealthAlert() {
  const { tenantId } = useAuth();
  const [alerts, setAlerts] = useState<KpiAlert[] | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    const run = async () => {
      const y = new Date().getFullYear();
      const start = `${y}-01-01`;
      const end = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase.rpc("get_financial_kpis" as any, { _start_date: start, _end_date: end });
      if (cancelled || error || !data) return;
      const next = buildKpiAlerts(data as KpiSnapshot);
      setAlerts(next);

      // Dedupe notifications per tenant using localStorage signature
      try {
        const sig = next.map(a => a.key).sort().join("|");
        const storageKey = `kpi_alert_sig_${tenantId}`;
        const prev = localStorage.getItem(storageKey) ?? "";
        const dangerCount = next.filter(a => a.level === "danger").length;
        if (sig && sig !== prev && dangerCount > 0) {
          const admins = await getTenantAdmins(tenantId);
          if (admins.length) {
            await notifyMany(admins, {
              title: `⚠️ تنبيه مالي: ${dangerCount} مؤشر خطر`,
              body: next.filter(a => a.level === "danger").slice(0, 3).map(a => a.title).join(" — "),
              type: "general",
              link: "/admin/kpi-dashboard",
            });
          }
        }
        if (sig !== prev) localStorage.setItem(storageKey, sig);
      } catch {}
    };

    run();
    const t = setInterval(run, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [tenantId]);

  const { dangers, warnings } = useMemo(() => ({
    dangers: (alerts ?? []).filter(a => a.level === "danger"),
    warnings: (alerts ?? []).filter(a => a.level === "warning"),
  }), [alerts]);

  if (!alerts) return null;

  if (alerts.length === 0) {
    return (
      <div className="mb-4 rounded-xl border border-success/40 bg-success/5 p-3 flex items-center gap-3 animate-fade-in">
        <ShieldCheck className="w-5 h-5 text-success" />
        <div className="text-sm">
          <span className="font-semibold text-success">المؤشرات المالية ضمن النطاق الصحي</span>
          <span className="text-muted-foreground mr-2">— لا توجد مخاطر حالياً</span>
        </div>
      </div>
    );
  }

  const hasDanger = dangers.length > 0;
  const topAlerts = [...dangers, ...warnings].slice(0, 3);

  return (
    <div
      className={`relative mb-4 rounded-2xl border-2 p-4 overflow-hidden animate-fade-in ${
        hasDanger
          ? "border-destructive/60 bg-destructive/5"
          : "border-warning/60 bg-warning/5"
      }`}
    >
      {/* Pulsing halo — always visible until resolved */}
      <div
        className={`pointer-events-none absolute inset-0 rounded-2xl animate-pulse ${
          hasDanger ? "shadow-[0_0_40px_-8px_hsl(var(--destructive)/0.55)] ring-1 ring-destructive/30"
                    : "shadow-[0_0_40px_-8px_hsl(var(--warning)/0.55)] ring-1 ring-warning/30"
        }`}
      />
      {/* Rotating shimmer strip */}
      <div className="pointer-events-none absolute -inset-x-4 top-0 h-1 overflow-hidden">
        <div
          className={`h-full w-1/3 animate-[slide-in-right_2.4s_ease-in-out_infinite] ${
            hasDanger ? "bg-gradient-to-r from-transparent via-destructive to-transparent"
                      : "bg-gradient-to-r from-transparent via-warning to-transparent"
          }`}
        />
      </div>

      <div className="relative flex items-start gap-3">
        <div className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center animate-pulse ${
          hasDanger ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"
        }`}>
          {hasDanger ? <AlertOctagon className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className={`font-bold text-base ${hasDanger ? "text-destructive" : "text-warning"}`}>
              {hasDanger
                ? `🚨 ${dangers.length} تنبيه خطر ${warnings.length ? `+ ${warnings.length} تحذير` : ""}`
                : `⚠️ ${warnings.length} تحذير مالي`}
            </div>
            <Link
              to="/admin/kpi-dashboard"
              className={`text-xs font-semibold inline-flex items-center gap-1 rounded-lg px-3 py-1.5 transition-colors ${
                hasDanger
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-warning text-warning-foreground hover:bg-warning/90"
              }`}
            >
              التفاصيل الكاملة <ArrowLeft className="w-3.5 h-3.5" />
            </Link>
          </div>

          <ul className="space-y-1.5">
            {topAlerts.map((a) => (
              <li key={a.key} className="flex items-start gap-2 text-sm">
                <span className={`mt-1 inline-block w-2 h-2 rounded-full shrink-0 animate-pulse ${
                  a.level === "danger" ? "bg-destructive" : "bg-warning"
                }`} />
                <div>
                  <span className={`font-semibold ${a.level === "danger" ? "text-destructive" : "text-warning"}`}>
                    {a.title}
                  </span>
                  <span className="text-muted-foreground"> — {a.advice}</span>
                </div>
              </li>
            ))}
            {alerts.length > topAlerts.length && (
              <li className="text-xs text-muted-foreground pr-4">
                +{alerts.length - topAlerts.length} تنبيه إضافي…
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
