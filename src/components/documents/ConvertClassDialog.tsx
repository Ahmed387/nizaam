import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PaymentMethodPicker, emptyPaymentValue, type PaymentMethodValue } from "@/components/PaymentMethodPicker";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";
import { uploadRecordAttachment } from "@/lib/attachmentUpload";
import { formatEGP, formatDate } from "@/lib/format";
import { rpcErrorText } from "@/lib/rpcError";
import { AlertTriangle, ArrowLeftRight, Info, Loader2 } from "lucide-react";

export type ClassTarget = "cash" | "credit";
type DocType = "invoice" | "shipment";

interface Move { id: string; amount: number; day: string; method: string; voucher: string | null }
interface Warn { code: string; level: "info" | "warning"; text: string }
interface PlanRow {
  doc_id: string; number?: string; date?: string; total?: number; status: "ok" | "skip" | "error" | "done"; message?: string | null;
  keep?: number; moves?: Move[]; moved?: number; credit_release?: number; new_amount?: number; method?: string; fee?: number;
  displaced?: number; voids?: Move[]; void_total?: number; till_before?: number; till_after?: number; warnings?: Warn[];
  voucher_id?: string | null;
}

const REASONS = ["اتسجلت غلط وقت الإدخال", "الدفع اتأجل", "الفلوس اتدفعت يوم الفاتورة فعلاً", "تصحيح بعد مراجعة الخزنة"];
const n = (v: unknown) => Number(v) || 0;
const methodLabel = (m?: string | null) => (PAYMENT_METHOD_LABELS as Record<string, string>)[m ?? "cash"] ?? m ?? "كاش";

/**
 * «تحويل لنقدي / تحويل لآجل» (owner decision 2026-10-16, migration 0093). The class is what the money says, so the
 * button moves the money on the right days: to نقدي = own later payments move to the invoice day + a new payment
 * for the rest (method chosen); to آجل = the invoice-day payments are cancelled on their own day. One preview with
 * every document, then one confirm. Works for one invoice (from the invoice / the table badge) or a selection.
 */
export function ConvertClassDialog({ open, onOpenChange, docType, ids, target, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  docType: DocType;
  ids: string[];
  target: ClassTarget;
  onDone?: () => void;
}) {
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pay, setPay] = useState<PaymentMethodValue>(() => emptyPaymentValue("cash"));
  const [reasonPick, setReasonPick] = useState<string>("");
  const [reasonText, setReasonText] = useState("");
  const [ackWarn, setAckWarn] = useState(false);
  const [saving, setSaving] = useState(false);
  const single = ids.length === 1;
  const docWord = docType === "invoice" ? "فاتورة بيع" : "فاتورة شراء";

  useEffect(() => {
    if (!open) return;
    setPay(emptyPaymentValue("cash")); setReasonPick(""); setReasonText(""); setAckWarn(false); setRows(null);
  }, [open, target, ids.join(",")]);

  // preview: again when the method changes (the transfer fee depends on it)
  useEffect(() => {
    if (!open || ids.length === 0) return;
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("document_class_preview" as any, {
        p_doc_type: docType, p_ids: ids, p_target: target, p_method: target === "cash" ? pay.method : "cash",
      } as any);
      if (!live) return;
      setLoading(false);
      if (error) { toast.error(rpcErrorText(error, "معاينة التحويل")); setRows([]); return; }
      setRows(((data ?? []) as any[]).map((r) => ({ ...r, warnings: r.warnings ?? [], moves: r.moves ?? [], voids: r.voids ?? [] })));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [open, docType, ids.join(","), target, pay.method]);

  const ok = useMemo(() => (rows ?? []).filter((r) => r.status === "ok"), [rows]);
  const skipped = useMemo(() => (rows ?? []).filter((r) => r.status === "skip"), [rows]);
  const errors = useMemo(() => (rows ?? []).filter((r) => r.status === "error"), [rows]);
  const totals = useMemo(() => ({
    newAmount: ok.reduce((s, r) => s + n(r.new_amount), 0),
    moved: ok.reduce((s, r) => s + n(r.moved), 0),
    voided: ok.reduce((s, r) => s + n(r.void_total), 0),
    fee: ok.reduce((s, r) => s + n(r.fee), 0),
    hard: ok.some((r) => (r.warnings ?? []).some((w) => w.level === "warning")),
  }), [ok]);
  const reason = (reasonPick === "__other" ? reasonText : reasonPick).trim();
  const needsMethod = target === "cash" && totals.newAmount > 0.005;
  const canSave = !saving && !loading && ok.length > 0 && reason.length > 0 && (!totals.hard || ackWarn);

  const confirmLabel = target === "cash"
    ? (single && ok[0]
        ? (n(ok[0].new_amount) > 0
            ? `ادفع ${formatEGP(n(ok[0].new_amount))} ${methodLabel(pay.method)} بتاريخ ${formatDate(ok[0].date!)}`
            : `انقل الدفعات ليوم ${formatDate(ok[0].date!)}`)
        : `حوّل ${ok.length} لنقدي${totals.newAmount > 0 ? ` — ${formatEGP(totals.newAmount)} ${methodLabel(pay.method)}` : ""}`)
    : (single && ok[0]
        ? `ألغِ ${ok[0].voids?.map((v) => v.voucher ?? "الدفعة").join(" و ")} يوم ${formatDate(ok[0].date!)}`
        : `حوّل ${ok.length} لآجل — إلغاء ${formatEGP(totals.voided)}`);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("document_class_convert" as any, {
      p_doc_type: docType, p_ids: ok.map((r) => r.doc_id), p_target: target,
      p_method: target === "cash" ? pay.method : "cash",
      p_reference: pay.reference_number ?? null, p_transfer_from: pay.transfer_from_account ?? null,
      p_transfer_to: pay.transfer_to_account ?? null, p_reason: reason,
    } as any);
    if (error) { setSaving(false); toast.error(rpcErrorText(error, "التحويل")); return; }
    const res = (data ?? []) as PlanRow[];
    const done = res.filter((r) => r.status === "done");
    const failed = res.filter((r) => r.status === "error");
    // transfer receipt: one invoice, non-cash new payment → on its new voucher
    const files = (pay.proof_files ?? []).filter((f) => f instanceof File);
    if (single && files.length && done[0]?.voucher_id && pay.method !== "cash") {
      const { data: auth } = await supabase.auth.getUser();
      for (const f of files) {
        try { await uploadRecordAttachment("voucher", done[0].voucher_id, f, auth.user?.id ?? null); }
        catch (e: any) { toast.error(`إيصال ${f.name}: ${e?.message ?? "فشل الرفع"}`); }
      }
    }
    setSaving(false);
    if (done.length) {
      toast.success(done.length === 1
        ? `تم — ${done[0].number} بقت ${target === "cash" ? "نقدي" : "آجل"}`
        : `تم تحويل ${done.length} فاتورة ل${target === "cash" ? "نقدي" : "آجل"}`);
    }
    if (failed.length) toast.error(failed.map((r) => `${r.number ?? ""}: ${r.message}`).join("\n"));
    onOpenChange(false);
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5" />
            {target === "cash" ? "تحويل لنقدي" : "تحويل لآجل"} — {single ? (rows?.[0]?.number ?? docWord) : `${ids.length} ${docWord}`}
          </DialogTitle>
          <DialogDescription>
            {target === "cash"
              ? "الفاتورة تتسدد كلها فلوس بتاريخها: الدفعات اللي اتسجلت عليها بعدين تتنقل ليومها، والباقي دفعة جديدة يوم الفاتورة."
              : "دفعات يوم الفاتورة تتلغي على يومها (السند يروح «الملغاة» بسببه)، والمبلغ يبقى على الحساب."}
          </DialogDescription>
        </DialogHeader>

        {loading && !rows ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> بنحسب اللي هيحصل...</div>
        ) : (
          <div className="space-y-3">
            {!single && rows && (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-success/10 text-success px-2 py-0.5 font-bold">{ok.length} هتتحول</span>
                {skipped.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5">{skipped.length} هي أصلاً {target === "cash" ? "نقدي" : "آجل"}</span>}
                {errors.length > 0 && <span className="rounded-full bg-destructive/10 text-destructive px-2 py-0.5 font-bold">{errors.length} مينفعش</span>}
              </div>
            )}

            <div className="space-y-2 max-h-[40vh] overflow-y-auto pe-1">
              {(rows ?? []).map((r) => <PlanCard key={r.doc_id} r={r} target={target} />)}
            </div>

            {ok.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                <div className="font-bold">الإجمالي</div>
                {target === "cash" ? (
                  <>
                    {totals.moved > 0 && <Line label="دفعات تتنقل ليوم الفاتورة (نفس السند)" value={totals.moved} />}
                    {totals.newAmount > 0 && <Line label="دفعات جديدة بتاريخ الفاتورة" value={totals.newAmount} strong />}
                    {totals.fee > 0 && <Line label="عمولة التحويل (مصروف — بتقلل الربح)" value={totals.fee} warn />}
                  </>
                ) : (
                  <Line label="دفعات تتلغي على يومها" value={totals.voided} strong />
                )}
              </div>
            )}

            {needsMethod && (
              <div className="rounded-lg border p-3">
                <PaymentMethodPicker amount={totals.newAmount} value={pay} onChange={setPay} showTransferFrom label="طريقة الدفعة الجديدة" />
                {!single && pay.method !== "cash" && (
                  <p className="mt-2 text-[11px] text-muted-foreground">إيصال التحويل لكل فاتورة يترفع بعد كده من 📎 على سندها.</p>
                )}
              </div>
            )}

            {ok.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label>السبب *</Label>
                  <Select value={reasonPick} onValueChange={setReasonPick}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختار السبب" /></SelectTrigger>
                    <SelectContent>
                      {REASONS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                      <SelectItem value="__other">سبب تاني…</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {reasonPick === "__other" && (
                  <div>
                    <Label>اكتب السبب *</Label>
                    <Input className="mt-1.5" value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="ليه بتحولها؟" />
                  </div>
                )}
              </div>
            )}

            {totals.hard && (
              <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs cursor-pointer">
                <Checkbox checked={ackWarn} onCheckedChange={(v) => setAckWarn(!!v)} className="mt-0.5" />
                <span>قريت التحذيرات اللي فوق ومتأكد — كمّل.</span>
              </label>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>رجوع</Button>
          <Button onClick={save} disabled={!canSave}>
            {saving && <Loader2 className="w-4 h-4 animate-spin ms-1" />}
            {ok.length ? confirmLabel : "مفيش حاجة تتحول"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, value, strong, warn }: { label: string; value: number; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span>{label}</span>
      <span className={`tabular-nums ${strong ? "font-bold" : ""} ${warn ? "text-warning font-bold" : ""}`}>{formatEGP(value)}</span>
    </div>
  );
}

function PlanCard({ r, target }: { r: PlanRow; target: ClassTarget }) {
  const tone = r.status === "error" ? "border-destructive/40 bg-destructive/5" : r.status === "skip" ? "opacity-60" : "";
  return (
    <div className={`rounded-lg border p-2.5 text-xs space-y-1 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold font-mono">{r.number ?? "—"}</span>
        <span className="text-muted-foreground">{r.date ? formatDate(r.date) : ""} · {formatEGP(n(r.total))}</span>
      </div>
      {r.status !== "ok" ? (
        <div className={r.status === "error" ? "text-destructive font-semibold" : "text-muted-foreground"}>{r.message}</div>
      ) : (
        <>
          {target === "cash" ? (
            <>
              {n(r.keep) > 0 && <div>مدفوع يوم الفاتورة فعلاً: {formatEGP(n(r.keep))}</div>}
              {(r.moves ?? []).map((m) => (
                <div key={m.id}>يتنقل {m.voucher ?? "سند الدفعة"} ({formatEGP(n(m.amount))} {methodLabel(m.method)}) من {formatDate(m.day)} ← {formatDate(r.date!)}</div>
              ))}
              {n(r.new_amount) > 0 && (
                <div className="font-semibold">دفعة جديدة {formatEGP(n(r.new_amount))} {methodLabel(r.method)} بتاريخ {formatDate(r.date!)}{n(r.fee) > 0 ? ` + عمولة ${formatEGP(n(r.fee))}` : ""}</div>
              )}
            </>
          ) : (
            (r.voids ?? []).map((v) => (
              <div key={v.id} className="font-semibold">يتلغي {v.voucher ?? "سند الدفعة"} ({formatEGP(n(v.amount))} {methodLabel(v.method)}) على يومه {formatDate(v.day)}</div>
            ))
          )}
          <div className="text-muted-foreground">خزنة الفرع آخر يوم {formatDate(r.date!)}: {formatEGP(n(r.till_before))} ← {formatEGP(n(r.till_after))}</div>
          {(r.warnings ?? []).map((w, i) => (
            <div key={i} className={`flex items-start gap-1 ${w.level === "warning" ? "text-warning font-semibold" : "text-info"}`}>
              {w.level === "warning" ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              <span>{w.text}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
