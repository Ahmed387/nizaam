import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, FileSpreadsheet, Layers, Loader2, Pencil, Printer, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { exportToExcel } from "@/lib/export";
import { formatDate, formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { openDocs, OPEN_DOCS_MAX } from "@/lib/openDocs";
import { printDocuments, type PrintFormat } from "@/lib/bulkPrint";
import {
  BULK_LABEL, cancelDoc, docAmount, docDate, docNotes, docNumber, docParty, docPath, docRecipient, isVoucherKind,
  movingMoney, runBulk, setDocDate, setDocNotes, type BulkKind, type BulkResult,
} from "@/lib/bulkDocs";

interface Props {
  kind: BulkKind;
  branchId: string;
  rows: any[];
  onSelectPage: () => void;
  /** selects every document of the current filters (all pages) */
  onSelectAll?: () => Promise<void>;
  totalCount: number;
  onClear: () => void;
  onDone: () => void;
  /** extra buttons for this tab (e.g. «تحويل لنقدي / لآجل») */
  extra?: ReactNode;
}

/** The selection bar of a document table: open as tabs, print, export, edit and cancel the selected documents. */
export function BulkActionsBar({ kind, branchId, rows, onSelectPage, onSelectAll, totalCount, onClear, onDone, extra }: Props) {
  const nav = useNavigate();
  const { isAdmin, isOwner, isSuperAdmin, hasRole } = useAuth();
  const isManager = hasRole("branch_manager");
  const label = BULK_LABEL[kind];
  const [busyAll, setBusyAll] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [results, setResults] = useState<{ title: string; list: BulkResult[] } | null>(null);

  const active = useMemo(() => rows.filter((r) => (r.status ?? "active") !== "cancelled"), [rows]);
  const total = useMemo(() => rows.reduce((s, r) => s + docAmount(kind, r), 0), [rows, kind]);
  const canCancelKind = kind === "sale_return" || kind === "purchase_return" ? (isOwner || isSuperAdmin) : isVoucherKind(kind);
  const canCancelRow = (r: any) => (r.status ?? "active") === "active"
    && (isVoucherKind(kind) ? (isAdmin || (isManager && r.source === "manual")) : (isOwner || isSuperAdmin));

  const openAll = () => {
    const list = rows.slice(0, OPEN_DOCS_MAX).map((r) => ({ path: docPath(kind, branchId, r), label: docNumber(kind, r) }));
    openDocs(list);
    if (rows.length > OPEN_DOCS_MAX) toast.info(`اتفتح أول ${OPEN_DOCS_MAX} بس — أقصى عدد تابات`);
    if (list[0]) nav(list[0].path);
  };

  const exportSel = () => {
    exportToExcel(`${label.one}-محدد`, [{
      name: label.one,
      rows: rows.map((r, i) => ({
        "#": i + 1,
        "الرقم": docNumber(kind, r),
        [kind === "purchase" || kind === "purchase_return" ? "المورد" : isVoucherKind(kind) ? "الطرف" : "العميل"]: docParty(kind, r),
        "المبلغ": docAmount(kind, r),
        "التاريخ": formatDate(docDate(kind, r)),
        "الحالة": (r.status ?? "active") === "cancelled" ? "ملغي" : "نشط",
        "المستلم": docRecipient(kind, r),
        "الملاحظات": docNotes(kind, r),
      })),
    }]);
  };

  const selectAll = async () => {
    if (!onSelectAll) return;
    setBusyAll(true);
    try { await onSelectAll(); } catch (e: any) { toast.error(e?.message ?? "تعذر تحديد كل النتائج"); } finally { setBusyAll(false); }
  };

  const finish = (title: string, list: BulkResult[]) => {
    setResults({ title, list });
    onDone();
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <Button size="sm" variant="ghost" className="h-7" onClick={onSelectPage}>تحديد كل الصفحة</Button>
      {onSelectAll && totalCount > 0 && (
        <Button size="sm" variant="ghost" className="h-7" disabled={busyAll} onClick={selectAll}>
          {busyAll && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}تحديد كل النتائج ({totalCount.toLocaleString("en-US")})
        </Button>
      )}
      {rows.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 shadow-sm">
          <span className="font-bold">محدد {rows.length.toLocaleString("en-US")} {label.many}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums">الإجمالي {formatEGP(total)}</span>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={openAll}><Layers className="h-3.5 w-3.5" />فتح الكل</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setPrintOpen(true)}><Printer className="h-3.5 w-3.5" />طباعة الكل</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={exportSel}><FileSpreadsheet className="h-3.5 w-3.5" />تصدير المحدد</Button>
          {active.length > 0 && <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setEditOpen(true)}><Pencil className="h-3.5 w-3.5" />تعديل الكل</Button>}
          {canCancelKind && active.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 gap-1 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setCancelOpen(true)}>
              <XCircle className="h-3.5 w-3.5" />إلغاء الكل
            </Button>
          )}
          {extra}
          <Button size="sm" variant="ghost" className="h-7" onClick={onClear}>إلغاء التحديد</Button>
        </div>
      )}

      <PrintDialog open={printOpen} onOpenChange={setPrintOpen} count={rows.length}
        onPick={async (f) => {
          setPrintOpen(false);
          try { await printDocuments(kind, rows.map((r) => r.id), f); } catch (e: any) { toast.error(e?.message ?? "تعذر الطباعة"); }
        }} />
      {editOpen && (
        <BulkEditDialog kind={kind} rows={active} canDate={isAdmin} onClose={() => setEditOpen(false)}
          onFinished={(list) => { setEditOpen(false); finish("نتيجة التعديل", list); }} />
      )}
      {cancelOpen && (
        <BulkCancelDialog kind={kind} rows={rows} canCancelRow={canCancelRow} onClose={() => setCancelOpen(false)}
          onFinished={(list) => { setCancelOpen(false); onClear(); finish("نتيجة الإلغاء", list); }} />
      )}
      <ResultsDialog results={results} onClose={() => setResults(null)} />
    </div>
  );
}

function PrintDialog({ open, onOpenChange, count, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; count: number; onPick: (f: PrintFormat) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-sm text-right">
        <DialogHeader>
          <DialogTitle>طباعة {count.toLocaleString("en-US")} مستند</DialogTitle>
          <DialogDescription>كل مستند هيطلع في صفحة لوحده، في ملف واحد.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-20 flex-col gap-1" onClick={() => onPick("a4")}><Printer className="h-5 w-5" />A4</Button>
          <Button variant="outline" className="h-20 flex-col gap-1" onClick={() => onPick("thermal")}><Printer className="h-5 w-5" />حراري (ريسيت 80مم)</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BulkEditDialog({ kind, rows, canDate, onClose, onFinished }: {
  kind: BulkKind; rows: any[]; canDate: boolean; onClose: () => void; onFinished: (list: BulkResult[]) => void;
}) {
  const [notesOn, setNotesOn] = useState(false);
  const [notesMode, setNotesMode] = useState<"replace" | "append">("append");
  const [notes, setNotes] = useState("");
  const [dateOn, setDateOn] = useState(false);
  const [day, setDay] = useState(cairoTodayDay());
  const [step, setStep] = useState<"form" | "preview">("form");
  const [running, setRunning] = useState(0);
  const [busy, setBusy] = useState(false);
  const today = cairoTodayDay();

  const newNotes = (r: any) => {
    const old = docNotes(kind, r).trim();
    const add = notes.trim();
    return notesMode === "replace" || !old ? add : `${old} — ${add}`;
  };
  const moving = rows.reduce((s, r) => s + (dateOn ? movingMoney(kind, r) : 0), 0);
  const valid = (notesOn && (notes.trim() || notesMode === "replace")) || (dateOn && day && day <= today);

  const run = async () => {
    setBusy(true);
    const list = await runBulk(kind, rows, async (r) => {
      if (notesOn) await setDocNotes(kind, r, newNotes(r));
      if (dateOn) await setDocDate(kind, r, day);
    }, setRunning);
    setBusy(false);
    onFinished(list);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto text-right">
        <DialogHeader>
          <DialogTitle>تعديل {rows.length.toLocaleString("en-US")} {BULK_LABEL[kind].many}</DialogTitle>
          <DialogDescription>المستلم مقفول بعد إصدار المستند فمش بيتعدل. الملغي مش داخل في التعديل.</DialogDescription>
        </DialogHeader>

        {step === "form" ? (
          <div className="space-y-4">
            <div className="space-y-2 rounded-lg border p-3">
              <label className="flex items-center gap-2 font-semibold"><Checkbox checked={notesOn} onCheckedChange={(v) => setNotesOn(!!v)} />الملاحظات</label>
              {notesOn && (<>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={notesMode === "append"} onChange={() => setNotesMode("append")} />تتضاف بعد الملاحظات الموجودة</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={notesMode === "replace"} onChange={() => setNotesMode("replace")} />تحل محل الملاحظات الموجودة</label>
                </div>
                <Textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اكتب الملاحظة" />
              </>)}
            </div>
            {canDate && (
              <div className="space-y-2 rounded-lg border p-3">
                <label className="flex items-center gap-2 font-semibold"><Checkbox checked={dateOn} onCheckedChange={(v) => setDateOn(!!v)} />التاريخ</label>
                {dateOn && (<>
                  <div className="flex items-center gap-2">
                    <Label className="shrink-0">التاريخ الجديد</Label>
                    <Input type="date" className="w-48" max={today} value={day} onChange={(e) => setDay(e.target.value)} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {kind === "purchase"
                      ? "فاتورة الشراء بتتنقل هي وقيدها، لكن دفعاتها بتفضل في أيامها. لو الفاتورة كانت نقدي ممكن تبقى آجل بعد النقل، فاستخدم «تحويل لنقدي» بعدها."
                      : "الفلوس اللي اتدفعت مع المستند يومه بتتنقل معاه هي وخزنتها، والمراجعة هتوريك المبالغ قبل التنفيذ."}
                  </p>
                </>)}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              هيتنقل {rows.length.toLocaleString("en-US")} {BULK_LABEL[kind].many} لتاريخ <b>{formatDate(day)}</b>
              {moving > 0 && <> ومعاهم فلوس <b>{formatEGP(moving)}</b> هتتشال من خزنة أيامها القديمة وتتحط في خزنة يوم {formatDate(day)}</>}.
              {notesOn && <> والملاحظات {notesMode === "replace" ? "هتتغير" : "هيتضاف لها"}: «{notes.trim() || "—"}».</>}
            </div>
            <div className="max-h-[45vh] overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted"><tr>
                  <th className="p-2">الرقم</th><th className="p-2 text-right">الطرف</th><th className="p-2">المبلغ</th>
                  <th className="p-2">التاريخ الحالي</th><th className="p-2">الجديد</th><th className="p-2">فلوس هتتنقل معاه</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const same = (docDate(kind, r) ?? "").slice(0, 10) === day;
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 text-center font-mono">{docNumber(kind, r)}</td>
                        <td className="p-2">{docParty(kind, r)}</td>
                        <td className="p-2 text-center tabular-nums">{formatEGP(docAmount(kind, r))}</td>
                        <td className="p-2 text-center">{formatDate(docDate(kind, r))}</td>
                        <td className={`p-2 text-center ${same ? "text-muted-foreground" : "font-bold"}`}>{same ? "نفس اليوم" : formatDate(day)}</td>
                        <td className="p-2 text-center tabular-nums">{movingMoney(kind, r) > 0 ? formatEGP(movingMoney(kind, r)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">لو مستند في فترة مقفولة أو مش مسموح لك، هيترفض لوحده والباقي يكمل، والنتيجة هتوضح كل واحد.</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={step === "preview" ? () => setStep("form") : onClose}>{step === "preview" ? "رجوع" : "إلغاء"}</Button>
          {step === "form" && dateOn ? (
            <Button disabled={!valid} onClick={() => setStep("preview")}>مراجعة قبل التنفيذ</Button>
          ) : (
            <Button disabled={!valid || busy} onClick={run}>
              {busy && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
              {busy ? `جاري التنفيذ ${running}/${rows.length}` : "تنفيذ"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkCancelDialog({ kind, rows, canCancelRow, onClose, onFinished }: {
  kind: BulkKind; rows: any[]; canCancelRow: (r: any) => boolean; onClose: () => void; onFinished: (list: BulkResult[]) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(0);
  const ok = rows.filter(canCancelRow);
  const skipped = rows.length - ok.length;
  const total = ok.reduce((s, r) => s + docAmount(kind, r), 0);

  const run = async () => {
    setBusy(true);
    const list = await runBulk(kind, ok, (r) => cancelDoc(kind, r, reason.trim()), setRunning);
    setBusy(false);
    onFinished(list);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-lg text-right">
        <DialogHeader>
          <DialogTitle>إلغاء {ok.length.toLocaleString("en-US")} {BULK_LABEL[kind].many}</DialogTitle>
          <DialogDescription>
            كل واحد بيتلغي بقواعده: {kind === "sale_return" || kind === "purchase_return"
              ? "البضاعة بترجع والفلوس اللي لسه برا بس هي اللي بترجع للخزنة، والمرتجع اللي بضاعته اتباعت تاني بيترفض."
              : "السند بيفضل ظاهر كـ «ملغي» وأثره بيتعكس في يومه الأصلي."} الإجمالي {formatEGP(total)}.
          </DialogDescription>
        </DialogHeader>
        {skipped > 0 && <div className="rounded-md bg-warning/10 p-2 text-xs text-warning">{skipped} مش هيتلغوا (ملغيين بالفعل أو مش مسموح لك تلغيهم).</div>}
        <div className="space-y-1.5">
          <Label>سبب الإلغاء (لكل المحدد)</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>تراجع</Button>
          <Button variant="destructive" disabled={busy || !reason.trim() || !ok.length} onClick={run}>
            {busy && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
            {busy ? `جاري الإلغاء ${running}/${ok.length}` : "تأكيد الإلغاء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultsDialog({ results, onClose }: { results: { title: string; list: BulkResult[] } | null; onClose: () => void }) {
  if (!results) return null;
  const done = results.list.filter((x) => x.ok).length;
  const failed = results.list.filter((x) => !x.ok);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-lg text-right">
        <DialogHeader>
          <DialogTitle>{results.title}</DialogTitle>
          <DialogDescription>
            <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" />تم {done}</span>
            {failed.length > 0 && <span className="mr-3 inline-flex items-center gap-1 text-destructive"><XCircle className="h-4 w-4" />اترفض {failed.length}</span>}
          </DialogDescription>
        </DialogHeader>
        {failed.length > 0 && (
          <div className="max-h-[50vh] space-y-1 overflow-auto text-sm">
            {failed.map((f) => (
              <div key={f.id} className="rounded border border-destructive/30 bg-destructive/5 p-2">
                <b className="font-mono">{f.number}</b>: {f.message}
              </div>
            ))}
          </div>
        )}
        <DialogFooter><Button onClick={onClose}>تمام</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
