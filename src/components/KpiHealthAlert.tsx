import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { buildKpiAlerts, KpiAlert, KpiSnapshot } from "@/lib/kpiAlerts";
import { notifyMany, getTenantAdmins } from "@/lib/notifications";
import { AlertTriangle, ShieldCheck, ArrowLeft, Siren, ChevronDown } from "lucide-react";
import { cairoTodayDay } from "@/lib/cairoDate";

// Realtime on GL — no polling. Debounce to coalesce rapid changes.
const DEBOUNCE_MS = 3_000;

export function KpiHealthAlert() {
  const { tenantId } = useAuth();
  const [alerts, setAlerts] = useState<KpiAlert[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    const run = async () => {
      const end = cairoTodayDay();
      const start = `${end.slice(0, 4)}-01-01`;   // Cairo year, not the device clock
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
              link: "/admin/accounting/kpis",
            });
          }
        }
        if (sig !== prev) localStorage.setItem(storageKey, sig);
      } catch {}
    };

    run();
    let debounce: any;
    const channel = supabase
      .channel(`kpi-health-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_entries", filter: `tenant_id=eq.${tenantId}` }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(run, DEBOUNCE_MS);
      })
      .subscribe();
    return () => { cancelled = true; clearTimeout(debounce); supabase.removeChannel(channel); };
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
  const title = hasDanger
    ? `${dangers.length} تنبيه خطر${warnings.length ? ` + ${warnings.length} تحذير` : ""}`
    : `${warnings.length} تحذير مالي`;

  return (
    <div
      className={`mb-4 rounded-xl border overflow-hidden animate-fade-in ${
        hasDanger ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-3 py-2 text-right hover:bg-muted/30 transition-colors"
      >
        {hasDanger ? (
          <Siren className="w-4 h-4 text-destructive shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
        )}
        <span className={`flex-1 text-sm font-semibold ${hasDanger ? "text-destructive" : "text-warning"}`}>
          {title}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>

      <div className={`grid transition-all duration-300 ease-in-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden">
          <div className="px-4 pb-3 pt-1 space-y-2 border-t border-border/50">
            <ul className="space-y-1.5 pt-2">
              {topAlerts.map((a) => (
                <li key={a.key} className="flex items-start gap-2 text-sm">
                  <span className={`mt-1.5 inline-block w-2 h-2 rounded-full shrink-0 ${
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
            <div className="flex justify-end">
              <Link
                to="/admin/accounting/kpis"
                className={`text-xs font-semibold inline-flex items-center gap-1 rounded-lg px-3 py-1.5 transition-colors ${
                  hasDanger
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : "bg-warning text-warning-foreground hover:bg-warning/90"
                }`}
              >
                التفاصيل الكاملة <ArrowLeft className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
