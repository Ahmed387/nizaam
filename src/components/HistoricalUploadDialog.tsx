import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Upload, Loader2, CheckCircle2, AlertCircle, Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readZip } from "@/lib/zipRead";
import {
  HISTORICAL_DOC_TYPES, matchKnownBranch, planCounts, planSahlFile, sha256Hex, uploadSahlPlan, withBranch, type SahlFilePlan,
} from "@/lib/historicalExcelImporter";
import { formatEGP } from "@/lib/format";
import { PermTable } from "@/components/PermTable";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}

type Row = SahlFilePlan & { state: "ready" | "duplicate" | "uploading" | "done" | "error"; note?: string };

/**
 * رفع ملفات «سهل» للأرشيف (0272): ملف أو كذا ملف أو zip مرة واحدة. النوع من الشيت، والفرع من اسم الملف
 * (تقدر تعدّله)، والفترة من تواريخ المستندات. الملف اللي اترفع قبل كده بيتخطى، ورفع فترة تاني بيستبدل القديم.
 */
export function HistoricalUploadDialog({ open, onOpenChange, onDone }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; pct: number } | null>(null);
  const [known, setKnown] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    supabase.rpc("historical_branches" as any).then(({ data }) => setKnown(((data as any[]) ?? []).map((r) => r.branch_name)));
  }, [open]);

  const reset = () => { setRows([]); setProgress(null); };

  const addFiles = async (files: FileList | File[]) => {
    setReading(true);
    const out: Row[] = [];
    try {
      const { data: done } = await supabase.from("historical_archive_files" as any).select("sha256");
      const seen = new Set(((done as any[]) ?? []).map((r) => r.sha256));
      const sources: { name: string; bytes: Uint8Array }[] = [];
      for (const f of Array.from(files)) {
        if (/\.zip$/i.test(f.name)) {
          for (const e of await readZip(f)) {
            if (/\.xlsx?$/i.test(e.name) && !e.name.startsWith("__MACOSX")) sources.push({ name: e.name.split("/").pop()!, bytes: await e.read() });
          }
        } else if (/\.xlsx?$/i.test(f.name)) {
          sources.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
        }
      }
      for (const src of sources) {
        try {
          const sha = await sha256Hex(src.bytes);
          if (rows.some((r) => r.sha256 === sha) || out.some((r) => r.sha256 === sha)) continue;
          const first = planSahlFile(src.name, src.bytes, sha);
          // same branch already in the archive under another spelling → its name
          const plan = first.branch && matchKnownBranch(first.branch, known) !== first.branch ? withBranch(first, matchKnownBranch(first.branch, known)) : first;
          const c = planCounts(plan);
          out.push({
            ...plan,
            state: seen.has(sha) ? "duplicate" : plan.kind && c.docs ? "ready" : "error",
            note: seen.has(sha) ? "الملف ده اترفع قبل كده — مش هيتكرر"
              : !plan.kind ? "مش ملف فواتير / سندات من «سهل»" : !c.docs ? "مفيش مستندات في الملف" : undefined,
          });
        } catch (e: any) {
          out.push({ fileName: src.name, sha256: "", kind: null, branch: "", dateFrom: null, dateTo: null,
            parsed: { invoices: [], vouchers: [], skipped: 0 }, state: "error", note: `مقدرتش أقرا الملف: ${e.message}` });
        }
      }
      if (!sources.length) toast.error("اختار ملفات إكسيل (.xlsx) أو ملف zip فيه ملفات «سهل»");
    } finally {
      setRows((prev) => [...prev, ...out]);
      setReading(false);
    }
  };

  const setBranch = (i: number, b: string) => setRows((p) => p.map((r, j) => (j === i ? { ...withBranch(r, b), state: r.state, note: r.note } : r)));

  const doUpload = async () => {
    const ready = rows.map((r, i) => ({ r, i })).filter((x) => x.r.state === "ready");
    if (ready.some((x) => !x.r.branch.trim())) return toast.error("اكتب اسم الفرع لكل ملف");
    setBusy(true);
    let ok = 0, rep = 0;
    for (const { r, i } of ready) {
      setRows((p) => p.map((x, j) => (j === i ? { ...x, state: "uploading" } : x)));
      try {
        const res = await uploadSahlPlan(r, (p) => setProgress({ phase: `${r.fileName} — ${p.phase}`, pct: p.total ? Math.round((p.done / p.total) * 100) : 100 }));
        const state: Row["state"] = res.status === "duplicate" ? "duplicate" : res.errors.length ? "error" : "done";
        if (state === "done") { ok++; rep += res.replaced; }
        setRows((p) => p.map((x, j) => (j === i ? { ...x, state,
          note: res.status === "duplicate" ? "اترفع قبل كده" : res.errors.length ? res.errors.slice(0, 2).join(" / ")
            : `اتحفظ: ${res.invoices + res.vouchers} مستند${res.items ? ` و ${res.items} صنف` : ""}${res.replaced ? ` — استبدل ${res.replaced} من رفعة قديمة لنفس الفترة` : ""}` } : x)));
      } catch (e: any) {
        setRows((p) => p.map((x, j) => (j === i ? { ...x, state: "error", note: e.message } : x)));
      }
    }
    setBusy(false);
    setProgress(null);
    if (ok) toast.success(`اترفع ${ok} ملف${rep ? ` (استبدل ${rep} مستند قديم لنفس الفترات)` : ""}`);
    onDone();
  };

  const readyCount = rows.filter((r) => r.state === "ready").length;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>رفع ملفات «سهل» للأرشيف</DialogTitle>
          <DialogDescription>
            ارفع ملف أو كذا ملف أو ملف zip. السيستم بيعرف نوع كل ملف من الشيت، والفرع من اسم الملف (تقدر تعدّله)، والفترة من التواريخ.
            الملف اللي اترفع قبل كده بيتخطى، ورفع نفس الفرع والنوع والفترة تاني بيستبدل القديم. الأرشيف بره السيستم ومش بيأثر على الخزنة ولا الحسابات ولا المخزون.
          </DialogDescription>
        </DialogHeader>

        <label className="cursor-pointer block">
          <div className="border-2 border-dashed rounded-xl p-6 text-center hover:bg-muted/40 transition">
            {reading ? <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" /> : <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />}
            <div className="text-sm font-medium">{reading ? "بيقرا الملفات…" : "اضغط لاختيار ملفات «سهل» أو zip"}</div>
            <div className="text-xs text-muted-foreground mt-1">.xlsx / .zip — تقدر تختار كذا ملف مرة واحدة</div>
          </div>
          <input type="file" accept=".xlsx,.xls,.zip" multiple className="hidden" data-testid="hist-files"
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
        </label>

        <datalist id="hist-branch-names">{known.map((b) => <option key={b} value={b} />)}</datalist>
        {rows.length > 0 && (
          <div className="overflow-x-auto" data-testid="hist-plan">
            <PermTable noFilter className="w-full text-xs">
              <thead><tr className="text-muted-foreground">
                <th className="p-1.5 text-right">الملف</th><th className="p-1.5">النوع</th><th className="p-1.5">الفرع</th>
                <th className="p-1.5">الفترة</th><th className="p-1.5">مستندات</th><th className="p-1.5">الإجمالي</th><th className="p-1.5 text-right">الحالة</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const c = planCounts(r);
                  return (
                    <tr key={`${r.sha256}-${i}`} className="border-t border-border/60">
                      <td className="p-1.5 max-w-[220px] truncate" title={r.fileName}>{r.fileName}</td>
                      <td className="p-1.5 text-center whitespace-nowrap">{r.kind ? HISTORICAL_DOC_TYPES[r.kind] : "—"}</td>
                      <td className="p-1.5 min-w-[170px]">
                        <Input list="hist-branch-names" value={r.branch} disabled={r.state !== "ready" || busy} onChange={(e) => setBranch(i, e.target.value)} className="h-7 text-xs" />
                      </td>
                      <td className="p-1.5 text-center tabular-nums whitespace-nowrap">{r.dateFrom ? `${r.dateFrom} ← ${r.dateTo}` : "—"}</td>
                      <td className="p-1.5 text-center tabular-nums">{c.docs}{c.items ? ` / ${c.items} صنف` : ""}</td>
                      <td className="p-1.5 text-center tabular-nums">{formatEGP(c.total)}</td>
                      <td className="p-1.5">
                        <span className={`inline-flex items-center gap-1 ${r.state === "done" ? "text-emerald-600" : r.state === "error" ? "text-destructive" : r.state === "duplicate" ? "text-muted-foreground" : ""}`}>
                          {r.state === "done" && <CheckCircle2 className="w-3 h-3" />}
                          {r.state === "error" && <AlertCircle className="w-3 h-3" />}
                          {r.state === "duplicate" && <Copy className="w-3 h-3" />}
                          {r.state === "uploading" && <Loader2 className="w-3 h-3 animate-spin" />}
                          {r.note ?? (r.state === "ready" ? "جاهز للرفع" : r.state === "uploading" ? "بيرفع…" : "")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </PermTable>
          </div>
        )}

        {progress && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">{progress.phase} — {progress.pct}%</div>
            <Progress value={progress.pct} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
          <Button onClick={doUpload} disabled={busy || !readyCount} data-testid="hist-upload">
            {busy ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Upload className="w-4 h-4 ml-1" />}
            رفع {readyCount} ملف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
