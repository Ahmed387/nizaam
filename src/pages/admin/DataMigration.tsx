import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Upload, Loader2, AlertTriangle, CheckCircle2, FileSpreadsheet, Boxes, ShieldCheck, XCircle } from "lucide-react";
import { downloadTemplate, parseExcelFile, ParsedRow } from "@/lib/excelImport";
import {
  DocKind, KIND_LABEL, MIGRATION_COLUMNS, MIGRATION_SAMPLE, DocResult,
  groupByDoc, runMigration,
} from "@/lib/invoiceMigration";
import {
  parseLegacyFile, ParsedLegacySheet, LegacyKind, LEGACY_KIND_LABEL,
} from "@/lib/legacySheetParser";
import { runLegacyMigration, LegacyDocResult } from "@/lib/legacyMigration";
import { runLegacyDryRun, DryRunReport } from "@/lib/legacyDryRun";
import { confirmAlert } from "@/components/ConfirmDialog";
import * as XLSX from "xlsx";
import { formatEGP } from "@/lib/format";

const KINDS: DocKind[] = ["purchase", "sale", "sale_return", "purchase_return"];
const LEGACY_ORDER: LegacyKind[] = ["purchase", "sale", "sale_return", "purchase_return"];

/* ==================================================================== */
/*                    ترحيل ملفات النظام القديم (بلوكات)                 */
/* ==================================================================== */

function LegacyPanel() {
  const { user, branches } = useAuth();
  const [branchId, setBranchId] = useState("");
  const [label, setLabel] = useState(`ترحيل ${new Date().toISOString().slice(0, 10)}`);
  const [supplierId, setSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [kindOverride, setKindOverride] = useState<LegacyKind | "">("");
  const [skipExisting, setSkipExisting] = useState(true);
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ParsedLegacySheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<LegacyDocResult[] | null>(null);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [checking, setChecking] = useState(false);
  /** ربط مخازن الملف بفروع النظام: اسم المخزن → id الفرع */
  const [whMap, setWhMap] = useState<Record<string, string>>({});

  // أي تغيير في الإعدادات بيلغي الفحص السابق
  useEffect(() => { setReport(null); }, [branchId, kindOverride, supplierId, skipExisting, fileName, whMap]);

  // أول ما الملف يتقرا: نحاول نطابق كل مخزن بفرع بنفس الاسم
  useEffect(() => {
    if (!sheet) { setWhMap({}); return; }
    const normalize = (s: string) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const next: Record<string, string> = {};
    for (const w of sheet.warehouses) {
      const nw = normalize(w);
      const hit = (branches as any[]).find((b) => {
        const nb = normalize(b.name);
        return nb === nw || nb.includes(nw) || nw.includes(nb);
      });
      next[w] = hit?.id ?? "";
    }
    setWhMap(next);
  }, [sheet, branches]);

  useEffect(() => {
    supabase.from("contacts").select("id, name").order("name").then(({ data }) => setSuppliers(data ?? []));
  }, []);


  const kind = (kindOverride || sheet?.kind || "") as LegacyKind | "";
  const needsSupplier = kind === "purchase" || kind === "purchase_return";

  const docs = sheet?.docs ?? [];
  const warned = useMemo(() => docs.filter((d) => d.warnings.length), [docs]);
  const branchName = (id: string) => (branches as any[]).find((b) => b.id === id)?.name ?? "—";

  /** المخازن اللي في الملف ومالهاش فرع مطابق على النظام */
  const unmappedWarehouses = useMemo(
    () => (sheet?.warehouses ?? []).filter((w) => !whMap[w]),
    [sheet, whMap],
  );

  /** تقسيم المستندات على الفروع حسب المخزن (المخزن الفاضي → الفرع الرئيسي المختار) */
  const groups = useMemo(() => {
    const m = new Map<string, { warehouse: string; branchId: string; docs: typeof docs }>();
    for (const d of docs) {
      const target = d.warehouse ? whMap[d.warehouse] || "" : branchId;
      const k = `${d.warehouse}|${target}`;
      if (!m.has(k)) m.set(k, { warehouse: d.warehouse || "", branchId: target, docs: [] });
      m.get(k)!.docs.push(d);
    }
    return [...m.values()];
  }, [docs, whMap, branchId]);

  const onFile = async (file: File) => {
    setResults(null);
    setSheet(null);
    setFileName(file.name);
    try {
      const parsed = await parseLegacyFile(file);
      setSheet(parsed);
      setKindOverride("");
      if (parsed.issues.length) parsed.issues.forEach((i) => toast.warning(i));
      else toast.success(`اتقرأ ${parsed.docs.length} مستند و ${parsed.itemCount} صنف`);
    } catch (e: any) {
      toast.error("فشلت قراءة الملف: " + e.message);
    }
  };

  const dryRun = async () => {
    if (!branchId) return toast.error("اختار الفرع الأول");
    if (!kind) return toast.error("حدّد نوع المستندات");
    if (!docs.length) return toast.error("مفيش مستندات للفحص");
    if (unmappedWarehouses.length) {
      return toast.error(`فيه مخزن في الملف مش موجود على النظام: ${unmappedWarehouses.join("، ")} — اختارله فرع الأول`);
    }
    setChecking(true);
    try {
      const parts: DryRunReport[] = [];
      for (const g of groups) {
        const rep = await runLegacyDryRun({
          kind, branchId: g.branchId || branchId, docs: g.docs,
          supplierId: needsSupplier ? supplierId || null : null, skipExisting,
        });
        rep.docs.forEach((d) => { d.branchName = branchName(g.branchId || branchId); });
        parts.push(rep);
      }
      const rep: DryRunReport = {
        kind,
        docs: parts.flatMap((p) => p.docs),
        ok: parts.reduce((s, p) => s + p.ok, 0),
        warnings: parts.reduce((s, p) => s + p.warnings, 0),
        blocked: parts.reduce((s, p) => s + p.blocked, 0),
        skipped: parts.reduce((s, p) => s + p.skipped, 0),
        newContacts: [...new Set(parts.flatMap((p) => p.newContacts))],
        newProducts: [...new Map(parts.flatMap((p) => p.newProducts).map((p) => [`${p.code}::${p.name}`, p])).values()],
        missingProducts: [...new Map(parts.flatMap((p) => p.missingProducts).map((p) => [`${p.code}::${p.name}`, p])).values()],
        total: parts.reduce((s, p) => s + p.total, 0),
      };
      setReport(rep);
      if (rep.blocked) toast.warning(`الفحص خلص — فيه ${rep.blocked} مستند متوقف محتاج مراجعة`);
      else toast.success(`الفحص خلص — كله تمام (${rep.ok} سليم${rep.warnings ? ` · ${rep.warnings} فيه ملاحظات` : ""})`);
    } catch (e: any) {
      toast.error("فشل الفحص: " + (e?.message ?? e));
    } finally {
      setChecking(false);
    }
  };


  const exportReport = () => {
    if (!report) return;
    const ws = XLSX.utils.json_to_sheet(
      report.docs.map((d) => ({
        "الرقم القديم": d.legacyNumber,
        "التاريخ": d.dateISO.replace("T", " "),
        "الحساب": d.account,
        "المخزن في الملف": d.warehouse || "—",
        "الفرع على النظام": d.branchName || "—",
        "أصناف": d.items,
        "الإجمالي": d.total,
        "المدفوع": d.paid,
        "الحالة": d.status === "ok" ? "سليم" : d.status === "warning" ? "ملاحظات" : d.status === "skip" ? "هيتخطى" : "متوقف",
        "التفاصيل": d.issues.map((i) => i.text).join(" | "),
      })),

    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DryRun");
    XLSX.writeFile(wb, `فحص-قبل-الترحيل-${kind || "legacy"}.xlsx`);
  };

  const start = async () => {
    if (!branchId) return toast.error("اختار الفرع الأول");
    if (!kind) return toast.error("حدّد نوع المستندات");
    if (needsSupplier && !supplierId) return toast.error("اختار المورد");
    if (!docs.length) return toast.error("مفيش مستندات للترحيل");
    if (!report) return toast.error("لازم تعمل الفحص التجريبي الأول");
    if (unmappedWarehouses.length) {
      return toast.error(`لازم تختار فرع لكل مخزن: ${unmappedWarehouses.join("، ")}`);
    }

    if (report.blocked) {
      const go = await confirmAlert({
        title: `فيه ${report.blocked} مستند متوقف`,
        description: "المستندات دي مش هتتسجل (مكررة أو فترة مقفولة أو منتج ناقص). تحب تكمل وترحّل الباقي؟",
        confirmLabel: "كمّل ورحّل الباقي",
        cancelLabel: "لأ، هراجع الأول",
        tone: "danger",
      });
      if (!go) return;
    }

    const ok = await confirmAlert({
      title: `هترحّل ${docs.length} مستند (${LEGACY_KIND_LABEL[kind]})`,
      description:
        "الترحيل هيأثر على المخزن والخزنة وحسابات العملاء/الموردين زي أي فاتورة عادية. " +
        (groups.length > 1
          ? `المستندات هتتوزع على ${groups.length} فرع حسب المخزن اللي في الملف. `
          : "") +
        "الترتيب الصح: شراء ← بيع ← مرتجعات. متأكد؟",
      confirmLabel: "أيوه، ابدأ الترحيل",
      cancelLabel: "لأ، استنى",
      tone: "danger",
    });
    if (!ok) return;

    setBusy(true);
    setProgress({ done: 0, total: docs.length });
    try {
      const all: LegacyDocResult[] = [];
      let inserted = 0, failed = 0, skipped = 0, base = 0;
      for (const g of groups) {
        const out = await runLegacyMigration({
          kind,
          branchId: g.branchId || branchId,
          userId: user!.id,
          label: (label.trim() || "ترحيل") + (g.warehouse ? ` — ${g.warehouse}` : ""),
          fileName,
          supplierId: needsSupplier ? supplierId : null,
          docs: g.docs,
          skipExisting,
          onProgress: (done) => setProgress({ done: base + done, total: docs.length }),
        });
        all.push(...out.results);
        inserted += out.inserted; failed += out.failed; skipped += out.skipped;
        base += g.docs.length;
      }
      setResults(all);
      setReport(null);
      if (failed === 0) toast.success(`تم ترحيل ${inserted} مستند بنجاح 🎉${skipped ? ` (${skipped} متخطي)` : ""}`);
      else toast.warning(`تم ${inserted} — فشل ${failed} — متخطي ${skipped}`);
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
        "الرقم القديم": r.legacyNumber,
        "الحالة": r.skipped ? "متخطي" : r.ok ? "تم" : "فشل",
        "رقم النظام": r.number ?? "",
        "عدد الأصناف": r.items,
        "الإجمالي": r.total,
        "ملاحظة": r.note ?? "",
        "الخطأ": r.error ?? "",
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Result");
    XLSX.writeFile(wb, `نتيجة-ترحيل-${kind || "legacy"}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>الفرع اللي هتترحّل عليه</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="اختار الفرع" /></SelectTrigger>
              <SelectContent>
                {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>اسم دفعة الترحيل</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثال: داتا معرض عبد المنعم" />
          </div>
          <div className="space-y-1">
            <Label>ملف النظام القديم</Label>
            <label className="cursor-pointer block">
              <Button asChild className="w-full"><span><Upload className="w-4 h-4 ml-1" /> رفع Excel</span></Button>
              <input type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          </div>
        </div>

        <div className="text-xs text-muted-foreground leading-6 bg-muted/40 rounded p-3">
          ارفع الملف زي ما هو من النظام القديم — النظام بيفهم شكل البلوكات (سطر الفاتورة ← عناوين الأصناف ← الأصناف ← الإجمالي).
          <b> الترتيب المهم:</b> رحّل <b>فواتير الشراء</b> الأول (عشان المخزون والمنتجات تتعمل)، بعدين <b>البيع</b>، وبعدين <b>المرتجعات</b>.
        </div>
      </Card>

      {sheet && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileSpreadsheet className="w-4 h-4" /> {fileName}
            {sheet.kind && <Badge className="bg-primary/15 text-primary">{LEGACY_KIND_LABEL[sheet.kind]}</Badge>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
            <div className="p-3 rounded border"><div className="text-xs text-muted-foreground">مستندات</div><div className="text-xl font-bold">{docs.length}</div></div>
            <div className="p-3 rounded border bg-primary/10"><div className="text-xs text-primary">أصناف</div><div className="text-xl font-bold text-primary">{sheet.itemCount}</div></div>
            <div className="p-3 rounded border bg-success/10"><div className="text-xs text-success">الإجمالي</div><div className="text-lg font-bold text-success">{formatEGP(sheet.grandTotal)}</div></div>
            <div className="p-3 rounded border bg-warning/10"><div className="text-xs text-warning">فيها ملاحظات</div><div className="text-xl font-bold text-warning">{warned.length}</div></div>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>نوع المستندات</Label>
              <Select value={kind} onValueChange={(v) => setKindOverride(v as LegacyKind)}>
                <SelectTrigger><SelectValue placeholder="اختار النوع" /></SelectTrigger>
                <SelectContent>
                  {LEGACY_ORDER.map((k) => <SelectItem key={k} value={k}>{LEGACY_KIND_LABEL[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {needsSupplier && (
              <div className="space-y-1">
                <Label>المورد الافتراضي (لو الملف مفيهوش عمود مورد)</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder="اختار المورد" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>تخطي المرحّل قبل كده</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={skipExisting} onCheckedChange={setSkipExisting} />
                <span className="text-xs text-muted-foreground">يمنع تكرار نفس رقم المستند القديم</span>
              </div>
            </div>
          </div>

          {sheet.warehouses.length > 0 && (
            <div className={`border rounded-lg p-3 space-y-2 ${unmappedWarehouses.length ? "border-warning bg-warning/5" : "bg-muted/30"}`}>
              <div className="text-sm font-semibold flex items-center gap-1">
                <AlertTriangle className={`w-4 h-4 ${unmappedWarehouses.length ? "text-warning" : "text-muted-foreground"}`} />
                ربط مخازن الملف بفروع النظام
              </div>
              {unmappedWarehouses.length > 0 && (
                <div className="text-xs text-warning">
                  في مخزن (أو أكتر) في الملف مش موجود عندك على النظام: <b>{unmappedWarehouses.join("، ")}</b> —
                  اختارله فرع من الفروع المتاحة تحت، أو اعمل الفرع الأول من صفحة الفروع وارجع هنا.
                </div>
              )}
              <div className="grid md:grid-cols-2 gap-2">
                {sheet.warehouses.map((w) => (
                  <div key={w} className="flex items-center gap-2">
                    <Badge variant="outline" className="shrink-0 max-w-[45%] truncate">{w}</Badge>
                    <span className="text-muted-foreground text-xs">←</span>
                    <Select value={whMap[w] || ""} onValueChange={(v) => setWhMap((m) => ({ ...m, [w]: v }))}>
                      <SelectTrigger className={`h-9 ${!whMap[w] ? "border-warning" : ""}`}>
                        <SelectValue placeholder="اختار الفرع" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground">
                أي مستند مفيهوش مخزن هيترحّل على الفرع الرئيسي المختار فوق.
                {groups.length > 1 && ` الملف ده هيتقسم على ${groups.length} مجموعة ترحيل.`}
              </div>
            </div>
          )}


          {warned.length > 0 && (
            <div className="border rounded p-3 bg-warning/5 max-h-40 overflow-y-auto text-xs space-y-1">
              <div className="font-semibold text-warning flex items-center gap-1 mb-1">
                <AlertTriangle className="w-4 h-4" /> مستندات فيها ملاحظات:
              </div>
              {warned.slice(0, 30).map((d) => (
                <div key={d.legacyNumber + d.row}><b>#{d.legacyNumber}:</b> {d.warnings.join("، ")}</div>
              ))}
            </div>
          )}

          {docs[0] && (
            <div className="border-2 border-primary/30 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-primary/10 text-sm font-bold">
                معاينة تفصيلية لأول مستند — #{docs[0].legacyNumber || "بدون رقم"} (صف {docs[0].row} في الملف)
              </div>

              <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {[
                  ["التاريخ / الوقت", docs[0].dateISO.replace("T", " ") || "—"],
                  ["الحساب (عميل/مورد)", docs[0].account || "—"],
                  ["المخزن", docs[0].warehouse || "—"],
                  ["طريقة السداد", docs[0].paymentLabel || "—"],
                  ["إجمالي الهيدر", formatEGP(docs[0].headerTotal)],
                  ["مجموع السطور", formatEGP(docs[0].itemsTotal)],
                  ["خصم الهيدر", formatEGP(docs[0].headerDiscount)],
                  ["المدفوع", formatEGP(docs[0].paid)],
                  ["الآجل", formatEGP(docs[0].credit)],
                  ["المستحق", formatEGP(docs[0].due)],
                  ["المستند الأصلي", docs[0].originalNumber ?? "—"],
                  [
                    "تفصيل الدفع",
                    docs[0].payments.length
                      ? docs[0].payments.map((p) => `${p.method}: ${formatEGP(p.amount)}`).join(" · ")
                      : "—",
                  ],
                ].map(([k, v]) => (
                  <div key={k as string} className="p-2 rounded border bg-muted/30">
                    <div className="text-muted-foreground">{k}</div>
                    <div className="font-semibold break-words">{v}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1">#</th>
                      <th className="px-2 py-1">كود الصنف</th>
                      <th className="px-2 py-1">اسم الصنف</th>
                      <th className="px-2 py-1">الكمية</th>
                      <th className="px-2 py-1">السعر</th>
                      <th className="px-2 py-1">الخصم</th>
                      <th className="px-2 py-1">النهائي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs[0].items.map((it, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">{i + 1}</td>
                        <td className="px-2 py-1">{it.code || "—"}</td>
                        <td className="px-2 py-1">{it.name}</td>
                        <td className="px-2 py-1">{it.qty}</td>
                        <td className="px-2 py-1">{formatEGP(it.price)}</td>
                        <td className="px-2 py-1">{formatEGP(it.discount)}</td>
                        <td className="px-2 py-1 font-semibold">{formatEGP(it.total)}</td>
                      </tr>
                    ))}
                    {!docs[0].items.length && (
                      <tr><td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">مفيش أصناف اتقرت في المستند ده</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {docs[0].warnings.length > 0 && (
                <div className="px-3 py-2 bg-warning/10 text-xs text-warning font-semibold">
                  ملاحظات: {docs[0].warnings.join("، ")}
                </div>
              )}
            </div>
          )}


          <div className="border rounded overflow-hidden">
            <div className="px-3 py-2 bg-muted text-sm font-semibold">معاينة أول 10 مستندات</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1">الرقم</th><th className="px-2 py-1">التاريخ</th>
                    <th className="px-2 py-1">الحساب</th><th className="px-2 py-1">أصناف</th>
                    <th className="px-2 py-1">الإجمالي</th><th className="px-2 py-1">المدفوع</th>
                    <th className="px-2 py-1">مرتبط بـ</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.slice(0, 10).map((d) => (
                    <tr key={d.legacyNumber + d.row} className="border-t">
                      <td className="px-2 py-1 font-semibold">{d.legacyNumber}</td>
                      <td className="px-2 py-1">{d.dateISO.replace("T", " ")}</td>
                      <td className="px-2 py-1">{d.account || "—"}</td>
                      <td className="px-2 py-1">{d.items.length}</td>
                      <td className="px-2 py-1">{formatEGP(d.headerTotal)}</td>
                      <td className="px-2 py-1">{formatEGP(d.paid)}</td>
                      <td className="px-2 py-1">{d.originalNumber ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {report && (
            <div className="border-2 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted flex items-center justify-between">
                <div className="text-sm font-bold flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary" /> نتيجة الفحص التجريبي (مفيش حاجة اتسجلت لسه)
                </div>
                <Button variant="outline" size="sm" onClick={exportReport}>
                  <Download className="w-4 h-4 ml-1" /> تصدير التقرير
                </Button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 text-center">
                <div className="p-2 rounded border bg-success/10"><div className="text-xs text-success">سليم</div><div className="text-xl font-bold text-success">{report.ok}</div></div>
                <div className="p-2 rounded border bg-warning/10"><div className="text-xs text-warning">فيه ملاحظات</div><div className="text-xl font-bold text-warning">{report.warnings}</div></div>
                <div className="p-2 rounded border bg-destructive/10"><div className="text-xs text-destructive">متوقف</div><div className="text-xl font-bold text-destructive">{report.blocked}</div></div>
                <div className="p-2 rounded border"><div className="text-xs text-muted-foreground">هيتخطى</div><div className="text-xl font-bold">{report.skipped}</div></div>
              </div>

              <div className="px-3 pb-3 text-xs space-y-1 text-muted-foreground">
                {report.newContacts.length > 0 && (
                  <div>🆕 <b>{report.newContacts.length}</b> حساب جديد هيتعمل: {report.newContacts.slice(0, 8).join("، ")}{report.newContacts.length > 8 ? " …" : ""}</div>
                )}
                {report.newProducts.length > 0 && (
                  <div>📦 <b>{report.newProducts.length}</b> منتج جديد هيتعمل من فواتير الشراء.</div>
                )}
                {report.missingProducts.length > 0 && (
                  <div className="text-destructive">⚠️ <b>{report.missingProducts.length}</b> منتج مش موجود — رحّل فواتير الشراء الأول.</div>
                )}
              </div>

              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50"><tr>
                    <th className="px-2 py-1">الرقم</th><th className="px-2 py-1">التاريخ</th>
                    <th className="px-2 py-1">الحساب</th><th className="px-2 py-1">الإجمالي</th>
                    <th className="px-2 py-1">الحالة</th><th className="px-2 py-1">التفاصيل</th>
                  </tr></thead>
                  <tbody>
                    {report.docs.map((d, i) => (
                      <tr key={d.legacyNumber + i} className="border-t">
                        <td className="px-2 py-1 font-semibold">{d.legacyNumber}</td>
                        <td className="px-2 py-1">{d.dateISO.replace("T", " ")}</td>
                        <td className="px-2 py-1">{d.account || "—"}</td>
                        <td className="px-2 py-1">{formatEGP(d.total)}</td>
                        <td className="px-2 py-1">
                          {d.status === "blocked" ? <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" /> متوقف</Badge>
                            : d.status === "warning" ? <Badge className="bg-warning/15 text-warning">ملاحظات</Badge>
                            : d.status === "skip" ? <Badge variant="outline">هيتخطى</Badge>
                            : <Badge className="bg-success/15 text-success">سليم</Badge>}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {d.issues.length ? d.issues.map((x, j) => (
                            <div key={j} className={x.level === "error" ? "text-destructive" : x.level === "warning" ? "text-warning" : ""}>• {x.text}</div>
                          )) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {busy && (
            <div className="space-y-1">
              <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
              <div className="text-xs text-muted-foreground text-center">{progress.done} / {progress.total}</div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-2">
            <Button onClick={dryRun} disabled={checking || busy || !docs.length} variant="outline" className="w-full">
              {checking ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 ml-2" />}
              فحص تجريبي قبل الاعتماد (إجباري)
            </Button>
            <Button onClick={start} disabled={busy || !docs.length || !report} className="w-full btn-gradient">
              {busy ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Boxes className="w-4 h-4 ml-2" />}
              {report ? `اعتمد وارفع ${docs.length} مستند` : "اعمل الفحص الأول"}
            </Button>
          </div>
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
                <th className="px-2 py-1">الرقم القديم</th><th className="px-2 py-1">الحالة</th>
                <th className="px-2 py-1">رقم النظام</th><th className="px-2 py-1">الإجمالي</th>
                <th className="px-2 py-1">ملاحظة / خطأ</th>
              </tr></thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={r.legacyNumber + i} className="border-t">
                    <td className="px-2 py-1">{r.legacyNumber}</td>
                    <td className="px-2 py-1">
                      {r.skipped
                        ? <Badge variant="outline">متخطي</Badge>
                        : r.ok ? <Badge className="bg-success/15 text-success">تم</Badge> : <Badge variant="destructive">فشل</Badge>}
                    </td>
                    <td className="px-2 py-1">{r.number ?? "—"}</td>
                    <td className="px-2 py-1">{formatEGP(r.total)}</td>
                    <td className={`px-2 py-1 ${r.error ? "text-destructive" : "text-muted-foreground"}`}>{r.error ?? r.note ?? ""}</td>
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

/* ==================================================================== */
/*                      الترحيل بالقوالب الجاهزة                        */
/* ==================================================================== */

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
      <Tabs defaultValue="legacy">
        <TabsList className="w-full justify-center flex-wrap h-auto">
          <TabsTrigger value="legacy" className="text-sm font-bold">ملفات النظام القديم</TabsTrigger>
          <TabsTrigger value="templates" className="text-sm">قوالب Nizam الجاهزة</TabsTrigger>
        </TabsList>

        <TabsContent value="legacy" className="mt-4"><LegacyPanel /></TabsContent>

        <TabsContent value="templates" className="mt-4">
          <Tabs defaultValue="purchase">
            <TabsList className="w-full justify-center flex-wrap h-auto">
              {KINDS.map((k) => <TabsTrigger key={k} value={k} className="text-sm">{KIND_LABEL[k]}</TabsTrigger>)}
            </TabsList>
            {KINDS.map((k) => (
              <TabsContent key={k} value={k} className="mt-4"><KindPanel kind={k} /></TabsContent>
            ))}
          </Tabs>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
