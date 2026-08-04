import { useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Download, Upload, Loader2, AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { downloadTemplate, parseExcelFile, ParsedRow } from "@/lib/excelImport";
import {
  DocKind, KIND_LABEL, MIGRATION_COLUMNS, MIGRATION_SAMPLE, DocResult,
  groupByDoc, runMigration,
} from "@/lib/invoiceMigration";
import { confirmAlert } from "@/components/ConfirmDialog";
import * as XLSX from "xlsx";
import { formatEGP } from "@/lib/format";

const KINDS: DocKind[] = ["purchase", "sale", "sale_return", "purchase_return"];

function KindPanel({ kind }: { kind: DocKind }) {
  const { user, branches } = useAuth();
  const cols = MIGRATION_COLUMNS[kind];
  const [branchId, setBranchId] = useState<string>("");
  const [label, setLabel] = useState<string>(`ترحيل ${new Date().toISOString().slice(0, 10)}`);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<DocResult[] | null>(null);

  const valid = useMemo(() => parsed.filter((r) => r.errors.length === 0), [parsed]);
  const invalid = useMemo(() => parsed.filter((r) => r.errors.length > 0), [parsed]);
  const docs = useMemo(() => groupByDoc(valid.map((r) => r.data)), [valid]);

  const onFile = async (file: File) => {
    try {
      setResults(null);
      setFileName(file.name);
      setParsed(await parseExcelFile(file, cols));
    } catch (e: any) {
      toast.error("فشلت قراءة الملف: " + e.message);
    }
  };

  const start = async () => {
    if (!branchId) return toast.error("اختار الفرع الأول");
    if (!docs.size) return toast.error("مفيش مستندات صالحة للترحيل");
    const ok = await confirmAlert({
      title: `هترحّل ${docs.size} مستند على فرع محدد`,
      description: "الترحيل هيأثر على المخزن والخزنة وحسابات العملاء/الموردين زي أي فاتورة عادية. متأكد؟",
      confirmLabel: "أيوه، ابدأ الترحيل",
      cancelLabel: "لأ، استنى",
      tone: "danger",
    });
    if (!ok) return;

    setBusy(true);
    setProgress({ done: 0, total: docs.size });
    try {
      const out = await runMigration({
        kind,
        branchId,
        userId: user!.id,
        label: label.trim() || "ترحيل",
        rows: valid.map((r) => r.data),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResults(out.results);
      if (out.failed === 0) toast.success(`تم ترحيل ${out.inserted} مستند بنجاح 🎉`);
      else toast.warning(`تم ترحيل ${out.inserted} مستند — فشل ${out.failed}`);
    } catch (e: any) {
      toast.error(e.message ?? "فشل الترحيل");
    } finally {
      setBusy(false);
    }
  };

  const exportResults = () => {
    if (!results) return;
    const ws = XLSX.utils.json_to_sheet(
      results.map((r) => ({
        "الرقم الأصلي": r.doc_no,
        "الحالة": r.ok ? "تم" : "فشل",
        "رقم المستند بالنظام": r.number ?? "",
        "عدد الأسطر": r.lines,
        "الإجمالي": r.total,
        "الخطأ": r.error ?? "",
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Result");
    XLSX.writeFile(wb, `نتيجة-ترحيل-${kind}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>الفرع</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="اختار الفرع" /></SelectTrigger>
              <SelectContent>
                {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>اسم دفعة الترحيل</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثال: داتا 2024" />
          </div>
          <div className="space-y-1">
            <Label>الملف</Label>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => downloadTemplate(`قالب-${kind}`, cols, MIGRATION_SAMPLE[kind])}>
                <Download className="w-4 h-4 ml-1" /> القالب
              </Button>
              <label className="flex-1 cursor-pointer">
                <Button asChild className="w-full"><span><Upload className="w-4 h-4 ml-1" /> رفع Excel</span></Button>
                <input type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </label>
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground leading-6 bg-muted/40 rounded p-3">
          كل سطر في الملف = صنف واحد. الأصناف اللي ليها نفس <b>رقم المستند</b> بتتجمّع في فاتورة واحدة.
          {kind === "sale" && " رحّل فواتير الشراء الأول عشان يبقى في رصيد مخزون للبيع منه."}
          {kind !== "purchase" && kind !== "sale" && " لازم الفاتورة الأصلية تكون مرحّلة قبل المرتجع."}
        </div>
      </Card>

      {parsed.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileSpreadsheet className="w-4 h-4" /> {fileName}
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="p-3 rounded border"><div className="text-xs text-muted-foreground">أسطر</div><div className="text-xl font-bold">{parsed.length}</div></div>
            <div className="p-3 rounded border bg-success/10"><div className="text-xs text-success">صالحة</div><div className="text-xl font-bold text-success">{valid.length}</div></div>
            <div className="p-3 rounded border bg-destructive/10"><div className="text-xs text-destructive">بها أخطاء</div><div className="text-xl font-bold text-destructive">{invalid.length}</div></div>
            <div className="p-3 rounded border bg-primary/10"><div className="text-xs text-primary">مستندات</div><div className="text-xl font-bold text-primary">{docs.size}</div></div>
          </div>

          {invalid.length > 0 && (
            <div className="border rounded p-3 bg-destructive/5 max-h-40 overflow-y-auto text-xs space-y-1">
              <div className="font-semibold text-destructive flex items-center gap-1 mb-1">
                <AlertTriangle className="w-4 h-4" /> أسطر هتتجاهل:
              </div>
              {invalid.slice(0, 30).map((r) => <div key={r.index}><b>سطر {r.index}:</b> {r.errors.join("، ")}</div>)}
            </div>
          )}

          <div className="border rounded overflow-hidden">
            <div className="px-3 py-2 bg-muted text-sm font-semibold">معاينة أول 10 مستندات</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr><th className="px-2 py-1">رقم المستند</th><th className="px-2 py-1">التاريخ</th><th className="px-2 py-1">عدد الأصناف</th></tr>
                </thead>
                <tbody>
                  {[...docs.entries()].slice(0, 10).map(([doc, rows]) => (
                    <tr key={doc} className="border-t">
                      <td className="px-2 py-1">{doc}</td>
                      <td className="px-2 py-1">{rows[0]?.date}</td>
                      <td className="px-2 py-1">{rows.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {busy && (
            <div className="space-y-1">
              <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
              <div className="text-xs text-muted-foreground text-center">{progress.done} / {progress.total}</div>
            </div>
          )}

          <Button onClick={start} disabled={busy || !docs.size} className="w-full btn-gradient">
            {busy ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Upload className="w-4 h-4 ml-2" />}
            ابدأ ترحيل {docs.size} مستند
          </Button>
        </Card>
      )}

      {results && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="w-4 h-4 text-success" /> نتيجة الترحيل
            </div>
            <Button variant="outline" size="sm" onClick={exportResults}><Download className="w-4 h-4 ml-1" /> تصدير النتيجة</Button>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50"><tr>
                <th className="px-2 py-1">الرقم الأصلي</th><th className="px-2 py-1">الحالة</th>
                <th className="px-2 py-1">رقم النظام</th><th className="px-2 py-1">الإجمالي</th><th className="px-2 py-1">الخطأ</th>
              </tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.doc_no} className="border-t">
                    <td className="px-2 py-1">{r.doc_no}</td>
                    <td className="px-2 py-1">
                      {r.ok ? <Badge className="bg-success/15 text-success">تم</Badge> : <Badge variant="destructive">فشل</Badge>}
                    </td>
                    <td className="px-2 py-1">{r.number ?? "—"}</td>
                    <td className="px-2 py-1">{r.ok ? formatEGP(r.total) : "—"}</td>
                    <td className="px-2 py-1 text-destructive">{r.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function DataMigration() {
  return (
    <AdminLayout>
      <PageHeader title="ترحيل الفواتير القديمة" subtitle="رفع داتا الشركة القديمة (بيع / شراء / مرتجعات) من ملفات Excel" />
      <Tabs defaultValue="purchase">
        <TabsList className="w-full justify-center flex-wrap h-auto">
          {KINDS.map((k) => <TabsTrigger key={k} value={k} className="text-sm">{KIND_LABEL[k]}</TabsTrigger>)}
        </TabsList>
        {KINDS.map((k) => (
          <TabsContent key={k} value={k} className="mt-4"><KindPanel kind={k} /></TabsContent>
        ))}
      </Tabs>
    </AdminLayout>
  );
}
