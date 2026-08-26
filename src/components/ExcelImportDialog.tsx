import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ImportColumn, ParsedRow, downloadTemplate, parseExcelFile } from "@/lib/excelImport";
import { Download, Upload, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  templateName: string;
  columns: ImportColumn[];
  sampleRow?: Record<string, any>;
  onImport: (validRows: any[]) => Promise<{ inserted: number; failed?: { index: number; error: string }[] }>;
}

export function ExcelImportDialog({ open, onOpenChange, title, templateName, columns, sampleRow, onImport }: Props) {
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; failed?: any[] } | null>(null);

  const reset = () => { setParsed([]); setResult(null); };

  const onFile = async (file: File) => {
    try {
      const rows = await parseExcelFile(file, columns);
      setParsed(rows);
      setResult(null);
    } catch (e: any) {
      toast.error("فشلت قراءة الملف: " + e.message);
    }
  };

  const valid = parsed.filter((r) => r.errors.length === 0);
  const invalid = parsed.filter((r) => r.errors.length > 0);

  const doImport = async () => {
    if (!valid.length) return toast.error("لا يوجد صفوف صالحة");
    setBusy(true);
    try {
      const res = await onImport(valid.map((r) => r.data));
      setResult(res);
      toast.success(`تم استيراد ${res.inserted} صف`);
    } catch (e: any) {
      toast.error(e.message ?? "فشل الاستيراد");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>حمّل القالب، ضع البيانات فيه، ثم ارفعه. الصفوف اللي فيها أخطاء هتتجاهل.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => downloadTemplate(templateName, columns, sampleRow)}>
            <Download className="w-4 h-4 ml-1" /> تحميل القالب
          </Button>
          <label className="cursor-pointer">
            <Button asChild variant="default">
              <span><Upload className="w-4 h-4 ml-1" /> رفع ملف Excel</span>
            </Button>
            <input type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>

        {parsed.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="p-3 rounded border bg-card text-center">
                <div className="text-xs text-muted-foreground">إجمالي الصفوف</div>
                <div className="text-xl font-bold">{parsed.length}</div>
              </div>
              <div className="p-3 rounded border bg-success/10 text-center">
                <div className="text-xs text-success">صحيح</div>
                <div className="text-xl font-bold text-success">{valid.length}</div>
              </div>
              <div className="p-3 rounded border bg-destructive/10 text-center">
                <div className="text-xs text-destructive">به أخطاء</div>
                <div className="text-xl font-bold text-destructive">{invalid.length}</div>
              </div>
            </div>

            <div className="border rounded overflow-hidden">
              <div className="px-3 py-2 bg-muted text-sm font-semibold">معاينة (أول 5 صفوف صالحة)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>{columns.map((c) => <th key={c.key} className="px-2 py-1 text-right">{c.header}</th>)}</tr>
                  </thead>
                  <tbody>
                    {valid.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">
                        {columns.map((c) => <td key={c.key} className="px-2 py-1">{String(r.data[c.key] ?? "")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {invalid.length > 0 && (
              <div className="border rounded p-3 bg-destructive/5 max-h-40 overflow-y-auto">
                <div className="font-semibold text-destructive flex items-center gap-1 mb-2">
                  <AlertCircle className="w-4 h-4" /> صفوف فيها أخطاء (هتتجاهل):
                </div>
                <ul className="text-xs space-y-1">
                  {invalid.slice(0, 20).map((r) => (
                    <li key={r.index}><b>صف {r.index}:</b> {r.errors.join("، ")}</li>
                  ))}
                </ul>
              </div>
            )}

            {result && (
              <div className="p-3 rounded bg-success/10 text-success text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                تم استيراد {result.inserted} صف بنجاح
                {result.failed?.length ? ` — فشل ${result.failed.length} صف` : ""}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
          <Button onClick={doImport} disabled={busy || !valid.length || !!result}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Upload className="w-4 h-4 ml-1" />}
            استيراد الصفوف الصحيحة ({valid.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
