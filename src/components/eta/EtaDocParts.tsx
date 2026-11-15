// Shared pieces of «الفواتير الإلكترونية الواردة»: the list page (EtaInvoices) and the invoice page (EtaInvoiceDetail,
// owner 2026-11-15 «تفتح في صفحة كاملة زي صفحة للتفاصيل»).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContactLookup } from "@/components/ContactLookup";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link2, Loader2, Plus, X } from "lucide-react";
import { rpcErrorText } from "@/lib/rpcError";
import { etaLines, type EtaDoc, type EtaIssuer } from "@/lib/etaInvoices";

export const fmt = (n: number | null | undefined) => Number(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const day = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-GB", { timeZone: "Africa/Cairo" }) : "—");

export const STATUS: Record<string, { label: string; cls: string }> = {
  Valid: { label: "صحيحة", cls: "bg-success/15 text-success" },
  Cancelled: { label: "ملغاة", cls: "bg-muted text-muted-foreground" },
  Rejected: { label: "مرفوضة", cls: "bg-destructive/15 text-destructive" },
};
export const statusOf = (s: string | null | undefined) => STATUS[s ?? ""] ?? { label: s ?? "—", cls: "bg-muted" };

/** The invoice lines: read once from the ETA (owner / admin), then kept in eta_documents.detail. */
export function EtaDocLines({ doc, canFetch }: { doc: EtaDoc; canFetch: boolean }) {
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
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
  }, [doc.id]);
  const lines = etaLines(detail);
  const sum = (k: "net" | "vat" | "total" | "discount") => lines.reduce((s, l) => s + l[k], 0);
  if (busy) return <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /> بنجيب البنود من المنظومة…</div>;
  if (err) return <div className="text-destructive text-sm p-3">{err}</div>;
  if (!detail) return null;
  return (
    <Table noFilter>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead><TableHead>الصنف</TableHead><TableHead>الكود</TableHead>
          <TableHead className="text-center whitespace-nowrap">الكمية</TableHead><TableHead className="text-center whitespace-nowrap">سعر الوحدة</TableHead>
          <TableHead className="text-center whitespace-nowrap">الخصم</TableHead><TableHead className="text-center whitespace-nowrap">الصافي</TableHead>
          <TableHead className="text-center whitespace-nowrap">الضريبة</TableHead><TableHead className="text-center whitespace-nowrap">الإجمالي</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l, i) => (
          <TableRow key={i}>
            <TableCell>{i + 1}</TableCell><TableCell>{l.description}</TableCell><TableCell className="font-mono text-xs">{l.code}</TableCell>
            <TableCell className="text-center whitespace-nowrap">{l.quantity}</TableCell><TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(l.price)}</TableCell>
            <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(l.discount)}</TableCell><TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(l.net)}</TableCell>
            <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(l.vat)}</TableCell><TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(l.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={5}>الإجمالي ({lines.length} بند)</TableCell>
          <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(sum("discount"))}</TableCell>
          <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(sum("net"))}</TableCell>
          <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(sum("vat"))}</TableCell>
          <TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(sum("total"))}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/** Link an ETA supplier (tax id) to our supplier accounts: suggestions by name + any account. Linking runs the automatic pairing. */
export function IssuerLinker({ issuer, branchId, onChanged }: { issuer: EtaIssuer; branchId: string | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const ids = issuer.links.map(l => l.id);
  const save = async (next: string[]) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("eta_link_issuer" as any, { p_issuer_id: issuer.issuer_id, p_contacts: next });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    const n = Number((data as any)?.matched ?? 0);
    toast.success(n > 0 ? `اتربط — ولقينا ${n} فاتورة شراء متطابقة` : "اتربط");
    setAdding(false);
    onChanged();
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 items-center">
        {issuer.links.map(l => (
          <Badge key={l.id} variant="secondary" className="gap-1">{l.name}
            <button disabled={busy} onClick={() => save(ids.filter(x => x !== l.id))} title="شيل الربط"><X className="w-3 h-3" /></button>
          </Badge>
        ))}
        {issuer.links.length === 0 && <span className="text-sm text-warning">المورد ده مش مربوط بحساب مورد عندنا.</span>}
      </div>
      {issuer.suggest.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs text-muted-foreground">اقتراح:</span>
          {issuer.suggest.map(s => (
            <Button key={s.id} size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => save([...ids, s.id])}>
              <Plus className="w-3 h-3 ml-1" />{s.name}
            </Button>
          ))}
        </div>
      )}
      {adding ? (
        <div className="max-w-md"><ContactLookup branchId={branchId} kind="supplier" value={null} placeholder="اختار حساب مورد…" onChange={(id) => { if (id) save([...ids, id]); }} /></div>
      ) : (
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(true)}><Link2 className="w-3 h-3 ml-1" />اربط بحساب مورد</Button>
      )}
    </div>
  );
}

type Cand = { shipment_id: string; number: string; branch: string; contact: string; date: string; total: number; diff: number; taken: boolean };
export function LinkDialog({ doc, onClose, onLink }: { doc: EtaDoc | null; onClose: () => void; onLink: (shipment: string, note?: string) => void }) {
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
              <TableRow><TableHead>فاتورة الشراء</TableHead><TableHead>المورد</TableHead><TableHead>الفرع</TableHead><TableHead>التاريخ</TableHead><TableHead className="text-center whitespace-nowrap">الإجمالي</TableHead><TableHead className="text-center whitespace-nowrap">الفرق</TableHead><TableHead>ربط</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {busy && <TableRow><TableCell colSpan={7} className="text-center py-4"><Loader2 className="w-4 h-4 animate-spin inline" /></TableCell></TableRow>}
              {!busy && rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4">مفيش فواتير شراء قريبة — يمكن لسه ماتسجلتش</TableCell></TableRow>}
              {!busy && rows.map(r => (
                <TableRow key={r.shipment_id}>
                  <TableCell className="font-mono">{r.number}</TableCell><TableCell>{r.contact}</TableCell><TableCell>{r.branch}</TableCell>
                  <TableCell>{day(r.date)}</TableCell><TableCell className="text-center font-mono tabular-nums whitespace-nowrap">{fmt(r.total)}</TableCell>
                  <TableCell className={`text-center font-mono tabular-nums whitespace-nowrap ${Math.abs(r.diff) < 1 ? "text-success" : ""}`}>{fmt(r.diff)}</TableCell>
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
