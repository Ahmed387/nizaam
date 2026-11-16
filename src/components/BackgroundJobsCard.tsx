// «المهام الأوتوماتيك» (migration 0234, owner 2026-11-16): every job that runs by itself, when it last worked, and the
// ones that stopped first with what to do. The same list feeds the «مهام أوتوماتيك وقفت» card in «متابعة» and the
// notifications sent by «job-failure-alerts» (link /admin/system-health#jobs). Read only.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermTable } from "@/components/PermTable";
import { Loader2, RefreshCcw, ServerCog } from "lucide-react";
import { rpcErrorText } from "@/lib/rpcError";
import { checkedText } from "@/lib/systemChecks";

type JobRow = { job_key: string; label: string; last_ok_at: string | null; last_fail_at: string | null; error: string | null; failing: boolean; advice: string };

const when = (iso: string | null) => (iso ? checkedText(iso).replace("آخر فحص: ", "") : "—");

export function BackgroundJobsCard() {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("background_jobs_status" as any);
    setLoading(false);
    if (error) { setError(rpcErrorText(error)); return; }
    setError(null);
    setRows((data as JobRow[]) ?? []);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (window.location.hash === "#jobs") document.getElementById("jobs")?.scrollIntoView({ behavior: "smooth" }); }, [rows.length]);

  const failing = rows.filter((r) => r.failing).length;
  return (
    <div className="rounded-2xl border p-4 space-y-3" id="jobs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ServerCog className="w-5 h-5 text-primary" />
          <div>
            <div className="font-bold">المهام الأوتوماتيك</div>
            <div className="text-xs text-muted-foreground">الحاجات اللي السيستم بيعملها لوحده. لو واحدة وقفت بيوصلك إشعار، وبيظهر كارت في «متابعة».</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!loading && (failing > 0
            ? <Badge className="bg-destructive/15 text-destructive border-destructive/30">{failing} وقفت</Badge>
            : <Badge className="bg-success/15 text-success border-success/30">كلها شغالة</Badge>)}
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <RefreshCcw className="w-4 h-4 ml-1" />} تحديث
          </Button>
        </div>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      {!error && (
        <PermTable permTable="background_jobs" className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b">
              <th className="p-2 text-right whitespace-nowrap">المهمة</th>
              <th className="p-2 text-center whitespace-nowrap">الحالة</th>
              <th className="p-2 text-center whitespace-nowrap">آخر مرة اشتغلت صح</th>
              <th className="p-2 text-right">المشكلة / تعمل إيه</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.job_key} className={`border-b ${r.failing ? "bg-destructive/5" : ""}`}>
                <td className="p-2 font-medium whitespace-nowrap">{r.label}</td>
                <td className="p-2 text-center">
                  {r.failing ? <Badge className="bg-destructive/15 text-destructive">وقفت</Badge> : <Badge className="bg-success/15 text-success">شغالة</Badge>}
                </td>
                <td className="p-2 text-center text-xs whitespace-nowrap tabular-nums">{when(r.last_ok_at)}</td>
                <td className="p-2 text-xs">
                  {r.failing ? <><div className="text-destructive">{r.error ?? "آخر تشغيل فشل"}</div><div className="text-muted-foreground">{r.advice}</div></> : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </PermTable>
      )}
    </div>
  );
}
