// «الفواتير الإلكترونية الواردة» (migrations 0220–0222, owner 2026-11-15 «عاوزك تعمل صفحة للفواتير الالكترونية الواردة»):
// the documents other taxpayers issued TO this company on the ETA portal (read every hour by `eta-sync`), compared with our
// purchase invoices. Receive only — nothing is sent to the ETA, and nothing here writes a document, a till row or an entry:
// linking only says «this ETA invoice = that purchase invoice we already have».
//   tab «الفواتير»: every document + where it stands (متسجلة / مش متسجلة / المورد مش مربوط / مش فاتورة شراء), its lines
//                   (fetched once from the ETA, then kept), link / unlink / «مش فاتورة شراء».
//   tab «الموردين»: the ETA suppliers by tax id, linked to one or more of our supplier accounts (suggestions by name);
//                   linking runs the automatic pairing (amount ± 1 pound, our invoice 10 days before → 30 days after).
// Credentials live in settings → «الربط مع الفاتورة الإلكترونية» (EtaConnectionWizard).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCardWithHint } from "@/components/MetricCardWithHint";
import { ContactLookup } from "@/components/ContactLookup";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  ExternalLink, RefreshCw, Settings2, CheckCheck, Link2, Unlink, EyeOff, ListTree, History, Loader2, X, Plus,
  FileCheck2, FileWarning, Receipt, Users, Percent, FileText,
} from "lucide-react";
import { rpcErrorText } from "@/lib/rpcError";
import type { EtaSettings } from "@/lib/etaWizard";
import { ETA_STATE, etaLines, etaState, etaTotals, etaTypeLabel, type EtaDoc, type EtaIssuer, type EtaState } from "@/lib/etaInvoices";
import { cairoTodayDay } from "@/lib/cairoDate";

const fmt = (n: number | null | undefined) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-GB", { timeZone: "Africa/Cairo" }) : "—");
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }) : "لسه");
const firstOfMonth = () => cairoTodayDay().slice(0, 8) + "01";

const STATUS: Record<string, { label: string; cls: string }> = {
  Valid: { label: "صحيحة", cls: "bg-success/15 text-success" },
  Cancelled: { label: "ملغاة", cls: "bg-muted text-muted-foreground" },
  Rejected: { label: "مرفوضة", cls: "bg-destructive/15 text-destructive" },
};

export default function EtaInvoices() {
  const { tenantId, branches } = useAuth();
  const [settings, setSettings] = useState<EtaSettings | null>(null);
  const [docs, setDocs] = useState<EtaDoc[]>([]);
  const [issuers, setIssuers] = useState<EtaIssuer[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stateFilter, setStateFilter] = useState<EtaState | "all">("all");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("docs");
  const [syncing, setSyncing] = useState(false);
  const [detailDoc, setDetailDoc] = useState<EtaDoc | null>(null);
  const [linkDoc, setLinkDoc] = useState<EtaDoc | null>(null);
  const [backfillOpen, setBackfillOpen] = useState(false);

  // only the owner / a manager get the settings (eta_settings_get refuses anybody else) — they are also the ones who link
  const canWrite = !!settings;
  const anyBranch = branches[0]?.id ?? null;

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [s, d, i] = await Promise.all([
      supabase.rpc("eta_settings_get" as any),
      supabase.rpc("eta_documents_list" as any, { p_from: from || null, p_to: to || null }),
      supabase.rpc("eta_issuers" as any),
    ]);
    setLoading(false);
    setSettings(s.error ? null : (s.data as EtaSettings));
    if (d.error) toast.error(rpcErrorText(d.error)); else setDocs((d.data as EtaDoc[]) ?? []);
    if (!i.error) setIssuers((i.data as EtaIssuer[]) ?? []);
  };
  useEffect(() => { load(); }, [tenantId, from, to]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return docs.filter(d =>
      (stateFilter === "all" || etaState(d) === stateFilter) &&
      (!term || [d.internal_id, d.issuer_name, d.issuer_id, d.match?.number].some(x => (x ?? "").toLowerCase().includes(term))));
  }, [docs, stateFilter, q]);
  const t = useMemo(() => etaTotals(docs), [docs]);
  const st = useMemo(() => etaTotals(shown), [shown]);

  const syncNow = async () => {
    setSyncing(true);
    const { error } = await supabase.rpc("eta_sync_now" as any);
    if (error) { setSyncing(false); toast.error(rpcErrorText(error)); return; }
    toast.success("بيتحدث… الفواتير الجديدة هتظهر خلال دقيقة");
    setTimeout(() => { setSyncing(false); load(); }, 45_000);
  };
  const markAllSeen = async () => {
    const { error } = await supabase.rpc("eta_mark_seen" as any, { p_ids: null });
    if (error) { toast.error(rpcErrorText(error)); return; }
    load();
  };
  const setMatch = async (doc: EtaDoc, action: "link" | "ignore" | "clear", shipment?: string, note?: string) => {
    const { error } = await supabase.rpc("eta_set_match" as any, { p_doc: doc.id, p_action: action, p_shipment: shipment ?? null, p_note: note ?? null });
    if (error) { toast.error(rpcErrorText(error)); return false; }
    toast.success(action === "link" ? "اتربطت بفاتورة الشراء" : action === "ignore" ? "اتعلّمت إنها مش فاتورة شراء" : "اتفكّ الربط");
    load();
    return true;
  };
  const filterBy = (s: EtaState | "all") => { setTab("docs"); setStateFilter(prev => (prev === s ? "all" : s)); };

  if (settings && !settings.enabled && docs.length === 0 && !loading) {
    return (
      <AdminLayout>
        <div dir="rtl" className="text-right space-y-6">
          <PageHeader title="الفواتير الإلكترونية الواردة" subtitle="فواتير الموردين اللي اتسجلت على منظومة الضرايب باسم شركتك" />
          <Card className="border-primary/40"><CardContent className="py-6 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">الربط مع منظومة الضرايب لسه مش شغّال. {settings.is_owner ? "خطوات الربط كلها في الإعدادات، وكل خطوة معاها شرح." : "مالك الشركة هو اللي يعمل الربط من الإعدادات."}</div>
            {settings.is_owner && <Button asChild><Link to="/admin/settings?tab=eta">ابدأ الربط</Link></Button>}
          </CardContent></Card>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-5">
        <PageHeader
          title="الفواتير الإلكترونية الواردة"
          subtitle="فواتير الموردين على منظومة الضرايب باسم شركتك، ومقارنتها بفواتير الشراء اللي عندنا — استقبال بس، مفيش حاجة بتتبعت للضرايب"
          actions={
            <div className="flex flex-wrap gap-2">
              {settings?.unseen ? <Button variant="outline" onClick={markAllSeen}><CheckCheck className="w-4 h-4 ml-2" />علّم الكل اتشاف ({settings.unseen})</Button> : null}
              {settings?.enabled && <Button variant="outline" onClick={syncNow} disabled={syncing}><RefreshCw className={`w-4 h-4 ml-2 ${syncing ? "animate-spin" : ""}`} />حدّث دلوقتي</Button>}
              {settings?.is_owner && settings.enabled && <Button variant="outline" onClick={() => setBackfillOpen(true)}><History className="w-4 h-4 ml-2" />هات فواتير أقدم</Button>}
              {settings?.is_owner && <Button variant="outline" asChild><Link to="/admin/settings?tab=eta"><Settings2 className="w-4 h-4 ml-2" />إعدادات الربط</Link></Button>}
            </div>
          }
        />

        {settings && (
          <div className="text-sm text-muted-foreground">
            {settings.enabled ? "الاستقبال شغّال — بيتحدث كل ساعة." : "الاستقبال متوقف."} آخر تحديث: {when(settings.last_sync_at)}
            {settings.last_error && <span className="text-destructive"> — آخر مشكلة: {settings.last_error}</span>}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <MetricCardWithHint label="الفواتير الصحيحة" value={t.count} currency={false} icon={<FileText />}
            active={stateFilter === "all"} onClick={() => filterBy("all")}
            metricHint={{ meaning: "عدد الفواتير والإشعارات الصحيحة اللي وصلت باسم الشركة في الفترة.", source: "منظومة الفاتورة الإلكترونية.", formula: "عدد المستندات بحالة «صحيحة»" }} />
          <MetricCardWithHint label="الإجمالي شامل الضريبة" value={t.total} currency icon={<Receipt />}
            metricHint={{ meaning: "قيمة الفواتير بالضريبة، والإشعارات الدائنة بتتطرح.", source: "منظومة الفاتورة الإلكترونية.", formula: "Σ الفواتير − Σ الإشعارات الدائنة (الصحيحة بس)" }} />
          <MetricCardWithHint label="ضريبة القيمة المضافة عليها" value={t.vat} currency icon={<Percent />}
            metricHint={{ meaning: "الضريبة اللي الموردين حطوها على الفواتير دي (ضريبة مدخلات).", source: "منظومة الفاتورة الإلكترونية.", formula: "Σ (الإجمالي − الصافي) للفواتير − نفس الحساب للإشعارات الدائنة" }} />
          <MetricCardWithHint label="متسجلة عندنا" value={t.recorded.total} currency tone="success" icon={<FileCheck2 />}
            footer={<span>{t.recorded.count} فاتورة</span>} active={stateFilter === "recorded"} onClick={() => filterBy("recorded")}
            metricHint={{ meaning: "فواتير لقينا لها فاتورة شراء عندنا بنفس المبلغ.", source: "الربط بين المنظومة وفواتير الشراء.", formula: "مجموع الفواتير المربوطة بفاتورة شراء" }} />
          <MetricCardWithHint label="مش متسجلة عندنا" value={t.notRecorded.total} currency tone="destructive" icon={<FileWarning />}
            footer={<span>{t.notRecorded.count} فاتورة</span>} active={stateFilter === "missing"} onClick={() => filterBy("missing")}
            metricHint={{ meaning: "فواتير على المنظومة ملقيناش لها فاتورة شراء عندنا، أو المورد لسه مش مربوط بحساب عندنا.", source: "الربط بين المنظومة وفواتير الشراء.", formula: "الفواتير الصحيحة اللي مش مربوطة ومش متعلّمة «مش فاتورة شراء»" }} />
          <MetricCardWithHint label="موردين مش مربوطين" value={t.unlinkedSuppliers} currency={false} tone="warning" icon={<Users />}
            onClick={() => setTab("issuers")}
            metricHint={{ meaning: "موردين على المنظومة لسه ماقلتلناش هما أنهي حساب عندنا.", source: "تبويب «الموردين».", formula: "عدد الأرقام الضريبية من غير حساب مورد مربوط" }} />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="docs">الفواتير ({docs.length})</TabsTrigger>
            <TabsTrigger value="issuers">الموردين ({issuers.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="docs" className="space-y-3 mt-3">
            <div className="flex flex-wrap items-end gap-3">
              <div><Label>من</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" /></div>
              <div><Label>إلى</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" /></div>
              <Button variant="ghost" size="sm" onClick={() => { setFrom(firstOfMonth()); setTo(cairoTodayDay()); }}>الشهر ده</Button>
              <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>كل الفترات</Button>
              <div className="flex-1 min-w-[220px]"><Label>بحث</Label><Input value={q} onChange={e => setQ(e.target.value)} placeholder="رقم الفاتورة، المورد، الرقم الضريبي، رقم فاتورة الشراء" /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["all", "missing", "unlinked", "recorded", "credit", "ignored", "void"] as const).map(k => {
                const n = k === "all" ? docs.length : docs.filter(d => etaState(d) === k).length;
                if (k !== "all" && n === 0) return null;
                return (
                  <Button key={k} size="sm" variant={stateFilter === k ? "default" : "outline"} onClick={() => setStateFilter(k)}>
                    {k === "all" ? "الكل" : ETA_STATE[k].label} ({n})
                  </Button>
                );
              })}
            </div>

            <Card><CardContent className="p-0">
              <Table permTable="eta_docs">
                <TableHeader>
                  <TableRow>
                    <TableHead>الفاتورة</TableHead>
                    <TableHead>المورد</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead className="text-left">الإجمالي</TableHead>
                    <TableHead>في السيستم</TableHead>
                    <TableHead className="text-left">قبل الضريبة</TableHead>
                    <TableHead className="text-left">الضريبة</TableHead>
                    <TableHead>على المنظومة</TableHead>
                    <TableHead>إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={9} className="text-center py-6"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
                  {!loading && shown.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">مفيش فواتير بالشروط دي</TableCell></TableRow>}
                  {!loading && shown.map(d => {
                    const s = STATUS[d.status ?? ""] ?? { label: d.status ?? "—", cls: "bg-muted" };
                    const es = etaState(d);
                    return (
                      <TableRow key={d.id} className={d.seen_at ? "" : "bg-primary/5"}>
                        <TableCell className="whitespace-nowrap">
                          <div>{etaTypeLabel(d.type_name)}{!d.seen_at && <Badge className="mr-2">جديد</Badge>}</div>
                          <div className="font-mono text-xs text-muted-foreground">{d.internal_id || "—"}</div>
                        </TableCell>
                        <TableCell className="min-w-[180px]"><div>{d.issuer_name || "—"}</div><div className="text-xs text-muted-foreground font-mono">{d.issuer_id}</div></TableCell>
                        <TableCell className="whitespace-nowrap">{day(d.date_issued)}</TableCell>
                        <TableCell className="text-left font-mono font-medium whitespace-nowrap">{fmt(d.total)}</TableCell>
                        <TableCell className="min-w-[190px]">
                          <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${ETA_STATE[es].tone}`}>{ETA_STATE[es].label}</span>
                          {d.match && (
                            <div className="text-xs mt-1">
                              <Link className="underline font-mono" to={`/branch/${d.match.branch_id}/shipments/${d.match.shipment_id}`}>{d.match.number}</Link>
                              {" "}— {d.match.branch} — {day(d.match.date)}
                              {Math.abs(d.match.diff) >= 0.01 && <span className="text-muted-foreground"> (فرق {fmt(d.match.diff)})</span>}
                              {d.match_mode === "auto" && <span className="text-muted-foreground"> · تلقائي</span>}
                            </div>
                          )}
                          {d.match_note && d.match_note !== ETA_STATE[es].label && <div className="text-xs text-muted-foreground mt-1">{d.match_note}</div>}
                        </TableCell>
                        <TableCell className="text-left font-mono whitespace-nowrap">{fmt(d.net_amount)}</TableCell>
                        <TableCell className="text-left font-mono whitespace-nowrap">{fmt(d.vat)}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${s.cls}`} title={d.status_reason ?? ""}>{s.label}</span>
                          {(d.cancel_requested || d.reject_requested) && d.status === "Valid" && <div className="text-xs text-warning mt-1">{d.cancel_requested ? "المورد طلب إلغاءها" : "مطلوب رفضها"}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="ghost" title="بنود الفاتورة" onClick={() => setDetailDoc(d)}><ListTree className="w-4 h-4" /></Button>
                            {d.public_url && <Button size="sm" variant="ghost" title="افتحها على البوابة" asChild><a href={d.public_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" /></a></Button>}
                            {canWrite && d.status === "Valid" && !d.match && d.match_mode !== "ignored" && (
                              <>
                                <Button size="sm" variant="ghost" title="اربطها بفاتورة شراء" onClick={() => setLinkDoc(d)}><Link2 className="w-4 h-4" /></Button>
                                <Button size="sm" variant="ghost" title="مش فاتورة شراء (مصروف)" onClick={() => setMatch(d, "ignore", undefined, "مش فاتورة شراء")}><EyeOff className="w-4 h-4" /></Button>
                              </>
                            )}
                            {canWrite && (d.match || d.match_mode === "ignored") && (
                              <Button size="sm" variant="ghost" title="فكّ الربط" onClick={() => setMatch(d, "clear")}><Unlink className="w-4 h-4" /></Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {!loading && shown.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3}>الإجمالي ({st.count} صحيحة، الإشعارات الدائنة بالسالب)</TableCell>
                      <TableCell className="text-left font-mono whitespace-nowrap">{fmt(st.total)}</TableCell>
                      <TableCell colSpan={2} />
                      <TableCell className="text-left font-mono whitespace-nowrap">{fmt(st.vat)}</TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="issuers" className="mt-3">
            <IssuersTab issuers={issuers} branchId={anyBranch} canWrite={canWrite} onChanged={load} />
          </TabsContent>
        </Tabs>

        <DetailDialog doc={detailDoc} canFetch={canWrite} onClose={() => setDetailDoc(null)} />
        <LinkDialog doc={linkDoc} onClose={() => setLinkDoc(null)} onLink={async (id, note) => { if (linkDoc && await setMatch(linkDoc, "link", id, note)) setLinkDoc(null); }} />
        <BackfillDialog open={backfillOpen} onClose={() => setBackfillOpen(false)} onDone={() => setTimeout(load, 60_000)} />
      </div>
    </AdminLayout>
  );
}

function IssuersTab({ issuers, branchId, canWrite, onChanged }: { issuers: EtaIssuer[]; branchId: string | null; canWrite: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState("");
  const [adding, setAdding] = useState("");
  const save = async (iss: EtaIssuer, ids: string[]) => {
    setBusy(iss.issuer_id);
    const { data, error } = await supabase.rpc("eta_link_issuer" as any, { p_issuer_id: iss.issuer_id, p_contacts: ids });
    setBusy("");
    if (error) { toast.error(rpcErrorText(error)); return; }
    const n = Number((data as any)?.matched ?? 0);
    toast.success(n > 0 ? `اتربط — ولقينا ${n} فاتورة شراء متطابقة` : "اتربط");
    setAdding("");
    onChanged();
  };
  return (
    <Card><CardContent className="p-0">
      <div className="p-3 text-sm text-muted-foreground leading-6">
        قولنا كل مورد على المنظومة هو أنهي حساب مورد عندنا (ممكن أكتر من حساب، مثلًا «شركة فريش (تكييف)» و«شركة فريش (بوتاجاز…)»،
        أو اسم مختلف خالص — زي «صادكو» اللي بتبعت فواتير «كريازي»). أول ما تربط، السيستم بيدوّر لوحده على فاتورة الشراء اللي بنفس المبلغ
        (فرق جنيه بالكتير) من 10 أيام قبل تاريخ الفاتورة لحد 30 يوم بعده.
      </div>
      <Table permTable="eta_issuers">
        <TableHeader>
          <TableRow>
            <TableHead>المورد على المنظومة</TableHead>
            <TableHead>الرقم الضريبي</TableHead>
            <TableHead className="text-left">عدد</TableHead>
            <TableHead className="text-left">الإجمالي</TableHead>
            <TableHead>متسجلة / فاضل</TableHead>
            <TableHead>مربوط بحساب</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {issuers.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">مفيش موردين لسه</TableCell></TableRow>}
          {issuers.map(i => {
            const ids = i.links.map(l => l.id);
            return (
              <TableRow key={i.issuer_id}>
                <TableCell className="font-medium">{i.issuer_name}</TableCell>
                <TableCell className="font-mono text-xs">{i.issuer_id}</TableCell>
                <TableCell className="text-left">{i.count}</TableCell>
                <TableCell className="text-left font-mono">{fmt(i.total)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="text-success">{i.matched}</span> / <span className={i.open ? "text-destructive" : ""}>{i.open}</span>
                  {i.ignored ? <span className="text-muted-foreground"> · {i.ignored} مش مشتريات</span> : null}
                </TableCell>
                <TableCell className="min-w-[300px] space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {i.links.map(l => (
                      <Badge key={l.id} variant="secondary" className="gap-1">{l.name}
                        {canWrite && <button disabled={!!busy} onClick={() => save(i, ids.filter(x => x !== l.id))} title="شيل الربط"><X className="w-3 h-3" /></button>}
                      </Badge>
                    ))}
                    {i.links.length === 0 && <span className="text-xs text-warning">مش مربوط</span>}
                  </div>
                  {canWrite && i.suggest.length > 0 && (
                    <div className="flex flex-wrap gap-1 items-center">
                      <span className="text-xs text-muted-foreground">اقتراح:</span>
                      {i.suggest.map(s => (
                        <Button key={s.id} size="sm" variant="outline" className="h-6 text-xs" disabled={!!busy} onClick={() => save(i, [...ids, s.id])}>
                          <Plus className="w-3 h-3 ml-1" />{s.name}
                        </Button>
                      ))}
                    </div>
                  )}
                  {canWrite && (adding === i.issuer_id ? (
                    <ContactLookup branchId={branchId} kind="supplier" value={null} placeholder="اختار حساب مورد…"
                      onChange={(id) => { if (id) save(i, [...ids, id]); }} />
                  ) : (
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setAdding(i.issuer_id)}><Link2 className="w-3 h-3 ml-1" />اربط بحساب مورد</Button>
                  ))}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function DetailDialog({ doc, canFetch, onClose }: { doc: EtaDoc | null; canFetch: boolean; onClose: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!doc) return;
    setDetail(null); setErr("");
    (async () => {
      setBusy(true);
      const { data, error } = await supabase.rpc("eta_document_detail" as any, { p_doc: doc.id });
      if (error) { setBusy(false); setErr(rpcErrorText(error)); return; }
      if ((data as any)?.detail) { setDetail((data as any).detail); setBusy(false); return; }
      if (!canFetch) { setBusy(false); setErr("البنود لسه ماتجابتش من المنظومة — المالك أو المدير يفتحها مرة وهتتحفظ"); return; }
      const r = await supabase.functions.invoke("eta-sync", { body: { mode: "detail", uuid: doc.eta_uuid } });
      setBusy(false);
      if (r.error || !(r.data as any)?.ok) { setErr((r.data as any)?.error ?? "مقدرناش نجيب البنود من المنظومة دلوقتي — جرّب تاني"); return; }
      setDetail((r.data as any).detail);
    })();
  }, [doc?.id]);
  const lines = etaLines(detail);
  const sum = (k: "net" | "vat" | "total" | "discount") => lines.reduce((s, l) => s + l[k], 0);
  return (
    <Dialog open={!!doc} onOpenChange={o => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-5xl">
        <DialogHeader><DialogTitle>{etaTypeLabel(doc?.type_name ?? null)} {doc?.internal_id} — {doc?.issuer_name} — {day(doc?.date_issued)}</DialogTitle></DialogHeader>
        {busy && <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /> بنجيب البنود من المنظومة…</div>}
        {err && <div className="text-destructive text-sm">{err}</div>}
        {!busy && detail && (
          <div className="max-h-[60vh] overflow-auto">
            <Table noFilter>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>الصنف</TableHead><TableHead>الكود</TableHead>
                  <TableHead className="text-left">الكمية</TableHead><TableHead className="text-left">سعر الوحدة</TableHead>
                  <TableHead className="text-left">الخصم</TableHead><TableHead className="text-left">الصافي</TableHead>
                  <TableHead className="text-left">الضريبة</TableHead><TableHead className="text-left">الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>{i + 1}</TableCell><TableCell>{l.description}</TableCell><TableCell className="font-mono text-xs">{l.code}</TableCell>
                    <TableCell className="text-left">{l.quantity}</TableCell><TableCell className="text-left font-mono">{fmt(l.price)}</TableCell>
                    <TableCell className="text-left font-mono">{fmt(l.discount)}</TableCell><TableCell className="text-left font-mono">{fmt(l.net)}</TableCell>
                    <TableCell className="text-left font-mono">{fmt(l.vat)}</TableCell><TableCell className="text-left font-mono">{fmt(l.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>الإجمالي ({lines.length} بند)</TableCell>
                  <TableCell className="text-left font-mono">{fmt(sum("discount"))}</TableCell>
                  <TableCell className="text-left font-mono">{fmt(sum("net"))}</TableCell>
                  <TableCell className="text-left font-mono">{fmt(sum("vat"))}</TableCell>
                  <TableCell className="text-left font-mono">{fmt(sum("total"))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
        <DialogFooter>
          {doc?.public_url && <Button variant="outline" asChild><a href={doc.public_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4 ml-2" />افتحها على البوابة</a></Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Cand = { shipment_id: string; number: string; branch: string; contact: string; date: string; total: number; diff: number; taken: boolean };
function LinkDialog({ doc, onClose, onLink }: { doc: EtaDoc | null; onClose: () => void; onLink: (shipment: string, note?: string) => void }) {
  const [rows, setRows] = useState<Cand[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { if (doc) { setSearch(""); setNote(""); } }, [doc?.id]);
  useEffect(() => {
    if (!doc) return;
    const h = setTimeout(async () => {
      setBusy(true);
      const { data, error } = await supabase.rpc("eta_shipment_candidates" as any, { p_doc: doc.id, p_search: search || null });
      setBusy(false);
      if (error) { toast.error(rpcErrorText(error)); return; }
      setRows((data as Cand[]) ?? []);
    }, 300);
    return () => clearTimeout(h);
  }, [doc?.id, search]);
  return (
    <Dialog open={!!doc} onOpenChange={o => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-4xl">
        <DialogHeader><DialogTitle>اربط {doc?.internal_id} ({fmt(doc?.total)}) بفاتورة شراء عندنا</DialogTitle></DialogHeader>
        <div className="text-sm text-muted-foreground leading-6">
          {doc?.linked ? "دي فواتير الشراء بتاعة الحسابات المربوطة بالمورد ده" : "المورد ده مش مربوط بحساب — دي فواتير الشراء من كل الموردين"} في الفترة ± 60 يوم، الأقرب في المبلغ الأول.
          الربط مش بيغيّر أي حاجة في فاتورة الشراء ولا في الحسابات.
        </div>
        <div className="grid md:grid-cols-2 gap-2">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث برقم فاتورة الشراء أو اسم المورد" />
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder="ملاحظة (اختياري) — مثلًا: اتسجلت مع فاتورة تانية" />
        </div>
        <div className="max-h-[50vh] overflow-auto">
          <Table noFilter>
            <TableHeader>
              <TableRow><TableHead>فاتورة الشراء</TableHead><TableHead>المورد</TableHead><TableHead>الفرع</TableHead><TableHead>التاريخ</TableHead><TableHead className="text-left">الإجمالي</TableHead><TableHead className="text-left">الفرق</TableHead><TableHead>ربط</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {busy && <TableRow><TableCell colSpan={7} className="text-center py-4"><Loader2 className="w-4 h-4 animate-spin inline" /></TableCell></TableRow>}
              {!busy && rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4">مفيش فواتير شراء قريبة — يمكن لسه ماتسجلتش</TableCell></TableRow>}
              {!busy && rows.map(r => (
                <TableRow key={r.shipment_id}>
                  <TableCell className="font-mono">{r.number}</TableCell><TableCell>{r.contact}</TableCell><TableCell>{r.branch}</TableCell>
                  <TableCell>{day(r.date)}</TableCell><TableCell className="text-left font-mono">{fmt(r.total)}</TableCell>
                  <TableCell className={`text-left font-mono ${Math.abs(r.diff) < 1 ? "text-success" : ""}`}>{fmt(r.diff)}</TableCell>
                  <TableCell>{r.taken ? <span className="text-xs text-muted-foreground">مربوطة بفاتورة تانية</span> : <Button size="sm" onClick={() => onLink(r.shipment_id, note)}>اربط</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BackfillDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState("2026-01-01");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("eta_backfill_from" as any, { p_from: from });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success("بدأنا نجيب الفواتير القديمة — كل ساعة بيجيب جزء لحد ما يخلص");
    onClose(); onDone();
  };
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>هات الفواتير الواردة من تاريخ أقدم</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm leading-6">
          <p>أول ربط بيجيب آخر 30 يوم بس. اختار من إمتى عاوز الفواتير، والسيستم هيجيبها على دفعات كل ساعة لحد ما يوصل للنهارده.</p>
          <p className="text-muted-foreground">الفواتير القديمة مش هيجيلك عنها إشعار — هتلاقيها في الصفحة بس، واللي ليها فاتورة شراء عندنا هتتربط لوحدها.</p>
          <div><Label>من تاريخ</Label><Input type="date" value={from} max={cairoTodayDay()} onChange={e => setFrom(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={run} disabled={busy || !from}>{busy && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}ابدأ</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
