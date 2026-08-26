import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LegacyDebtImport } from "@/components/legacy/LegacyDebtImport";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Upload, Loader2, AlertTriangle, CheckCircle2, FileSpreadsheet, Boxes, ShieldCheck, XCircle, BookOpen, Building2, Wallet, Banknote } from "lucide-react";
import {
  parseLegacyFile, ParsedLegacySheet, LegacyKind, LEGACY_KIND_LABEL, LegacyDoc,
} from "@/lib/legacySheetParser";
import { LegacyDocsEditor } from "@/components/legacy/LegacyDocsEditor";
import { LegacyAccountsMapper } from "@/components/legacy/LegacyAccountsMapper";

import { runLegacyMigration, LegacyDocResult } from "@/lib/legacyMigration";
import { runLegacyDryRun, DryRunReport } from "@/lib/legacyDryRun";
import { confirmAlert } from "@/components/ConfirmDialog";
import * as XLSX from "xlsx";
import { formatEGP } from "@/lib/format";
import { downloadLegacyTemplate, COLUMN_HELP, auditSheetColumns } from "@/lib/legacyTemplate";

const LEGACY_ORDER: LegacyKind[] = ["purchase", "sale", "sale_return", "purchase_return"];

const METHOD_LABEL: Record<string, string> = {
  cash: "الخزنة الكاش",
  instapay: "إنستاباي",
  vodafone: "فودافون كاش",
  bank: "البنك / PayMob",
};

/** ملخص بعد الترحيل: كل فرع اتحطّ فيه إيه، وكل خزنة دخلها كام */
interface BranchSummary {
  branchName: string;
  warehouse: string;
  docs: number;
  items: number;
  total: number;
  credit: number;
  byMethod: Record<string, number>;
}


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
  /** المستندات بعد التعديل اليدوي (دي اللي بتترحّل فعليًا) */
  const [docs, setDocs] = useState<LegacyDoc[]>([]);
  /** ربط اسم الحساب في الملف بحساب موجود على النظام */
  const [contactMap, setContactMap] = useState<Record<string, string>>({});
  /** ملخص بعد الاعتماد: كل فرع وكل خزنة */
  const [summary, setSummary] = useState<BranchSummary[] | null>(null);


  // أي تغيير في الإعدادات أو البيانات بيلغي الفحص السابق
  useEffect(() => { setReport(null); }, [branchId, kindOverride, supplierId, skipExisting, fileName, whMap, docs, contactMap]);

  const warehouses = useMemo(
    () => [...new Set(docs.map((d) => d.warehouse).filter(Boolean))],
    [docs],
  );
  const fileAccounts = useMemo(
    () => [...new Set(docs.map((d) => d.account.trim()).filter(Boolean))],
    [docs],
  );

  // أول ما الملف يتقرا: نحاول نطابق كل مخزن بفرع بنفس الاسم
  useEffect(() => {
    const normalize = (s: string) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    setWhMap((prev) => {
      const next: Record<string, string> = {};
      for (const w of warehouses) {
        if (prev[w]) { next[w] = prev[w]; continue; }
        const nw = normalize(w);
        const hit = (branches as any[]).find((b) => {
          const nb = normalize(b.name);
          return nb === nw || nb.includes(nw) || nw.includes(nb);
        });
        next[w] = hit?.id ?? "";
      }
      return next;
    });
  }, [warehouses, branches]);

  useEffect(() => {
    supabase.from("contacts").select("id, name").order("name").then(({ data }) => setSuppliers(data ?? []));
  }, []);


  const kind = (kindOverride || sheet?.kind || "") as LegacyKind | "";
  const isPurchase = kind === "purchase" || kind === "purchase_return";
  /** المورد الافتراضي مطلوب بس لو فيه مستند مفيهوش اسم مورد في الملف */
  const needsSupplier = isPurchase && docs.some((d) => !d.account.trim());

  const itemCount = useMemo(() => docs.reduce((s, d) => s + d.items.length, 0), [docs]);
  const grandTotal = useMemo(() => docs.reduce((s, d) => s + d.headerTotal, 0), [docs]);
  const warned = useMemo(() => docs.filter((d) => d.warnings.length), [docs]);
  const colAudit = useMemo(
    () => auditSheetColumns(docs, kindOverride || sheet?.kind || ""),
    [docs, kindOverride, sheet?.kind],
  );

  const branchName = (id: string) => (branches as any[]).find((b) => b.id === id)?.name ?? "—";

  /** المخازن اللي في الملف ومالهاش فرع مطابق على النظام */
  const unmappedWarehouses = useMemo(
    () => warehouses.filter((w) => !whMap[w] && docs.some((d) => d.warehouse === w && !d.branchId)),
    [warehouses, whMap, docs],
  );

  /** لازم نختار فرع افتراضي بس لو فيه مستند من غير مخزن */
  const needsDefaultBranch = useMemo(() => docs.some((d) => !d.warehouse && !d.branchId), [docs]);

  /** تقسيم المستندات على الفروع حسب المخزن (المخزن الفاضي → الفرع الافتراضي المختار) */
  const groups = useMemo(() => {
    const m = new Map<string, { warehouse: string; branchId: string; docs: LegacyDoc[] }>();
    for (const d of docs) {
      const target = d.branchId || (d.warehouse ? whMap[d.warehouse] || "" : branchId);
      const k = `${d.warehouse}|${target}`;
      if (!m.has(k)) m.set(k, { warehouse: d.warehouse || "", branchId: target, docs: [] });
      m.get(k)!.docs.push(d);
    }
    return [...m.values()];
  }, [docs, whMap, branchId]);

  const onFile = async (file: File) => {
    setResults(null);
    setSummary(null);

    setSheet(null);
    setDocs([]);
    setWhMap({});
    setContactMap({});
    setFileName(file.name);
    try {
      const parsed = await parseLegacyFile(file);
      setSheet(parsed);
      setDocs(parsed.docs);
      setKindOverride("");
      if (parsed.issues.length) parsed.issues.forEach((i) => toast.warning(i));
      else toast.success(`اتقرأ ${parsed.docs.length} مستند و ${parsed.itemCount} صنف`);
    } catch (e: any) {
      toast.error("فشلت قراءة الملف: " + e.message);
    }
  };


  const dryRun = async () => {
    if (needsDefaultBranch && !branchId) return toast.error("فيه مستندات من غير مخزن — اختار الفرع الافتراضي");

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
          supplierId: isPurchase ? supplierId || null : null, skipExisting, contactMap,
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
    if (needsDefaultBranch && !branchId) return toast.error("فيه مستندات من غير مخزن — اختار الفرع الافتراضي");
    if (!kind) return toast.error("حدّد نوع المستندات");
    if (needsSupplier && !supplierId) return toast.error("فيه فواتير من غير مورد في الملف — اختار المورد الافتراضي");

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
      const sums: BranchSummary[] = [];
      let inserted = 0, failed = 0, skipped = 0, base = 0;
      for (const g of groups) {
        const out = await runLegacyMigration({
          kind,
          branchId: g.branchId || branchId,
          userId: user!.id,
          label: (label.trim() || "ترحيل") + (g.warehouse ? ` — ${g.warehouse}` : ""),
          fileName,
          supplierId: isPurchase ? supplierId || null : null,
          contactMap,
          docs: g.docs,
          skipExisting,
          onProgress: (done) => setProgress({ done: base + done, total: docs.length }),
        });
        all.push(...out.results);
        inserted += out.inserted; failed += out.failed; skipped += out.skipped;
        base += g.docs.length;

        // ملخص الفرع: المستندات اللي اتسجلت فعلًا بس
        const done = new Set(out.results.filter((r) => r.ok && !r.skipped).map((r) => r.legacyNumber));
        const s: BranchSummary = {
          branchName: branchName(g.branchId || branchId),
          warehouse: g.warehouse || "بدون مخزن في الملف",
          docs: 0, items: 0, total: 0, credit: 0, byMethod: {},
        };
        for (const d of g.docs) {
          if (!done.has(d.legacyNumber)) continue;
          s.docs += 1;
          s.items += d.items.length;
          s.total += d.headerTotal;
          s.credit += Math.max(0, d.headerTotal - d.paid);
          for (const p of d.payments) {
            s.byMethod[p.method] = (s.byMethod[p.method] ?? 0) + Math.min(p.amount, d.headerTotal);
          }
        }
        if (s.docs) sums.push(s);
      }
      setResults(all);
      setSummary(sums);
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
      {/* ------------------------- الشرح بالعامية ------------------------- */}
      <Card className="p-4 space-y-3 border-primary/30 bg-gradient-to-l from-primary/5 to-transparent animate-fade-in">
        <div className="flex items-center gap-2 font-bold">
          <BookOpen className="w-4 h-4 text-primary" /> الصفحة دي بتعمل إيه؟
        </div>
        <p className="text-sm leading-7 text-muted-foreground">
          دي الصفحة اللي بترفع بيها فواتيرك القديمة (اللي على Excel) وتخليها فواتير حقيقية جوه نظام.
          يعني الفاتورة مش بتتسجل «ورقة» — لأ، بتتحرّك في المخزن، وتدخّل فلوس الخزنة، وتقيّد على حساب العميل أو المورد،
          وتعمل قيد يومية زي أي فاتورة بتعملها بإيدك من الشاشات العادية. عشان كده ركّز في المراجعة قبل ما تعتمد.
        </p>

        <div className="text-sm font-bold pt-1">ارفع بالترتيب ده — مهم جدًا 👇</div>
        <div className="grid md:grid-cols-4 gap-2">
          {[
            { n: "١", t: "فواتير الشراء", d: "الأول خالص — منها بتتولد المنتجات نفسها وتكلفتها وأرصدة المخزن." },
            { n: "٢", t: "فواتير البيع", d: "بعد الشراء — لأنها بتخصم من المخزون، ولو المنتج مش موجود الفاتورة هتقف." },
            { n: "٣", t: "مرتجع البيع", d: "بعد البيع — بيتربط بالفاتورة الأصلية برقمها القديم." },
            { n: "٤", t: "مرتجع الشراء", d: "آخر حاجة — بيتربط بفاتورة الشراء الأصلية." },
          ].map((s, i) => (
            <div key={s.n} className="rounded-xl border p-3 bg-surface-2/50 hover:border-primary/40 transition-colors animate-fade-in"
              style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-center gap-2 font-bold text-sm">
                <span className="w-6 h-6 rounded-full bg-primary/15 text-primary grid place-items-center text-xs">{s.n}</span>
                {s.t}
              </div>
              <div className="text-xs text-muted-foreground leading-5 mt-1">{s.d}</div>
            </div>
          ))}
        </div>

        <div className="text-xs text-muted-foreground leading-6 bg-muted/40 rounded-lg p-3">
          <b>خطوات الشغل:</b> ١ ترفع الملف ← ٢ تحدد النوع وتربط كل مخزن بفرعه وكل اسم بحسابه ← ٣ تراجع وتعدّل البيانات
          (تمسح فاتورة، تظبط سعر أو تكلفة) ← ٤ فحص تجريبي (مبيسجّلش حاجة، بس بيقولك هيحصل إيه) ← ٥ تعتمد وترحّل.
          <br />
          الفرع مبتختروش من فوق — بيتحدد من عمود <b>المخزن</b> اللي جوه الملف، وانت بتربط كل مخزن بفرعه.
        </div>

        {/* أعمدة قالب نظام — بتتفحص حسب الشيت المرفوع */}
        <div className={`rounded-lg border p-3 space-y-2 animate-fade-in ${
          !sheet ? "border-border bg-muted/30"
            : colAudit.missing.length ? "border-warning/40 bg-warning/5"
            : "border-success/40 bg-success/5"
        }`}>
          <div className={`text-sm font-bold flex items-center gap-2 ${
            !sheet ? "" : colAudit.missing.length ? "text-warning" : "text-success"
          }`}>
            {!sheet ? <><BookOpen className="w-4 h-4" /> الأعمدة اللي النظام بيقراها</>
              : colAudit.missing.length
                ? <><AlertTriangle className="w-4 h-4" /> ملفك ناقصه {colAudit.missing.length} عمود من {colAudit.total} ({colAudit.missingRequired.length} منهم مهمين للنوع ده) — اتعوّضوا بقيم افتراضية</>
                : <><CheckCircle2 className="w-4 h-4" /> ملفك فيه كل الأعمدة اللي النظام محتاجها 👏</>}
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            {!sheet
              ? "دي كل الأعمدة اللي النظام بيشتغل بيها. ارفع الملف وهقولك على طول إيه الموجود فيه وإيه الناقص."
              : "قارنّا الشيت بتاعك بمتطلبات النظام للنوع ده. أي عمود ناقص النظام حطّ مكانه القيمة الافتراضية المكتوبة تحت، وظلّله بالأصفر في جدول المراجعة عشان تعدّله قبل الاعتماد."}
          </p>

          {sheet && colAudit.present.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {colAudit.present.map((c) => (
                <Badge key={c.key} variant="outline" className="border-success/40 text-success bg-success/10 text-[11px]">
                  <CheckCircle2 className="w-3 h-3 ml-1" /> {c.col}
                </Badge>
              ))}
            </div>
          )}

          {sheet && colAudit.missingRequired.length > 0 && (
            <div className="text-[11px] font-bold text-destructive">أعمدة مهمة ناقصة — راجعها كويس:</div>
          )}
          <div className="grid md:grid-cols-2 gap-1.5">
            {(sheet ? colAudit.missingRequired : COLUMN_HELP).map((c) => (
              <div key={c.key} className={`text-[11px] leading-5 rounded-lg px-2 py-1.5 border ${
                sheet ? "border-destructive/40 bg-destructive/5" : "border-border/50 bg-background/60"}`}>
                <b className="text-foreground">{c.col}</b> — {c.what}. <span className="text-muted-foreground">{c.need}</span>
                {sheet && <div className="text-warning mt-0.5">القيمة الافتراضية: {c.fallback}</div>}
              </div>
            ))}
          </div>

          {sheet && colAudit.missingOptional.length > 0 && (
            <>
              <div className="text-[11px] font-bold text-muted-foreground">ناقصة كمان بس مش حرجة للنوع ده:</div>
              <div className="grid md:grid-cols-2 gap-1.5">
                {colAudit.missingOptional.map((c) => (
                  <div key={c.key} className="text-[11px] leading-5 rounded-lg bg-background/60 border border-border/50 px-2 py-1.5">
                    <b className="text-foreground">{c.col}</b> — {c.what}.
                    <span className="text-muted-foreground"> القيمة الافتراضية: {c.fallback}</span>
                  </div>
                ))}
              </div>
            </>
          )}


          <Button variant="outline" size="sm" onClick={() => downloadLegacyTemplate(kindOverride || sheet?.kind || "")}>
            <Download className="w-4 h-4 ml-1" /> نزّل قالب نظام (بالأعمدة الكاملة + شرح)
          </Button>
        </div>

      </Card>

      <Card className="p-4 space-y-4">
        <div className="text-sm font-bold flex items-center gap-2">
          <Badge className="bg-primary text-primary-foreground">١</Badge> ارفع الملف
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>اسم دفعة الترحيل</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثال: داتا معرض عبد المنعم" />
          </div>
          <div className="space-y-1">
            <Label>ملف الفواتير (Excel)</Label>
            <label className="cursor-pointer block">
              <Button asChild className="w-full"><span><Upload className="w-4 h-4 ml-1" /> رفع Excel</span></Button>
              <input type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          </div>
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
            <div className="p-3 rounded border bg-primary/10"><div className="text-xs text-primary">أصناف</div><div className="text-xl font-bold text-primary">{itemCount}</div></div>
            <div className="p-3 rounded border bg-success/10"><div className="text-xs text-success">الإجمالي</div><div className="text-lg font-bold text-success">{formatEGP(grandTotal)}</div></div>
            <div className="p-3 rounded border bg-warning/10"><div className="text-xs text-warning">فيها ملاحظات</div><div className="text-xl font-bold text-warning">{warned.length}</div></div>
          </div>

          <div className="text-sm font-bold flex items-center gap-2 pt-1">
            <Badge className="bg-primary text-primary-foreground">٢</Badge> النوع وربط المخازن بالفروع
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
            {isPurchase && (
              <div className="space-y-1">
                <Label>
                  المورد الافتراضي {needsSupplier ? "(مطلوب — فيه فواتير من غير مورد)" : "(اختياري — كل الفواتير فيها مورد)"}
                </Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger className={needsSupplier && !supplierId ? "border-warning" : ""}>
                    <SelectValue placeholder="اختار المورد" />
                  </SelectTrigger>
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

          {fileAccounts.length > 0 && (
            <LegacyAccountsMapper
              names={fileAccounts}
              isPurchase={isPurchase}
              value={contactMap}
              onChange={setContactMap}
            />
          )}

          {(warehouses.length > 0 || needsDefaultBranch) && (
            <div className={`border rounded-lg p-3 space-y-2 ${unmappedWarehouses.length || (needsDefaultBranch && !branchId) ? "border-warning bg-warning/5" : "bg-muted/30"}`}>
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
                {warehouses.map((w) => (
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
                {needsDefaultBranch && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="shrink-0 max-w-[45%] truncate">مستندات من غير مخزن</Badge>
                    <span className="text-muted-foreground text-xs">←</span>
                    <Select value={branchId} onValueChange={setBranchId}>
                      <SelectTrigger className={`h-9 ${!branchId ? "border-warning" : ""}`}>
                        <SelectValue placeholder="اختار الفرع الافتراضي" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {groups.length > 1
                  ? `الملف ده هيتقسم على ${groups.length} مجموعة ترحيل — كل مجموعة على فرعها.`
                  : "كل المستندات هتترحّل على فرع واحد."}
              </div>
            </div>
          )}

          <div className="text-sm font-bold flex items-center gap-2 pt-1">
            <Badge className="bg-primary text-primary-foreground">٣</Badge> راجع وعدّل البيانات قبل الاعتماد
          </div>
          <LegacyDocsEditor docs={docs} onChange={setDocs} missing={colAudit.missingKeys}
            partyType={isPurchase ? "supplier" : "customer"}
            branches={branches.map((b: any) => ({ id: b.id, name: b.name }))}
            resolveBranch={(d) => (d.warehouse ? whMap[d.warehouse] || "" : branchId)} />




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

          <div className="text-sm font-bold flex items-center gap-2 pt-1">
            <Badge className="bg-primary text-primary-foreground">٤</Badge> فحص تجريبي قبل الاعتماد
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

              <div className="overflow-x-auto rounded-lg border border-border/60 m-3 mt-0">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-surface-2 sticky top-0 z-10">
                    <tr className="border-b-2 border-border">
                      {["الرقم القديم", "التاريخ", "الحساب", "الفرع", "الإجمالي", "الحالة", "التفاصيل"].map((h) => (
                        <th key={h} className="px-2 py-2.5 font-extrabold text-center whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.docs.map((d, i) => (
                      <tr
                        key={d.legacyNumber + i}
                        className={`border-b border-border/50 transition-colors hover:bg-primary/5 animate-fade-in ${
                          d.status === "blocked" ? "bg-destructive/5"
                            : d.status === "warning" ? "bg-warning/5"
                            : i % 2 ? "bg-surface-2/30" : ""
                        }`}
                      >
                        <td className="px-2 py-2 text-center font-bold tabular-nums">{d.legacyNumber || "—"}</td>
                        <td className="px-2 py-2 text-center whitespace-nowrap tabular-nums text-muted-foreground">{d.dateISO.replace("T", " ")}</td>
                        <td className="px-2 py-2 text-right">{d.account || "—"}</td>
                        <td className="px-2 py-2 text-center text-muted-foreground">{d.branchName || "—"}</td>
                        <td className="px-2 py-2 text-center font-bold tabular-nums whitespace-nowrap">{formatEGP(d.total)}</td>
                        <td className="px-2 py-2 text-center">
                          {d.status === "blocked" ? <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" /> متوقف</Badge>
                            : d.status === "warning" ? <Badge className="bg-warning/15 text-warning">ملاحظات</Badge>
                            : d.status === "skip" ? <Badge variant="outline">هيتخطى</Badge>
                            : <Badge className="bg-success/15 text-success gap-1"><CheckCircle2 className="w-3 h-3" /> سليم</Badge>}
                        </td>
                        <td className="px-2 py-2 text-right text-muted-foreground leading-5">
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
              ٤ · فحص تجريبي قبل الاعتماد (إجباري)
            </Button>
            <Button onClick={start} disabled={busy || !docs.length || !report} className="w-full btn-gradient">
              {busy ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Boxes className="w-4 h-4 ml-2" />}
              {report ? `٥ · اعتمد وارفع ${docs.length} مستند` : "اعمل الفحص الأول"}
            </Button>
          </div>

        </Card>
      )}

      {summary && summary.length > 0 && (
        <Card className="p-4 space-y-3 border-success/40 bg-gradient-to-l from-success/5 to-transparent animate-fade-in">
          <div className="flex items-center gap-2 font-bold">
            <CheckCircle2 className="w-4 h-4 text-success" /> راح فين بالظبط؟ (بعد الاعتماد)
          </div>
          <p className="text-xs text-muted-foreground leading-6">
            دي كل فاتورة اتسجلت فعلًا — اتحطت في أنهي فرع، والفلوس دخلت أنهي خزنة، والباقي على الحساب كام.
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            {summary.map((s, i) => (
              <div key={i} className="rounded-xl border p-3 space-y-2 bg-surface-2/40 animate-fade-in" style={{ animationDelay: `${i * 70}ms` }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <Building2 className="w-4 h-4 text-primary" /> {s.branchName}
                  </div>
                  <Badge variant="outline" className="text-[11px]">مخزن الملف: {s.warehouse}</Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg border p-2"><div className="text-muted-foreground">مستندات</div><div className="text-lg font-bold">{s.docs}</div></div>
                  <div className="rounded-lg border p-2 bg-primary/10"><div className="text-primary">أصناف</div><div className="text-lg font-bold text-primary">{s.items}</div></div>
                  <div className="rounded-lg border p-2 bg-success/10"><div className="text-success">الإجمالي</div><div className="text-sm font-bold text-success">{formatEGP(s.total)}</div></div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-semibold flex items-center gap-1"><Wallet className="w-3.5 h-3.5 text-primary" /> الخزن اللي اتأثرت</div>
                  {Object.entries(s.byMethod).filter(([, v]) => v > 0).length === 0 && (
                    <div className="text-xs text-muted-foreground">مفيش فلوس اتحصّلت — كله آجل.</div>
                  )}
                  {Object.entries(s.byMethod).filter(([, v]) => v > 0).map(([m, v]) => (
                    <div key={m} className="flex items-center justify-between text-xs rounded-lg bg-background/60 border border-border/50 px-2 py-1.5">
                      <span className="flex items-center gap-1.5"><Banknote className="w-3.5 h-3.5 text-success" /> {METHOD_LABEL[m] ?? m}</span>
                      <b className="tabular-nums text-success">{formatEGP(v)}</b>
                    </div>
                  ))}
                  {s.credit > 0.5 && (
                    <div className="flex items-center justify-between text-xs rounded-lg bg-warning/10 border border-warning/30 px-2 py-1.5">
                      <span>آجل على الحساب</span>
                      <b className="tabular-nums text-warning">{formatEGP(s.credit)}</b>
                    </div>
                  )}
                </div>
              </div>
            ))}
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
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-surface-2 sticky top-0">
                <tr className="border-b-2 border-border">
                  {["الرقم القديم", "الحالة", "رقم النظام", "الإجمالي", "ملاحظة / خطأ"].map((h) => (
                    <th key={h} className="px-2 py-2.5 font-extrabold text-center whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={r.legacyNumber + i}
                    className={`border-b border-border/50 transition-colors hover:bg-primary/5 animate-fade-in ${
                      r.error ? "bg-destructive/5" : i % 2 ? "bg-surface-2/30" : ""}`}>
                    <td className="px-2 py-2 text-center font-bold tabular-nums">{r.legacyNumber}</td>
                    <td className="px-2 py-2 text-center">
                      {r.skipped
                        ? <Badge variant="outline">متخطي</Badge>
                        : r.ok ? <Badge className="bg-success/15 text-success gap-1"><CheckCircle2 className="w-3 h-3" /> تم</Badge> : <Badge variant="destructive">فشل</Badge>}
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums">{r.number ?? "—"}</td>
                    <td className="px-2 py-2 text-center font-bold tabular-nums whitespace-nowrap">{formatEGP(r.total)}</td>
                    <td className={`px-2 py-2 text-right ${r.error ? "text-destructive" : "text-muted-foreground"}`}>{r.error ?? r.note ?? ""}</td>
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

export default function DataMigration({ embedded = false }: { embedded?: boolean }) {
  const Wrap: any = embedded ? (({ children }: any) => <div>{children}</div>) : AdminLayout;
  return (
    <Wrap>
      {!embedded && <PageHeader
        title="ترحيل الفواتير القديمة"
        subtitle="ارفع ملفات الفواتير زي ما هي (بيع / شراء / مرتجع بيع / مرتجع شراء) — النوع بيتحدد تلقائيًا من اسم الملف أو محتواه"
      />}
      <Tabs defaultValue="docs">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="docs">الفواتير والمرتجعات</TabsTrigger>
          <TabsTrigger value="debt">ترحيل الديون كفواتير</TabsTrigger>
        </TabsList>
        <TabsContent value="docs" className="mt-4"><LegacyPanel /></TabsContent>
        <TabsContent value="debt" className="mt-4"><LegacyDebtImport /></TabsContent>
      </Tabs>
    </Wrap>
  );
}

