// «الفواتير الإلكترونية الواردة» (migrations 0220–0222, owner 2026-11-15 «عاوزك تعمل صفحة للفواتير الالكترونية الواردة»):
// the documents other taxpayers issued TO this company on the ETA portal (read every hour by `eta-sync`), compared with our
// purchase invoices. Receive only — nothing is sent to the ETA, and nothing here writes a document, a till row or an entry:
// linking only says «this ETA invoice = that purchase invoice we already have».
//   tab «الفواتير»: every document + where it stands (متسجلة / مش متسجلة / المورد مش مربوط / مش فاتورة شراء), its lines
//                   (fetched once from the ETA, then kept), link / unlink / «مش فاتورة شراء».
//   PDF (owner 2026-11-27): tick invoices → ONE merged PDF or a ZIP with a file each, the portal's own printout; a row
//                   button downloads one (`useEtaPdfDownload`, eta-sync mode 'pdf').
//   tab «الموردين»: the ETA suppliers by tax id, linked to one or more of our supplier accounts (suggestions by name);
//                   linking runs the automatic pairing (amount ± 1 pound, our invoice 10 days before → 30 days after).
// Credentials live in settings → «الربط مع الفاتورة الإلكترونية» (EtaConnectionWizard).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import {
  EMPTY_ETA_FILTERS, ETA_STATE, ETA_TYPE, ETA_VIEW_LABEL, etaFilter, etaFilterCount, etaInView, etaState, etaTotals, etaTypeLabel,
  type EtaDoc, type EtaFilters, type EtaIssuer, type EtaView,
} from "@/lib/etaInvoices";
import { EMPTY_DOCUMENT_FILTERS, UnifiedDocumentFilters, type DocumentFilters } from "@/components/documents/UnifiedDocumentFilters";
import { cairoTodayDay } from "@/lib/cairoDate";
import { LinkDialog, STATUS, day, fmt } from "@/components/eta/EtaDocParts";
import { etaSyncView, manualWait, mmss, type EtaSyncSettings } from "@/lib/etaSyncStatus";
import { Checkbox } from "@/components/ui/checkbox";
import { EtaPdfBar, EtaPdfButton, useEtaPdfDownload } from "@/components/eta/EtaPdfDownload";



export default function EtaInvoices() {
  const { tenantId, branches } = useAuth();
  const [settings, setSettings] = useState<EtaSettings | null>(null);
  const [docs, setDocs] = useState<EtaDoc[]>([]);
  const [issuers, setIssuers] = useState<EtaIssuer[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stateFilter, setStateFilter] = useState<EtaView>("all");
  const tableRef = useRef<HTMLDivElement>(null);
  // the filter box (owner 2026-11-27 «بوكس السيرش زي السندات والبيع والشراء»): the date is read on the server, the rest here
  const [ef, setEf] = useState<EtaFilters>(EMPTY_ETA_FILTERS);
  const [tab, setTab] = useState("docs");
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [params] = useSearchParams();
  const wantedDoc = params.get("doc");
  const navigate = useNavigate();
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
  // an invoice opens on its own page (owner 2026-11-15 «تفتح في صفحة كاملة»); an old «?doc=» address goes there too
  const openDoc = (d: EtaDoc) => navigate(`/admin/eta-invoices/${d.id}`);
  useEffect(() => { if (wantedDoc) navigate(`/admin/eta-invoices/${encodeURIComponent(wantedDoc)}`, { replace: true }); }, [wantedDoc]);
  const wait = manualWait((settings as EtaSyncSettings | null)?.manual_ready_at, now);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), wait > 0 ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [wait > 0]);
  // a page left open picks up the hourly run by itself
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden && !syncing) load(); }, 10 * 60_000);
    return () => clearInterval(id);
  }, [tenantId, from, to, syncing]);

  const shown = useMemo(() => {
    return etaFilter(docs, ef).filter((d) => etaInView(d, stateFilter));
  }, [docs, stateFilter, ef]);
  // the box speaks DocumentFilters: issuer → partyId, type → categoryId, ETA status → payment
  const boxValue: DocumentFilters = { ...EMPTY_DOCUMENT_FILTERS, q: ef.q, from, to, amountMin: ef.amountMin, amountMax: ef.amountMax,
    status: stateFilter === "all" ? "" : stateFilter, partyId: ef.issuer, categoryId: ef.type, payment: ef.etaStatus };
  const applyBox = (f: DocumentFilters) => {
    setEf({ q: f.q, amountMin: f.amountMin, amountMax: f.amountMax, issuer: f.partyId, type: f.categoryId, etaStatus: f.payment });
    setFrom(f.from); setTo(f.to); setStateFilter((f.status || "all") as EtaView);
  };
  const resetBox = () => { setEf(EMPTY_ETA_FILTERS); setFrom(""); setTo(""); setStateFilter("all"); };
  const boxUsed = etaFilterCount(ef) > 0 || !!from || !!to || stateFilter !== "all";
  const etaStatuses = useMemo(() => Array.from(new Set(docs.map((d) => d.status).filter(Boolean) as string[])).sort(), [docs]);
  const t = useMemo(() => etaTotals(docs), [docs]);
  const st = useMemo(() => etaTotals(shown), [shown]);
  // picked invoices for the PDF download, in the table's order; a filter change keeps only what is still shown
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pickedDocs = useMemo(() => shown.filter((d) => picked.has(d.id)), [shown, picked]);
  const allPicked = shown.length > 0 && pickedDocs.length === shown.length;
  const togglePick = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const pdf = useEtaPdfDownload();

  // «اسحب دلوقتي»: eta_sync_now starts the pull (one per 2 min); we watch last_sync_at until the run writes it (≤ 2.5 min)
  const syncNow = async () => {
    const before = settings?.last_sync_at ?? null;
    const docsBefore = settings?.documents ?? 0;
    setSyncing(true);
    const { error } = await supabase.rpc("eta_sync_now" as any);
    if (error) { setSyncing(false); toast.error(rpcErrorText(error)); load(); return; }
    toast.message("بيسحب من المنظومة… بياخد من ثواني لدقيقتين");
    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      const { data } = await supabase.rpc("eta_settings_get" as any);
      const s2 = data as EtaSettings | null;
      if (s2 && s2.last_sync_at && s2.last_sync_at !== before) {
        setSyncing(false);
        await load();
        if (s2.last_error) toast.error("السحب ماكملش — شوف السبب فوق الجدول");
        else {
          const added = Math.max(0, (s2.documents ?? 0) - docsBefore);
          toast.success(added ? `اتسحب — ${added} فاتورة جديدة` : "اتسحب — مفيش فواتير جديدة");
        }
        return;
      }
      if (Date.now() - started > 150_000) {
        setSyncing(false);
        await load();
        toast.error("السحب أخد وقت أطول من العادي — هيظهر لوحده أول ما يخلص، أو جرّب تاني بعد دقيقتين");
        return;
      }
    }
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
  // a top card shows its invoices: the list switches to that card's rows and scrolls to them; a second click shows all again
  const filterBy = (s: EtaView) => {
    setTab("docs");
    setStateFilter(prev => (prev === s ? "all" : s));
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

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
              {settings?.is_owner && settings.enabled && <Button variant="outline" onClick={() => setBackfillOpen(true)}><History className="w-4 h-4 ml-2" />هات فواتير أقدم</Button>}
              {settings?.is_owner && <Button variant="outline" asChild><Link to="/admin/settings?tab=eta"><Settings2 className="w-4 h-4 ml-2" />إعدادات الربط</Link></Button>}
            </div>
          }
        />

        {settings && (() => {
          const v = etaSyncView(settings as EtaSyncSettings, now);
          const border = v.tone === "error" ? "border-destructive/50 bg-destructive/5" : v.tone === "warn" ? "border-warning/60 bg-warning/5" : v.tone === "off" ? "border-border bg-muted/30" : "border-border";
          return (
            <Card className={border}>
              <CardContent className="py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`inline-block w-2 h-2 rounded-full ${v.tone === "ok" ? "bg-success" : v.tone === "error" ? "bg-destructive" : v.tone === "warn" ? "bg-warning" : "bg-muted-foreground"}`} />
                    <span>آخر سحب من المنظومة: <b className="tabular-nums">{v.last}</b></span>
                    {v.next && <span className="text-muted-foreground">— السحب الجاي <b className="tabular-nums">{v.next}</b> (كل ساعة لوحده)</span>}
                    {syncing && <span className="text-primary">— بيسحب دلوقتي…</span>}
                  </div>
                  {settings.enabled && (
                    <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing || wait > 0}
                      title={wait > 0 ? "المنظومة بتقفل الطلبات الكتير ورا بعض — مرة كل دقيقتين" : "اسحب الفواتير الجديدة من المنظومة دلوقتي"}>
                      {syncing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <RefreshCw className="w-4 h-4 ml-2" />}
                      {syncing ? "بيسحب…" : wait > 0 ? `اسحب دلوقتي (استنى ${mmss(wait)})` : "اسحب دلوقتي"}
                    </Button>
                  )}
                </div>
                {v.problem && (
                  <div className={`text-sm rounded-md p-2 space-y-1 ${v.tone === "error" ? "bg-destructive/10" : "bg-muted/50"}`}>
                    <div><b>{v.tone === "error" ? "السحب فشل:" : v.tone === "off" ? "متوقف:" : "تنبيه:"}</b> {v.problem.reason}</div>
                    <div><b>تعمل إيه:</b> {v.problem.todo}</div>
                    {v.tone === "error" && settings.is_owner && /إعدادات الربط/.test(v.problem.todo) && (
                      <Button size="sm" variant="link" className="h-auto p-0" asChild><Link to="/admin/settings?tab=eta">افتح إعدادات الربط</Link></Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <MetricCardWithHint label="الفواتير الصحيحة" value={t.count} currency={false} icon={<FileText />}
            active={stateFilter === "valid"} onClick={() => filterBy("valid")}
            metricHint={{ meaning: "عدد الفواتير والإشعارات الصحيحة اللي وصلت باسم الشركة في الفترة.", source: "منظومة الفاتورة الإلكترونية.", formula: "عدد المستندات بحالة «صحيحة»" }} />
          <MetricCardWithHint label="الإجمالي شامل الضريبة" value={t.total} currency icon={<Receipt />}
            active={stateFilter === "valid"} onClick={() => filterBy("valid")} footer={<span>{t.count} فاتورة صحيحة</span>}
            metricHint={{ meaning: "قيمة الفواتير بالضريبة، والإشعارات الدائنة بتتطرح.", source: "منظومة الفاتورة الإلكترونية.", formula: "Σ الفواتير − Σ الإشعارات الدائنة (الصحيحة بس)" }} />
          <MetricCardWithHint label="ضريبة القيمة المضافة عليها" value={t.vat} currency icon={<Percent />}
            active={stateFilter === "valid"} onClick={() => filterBy("valid")} footer={<span>{t.count} فاتورة صحيحة</span>}
            metricHint={{ meaning: "الضريبة اللي الموردين حطوها على الفواتير دي (ضريبة مدخلات).", source: "منظومة الفاتورة الإلكترونية.", formula: "Σ (الإجمالي − الصافي) للفواتير − نفس الحساب للإشعارات الدائنة" }} />
          <MetricCardWithHint label="متسجلة عندنا" value={t.recorded.total} currency tone="success" icon={<FileCheck2 />}
            footer={<span>{t.recorded.count} فاتورة</span>} active={stateFilter === "recorded"} onClick={() => filterBy("recorded")}
            metricHint={{ meaning: "فواتير لقينا لها فاتورة شراء عندنا بنفس المبلغ.", source: "الربط بين المنظومة وفواتير الشراء.", formula: "مجموع الفواتير المربوطة بفاتورة شراء" }} />
          <MetricCardWithHint label="مش متسجلة عندنا" value={t.notRecorded.total} currency tone="destructive" icon={<FileWarning />}
            footer={<span>{t.notRecorded.count} فاتورة</span>} active={stateFilter === "not_recorded"} onClick={() => filterBy("not_recorded")}
            metricHint={{ meaning: "فواتير على المنظومة ملقيناش لها فاتورة شراء عندنا، أو المورد لسه مش مربوط بحساب عندنا.", source: "الربط بين المنظومة وفواتير الشراء.", formula: "الفواتير الصحيحة اللي مش مربوطة ومش متعلّمة «مش فاتورة شراء»" }} />
          <MetricCardWithHint label="موردين مش مربوطين" value={t.unlinkedSuppliers} currency={false} tone="warning" icon={<Users />}
            footer={<span>{t.unlinked.count} فاتورة بتاعتهم</span>}
            active={stateFilter === "unlinked"} onClick={() => filterBy("unlinked")}
            metricHint={{ meaning: "موردين على المنظومة لسه ماقلتلناش هما أنهي حساب عندنا.", source: "تبويب «الموردين».", formula: "عدد الأرقام الضريبية من غير حساب مورد مربوط" }} />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="docs">الفواتير ({docs.length})</TabsTrigger>
            <TabsTrigger value="issuers">الموردين ({issuers.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="docs" className="space-y-3 mt-3">
            <UnifiedDocumentFilters title="الفواتير الواردة" noun="فاتورة" shown={{ from: shown.length ? 1 : 0, to: shown.length, total: docs.length }}
              value={boxValue} onChange={applyBox} onReset={resetBox} hasAnyFilter={boxUsed} showAmount
              searchLabel="بحث (رقم الفاتورة، المورد، الرقم الضريبي، رقم فاتورة الشراء)" searchPlaceholder="أي كلمة بأي ترتيب…"
              statusOptions={[
                { value: "valid", label: ETA_VIEW_LABEL.valid }, { value: "not_recorded", label: ETA_VIEW_LABEL.not_recorded },
                ...(["missing", "unlinked", "recorded", "credit", "ignored", "void"] as const).map((k) => ({ value: k, label: ETA_STATE[k].label })),
              ]}
              extraFields={(draft, set) => (
                <>
                  <UnifiedDocumentFilters.Field label="المورد">
                    <UnifiedDocumentFilters.Select value={draft.partyId} onChange={(v) => set({ partyId: v })} ariaLabel="المورد"
                      options={issuers.map((i) => ({ value: i.issuer_id, label: `${i.issuer_name} (${i.count})` }))} />
                  </UnifiedDocumentFilters.Field>
                  <UnifiedDocumentFilters.Field label="النوع">
                    <UnifiedDocumentFilters.Select value={draft.categoryId} onChange={(v) => set({ categoryId: v })} ariaLabel="النوع"
                      options={Object.entries(ETA_TYPE).map(([value, label]) => ({ value, label }))} />
                  </UnifiedDocumentFilters.Field>
                  <UnifiedDocumentFilters.Field label="حالتها على المنظومة">
                    <UnifiedDocumentFilters.Select value={draft.payment} onChange={(v) => set({ payment: v })} ariaLabel="حالتها على المنظومة"
                      options={etaStatuses.map((v) => ({ value: v, label: STATUS[v]?.label ?? v }))} />
                  </UnifiedDocumentFilters.Field>
                </>
              )} />
            <div ref={tableRef} className="scroll-mt-4" />
            {stateFilter !== "all" && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <span>بتعرض: <b>{stateFilter === "valid" || stateFilter === "not_recorded" ? ETA_VIEW_LABEL[stateFilter] : ETA_STATE[stateFilter].label}</b> — {shown.length} فاتورة</span>
                <Button size="sm" variant="ghost" onClick={() => setStateFilter("all")}><X className="w-4 h-4 ml-1" />اعرض الكل</Button>
              </div>
            )}
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

            {pickedDocs.length > 0 && (
              <EtaPdfBar count={pickedDocs.length} lang={pdf.lang} setLang={pdf.setLang} busy={pdf.busy}
                onMerged={() => pdf.download(pickedDocs, "merged")} onZip={() => pdf.download(pickedDocs, "zip")} onClear={() => setPicked(new Set())} />
            )}
            <Card><CardContent className="p-0">
              <Table permTable="eta_docs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-center">
                      <Checkbox aria-label="حدد كل اللي معروض" data-testid="eta-pick-all" checked={allPicked}
                        onCheckedChange={(v) => setPicked(v ? new Set(shown.map((d) => d.id)) : new Set())} />
                    </TableHead>
                    <TableHead className="text-right whitespace-nowrap w-[150px]">الفاتورة</TableHead>
                    <TableHead className="text-right whitespace-nowrap min-w-[220px]">المورد</TableHead>
                    <TableHead className="text-center whitespace-nowrap w-[120px]">الإجمالي</TableHead>
                    <TableHead className="text-center whitespace-nowrap w-[120px]">قبل الضريبة</TableHead>
                    <TableHead className="text-center whitespace-nowrap w-[110px]">الضريبة</TableHead>
                    <TableHead className="text-center whitespace-nowrap min-w-[200px]">في السيستم</TableHead>
                    <TableHead className="text-center whitespace-nowrap w-[110px]">على المنظومة</TableHead>
                    <TableHead className="text-center whitespace-nowrap w-[100px]">التاريخ</TableHead>
                    <TableHead className="text-center whitespace-nowrap w-[150px]">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={10} className="text-center py-6"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
                  {!loading && shown.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">مفيش فواتير بالشروط دي</TableCell></TableRow>}
                  {!loading && shown.map(d => {
                    const s = STATUS[d.status ?? ""] ?? { label: d.status ?? "—", cls: "bg-muted" };
                    const es = etaState(d);
                    return (
                      <TableRow key={d.id} className={`cursor-pointer hover:bg-muted/40 ${d.seen_at ? "" : "bg-primary/5"}`}
                        title="اضغط لتفاصيل الفاتورة"
                        onClick={(e) => { if (!(e.target as HTMLElement).closest("button, a, input, [role=checkbox]")) openDoc(d); }}>
                        <TableCell className="text-center align-middle">
                          <Checkbox aria-label="حدد الفاتورة" data-testid={`eta-pick-${d.id}`} checked={picked.has(d.id)} onCheckedChange={(v) => togglePick(d.id, !!v)} />
                        </TableCell>
                        <TableCell className="text-right align-middle whitespace-nowrap">
                          <div className="font-mono text-sm font-semibold">{d.internal_id || "—"}</div>
                          <div className="text-xs text-muted-foreground">{etaTypeLabel(d.type_name)}{!d.seen_at && <Badge className="mr-2 px-1.5 py-0 text-[10px]">جديد</Badge>}</div>
                        </TableCell>
                        <TableCell className="text-right align-middle max-w-[320px]"><div className="truncate font-medium" title={d.issuer_name ?? ""}>{d.issuer_name || "—"}</div><div className="text-xs text-muted-foreground font-mono">{d.issuer_id}</div></TableCell>
                        <TableCell className="text-center align-middle font-mono tabular-nums font-semibold whitespace-nowrap">{fmt(d.total)}</TableCell>
                        <TableCell className="text-center align-middle font-mono tabular-nums whitespace-nowrap">{fmt(d.net_amount)}</TableCell>
                        <TableCell className="text-center align-middle font-mono tabular-nums whitespace-nowrap">{fmt(d.vat)}</TableCell>
                        <TableCell className="text-center align-middle">
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
                        <TableCell className="text-center align-middle">
                          <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${s.cls}`} title={d.status_reason ?? ""}>{s.label}</span>
                          {(d.cancel_requested || d.reject_requested) && d.status === "Valid" && <div className="text-xs text-warning mt-1">{d.cancel_requested ? "المورد طلب إلغاءها" : "مطلوب رفضها"}</div>}
                        </TableCell>
                        <TableCell className="text-center align-middle tabular-nums whitespace-nowrap">{day(d.date_issued)}</TableCell>
                        <TableCell className="text-center align-middle">
                          <div className="flex items-center justify-center gap-0.5">
                            <Button size="sm" variant="ghost" title="تفاصيل الفاتورة" onClick={() => openDoc(d)}><ListTree className="w-4 h-4" /></Button>
                            <EtaPdfButton busy={pdf.busy} onClick={() => pdf.download([d])} />
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
                      <TableCell colSpan={3} className="text-right">الإجمالي ({st.count} صحيحة، الإشعارات الدائنة بالسالب)</TableCell>
                      <TableCell className="text-center font-mono tabular-nums font-semibold whitespace-nowrap">{fmt(st.total)}</TableCell>
                      <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(st.net)}</TableCell>
                      <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(st.vat)}</TableCell>
                      <TableCell colSpan={4} />
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

        <LinkDialog doc={linkDoc} onClose={() => setLinkDoc(null)} onLink={async (id, note) => { if (linkDoc && await setMatch(linkDoc, "link", id, note)) setLinkDoc(null); }} />
        {pdf.dialog}
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
            <TableHead className="text-center whitespace-nowrap">عدد</TableHead>
            <TableHead className="text-center whitespace-nowrap">الإجمالي</TableHead>
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
                <TableCell className="text-center whitespace-nowrap">{i.count}</TableCell>
                <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(i.total)}</TableCell>
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
