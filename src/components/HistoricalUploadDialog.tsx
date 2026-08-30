import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  HISTORICAL_BRANCHES, HISTORICAL_DOC_TYPES, HistoricalBranch, HistoricalFileType,
  ImportResult, ParsedHistorical, parseHistoricalFile, uploadHistorical,
} from "@/lib/historicalExcelImporter";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}

export function HistoricalUploadDialog({ open, onOpenChange, onDone }: Props) {
  const [branch, setBranch] = useState<HistoricalBranch>(HISTORICAL_BRANCHES[0]);
  const [fileType, setFileType] = useState<HistoricalFileType>("sales");
  const [parsed, setParsed] = useState<ParsedHistorical | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; pct: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => { setParsed(null); setResult(null); setProgress(null); setFileName(""); };

  const onFile = async (file: File) => {
    setResult(null);
    setFileName(file.name);
    try {
      const p = await parseHistoricalFile(file, branch, fileType);
      setParsed(p);
      if (!p.invoices.length && !p.vouchers.length) toast.error("مالقيتش صفوف صالحة في الملف — راجع الأعمدة والتواريخ");
    } catch (e: any) {
      toast.error("فشلت قراءة الملف: " + e.message);
    }
  };

  const doUpload = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const res = await uploadHistorical(parsed, (p) =>
        setProgress({ phase: p.phase, pct: p.total ? Math.round((p.done / p.total) * 100) : 100 }),
      );
      setResult(res);
      if (res.errors.length) toast.warning(`تم الرفع مع ${res.errors.length} خطأ`);
      else toast.success("تم رفع البيانات التاريخية بنجاح");
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? "فشل الرفع");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const itemsCount = parsed?.invoices.reduce((s, i) => s + i.items.length, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>رفع بيانات تاريخية</DialogTitle>
          <DialogDescription>
            اختار الفرع ونوع الملف، وارفع ملف الإكسيل الشجري. إعادة رفع نفس الملف مش هتكرر البيانات.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">الفرع</label>
            <Select value={branch} onValueChange={(v) => { setBranch(v as HistoricalBranch); reset(); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {HISTORICAL_BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">نوع الملف</label>
            <Select value={fileType} onValueChange={(v) => { setFileType(v as HistoricalFileType); reset(); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(HISTORICAL_DOC_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <label className="cursor-pointer block">
          <div className="border-2 border-dashed rounded-xl p-6 text-center hover:bg-muted/40 transition">
            <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
            <div className="text-sm font-medium">{fileName || "اضغط لاختيار ملف Excel"}</div>
            <div className="text-xs text-muted-foreground mt-1">.xlsx / .xls</div>
          </div>
          <input type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>

        {parsed && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <div className="text-xs text-emerald-600 dark:text-emerald-400">فواتير</div>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{parsed.invoices.length}</div>
            </div>
            <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
              <div className="text-xs text-sky-600 dark:text-sky-400">أصناف / سندات</div>
              <div className="text-xl font-bold text-sky-600 dark:text-sky-400">{itemsCount || parsed.vouchers.length}</div>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="text-xs text-amber-600 dark:text-amber-400">صفوف متجاهلة</div>
              <div className="text-xl font-bold text-amber-600 dark:text-amber-400">{parsed.skipped}</div>
            </div>
          </div>
        )}

        {progress && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">{progress.phase} — {progress.pct}%</div>
            <Progress value={progress.pct} />
          </div>
        )}

        {result && (
          <div className="p-3 rounded-lg bg-emerald-500/10 text-sm space-y-1">
            <div className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" /> تم الحفظ
            </div>
            <div>فواتير: {result.invoices} — أصناف: {result.items} — سندات: {result.vouchers}</div>
            {result.errors.length > 0 && (
              <div className="text-destructive flex items-start gap-1 text-xs">
                <AlertCircle className="w-3 h-3 mt-0.5" /> {result.errors.slice(0, 3).join(" / ")}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
          <Button onClick={doUpload} disabled={busy || !parsed || (!parsed.invoices.length && !parsed.vouchers.length)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Upload className="w-4 h-4 ml-1" />}
            رفع وحفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
