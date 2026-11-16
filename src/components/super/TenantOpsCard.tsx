/**
 * Platform owner → one company: daily activity report on Telegram (on / off) and how many days «سجل العمليات» is kept
 * (migration 0238, owner 2026-11-16: «صاحب المنصة هوا اللي يحدد»، default 7 days). The nightly purge runs at 00:15
 * Cairo, after the 23:15 report; tax / permission rows are kept 5 years whatever the days.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { rpcErrorText } from "@/lib/rpcError";

interface Ops {
  daily_report_enabled: boolean; audit_retention_days: number; last_purge_at: string | null; last_purge_rows: number | null;
  tg_linked: boolean; group_linked?: boolean; group_title?: string | null; owner_name: string | null; owner_phone: string | null; owner_email: string | null;
  last_report: { day: string; sent_at: string | null; error: string | null } | null; audit_rows: number;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }) : "—");

export function TenantOpsCard({ tenantId }: { tenantId: string }) {
  const [ops, setOps] = useState<Ops | null>(null);
  const [days, setDays] = useState("7");
  const [report, setReport] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await (supabase.rpc as any)("super_tenant_ops_get", { p_tenant: tenantId });
    if (error) return toast.error(rpcErrorText(error));
    const o = data as Ops;
    setOps(o); setDays(String(o.audit_retention_days)); setReport(o.daily_report_enabled);
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 3650) return toast.error("مدة الاحتفاظ من يوم لـ 3650 يوم");
    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("super_tenant_ops_set", { p_tenant: tenantId, p_daily_report: report, p_retention_days: n });
    setSaving(false);
    if (error) return toast.error(rpcErrorText(error));
    setOps(data as Ops);
    toast.success("اتحفظ");
  };

  const linkGroup = async () => {
    const { data, error } = await (supabase.rpc as any)("super_tg_link_start", { p_tenant: tenantId });
    if (error) return toast.error(rpcErrorText(error));
    window.open((data as any).url, "_blank", "noopener");
    toast.info("اختار جروب الشركة في تليجرام — هيظهر «مربوط» هنا بعد ثواني");
    let n = 0;
    const t = window.setInterval(async () => {
      n++;
      const { data: d } = await (supabase.rpc as any)("super_tenant_ops_get", { p_tenant: tenantId });
      if ((d as any)?.group_linked || n > 120) { window.clearInterval(t); if ((d as any)?.group_linked) { setOps(d as Ops); toast.success("الجروب اتربط"); } }
    }, 5000);
  };
  const unlinkGroup = async () => {
    if (!window.confirm("تفك ربط جروب الفواتير بتاع الشركة دي؟")) return;
    const { error } = await (supabase.rpc as any)("super_tg_unlink_group", { p_tenant: tenantId });
    if (error) return toast.error(rpcErrorText(error));
    load();
  };

  if (!ops) return <section className="card-elevated p-5 mb-5"><Loader2 className="w-5 h-5 animate-spin" /></section>;
  return (
    <section className="card-elevated p-5 mb-5 grid gap-4">
      <h3 className="font-bold">التقرير اليومي وسجل العمليات</h3>
      <div className="text-sm text-muted-foreground">
        صاحب الشركة: {ops.owner_name ?? "—"} {ops.owner_phone ? `— ${ops.owner_phone}` : ""} {ops.owner_email ? `— ${ops.owner_email}` : ""} —
        تليجرام صاحب الشركة: {ops.tg_linked ? "مربوط" : "مش مربوط"}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <Label className="font-bold">جروب الفواتير الإلكترونية</Label>
          <div className="text-xs text-muted-foreground">
            {ops.group_linked ? `مربوط: «${ops.group_title ?? "الجروب"}»` : "مش مربوط — اعمل الجروب في تليجرام وضيف صاحب الشركة، وبعدين دوس «اربط الجروب» واختاره."}
          </div>
        </div>
        {ops.group_linked
          ? <Button variant="ghost" size="sm" onClick={unlinkGroup}>فك الربط</Button>
          : <Button size="sm" onClick={linkGroup}>اربط الجروب</Button>}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <Label className="font-bold">تقرير النشاط اليومي (11:15 بالليل)</Label>
            <div className="text-xs text-muted-foreground">PDF بكل موظف عمل إيه وفتح إيه — على تليجرام صاحب الشركة، ولو مفيش نشاط مش بيتبعت.</div>
            <div className="text-xs text-muted-foreground mt-1">
              آخر تقرير: {ops.last_report ? `${ops.last_report.day} — ${ops.last_report.sent_at ? "اتبعت" : ops.last_report.error === "no activity" ? "مفيش نشاط" : ops.last_report.error ?? "مستني"}` : "—"}
            </div>
          </div>
          <Switch checked={report} onCheckedChange={setReport} />
        </div>
        <div className="rounded-lg border p-3 space-y-1">
          <Label className="font-bold">مدة الاحتفاظ بسجل العمليات (بالأيام)</Label>
          <Input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} className="max-w-32" />
          <div className="text-xs text-muted-foreground">
            الأقدم من كده بيتمسح نهائي كل ليلة الساعة 12:15. سجلات الضرايب والصلاحيات بتفضل 5 سنين. «سجل المستندات» مش بيتمسح.
          </div>
          <div className="text-xs text-muted-foreground">في السجل دلوقتي: {ops.audit_rows.toLocaleString("ar-EG")} سطر — آخر مسح: {when(ops.last_purge_at)}{ops.last_purge_rows != null ? ` (${ops.last_purge_rows} سطر)` : ""}</div>
        </div>
      </div>
      <div><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ</Button></div>
    </section>
  );
}
