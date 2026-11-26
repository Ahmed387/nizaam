// One received e-invoice on its own page (owner 2026-11-15 «لما بضغط علي اشعار … عاوز تفتح في صفحة كاملة زي صفحة للتفاصيل»):
// /admin/eta-invoices/:id — opened from the notification and from a row of the list. Summary, where it stands in the system with
// its actions (link the supplier, link a purchase, «مش فاتورة شراء», unlink) and the lines. Opening a new one marks it seen.
// Nothing here writes a document, a till row or an entry.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ArrowRight, EyeOff, ExternalLink, Link2, Loader2, Unlink } from "lucide-react";
import { rpcErrorText } from "@/lib/rpcError";
import { ETA_STATE, etaState, etaTypeLabel, type EtaDoc, type EtaIssuer } from "@/lib/etaInvoices";
import { EtaDocLines, IssuerLinker, LinkDialog, day, fmt, statusOf } from "@/components/eta/EtaDocParts";
import { EtaPdfButton, useEtaPdfDownload } from "@/components/eta/EtaPdfDownload";

function Item({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="font-medium truncate">{children}</div>
    </div>
  );
}

export default function EtaInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { branches } = useAuth();
  const [doc, setDoc] = useState<EtaDoc | null>(null);
  const [issuer, setIssuer] = useState<EtaIssuer | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const pdf = useEtaPdfDownload();

  const load = async () => {
    if (!id) return;
    const [s, d, i] = await Promise.all([
      supabase.rpc("eta_settings_get" as any),
      supabase.rpc("eta_documents_list" as any, { p_from: null, p_to: null }),
      supabase.rpc("eta_issuers" as any),
    ]);
    setLoading(false);
    setCanWrite(!s.error);
    if (d.error) { setMissing(rpcErrorText(d.error)); return; }
    const found = ((d.data as EtaDoc[]) ?? []).find(x => x.id === id) ?? null;
    if (!found) { setMissing("الفاتورة دي مش موجودة في الفواتير الواردة"); return; }
    setDoc(found);
    setIssuer(((i.data as EtaIssuer[]) ?? []).find(x => x.issuer_id === found.issuer_id) ?? null);
    if (!found.seen_at && !s.error) supabase.rpc("eta_mark_seen" as any, { p_ids: [found.id] }).then(() => {});
  };
  useEffect(() => { setLoading(true); setMissing(""); setDoc(null); load(); }, [id]);

  const setMatch = async (action: "link" | "ignore" | "clear", shipment?: string, note?: string) => {
    if (!doc) return false;
    const { error } = await supabase.rpc("eta_set_match" as any, { p_doc: doc.id, p_action: action, p_shipment: shipment ?? null, p_note: note ?? null });
    if (error) { toast.error(rpcErrorText(error)); return false; }
    toast.success(action === "link" ? "اتربطت بفاتورة الشراء" : action === "ignore" ? "اتعلّمت إنها مش فاتورة شراء" : "اتفكّ الربط");
    load();
    return true;
  };

  const back = (
    <Button variant="outline" asChild><Link to="/admin/eta-invoices"><ArrowRight className="w-4 h-4 ml-2" />كل الفواتير الواردة</Link></Button>
  );

  if (loading || !doc) {
    return (
      <AdminLayout>
        <div dir="rtl" className="text-right space-y-5">
          <PageHeader title="فاتورة إلكترونية واردة" actions={back} />
          <Card><CardContent className="py-10 text-center">
            {loading ? <><Loader2 className="w-5 h-5 animate-spin inline" /> بنحمّل الفاتورة…</> : <span className="text-muted-foreground">{missing}</span>}
          </CardContent></Card>
        </div>
      </AdminLayout>
    );
  }

  const es = etaState(doc);
  const st = statusOf(doc.status);
  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-5">
        <PageHeader
          title={`${etaTypeLabel(doc.type_name)} رقم ${doc.internal_id || "—"}`}
          subtitle={`${doc.issuer_name || "—"} — ${day(doc.date_issued)}`}
          actions={
            <div className="flex flex-wrap gap-2">
              {back}
              <EtaPdfButton busy={pdf.busy} onClick={() => pdf.download([doc])} label="حمّل الـ PDF من المنظومة" />
              {doc.public_url && <Button variant="outline" asChild><a href={doc.public_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4 ml-2" />افتحها على البوابة</a></Button>}
            </div>
          }
        />

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">بيانات الفاتورة</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <Item k="المورد"><span title={doc.issuer_name ?? ""}>{doc.issuer_name || "—"}</span></Item>
              <Item k="الرقم الضريبي"><span className="font-mono">{doc.issuer_id || "—"}</span></Item>
              <Item k="تاريخ الفاتورة"><span className="tabular-nums">{day(doc.date_issued)}</span></Item>
              <Item k="وصلت المنظومة"><span className="tabular-nums">{day(doc.date_received)}</span></Item>
              <Item k="قبل الضريبة"><span className="font-mono tabular-nums">{fmt(doc.net_amount)}</span></Item>
              <Item k="الضريبة"><span className="font-mono tabular-nums">{fmt(doc.vat)}</span></Item>
              <Item k="الإجمالي"><span className="font-mono tabular-nums font-bold text-base">{fmt(doc.total)}</span></Item>
              <Item k="على المنظومة">
                <span className={`px-2 py-0.5 rounded text-xs ${st.cls}`} title={doc.status_reason ?? ""}>{st.label}</span>
                {(doc.cancel_requested || doc.reject_requested) && doc.status === "Valid" && <span className="text-xs text-warning mr-2">{doc.cancel_requested ? "المورد طلب إلغاءها" : "مطلوب رفضها"}</span>}
              </Item>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">في السيستم</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs ${ETA_STATE[es].tone}`}>{ETA_STATE[es].label}</span>
              {doc.match && (
                <span>
                  فاتورة الشراء <Link className="underline font-mono" to={`/branch/${doc.match.branch_id}/shipments/${doc.match.shipment_id}`}>{doc.match.number}</Link>
                  {" "}— {doc.match.branch} — {day(doc.match.date)} — {fmt(doc.match.total)}
                  {Math.abs(doc.match.diff) >= 0.01 && <span className="text-muted-foreground"> (فرق {fmt(doc.match.diff)})</span>}
                  {doc.match_mode === "auto" && <span className="text-muted-foreground"> · اتربطت لوحدها</span>}
                </span>
              )}
              {doc.match_note && doc.match_note !== ETA_STATE[es].label && <span className="text-muted-foreground">{doc.match_note}</span>}
            </div>

            {canWrite && (
              <div className="flex flex-wrap gap-2">
                {doc.status === "Valid" && !doc.match && doc.match_mode !== "ignored" && (
                  <>
                    <Button size="sm" onClick={() => setLinkOpen(true)}><Link2 className="w-4 h-4 ml-2" />اربطها بفاتورة شراء</Button>
                    <Button size="sm" variant="outline" onClick={() => setMatch("ignore", undefined, "مش فاتورة شراء")}><EyeOff className="w-4 h-4 ml-2" />مش فاتورة شراء (مصروف)</Button>
                  </>
                )}
                {(doc.match || doc.match_mode === "ignored") && (
                  <Button size="sm" variant="outline" onClick={() => setMatch("clear")}><Unlink className="w-4 h-4 ml-2" />فكّ الربط</Button>
                )}
              </div>
            )}

            {canWrite && issuer && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="font-medium">المورد ده عندنا</div>
                <div className="text-xs text-muted-foreground">
                  اربط المورد بحساب المورد عندنا مرة واحدة، والسيستم هيدوّر لوحده على فاتورة الشراء اللي بنفس المبلغ — للفاتورة دي ولكل فواتيره الجاية.
                </div>
                <IssuerLinker issuer={issuer} branchId={branches[0]?.id ?? null} onChanged={load} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">بنود الفاتورة</CardTitle></CardHeader>
          <CardContent className="p-0 sm:p-2">
            <EtaDocLines doc={doc} canFetch={canWrite} />
          </CardContent>
        </Card>

        <LinkDialog doc={linkOpen ? doc : null} onClose={() => setLinkOpen(false)}
          onLink={async (shipment, note) => { if (await setMatch("link", shipment, note)) setLinkOpen(false); }} />
      </div>
      {pdf.dialog}
    </AdminLayout>
  );
}
