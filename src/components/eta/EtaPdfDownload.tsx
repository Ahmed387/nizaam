import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cairoTodayDay } from "@/lib/cairoDate";
import {
  downloadBytes, etaBundleName, etaPdfName, fetchEtaPdfs, mergePdfs, savedEtaPdfLang, saveEtaPdfLang, zipPdfs,
  type EtaPdfDoc, type EtaPdfLang, type EtaPdfResult,
} from "@/lib/etaPdf";
import { Download, FileStack, FolderArchive, Loader2, X } from "lucide-react";
import { toast } from "sonner";

export type EtaPdfKind = "merged" | "zip";
type Run = { total: number; done: number; phase: "fetch" | "build" | "end"; failed: EtaPdfResult[]; saved: number; file: string | null };

/**
 * The portal's own e-invoice PDF (eta-sync mode 'pdf'): one invoice, or the picked ones as ONE merged PDF or a ZIP with
 * a file each. A progress dialog shows «5 من 12», can stop, and lists the invoices the portal did not give.
 */
export function useEtaPdfDownload() {
  const [lang, setLangState] = useState<EtaPdfLang>(savedEtaPdfLang);
  const [run, setRun] = useState<Run | null>(null);
  const signal = useRef({ cancelled: false });
  const busy = !!run && run.phase !== "end";
  const setLang = (l: EtaPdfLang) => { setLangState(l); saveEtaPdfLang(l); };

  async function download(docs: EtaPdfDoc[], kind: EtaPdfKind = "merged") {
    if (!docs.length || busy) return;
    signal.current = { cancelled: false };
    setRun({ total: docs.length, done: 0, phase: "fetch", failed: [], saved: 0, file: null });
    try {
      const res = await fetchEtaPdfs(docs, lang, (done, total) => setRun((r) => r && { ...r, done, total }), signal.current);
      const ok = res.filter((r): r is EtaPdfResult & { bytes: Uint8Array } => !!r.bytes);
      const failed = res.filter((r) => !r.bytes && r.error !== "اتلغى");
      setRun((r) => r && { ...r, phase: "build", failed });
      let file: string | null = null;
      if (ok.length === 1) {
        file = etaPdfName(ok[0].doc);
        downloadBytes(ok[0].bytes, file, "application/pdf");
      } else if (ok.length > 1 && kind === "merged") {
        file = etaBundleName(ok.length, cairoTodayDay(), "pdf");
        downloadBytes(await mergePdfs(ok.map((r) => r.bytes)), file, "application/pdf");
      } else if (ok.length > 1) {
        file = etaBundleName(ok.length, cairoTodayDay(), "zip");
        downloadBytes(zipPdfs(ok), file, "application/zip");
      }
      setRun((r) => r && { ...r, phase: "end", saved: ok.length, file });
      // one invoice that came fine needs no dialog left open
      if (docs.length === 1 && ok.length === 1) { setRun(null); toast.success(`اتحمّلت الفاتورة ${ok[0].doc.internal_id || ""}`.trim()); }
    } catch (e: any) {
      setRun(null);
      toast.error(`مقدرناش نعمل الملف: ${e?.message ?? e}`);
    }
  }

  const dialog = (
    <Dialog open={!!run} onOpenChange={(o) => { if (!o && !busy) setRun(null); }}>
      <DialogContent className="max-w-md" data-testid="eta-pdf-progress">
        <DialogHeader><DialogTitle>تحميل الفواتير من منظومة الضرايب</DialogTitle></DialogHeader>
        {run && (
          <div className="space-y-3 text-sm">
            {run.phase === "fetch" && (
              <>
                <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />
                  بنجيب ملف كل فاتورة من المنظومة: <b className="tabular-nums" data-testid="eta-pdf-count">{run.done} من {run.total}</b></div>
                <Progress value={run.total ? (run.done / run.total) * 100 : 0} />
                <p className="text-xs text-muted-foreground">المنظومة بتدّي فاتورة كل ثانية تقريباً — سيب الصفحة مفتوحة.</p>
              </>
            )}
            {run.phase === "build" && <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />بنجهّز الملف…</div>}
            {run.phase === "end" && (
              <div data-testid="eta-pdf-result" className="space-y-2">
                {run.saved > 0
                  ? <div className="rounded-md border border-success/40 bg-success/10 p-2.5">
                      اتحمّل <b>{run.saved}</b> فاتورة {run.file?.endsWith(".zip") ? "— ملف مضغوط (ZIP) جواه ملف لكل فاتورة" : run.saved > 1 ? "— في ملف PDF واحد" : ""}.
                      <div className="text-xs text-muted-foreground mt-1">هتلاقيه في التنزيلات.</div>
                    </div>
                  : <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5">مفيش ولا فاتورة اتحمّلت.</div>}
                {run.failed.length > 0 && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5">
                    <div className="font-semibold mb-1">{run.failed.length} فاتورة المنظومة مدّتهاش:</div>
                    <ul className="max-h-40 overflow-y-auto space-y-1 text-xs">
                      {run.failed.map((f) => <li key={f.doc.id}><b>{f.doc.internal_id || f.doc.eta_uuid}</b> — {f.doc.issuer_name}: {f.error}</li>)}
                    </ul>
                    <div className="text-xs text-muted-foreground mt-1">حدّدهم تاني وجرّب بعد دقيقة.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {busy
            ? <Button variant="outline" onClick={() => { signal.current.cancelled = true; }} disabled={run?.phase !== "fetch"} data-testid="eta-pdf-stop"><X className="w-4 h-4 ml-1" />وقّف</Button>
            : <Button onClick={() => setRun(null)} data-testid="eta-pdf-close">تمام</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { download, busy, lang, setLang, dialog };
}

/** The bar over the table while invoices are picked. */
export function EtaPdfBar({ count, lang, setLang, busy, onMerged, onZip, onClear }: {
  count: number; lang: EtaPdfLang; setLang: (l: EtaPdfLang) => void; busy: boolean; onMerged: () => void; onZip: () => void; onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm" data-testid="eta-pdf-bar">
      <span>اتحدد <b className="tabular-nums">{count}</b> فاتورة</span>
      <span className="text-muted-foreground">— نفس الـ PDF اللي على المنظومة</span>
      <div className="flex-1" />
      <Select value={lang} onValueChange={(v) => setLang(v as EtaPdfLang)}>
        <SelectTrigger className="h-8 w-28" data-testid="eta-pdf-lang"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="ar">عربي</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
      </Select>
      <Button size="sm" onClick={onMerged} disabled={busy} data-testid="eta-pdf-merged"><FileStack className="w-4 h-4 ml-1" />PDF واحد مجمّع</Button>
      <Button size="sm" variant="outline" onClick={onZip} disabled={busy || count < 2} data-testid="eta-pdf-zip"
        title={count < 2 ? "حدد فاتورتين أو أكتر" : "كل فاتورة ملف لوحدها جوه ملف مضغوط واحد"}><FolderArchive className="w-4 h-4 ml-1" />كل فاتورة ملف (ZIP)</Button>
      <Button size="sm" variant="ghost" onClick={onClear} data-testid="eta-pdf-clear"><X className="w-4 h-4 ml-1" />إلغاء التحديد</Button>
    </div>
  );
}

export function EtaPdfButton({ onClick, busy, label }: { onClick: () => void; busy: boolean; label?: string }) {
  return label
    ? <Button variant="outline" onClick={onClick} disabled={busy} data-testid="eta-pdf-one"><Download className="w-4 h-4 ml-1" />{label}</Button>
    : <Button size="sm" variant="ghost" title="حمّل الـ PDF من المنظومة" onClick={onClick} disabled={busy} data-testid="eta-pdf-row"><Download className="w-4 h-4" /></Button>;
}
