// «الفواتير الإلكترونية الواردة» (migration 0220, owner 2026-11-14 «عاوز استقبل بس»): the documents other taxpayers
// issued TO this company on the ETA e-invoicing portal, read every hour by the edge function `eta-sync`.
// Receive only — nothing is sent to the ETA, and nothing here touches a document, a till, the books or stock.
// The Client ID / Secret are set by the OWNER in settings → «الربط مع الفاتورة الإلكترونية» (EtaConnectionWizard).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ExternalLink, RefreshCw, Settings2, CheckCheck } from "lucide-react";
import { rpcErrorText } from "@/lib/rpcError";
import { fetchAllRows } from "@/lib/fetchAll";

import type { EtaSettings } from "@/lib/etaWizard";
type EtaDoc = {
  id: string; eta_uuid: string; internal_id: string | null; type_name: string | null; issuer_id: string | null;
  issuer_name: string | null; date_issued: string | null; total_sales: number | null; total_discount: number | null;
  net_amount: number | null; total: number | null; status: string | null; status_reason: string | null;
  public_url: string | null; seen_at: string | null;
};

const fmt = (n: number | null) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { timeZone: "Africa/Cairo" }) : "—");
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }) : "لسه");
const TYPE: Record<string, string> = { I: "فاتورة", C: "إشعار دائن", D: "إشعار مدين" };
const STATUS: Record<string, { label: string; cls: string }> = {
  Valid: { label: "صحيحة", cls: "bg-success/15 text-success" },
  Cancelled: { label: "ملغاة", cls: "bg-muted text-muted-foreground" },
  Rejected: { label: "مرفوضة", cls: "bg-destructive/15 text-destructive" },
};

export default function EtaInvoices() {
  const { tenantId } = useAuth();
  const [settings, setSettings] = useState<EtaSettings | null>(null);
  const [docs, setDocs] = useState<EtaDoc[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    if (!tenantId) return;
    const { data, error } = await supabase.rpc("eta_settings_get" as any);
    if (error) { toast.error(rpcErrorText(error)); return; }
    const s = data as EtaSettings;
    setSettings(s);
    const rows = await fetchAllRows<EtaDoc>(() =>
      supabase.from("eta_documents" as any)
        .select("id,eta_uuid,internal_id,type_name,issuer_id,issuer_name,date_issued,total_sales,total_discount,net_amount,total,status,status_reason,public_url,seen_at")
        .eq("tenant_id", tenantId).order("date_issued", { ascending: false }).order("id"));
    setDocs(rows);
  };
  useEffect(() => { load(); }, [tenantId]);

  const syncNow = async () => {
    setSyncing(true);
    const { error } = await supabase.rpc("eta_sync_now" as any);
    if (error) { setSyncing(false); toast.error(rpcErrorText(error)); return; }
    toast.success("بيتحدث… الفواتير هتظهر خلال دقيقة أو اتنين");
    setTimeout(() => { setSyncing(false); load(); }, 60_000);
  };

  const markAllSeen = async () => {
    const { error } = await supabase.rpc("eta_mark_seen" as any, { p_ids: null });
    if (error) { toast.error(rpcErrorText(error)); return; }
    load();
  };

  const totals = useMemo(() => {
    const valid = docs.filter(d => d.status === "Valid");
    const sign = (d: EtaDoc) => (d.type_name === "C" ? -1 : 1);
    return {
      count: valid.length,
      total: valid.reduce((s, d) => s + sign(d) * Number(d.total || 0), 0),
      vat: valid.reduce((s, d) => s + sign(d) * (Number(d.total || 0) - Number(d.net_amount || 0)), 0),
      issuers: new Set(valid.map(d => d.issuer_id)).size,
    };
  }, [docs]);

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader
          title="الفواتير الإلكترونية الواردة"
          subtitle="فواتير الموردين اللي اتسجلت على منظومة الفاتورة الإلكترونية باسم شركتك — استقبال بس، مفيش حاجة بتتبعت للضرايب"
          actions={
            <div className="flex gap-2">
              {settings?.unseen ? <Button variant="outline" onClick={markAllSeen}><CheckCheck className="w-4 h-4 ml-2" />علّم الكل اتشاف ({settings.unseen})</Button> : null}
              {settings?.enabled && <Button variant="outline" onClick={syncNow} disabled={syncing}><RefreshCw className={`w-4 h-4 ml-2 ${syncing ? "animate-spin" : ""}`} />حدّث دلوقتي</Button>}
              {settings?.is_owner && <Button variant="outline" asChild><Link to="/admin/settings?tab=eta"><Settings2 className="w-4 h-4 ml-2" />إعدادات الربط</Link></Button>}
            </div>
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">عدد الفواتير الصحيحة</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{totals.count}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">الإجمالي (شامل الضريبة)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold font-mono">{fmt(totals.total)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">الضرايب عليها</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold font-mono">{fmt(totals.vat)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">عدد الموردين</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{totals.issuers}</div></CardContent></Card>
        </div>

        <div className="text-sm text-muted-foreground">
          {settings?.enabled ? "الربط شغّال — بيتحدث كل ساعة." : "الربط مش متشغّل."} آخر تحديث: {when(settings?.last_sync_at ?? null)}
          {settings?.last_error && <span className="text-destructive"> — آخر مشكلة: {settings.last_error}</span>}
        </div>

        {settings && !settings.enabled && (
          <Card className="border-primary/40">
            <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                الربط مع منظومة الضرايب لسه مش شغّال. {settings.is_owner
                  ? "خطوات الربط كلها في الإعدادات، وكل خطوة معاها شرح."
                  : "مالك الشركة هو اللي يعمل الربط من الإعدادات."}
              </div>
              {settings.is_owner && <Button asChild><Link to="/admin/settings?tab=eta">ابدأ الربط</Link></Button>}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>الفواتير</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>رقم المورد للفاتورة</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>الرقم الضريبي</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead className="text-left">قبل الضريبة</TableHead>
                  <TableHead className="text-left">الإجمالي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">مفيش فواتير واردة لسه</TableCell></TableRow>}
                {docs.map(d => {
                  const st = STATUS[d.status ?? ""] ?? { label: d.status ?? "—", cls: "bg-muted" };
                  return (
                    <TableRow key={d.id} className={d.seen_at ? "" : "bg-primary/5 font-medium"}>
                      <TableCell>{TYPE[d.type_name ?? ""] ?? d.type_name}{!d.seen_at && <Badge className="mr-2">جديد</Badge>}</TableCell>
                      <TableCell className="font-mono">{d.internal_id || "—"}</TableCell>
                      <TableCell>{d.issuer_name || "—"}</TableCell>
                      <TableCell className="font-mono">{d.issuer_id || "—"}</TableCell>
                      <TableCell>{day(d.date_issued)}</TableCell>
                      <TableCell className="text-left font-mono">{fmt(d.net_amount)}</TableCell>
                      <TableCell className="text-left font-mono">{fmt(d.total)}</TableCell>
                      <TableCell><span className={`px-2 py-0.5 rounded text-xs ${st.cls}`} title={d.status_reason ?? ""}>{st.label}</span></TableCell>
                      <TableCell>
                        {d.public_url && (
                          <a href={d.public_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary text-sm">
                            <ExternalLink className="w-4 h-4" />افتحها
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
