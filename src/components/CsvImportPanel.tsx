import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Download, Upload, AlertTriangle, CheckCircle2, Loader2, FileWarning, RotateCcw,
  ArrowLeft, FileSpreadsheet, Pencil, MousePointerClick,
} from "lucide-react";
import { toast } from "sonner";
import {
  CsvColumn, ParsedCsvRow, downloadCsvTemplate, downloadCsvRows, headerOf, readImportFile,
} from "@/lib/csvImport";

export interface ValidationOutput {
  /** الصفوف السليمة اللي هتترفع */
  ok: ParsedCsvRow[];
  /** الصفوف المرفوضة بأسبابها */
  bad: { index: number; errors: string[]; data?: any }[];
  /** ملاحظات عامة (تحذيرات، إجماليات، فروق) */
  notes?: string[];
  /** لو true → الاستيراد ممنوع خالص لحد ما المستخدم يصلّح */
  blocked?: string | null;
}

export interface ImportOutput {
  inserted: number;
  failed?: { index: number; error: string }[];
  notes?: string[];
}

interface Props {
  title: string;
  description: string;
  templateName: string;
  columns: CsvColumn[];
  sample: Record<string, any>;
  validate: (rows: ParsedCsvRow[]) => Promise<ValidationOutput>;
  onImport: (rows: ParsedCsvRow[]) => Promise<ImportOutput>;
  /** عناصر إضافية فوق (زي إجمالي تأكيدي) */
  extra?: React.ReactNode;
}

export function CsvImportPanel({ title, description, templateName, columns, sample, validate, onImport, extra }: Props) {
  const [parsed, setParsed] = useState<ParsedCsvRow[] | null>(null);
  const [val, setVal] = useState<ValidationOutput | null>(null);
  const [headerIssues, setHeaderIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportOutput | null>(null);

  const reset = () => { setParsed(null); setVal(null); setResult(null); setHeaderIssues([]); };

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const res = await readImportFile(file, columns);
      const issues: string[] = [];
      if (res.missingRequired.length)
        issues.push(`أعمدة مطلوبة ناقصة في الملف: ${res.missingRequired.map((c) => c.ar).join("، ")}`);
      if (res.unknownHeaders.length)
        issues.push(`أعمدة النظام مش عارفها (هتتجاهل): ${res.unknownHeaders.join("، ")}`);
      setHeaderIssues(issues);
      setParsed(res.rows);
      setResult(null);
      if (!res.rows.length) { toast.error("الملف فاضي أو مفهوش صفوف"); setVal(null); return; }
      const v = await validate(res.rows);
      setVal(v);
    } catch (e: any) {
      toast.error("فشلت قراءة الملف", { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!val?.ok.length) return;
    setBusy(true);
    try {
      const r = await onImport(val.ok);
      setResult(r);
      toast.success(`تم استيراد ${r.inserted} صف`, {
        description: r.failed?.length ? `فشل ${r.failed.length} صف — شوف التقرير تحت` : "من غير أخطاء",
      });
    } catch (e: any) {
      toast.error("فشل الاستيراد", { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  const downloadErrors = () => {
    const rows = (val?.bad ?? []).map((b) => [b.index, b.errors.join(" | ")]);
    (result?.failed ?? []).forEach((f) => rows.push([f.index, f.error]));
    downloadCsvRows(`${templateName}-errors`, ["رقم الصف / Row", "سبب الرفض / Reason"], rows);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-primary/20 bg-gradient-to-l from-primary/10 via-primary/5 to-transparent p-4 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2 text-sm font-bold text-primary">
            <MousePointerClick className="h-4 w-4" />
            مسار واحد للرفع: القالب هو نفس الملف اللي هترفعه
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1 rounded-lg border border-border/70 bg-background/80 p-3 text-center space-y-2">
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">1</span>
                حمّل القالب
              </div>
              <Button variant="ghost" size="sm" className="h-auto py-1.5 text-xs text-primary hover:text-primary hover:bg-primary/10"
                onClick={() => downloadCsvTemplate(templateName, columns, sample)}>
                <Download className="h-3.5 w-3.5 me-1" /> ملف Excel/CSV جاهز
              </Button>
            </div>

            <div className="hidden sm:flex flex-col items-center text-muted-foreground">
              <ArrowLeft className="h-4 w-4" />
              <span className="text-[10px]">نفس الملف</span>
            </div>

            <div className="flex-1 rounded-lg border border-border/70 bg-background/80 p-3 text-center space-y-2">
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">2</span>
                املأ بياناتك
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Pencil className="h-3.5 w-3.5" /> امسح المثال واكتب بياناتك
              </div>
            </div>

            <div className="hidden sm:flex flex-col items-center text-muted-foreground">
              <ArrowLeft className="h-4 w-4" />
              <span className="text-[10px]">نفس الملف</span>
            </div>

            <div className="flex-1 rounded-lg border border-primary/30 bg-primary/5 p-3 text-center space-y-2">
              <div className="text-xs text-primary font-semibold flex items-center justify-center gap-1">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">3</span>
                رفع الملف
              </div>
              <label className="block">
                <Button asChild size="sm" className="w-full">
                  <span className="cursor-pointer"><Upload className="h-3.5 w-3.5 me-1" /> رفع الملف</span>
                </Button>
                <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              القالب مش طريقة تانية — هو نفس الملف بس النظام جهّزهولك عشان الأعمدة تطلع صح.
            </span>
            <div className="flex items-center gap-2">
              {parsed && (
                <Button variant="ghost" size="sm" onClick={reset}><RotateCcw className="h-3.5 w-3.5 me-1" /> ابدأ من جديد</Button>
              )}
              {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </div>

        {extra}

        <div className="rounded border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العمود / Column</TableHead>
                <TableHead className="w-24">مطلوب؟</TableHead>
                <TableHead className="w-24">النوع</TableHead>
                <TableHead>ملاحظات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {columns.map((c) => (
                <TableRow key={c.key}>
                  <TableCell className="font-medium">{headerOf(c)}</TableCell>
                  <TableCell>
                    {c.required
                      ? <Badge variant="destructive">إجباري</Badge>
                      : <Badge variant="secondary">اختياري</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.type === "number" ? "رقم" : c.type === "date" ? "تاريخ" : "نص"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{c.note ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {headerIssues.length > 0 && (
          <div className="rounded border border-warning/40 bg-warning/10 p-3 text-sm space-y-1">
            {headerIssues.map((h, i) => (
              <div key={i} className="flex gap-2"><FileWarning className="h-4 w-4 mt-0.5" />{h}</div>
            ))}
          </div>
        )}

        {val && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border p-3 text-center">
                <div className="text-xs text-muted-foreground">إجمالي الصفوف</div>
                <div className="text-xl font-bold">{(val.ok.length + val.bad.length)}</div>
              </div>
              <div className="rounded border p-3 text-center bg-success/10">
                <div className="text-xs text-success">جاهزة للرفع</div>
                <div className="text-xl font-bold text-success">{val.ok.length}</div>
              </div>
              <div className="rounded border p-3 text-center bg-destructive/10">
                <div className="text-xs text-destructive">مرفوضة</div>
                <div className="text-xl font-bold text-destructive">{val.bad.length}</div>
              </div>
            </div>

            {val.notes?.map((n, i) => (
              <div key={i} className="rounded border bg-muted/40 p-2 text-sm">{n}</div>
            ))}

            {val.blocked && (
              <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm font-semibold text-destructive flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5" /> {val.blocked}
              </div>
            )}

            {val.ok.length > 0 && (
              <div className="rounded border overflow-x-auto">
                <div className="px-3 py-2 bg-muted text-sm font-semibold">معاينة أول 8 صفوف صالحة</div>
                <Table>
                  <TableHeader>
                    <TableRow>{columns.map((c) => <TableHead key={c.key}>{c.ar}</TableHead>)}</TableRow>
                  </TableHeader>
                  <TableBody>
                    {val.ok.slice(0, 8).map((r) => (
                      <TableRow key={r.index}>
                        {columns.map((c) => <TableCell key={c.key}>{String(r.data[c.key] ?? "—")}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {val.bad.length > 0 && (
              <div className="rounded border border-destructive/40 bg-destructive/5 p-3 max-h-56 overflow-y-auto text-sm space-y-1">
                <div className="font-semibold text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" /> صفوف مرفوضة (مش هتترفع):
                </div>
                {val.bad.slice(0, 100).map((b) => (
                  <div key={b.index}><b>صف {b.index}:</b> {b.errors.join("، ")}</div>
                ))}
                <Button size="sm" variant="outline" onClick={downloadErrors}>
                  <Download className="h-4 w-4 me-1" /> تنزيل تقرير الأخطاء
                </Button>
              </div>
            )}

            <Button size="lg" disabled={busy || !val.ok.length || !!val.blocked || !!result} onClick={run}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Upload className="h-4 w-4 me-1" />}
              تأكيد الاستيراد ({val.ok.length} صف)
            </Button>
          </div>
        )}

        {result && (
          <div className="rounded border border-success/40 bg-success/10 p-3 text-sm space-y-2">
            <div className="flex items-center gap-2 font-semibold text-success">
              <CheckCircle2 className="h-4 w-4" /> التقرير النهائي: نجح {result.inserted} صف
              {result.failed?.length ? ` — فشل ${result.failed.length} صف` : ""}
            </div>
            {result.notes?.map((n, i) => <div key={i}>{n}</div>)}
            {!!result.failed?.length && (
              <>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {result.failed.map((f) => <div key={f.index}><b>صف {f.index}:</b> {f.error}</div>)}
                </div>
                <Button size="sm" variant="outline" onClick={downloadErrors}>
                  <Download className="h-4 w-4 me-1" /> تنزيل تقرير الأخطاء
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
