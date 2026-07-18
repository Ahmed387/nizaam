import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PaymentMethodPicker, PaymentMethodValue } from "@/components/PaymentMethodPicker";
import { formatEGP } from "@/lib/format";
import {
  Plus,
  Pencil,
  Trash2,
  Info,
  ShieldCheck,
  Loader2,
  Undo2,
  Clock,
} from "lucide-react";
import { StagedOp, StagedPayment, stagedOpLabel, stagedPaidDelta } from "@/lib/stagedPayments";
import { toast } from "sonner";

interface Props {
  invoiceId: string;
  invoiceNumber?: string;
  invoiceTotal: number;
  paymentPlanId: string | null;
  stagedOps: StagedOp[];
  setStagedOps: (ops: StagedOp[]) => void;
}

/**
 * Staging-mode payments panel used inside EditSaleInvoice.
 * NO writes to DB — every add/edit/delete produces a StagedOp that lives in
 * parent state and is only executed when the user hits "حفظ التعديلات".
 */
export function StagedPaymentsPanel({
  invoiceId,
  invoiceNumber,
  invoiceTotal,
  paymentPlanId,
  stagedOps,
  setStagedOps,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [initialPayments, setInitialPayments] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [plan, setPlan] = useState<any>(null);

  const [addOpen, setAddOpen] = useState<false | "invpay" | "tx">(false);
  const [editTarget, setEditTarget] = useState<null | { kind: "invpay" | "tx"; row: any }>(null);
  const [deleteTarget, setDeleteTarget] = useState<null | { kind: "invpay" | "tx"; row: any }>(null);
  const [deleteReason, setDeleteReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: ip }, planRes, txRes] = await Promise.all([
        supabase.from("invoice_payments").select("*").eq("invoice_id", invoiceId).order("created_at"),
        paymentPlanId
          ? supabase.from("payment_plans").select("*").eq("id", paymentPlanId).maybeSingle()
          : Promise.resolve({ data: null } as any),
        paymentPlanId
          ? supabase
              .from("payment_transactions")
              .select("*")
              .eq("payment_plan_id", paymentPlanId)
              .order("created_at")
          : Promise.resolve({ data: [] } as any),
      ]);
      setInitialPayments(ip ?? []);
      setPlan(planRes?.data ?? null);
      setTxs(txRes?.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [invoiceId, paymentPlanId]);

  useEffect(() => {
    load();
  }, [load]);

  const activeInitial = initialPayments.filter((p) => !p.voided_at && !p.reverses_payment_id);
  const activeTxs = txs.filter((t) => !t.voided_at && !t.reverses_tx_id);

  // Which existing rows have a pending edit / delete op?
  const editOpFor = (kind: "invpay" | "tx", id: string) =>
    stagedOps.find(
      (op) =>
        (op.type === (kind === "invpay" ? "edit_invpay" : "edit_tx")) &&
        (op as any).targetId === id
    );
  const deleteOpFor = (kind: "invpay" | "tx", id: string) =>
    stagedOps.find(
      (op) =>
        (op.type === (kind === "invpay" ? "delete_invpay" : "delete_tx")) &&
        (op as any).targetId === id
    );

  const addOp = (op: StagedOp) => setStagedOps([...stagedOps, op]);
  const removeOp = (opId: string) => setStagedOps(stagedOps.filter((o) => o.id !== opId));

  const paidActive =
    activeInitial.reduce((s, p) => s + Number(p.amount || 0), 0) +
    activeTxs.reduce((s, t) => s + Number(t.amount || 0), 0);
  const stagedDelta = stagedPaidDelta(stagedOps);
  const paidAfter = paidActive + stagedDelta;
  const remainingAfter = Math.max(0, invoiceTotal - paidAfter);
  const overpaid = paidAfter - invoiceTotal > 0.01;

  // Max allowed for a NEW addition = remaining after all staged ops applied
  const remainingForAdd = Math.max(0, invoiceTotal - paidAfter);

  const rowStyle = (op?: StagedOp) => {
    if (!op) return "";
    if (op.type.startsWith("delete")) return "opacity-50 line-through bg-destructive/5";
    if (op.type.startsWith("edit")) return "bg-warning/10";
    return "";
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          <ShieldCheck className="w-4 h-4 text-primary" />
          دفعات الفاتورة {invoiceNumber ? `#${invoiceNumber}` : ""}
        </div>
        {loading && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> تحميل…
          </div>
        )}
      </div>

      {/* Warning banner about staging */}
      <div className="bg-warning/10 border-2 border-warning/40 rounded-lg p-3 text-xs flex gap-2 leading-relaxed">
        <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <div>
          <b>الوضع الحالي: تعديل معلّق</b> — أي إضافة/تعديل/حذف على الدفعات
          هيتم فقط لما تدوس <b>«حفظ التعديلات»</b> فوق. لو دوست «إلغاء» كل شي هيتلغي
          ومحاسبتش الخزنة ولا رصيد العميل.
        </div>
      </div>

      {/* Pending ops summary */}
      {stagedOps.length > 0 && (
        <div className="rounded-lg border-2 border-warning bg-warning/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-warning">
            <Clock className="w-4 h-4" />
            {stagedOps.length} تعديل معلّق على الدفعات
          </div>
          <div className="space-y-1">
            {stagedOps.map((op) => (
              <div
                key={op.id}
                className="flex items-center justify-between bg-background rounded px-2 py-1.5 text-xs"
              >
                <span className="font-semibold">{stagedOpLabel(op)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-muted-foreground hover:text-destructive"
                  onClick={() => removeOp(op.id)}
                >
                  <Undo2 className="w-3.5 h-3.5" /> تراجع
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plan totals */}
      {plan && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-muted/40 rounded-lg p-2.5 text-center">
            <div className="text-[11px] text-muted-foreground">إجمالي الخطة</div>
            <div className="font-bold tabular-nums" dir="ltr">
              {formatEGP(Number(plan.total_amount || 0))}
            </div>
          </div>
          <div className="bg-success/10 rounded-lg p-2.5 text-center">
            <div className="text-[11px] text-muted-foreground">مدفوع (بعد التعديلات)</div>
            <div className="font-bold text-success tabular-nums" dir="ltr">
              {formatEGP(paidAfter)}
            </div>
          </div>
          <div className="bg-warning/10 rounded-lg p-2.5 text-center">
            <div className="text-[11px] text-muted-foreground">متبقي</div>
            <div className="font-bold text-warning tabular-nums" dir="ltr">
              {formatEGP(remainingAfter)}
            </div>
          </div>
        </div>
      )}

      {/* Initial payments */}
      {(initialPayments.length > 0 ||
        stagedOps.some((o) => o.type === "add_invpay")) && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold">
              الدفعات الأولية ({activeInitial.length} نشطة)
            </div>
            <Button
              size="sm"
              onClick={() => setAddOpen("invpay")}
              className="gap-1 h-8"
              disabled={remainingForAdd <= 0.01}
            >
              <Plus className="w-4 h-4" /> إضافة دفعة (معلّق)
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface-2">
                <tr className="font-bold">
                  <th className="p-2 text-right">التاريخ</th>
                  <th className="p-2 text-right">الطريقة</th>
                  <th className="p-2 text-center">المبلغ</th>
                  <th className="p-2 text-right">مرجع</th>
                  <th className="p-2 text-center w-40">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {initialPayments.map((p) => {
                  const isVoided = !!p.voided_at;
                  const isReversal = !!p.reverses_payment_id;
                  const editOp = editOpFor("invpay", p.id) as any;
                  const delOp = deleteOpFor("invpay", p.id);
                  const displayed = editOp?.payload ?? {
                    amount: p.amount,
                    payment_method: p.payment_method,
                    reference_number: p.reference_number,
                  };
                  return (
                    <tr
                      key={p.id}
                      className={`border-t border-border ${
                        isVoided || isReversal ? "opacity-50 line-through" : ""
                      } ${rowStyle(editOp ?? delOp)}`}
                    >
                      <td className="p-2 tabular-nums" dir="ltr">
                        {new Date(p.created_at).toLocaleString("ar-EG")}
                      </td>
                      <td className="p-2 font-semibold">
                        {displayed.payment_method ?? displayed.method}
                        {editOp && (
                          <span className="mr-1 text-[10px] bg-warning/20 text-warning px-1.5 py-0.5 rounded-full">
                            معلّق
                          </span>
                        )}
                        {delOp && (
                          <span className="mr-1 text-[10px] bg-destructive/20 text-destructive px-1.5 py-0.5 rounded-full">
                            حذف معلّق
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-center font-bold tabular-nums text-success" dir="ltr">
                        {formatEGP(Number(displayed.amount || 0))}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {(editOp?.payload?.reference_number ?? p.reference_number) ?? "—"}
                      </td>
                      <td className="p-2 text-center">
                        {!isVoided && !isReversal && (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-primary hover:bg-primary/10"
                              onClick={() => setEditTarget({ kind: "invpay", row: p })}
                            >
                              <Pencil className="w-3.5 h-3.5" /> تعديل
                            </Button>
                            {delOp ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1"
                                onClick={() => removeOp(delOp.id)}
                              >
                                <Undo2 className="w-3.5 h-3.5" /> تراجع
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-destructive hover:bg-destructive/10"
                                onClick={() => {
                                  setDeleteReason("");
                                  setDeleteTarget({ kind: "invpay", row: p });
                                }}
                              >
                                <Trash2 className="w-3.5 h-3.5" /> حذف
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {/* Staged additions */}
                {stagedOps
                  .filter((o) => o.type === "add_invpay")
                  .map((op) => {
                    const p = (op as any).payload as StagedPayment;
                    return (
                      <tr
                        key={op.id}
                        className="border-t border-border bg-success/5"
                      >
                        <td className="p-2 text-muted-foreground text-[11px]">— جديد —</td>
                        <td className="p-2 font-semibold">
                          {p.method}
                          <span className="mr-1 text-[10px] bg-success/20 text-success px-1.5 py-0.5 rounded-full">
                            إضافة معلّقة
                          </span>
                        </td>
                        <td className="p-2 text-center font-bold tabular-nums text-success" dir="ltr">
                          {formatEGP(p.amount)}
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {p.reference_number ?? "—"}
                        </td>
                        <td className="p-2 text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-muted-foreground hover:text-destructive"
                            onClick={() => removeOp(op.id)}
                          >
                            <Undo2 className="w-3.5 h-3.5" /> تراجع
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Plan transactions */}
      {paymentPlanId && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold">
              دفعات الخطة ({activeTxs.length} نشطة)
            </div>
            <Button
              size="sm"
              onClick={() => setAddOpen("tx")}
              className="gap-1 h-8"
              disabled={remainingForAdd <= 0.01}
            >
              <Plus className="w-4 h-4" /> إضافة دفعة على الخطة (معلّق)
            </Button>
          </div>

          {txs.length === 0 && !stagedOps.some((o) => o.type === "add_tx") ? (
            <div className="text-center text-xs text-muted-foreground py-6 border border-dashed border-border rounded-lg">
              لا توجد دفعات على خطة الدفع بعد
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface-2">
                  <tr className="font-bold">
                    <th className="p-2 text-right">التاريخ</th>
                    <th className="p-2 text-right">الطريقة</th>
                    <th className="p-2 text-center">المبلغ</th>
                    <th className="p-2 text-right">مرجع</th>
                    <th className="p-2 text-center w-40">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.map((t) => {
                    const isVoided = !!t.voided_at;
                    const isReversal = !!t.reverses_tx_id;
                    const editOp = editOpFor("tx", t.id) as any;
                    const delOp = deleteOpFor("tx", t.id);
                    const displayed = editOp?.payload ?? {
                      amount: t.amount,
                      payment_method: t.payment_method,
                      reference_number: t.reference_number,
                    };
                    return (
                      <tr
                        key={t.id}
                        className={`border-t border-border ${
                          isVoided || isReversal ? "opacity-50 line-through" : ""
                        } ${rowStyle(editOp ?? delOp)}`}
                      >
                        <td className="p-2 tabular-nums" dir="ltr">
                          {new Date(t.created_at).toLocaleString("ar-EG")}
                        </td>
                        <td className="p-2 font-semibold">
                          {displayed.payment_method ?? displayed.method}
                          {editOp && (
                            <span className="mr-1 text-[10px] bg-warning/20 text-warning px-1.5 py-0.5 rounded-full">
                              معلّق
                            </span>
                          )}
                          {delOp && (
                            <span className="mr-1 text-[10px] bg-destructive/20 text-destructive px-1.5 py-0.5 rounded-full">
                              حذف معلّق
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-center font-bold tabular-nums text-success" dir="ltr">
                          {formatEGP(Number(displayed.amount || 0))}
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {(editOp?.payload?.reference_number ?? t.reference_number) ?? "—"}
                        </td>
                        <td className="p-2 text-center">
                          {!isVoided && !isReversal && (
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-primary hover:bg-primary/10"
                                onClick={() => setEditTarget({ kind: "tx", row: t })}
                              >
                                <Pencil className="w-3.5 h-3.5" /> تعديل
                              </Button>
                              {delOp ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1"
                                  onClick={() => removeOp(delOp.id)}
                                >
                                  <Undo2 className="w-3.5 h-3.5" /> تراجع
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 text-destructive hover:bg-destructive/10"
                                  onClick={() => {
                                    setDeleteReason("");
                                    setDeleteTarget({ kind: "tx", row: t });
                                  }}
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> حذف
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {stagedOps
                    .filter((o) => o.type === "add_tx")
                    .map((op) => {
                      const p = (op as any).payload as StagedPayment;
                      return (
                        <tr key={op.id} className="border-t border-border bg-success/5">
                          <td className="p-2 text-muted-foreground text-[11px]">— جديد —</td>
                          <td className="p-2 font-semibold">
                            {p.method}
                            <span className="mr-1 text-[10px] bg-success/20 text-success px-1.5 py-0.5 rounded-full">
                              إضافة معلّقة
                            </span>
                          </td>
                          <td className="p-2 text-center font-bold tabular-nums text-success" dir="ltr">
                            {formatEGP(p.amount)}
                          </td>
                          <td className="p-2 text-muted-foreground">
                            {p.reference_number ?? "—"}
                          </td>
                          <td className="p-2 text-center">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-muted-foreground hover:text-destructive"
                              onClick={() => removeOp(op.id)}
                            >
                              <Undo2 className="w-3.5 h-3.5" /> تراجع
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!paymentPlanId &&
        initialPayments.length === 0 &&
        !stagedOps.some((o) => o.type === "add_invpay") && (
          <div className="text-center">
            <div className="text-sm text-muted-foreground py-4 border border-dashed border-border rounded-lg mb-2">
              لا توجد دفعات مسجلة على هذه الفاتورة
            </div>
            <Button
              size="sm"
              onClick={() => setAddOpen("invpay")}
              className="gap-1"
              disabled={remainingForAdd <= 0.01}
            >
              <Plus className="w-4 h-4" /> إضافة دفعة (معلّق)
            </Button>
          </div>
        )}

      {/* Live projection */}
      <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 p-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-background/80 rounded-lg p-3 text-center border border-border">
            <div className="text-[11px] text-muted-foreground mb-1">إجمالي الفاتورة</div>
            <div className="font-extrabold tabular-nums text-base" dir="ltr">
              {formatEGP(invoiceTotal)}
            </div>
          </div>
          <div className="bg-success/10 rounded-lg p-3 text-center border border-success/30">
            <div className="text-[11px] text-muted-foreground mb-1">المدفوع بعد التعديلات</div>
            <div className="font-extrabold tabular-nums text-base text-success" dir="ltr">
              {formatEGP(paidAfter)}
            </div>
          </div>
          <div
            className={`rounded-lg p-3 text-center border ${
              overpaid
                ? "bg-destructive/10 border-destructive/40"
                : "bg-warning/10 border-warning/30"
            }`}
          >
            <div className="text-[11px] text-muted-foreground mb-1">
              {overpaid ? "زيادة عن الإجمالي" : "المتبقي"}
            </div>
            <div
              className={`font-extrabold tabular-nums text-base ${
                overpaid ? "text-destructive" : "text-warning"
              }`}
              dir="ltr"
            >
              {formatEGP(overpaid ? paidAfter - invoiceTotal : remainingAfter)}
            </div>
          </div>
        </div>
      </div>

      {/* Add dialog */}
      <PaymentFormDialog
        open={!!addOpen}
        onOpenChange={(o) => !o && setAddOpen(false)}
        title={addOpen === "tx" ? "إضافة دفعة على الخطة (معلّق)" : "إضافة دفعة (معلّق)"}
        maxAllowed={remainingForAdd}
        invoiceTotal={invoiceTotal}
        onSubmit={(payload) => {
          const id = crypto.randomUUID();
          if (addOpen === "tx" && paymentPlanId) {
            addOp({ id, type: "add_tx", payload, planId: paymentPlanId });
          } else {
            addOp({ id, type: "add_invpay", payload });
          }
          setAddOpen(false);
          toast.success("تمت إضافة الدفعة كتعديل معلّق — لن تحفظ إلا بعد الضغط على «حفظ التعديلات»");
        }}
      />

      {/* Edit dialog */}
      <PaymentFormDialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        title="تعديل دفعة (معلّق)"
        initial={editTarget?.row}
        requireReason
        maxAllowed={
          editTarget
            ? invoiceTotal -
              (paidAfter -
                Number(
                  (editOpFor(editTarget.kind, editTarget.row.id) as any)?.payload?.amount ??
                    editTarget.row.amount ??
                    0
                )) // room = total - (paidAfter without this row's contribution)
            : undefined
        }
        invoiceTotal={invoiceTotal}
        onSubmit={(payload, reason) => {
          if (!editTarget) return;
          const kind = editTarget.kind;
          const targetId = editTarget.row.id;
          // Replace any existing edit op for this target
          const filtered = stagedOps.filter(
            (o) => !((o.type === (kind === "invpay" ? "edit_invpay" : "edit_tx")) && (o as any).targetId === targetId)
          );
          const newOp: StagedOp =
            kind === "invpay"
              ? {
                  id: crypto.randomUUID(),
                  type: "edit_invpay",
                  targetId,
                  original: editTarget.row,
                  payload,
                  reason: reason ?? "",
                }
              : {
                  id: crypto.randomUUID(),
                  type: "edit_tx",
                  targetId,
                  original: editTarget.row,
                  payload,
                  reason: reason ?? "",
                };
          setStagedOps([...filtered, newOp]);
          setEditTarget(null);
          toast.success("تم حفظ التعديل كمعلّق");
        }}
      />

      {/* Delete confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteReason("");
          }
        }}
      >
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="w-5 h-5" /> حذف دفعة (معلّق)
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm">
              <div>
                هيتم <b>تسجيل الحذف كتعديل معلّق</b>. لن ينفذ فعلياً على الخزنة إلا بعد الضغط
                على «حفظ التعديلات» فوق. تقدر تتراجع بضغطة.
              </div>
              {deleteTarget && (
                <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1 font-semibold">
                  <div className="flex justify-between">
                    <span>المبلغ:</span>
                    <span className="tabular-nums text-success" dir="ltr">
                      {formatEGP(Number(deleteTarget.row.amount || 0))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>الطريقة:</span>
                    <span>{deleteTarget.row.payment_method}</span>
                  </div>
                </div>
              )}
              <div>
                <Label className="text-xs mb-1 block">سبب الحذف (اختياري)</Label>
                <Textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  className="min-h-[70px] text-sm"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!deleteTarget) return;
                const kind = deleteTarget.kind;
                const targetId = deleteTarget.row.id;
                const filtered = stagedOps.filter(
                  (o) =>
                    !(
                      (o.type === (kind === "invpay" ? "delete_invpay" : "delete_tx")) &&
                      (o as any).targetId === targetId
                    )
                );
                const newOp: StagedOp =
                  kind === "invpay"
                    ? {
                        id: crypto.randomUUID(),
                        type: "delete_invpay",
                        targetId,
                        original: deleteTarget.row,
                        reason: deleteReason,
                      }
                    : {
                        id: crypto.randomUUID(),
                        type: "delete_tx",
                        targetId,
                        original: deleteTarget.row,
                        reason: deleteReason,
                      };
                setStagedOps([...filtered, newOp]);
                setDeleteTarget(null);
                setDeleteReason("");
                toast.success("تم تسجيل الحذف كمعلّق");
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              تأكيد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ============ Shared payment form dialog (staged submit) ============ */

function PaymentFormDialog({
  open,
  onOpenChange,
  title,
  initial,
  maxAllowed,
  invoiceTotal,
  requireReason,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial?: any;
  maxAllowed?: number;
  invoiceTotal?: number;
  requireReason?: boolean;
  onSubmit: (payload: StagedPayment, reason?: string) => void;
}) {
  const [method, setMethod] = useState<PaymentMethodValue>({
    method: "cash",
    fee_amount: 0,
    total_with_fee: 0,
  });
  const [amount, setAmount] = useState<string>("");
  const [reference, setReference] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [reason, setReason] = useState("");
  const [feeOnCustomer, setFeeOnCustomer] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setMethod({
        method: initial.payment_method || "cash",
        fee_amount: Number(initial.fee_amount || 0),
        total_with_fee: Number(initial.amount || 0) + Number(initial.fee_amount || 0),
        transfer_to_account: initial.transfer_to_account ?? undefined,
        transfer_from_account: initial.transfer_from_account ?? undefined,
      });
      setAmount(String(initial.amount ?? ""));
      setReference(initial.reference_number ?? "");
      setReceivedBy(initial.received_by_name ?? "");
      setFeeOnCustomer(!!initial.fee_on_customer);
    } else {
      setMethod({ method: "cash", fee_amount: 0, total_with_fee: 0 });
      setAmount("");
      setReference("");
      setReceivedBy("");
      setFeeOnCustomer(false);
    }
    setReason("");
  }, [open, initial]);

  const submit = () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("ادخل مبلغ صحيح");
      return;
    }
    if (typeof maxAllowed === "number" && amt > maxAllowed + 0.001) {
      toast.error(
        `المبلغ أكبر من المسموح (${maxAllowed.toFixed(2)} ج.م${
          invoiceTotal ? ` من إجمالي ${invoiceTotal.toFixed(2)}` : ""
        })`
      );
      return;
    }
    if (requireReason && !reason.trim()) {
      toast.error("سبب التعديل مطلوب");
      return;
    }
    onSubmit(
      {
        method: method.method,
        amount: amt,
        reference_number: reference || null,
        transfer_to_account: method.transfer_to_account || null,
        transfer_from_account: method.transfer_from_account || null,
        fee_amount: Number(method.fee_amount || 0),
        fee_on_customer: feeOnCustomer,
        received_by_name: receivedBy || null,
      },
      reason
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs mb-1 block">طريقة الدفع</Label>
            <PaymentMethodPicker
              amount={Number(amount) || 0}
              value={method}
              onChange={setMethod}
              showReceivedBy
              showFeeBearerToggle
              feeOnCustomer={feeOnCustomer}
              onFeeBearerChange={setFeeOnCustomer}
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">المبلغ</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-11 text-lg font-bold text-center tabular-nums"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">رقم مرجعي (اختياري)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">استلم بواسطة (اختياري)</Label>
            <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className="h-9" />
          </div>
          {requireReason && (
            <div>
              <Label className="text-xs mb-1 block text-destructive">سبب التعديل *</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: طريقة الدفع كانت غلط..."
                className="min-h-[70px]"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={submit}>حفظ كتعديل معلّق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
