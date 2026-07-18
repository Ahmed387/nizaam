import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";
import { Plus, Pencil, Loader2, Info, RefreshCw, History as HistoryIcon, ShieldCheck, Trash2 } from "lucide-react";
import { MultiMethodPaymentDialog } from "./MultiMethodPaymentDialog";
import { EditPaymentDialog } from "./EditPaymentDialog";
import { PaymentMethodPicker, PaymentMethodValue } from "./PaymentMethodPicker";


interface Props {
  invoiceId: string;
  branchId: string;
  paymentPlanId: string | null;
  invoiceNumber?: string;
  onChanged?: () => void;
}

type EditTarget =
  | { kind: "tx"; row: any }
  | { kind: "invpay"; row: any }
  | null;

/**
 * Inline نسخة من InvoicePaymentsDialog — بدون Dialog wrapper وبدون تبويبات.
 * الدفعات فوق وسجل التعديلات تحتها في نفس القسم.
 */
export function InvoicePaymentsPanel({
  invoiceId,
  branchId,
  paymentPlanId,
  invoiceNumber,
  onChanged,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [initialPayments, setInitialPayments] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [plan, setPlan] = useState<any>(null);
  const [invoiceTotal, setInvoiceTotal] = useState<number>(0);
  const [addPlanOpen, setAddPlanOpen] = useState(false);
  const [addInvoicePayOpen, setAddInvoicePayOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<EditTarget>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [history, setHistory] = useState<any[]>([]);


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: ip }, planRes, txRes, invRes] = await Promise.all([
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
        supabase.from("invoices").select("total").eq("id", invoiceId).maybeSingle(),
      ]);
      setInitialPayments(ip ?? []);
      setPlan(planRes?.data ?? null);
      setTxs(txRes?.data ?? []);
      setInvoiceTotal(Number(invRes?.data?.total ?? 0));
    } finally {
      setLoading(false);
    }
  }, [invoiceId, paymentPlanId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`inv-pay-panel-${invoiceId}-${Date.now()}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "invoice_payments", filter: `invoice_id=eq.${invoiceId}` },
        () => load()
      );
    channel.on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "invoices", filter: `id=eq.${invoiceId}` },
      () => load()
    );
    if (paymentPlanId) {
      channel
        .on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "payment_transactions", filter: `payment_plan_id=eq.${paymentPlanId}` },
          () => load()
        )
        .on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "payment_plans", filter: `id=eq.${paymentPlanId}` },
          () => load()
        );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [invoiceId, paymentPlanId, load]);

  // Notify parent whenever totals change in realtime
  useEffect(() => {
    onChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayments, txs, invoiceTotal]);

  const loadHistory = useCallback(async () => {
    const ids: string[] = [
      ...initialPayments.map((p) => p.id),
      ...txs.map((t) => t.id),
    ];
    if (ids.length === 0) {
      setHistory([]);
      return;
    }
    const { data } = await supabase
      .from("audit_log")
      .select("*")
      .eq("action", "payment_edited")
      .in("entity_id", ids)
      .order("created_at", { ascending: false });
    setHistory(data ?? []);
  }, [initialPayments, txs]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const activeTxs = txs.filter((t) => !t.voided_at && !t.reverses_tx_id);
  const voidedTxs = txs.filter((t) => t.voided_at || t.reverses_tx_id);
  const activeInitial = initialPayments.filter((p) => !p.voided_at && !p.reverses_payment_id);
  const inactiveInitial = initialPayments.filter((p) => p.voided_at || p.reverses_payment_id);

  const totalActive =
    activeInitial.reduce((s, p) => s + Number(p.amount || 0), 0) +
    activeTxs.reduce((s, t) => s + Number(t.amount || 0), 0);

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          <ShieldCheck className="w-4 h-4 text-primary" />
          دفعات الفاتورة {invoiceNumber ? `#${invoiceNumber}` : ""}
        </div>
        {loading && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> تحديث تلقائي…
          </div>
        )}
      </div>

      {/* Info banner */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs flex gap-2 leading-relaxed">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div>
          <b>تعديل الدفعة</b> بيحدّث الرقم أو طريقة الدفع مباشرة في الصف نفسه، والخزنة ورصيد العميل والخطة بيتحدثوا تلقائياً بالفرق.
          كل تعديل بيتسجل في <b>سجل التعديلات</b> بالقيمة القديمة والجديدة وسبب التعديل.
        </div>
      </div>

      {/* Plan summary */}
      {plan && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-muted/40 rounded-lg p-2.5 text-center">
            <div className="text-[11px] text-muted-foreground">إجمالي الخطة</div>
            <div className="font-bold tabular-nums" dir="ltr">{formatEGP(Number(plan.total_amount || 0))}</div>
          </div>
          <div className="bg-success/10 rounded-lg p-2.5 text-center">
            <div className="text-[11px] text-muted-foreground">مدفوع</div>
            <div className="font-bold text-success tabular-nums" dir="ltr">{formatEGP(Number(plan.paid_amount || 0))}</div>
          </div>
          <div className="bg-warning/10 rounded-lg p-2.5 text-center">
            <div className="text-[11px] text-muted-foreground">متبقي</div>
            <div className="font-bold text-warning tabular-nums" dir="ltr">{formatEGP(Number(plan.remaining_amount || 0))}</div>
          </div>
        </div>
      )}

      {/* Initial payments */}
      {initialPayments.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold">
              الدفعات الأولية ({activeInitial.length} نشطة{inactiveInitial.length ? ` + ${inactiveInitial.length} ملغية/عكسية` : ""})
            </div>
            <Button size="sm" onClick={() => setAddInvoicePayOpen(true)} className="gap-1 h-8">
              <Plus className="w-4 h-4" /> إضافة دفعة على الفاتورة
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface-2">
                <tr className="font-bold">
                  <th className="p-2 text-right">التاريخ</th>
                  <th className="p-2 text-right">النوع</th>
                  <th className="p-2 text-right">الطريقة</th>
                  <th className="p-2 text-center">المبلغ</th>
                  <th className="p-2 text-right">مرجع</th>
                  <th className="p-2 text-right">استلم</th>
                  <th className="p-2 text-center w-40">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {initialPayments.map((p) => {
                  const isVoided = !!p.voided_at;
                  const isReversal = !!p.reverses_payment_id;
                  return (
                    <tr
                      key={p.id}
                      className={`border-t border-border ${isVoided ? "opacity-50 line-through" : ""} ${isReversal ? "bg-warning/5" : ""}`}
                    >
                      <td className="p-2 tabular-nums" dir="ltr">{new Date(p.created_at).toLocaleString("ar-EG")}</td>
                      <td className="p-2">
                        {isReversal ? (
                          <span className="text-[10px] font-bold bg-warning/20 text-warning px-2 py-0.5 rounded-full">قيد عكسي</span>
                        ) : isVoided ? (
                          <span className="text-[10px] font-bold bg-muted text-muted-foreground px-2 py-0.5 rounded-full">ملغية</span>
                        ) : (
                          <span className="text-[10px] font-bold bg-success/20 text-success px-2 py-0.5 rounded-full">دفعة أولية</span>
                        )}
                      </td>
                      <td className="p-2 font-semibold">{p.payment_method}</td>
                      <td className={`p-2 text-center font-bold tabular-nums ${isReversal ? "text-warning" : "text-success"}`} dir="ltr">
                        {isReversal ? "- " : ""}{formatEGP(Number(p.amount || 0))}
                      </td>
                      <td className="p-2 text-muted-foreground">{p.reference_number ?? "—"}</td>
                      <td className="p-2">{p.received_by_name ?? "—"}</td>
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
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-destructive hover:bg-destructive/10"
                              onClick={() => { setDeleteReason(""); setDeleteTarget({ kind: "invpay", row: p }); }}
                            >
                              <Trash2 className="w-3.5 h-3.5" /> حذف
                            </Button>
                          </div>
                        )}
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
            <div className="text-sm font-bold">دفعات الخطة ({activeTxs.length} نشطة{voidedTxs.length ? ` + ${voidedTxs.length} ملغية` : ""})</div>
            <Button size="sm" onClick={() => setAddPlanOpen(true)} className="gap-1 h-8">
              <Plus className="w-4 h-4" /> إضافة دفعة على الخطة
            </Button>
          </div>

          {txs.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-6 border border-dashed border-border rounded-lg">
              لا توجد دفعات على خطة الدفع بعد
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface-2">
                  <tr className="font-bold">
                    <th className="p-2 text-right">التاريخ</th>
                    <th className="p-2 text-right">النوع</th>
                    <th className="p-2 text-right">الطريقة</th>
                    <th className="p-2 text-center">المبلغ</th>
                    <th className="p-2 text-right">مرجع</th>
                    <th className="p-2 text-right">استلم</th>
                    <th className="p-2 text-center w-40">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.map((t) => {
                    const isVoided = !!t.voided_at;
                    const isReversal = !!t.reverses_tx_id;
                    return (
                      <tr
                        key={t.id}
                        className={`border-t border-border ${isVoided ? "opacity-50 line-through" : ""} ${isReversal ? "bg-warning/5" : ""}`}
                      >
                        <td className="p-2 tabular-nums" dir="ltr">{new Date(t.created_at).toLocaleString("ar-EG")}</td>
                        <td className="p-2">
                          {isReversal ? (
                            <span className="text-[10px] font-bold bg-warning/20 text-warning px-2 py-0.5 rounded-full">قيد عكسي</span>
                          ) : isVoided ? (
                            <span className="text-[10px] font-bold bg-muted text-muted-foreground px-2 py-0.5 rounded-full">ملغية</span>
                          ) : (
                            <span className="text-[10px] font-bold bg-success/20 text-success px-2 py-0.5 rounded-full">
                              {t.direction === "in" ? "استلام" : "سداد"}
                            </span>
                          )}
                        </td>
                        <td className="p-2 font-semibold">{t.payment_method}</td>
                        <td className={`p-2 text-center font-bold tabular-nums ${isReversal ? "text-warning" : "text-success"}`} dir="ltr">
                          {isReversal ? "- " : ""}{formatEGP(Number(t.amount || 0))}
                        </td>
                        <td className="p-2 text-muted-foreground">{t.reference_number ?? "—"}</td>
                        <td className="p-2">{t.received_by_name ?? "—"}</td>
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
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-destructive hover:bg-destructive/10"
                                onClick={() => { setDeleteReason(""); setDeleteTarget({ kind: "tx", row: t }); }}
                              >
                                <Trash2 className="w-3.5 h-3.5" /> حذف
                              </Button>
                            </div>
                          )}
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

      {!paymentPlanId && initialPayments.length === 0 && (
        <div className="text-center">
          <div className="text-sm text-muted-foreground py-4 border border-dashed border-border rounded-lg mb-2">
            لا توجد دفعات مسجلة على هذه الفاتورة
          </div>
          <Button size="sm" onClick={() => setAddInvoicePayOpen(true)} className="gap-1">
            <Plus className="w-4 h-4" /> إضافة دفعة
          </Button>
        </div>
      )}

      {/* Live totals — يتحدثوا تلقائياً مع أي تعديل */}
      {(() => {
        const remaining = Math.max(0, invoiceTotal - totalActive);
        const overpaid = totalActive - invoiceTotal > 0.01;
        const pct = invoiceTotal > 0 ? Math.min(100, (totalActive / invoiceTotal) * 100) : 0;
        return (
          <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-background/80 rounded-lg p-3 text-center border border-border">
                <div className="text-[11px] text-muted-foreground mb-1">إجمالي الفاتورة</div>
                <div className="font-extrabold tabular-nums text-base" dir="ltr">{formatEGP(invoiceTotal)}</div>
              </div>
              <div className="bg-success/10 rounded-lg p-3 text-center border border-success/30">
                <div className="text-[11px] text-muted-foreground mb-1">المدفوع (نشط)</div>
                <div className="font-extrabold tabular-nums text-base text-success" dir="ltr">{formatEGP(totalActive)}</div>
              </div>
              <div className={`rounded-lg p-3 text-center border ${overpaid ? "bg-destructive/10 border-destructive/40" : "bg-warning/10 border-warning/30"}`}>
                <div className="text-[11px] text-muted-foreground mb-1">{overpaid ? "زيادة عن الإجمالي" : "المتبقي"}</div>
                <div className={`font-extrabold tabular-nums text-base ${overpaid ? "text-destructive" : "text-warning"}`} dir="ltr">
                  {formatEGP(overpaid ? totalActive - invoiceTotal : remaining)}
                </div>
              </div>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${overpaid ? "bg-destructive" : "bg-success"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-[11px] text-center text-muted-foreground tabular-nums">
              {pct.toFixed(1)}% مدفوع
            </div>
          </div>
        );
      })()}

      {/* History section (inline instead of tab) */}
      <div className="pt-3 border-t-2 border-dashed border-border">
        <div className="flex items-center gap-2 text-sm font-bold mb-2">
          <HistoryIcon className="w-4 h-4 text-primary" />
          سجل التعديلات ({history.length})
        </div>
        {history.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-4 border border-dashed border-border rounded-lg">
            لا توجد تعديلات مسجلة على دفعات هذه الفاتورة
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((h) => {
              const d = h.details || {};
              const oldV = d.old || {};
              const newV = d.new || {};
              const diffs: Array<[string, any, any]> = [];
              const push = (label: string, a: any, b: any) => {
                if ((a ?? "") !== (b ?? "") && !(a == null && b == null)) diffs.push([label, a, b]);
              };
              push("المبلغ", oldV.amount, newV.amount);
              push("الطريقة", oldV.payment_method, newV.payment_method);
              push("رقم مرجعي", oldV.reference_number, newV.reference_number);
              push("الحساب المحوّل إليه", oldV.transfer_to_account, newV.transfer_to_account);
              push("الحساب المحوّل منه", oldV.transfer_from_account, newV.transfer_from_account);
              push("العمولة", oldV.fee_amount, newV.fee_amount);
              push("المستلم", oldV.received_by_name, newV.received_by_name);
              return (
                <div key={h.id} className="border border-border rounded-lg p-3 space-y-2 bg-surface-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span dir="ltr" className="tabular-nums">{new Date(h.created_at).toLocaleString("ar-EG")}</span>
                    <span className="font-semibold">{h.user_name || "—"}</span>
                  </div>
                  {diffs.length === 0 ? (
                    <div className="text-xs text-muted-foreground">لا يوجد تغييرات ملحوظة</div>
                  ) : (
                    <div className="space-y-1">
                      {diffs.map(([label, a, b], i) => (
                        <div key={i} className="text-xs flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-primary">{label}:</span>
                          <span className="line-through text-muted-foreground tabular-nums">{String(a ?? "—")}</span>
                          <span>←</span>
                          <span className="font-bold text-success tabular-nums">{String(b ?? "—")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {d.reason && (
                    <div className="text-xs bg-warning/10 rounded p-2">
                      <b>السبب:</b> {d.reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add on plan */}
      {addPlanOpen && paymentPlanId && plan && (
        <MultiMethodPaymentDialog
          open={addPlanOpen}
          onOpenChange={setAddPlanOpen}
          mode={{ kind: "plan", planId: paymentPlanId }}
          defaultAmount={Math.max(Number(plan.remaining_amount || 0), 0)}
          direction="in"
          title="إضافة دفعة على خطة الدفع"
          onSuccess={() => {
            onChanged?.();
            load();
          }}
        />
      )}

      <AddInvoicePaymentDialog
        open={addInvoicePayOpen}
        onOpenChange={setAddInvoicePayOpen}
        invoiceId={invoiceId}
        maxAllowed={invoiceTotal > 0 ? Math.max(invoiceTotal - totalActive, 0) : undefined}
        invoiceTotal={invoiceTotal}
        onSuccess={() => {
          onChanged?.();
          load();
        }}
      />

      <EditPaymentDialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        target={editTarget}
        maxAllowed={
          invoiceTotal > 0 && editTarget
            ? Math.max(invoiceTotal - totalActive + Number(editTarget.row.amount || 0), 0)
            : undefined
        }
        invoiceTotal={invoiceTotal}
        onSuccess={() => {
          setEditTarget(null);
          onChanged?.();
          load();
        }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) { setDeleteTarget(null); setDeleteReason(""); } }}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="w-5 h-5" /> حذف الدفعة
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm">
              <div>
                هيتم عمل <b>قيد عكسي</b> يرجّع مبلغ الدفعة من الخزنة ويلغي أي عمولات مرتبطة بيها،
                ورصيد العميل والخطة هيتحدثوا تلقائياً — من غير ما تتأثر أي حسابات تانية.
              </div>
              {deleteTarget && (
                <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1 font-semibold">
                  <div className="flex justify-between"><span>المبلغ:</span><span className="tabular-nums text-success" dir="ltr">{formatEGP(Number(deleteTarget.row.amount || 0))}</span></div>
                  <div className="flex justify-between"><span>الطريقة:</span><span>{deleteTarget.row.payment_method}</span></div>
                  {deleteTarget.row.reference_number && (
                    <div className="flex justify-between"><span>مرجع:</span><span>{deleteTarget.row.reference_number}</span></div>
                  )}
                </div>
              )}
              <div>
                <Label className="text-xs mb-1 block">سبب الحذف (اختياري)</Label>
                <Textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="مثلاً: تسجيل خطأ، ارتداد التحويل..."
                  className="min-h-[70px] text-sm"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteTarget) return;
                setDeleting(true);
                try {
                  const rpcName = deleteTarget.kind === "invpay" ? "void_invoice_payment" : "void_payment_transaction";
                  const params: any = deleteTarget.kind === "invpay"
                    ? { p_payment_id: deleteTarget.row.id, p_reason: deleteReason || null }
                    : { p_tx_id: deleteTarget.row.id, p_reason: deleteReason || null };
                  const { error } = await supabase.rpc(rpcName as any, params);
                  if (error) throw error;
                  toast.success("تم حذف الدفعة وتم عكس أثرها على الخزنة");
                  setDeleteTarget(null);
                  setDeleteReason("");
                  onChanged?.();
                  load();
                } catch (err: any) {
                  toast.error(err.message ?? "فشل حذف الدفعة");
                } finally {
                  setDeleting(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1"
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />} تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


/* -------- Add invoice payment (any method) -------- */
function AddInvoicePaymentDialog({
  open,
  onOpenChange,
  invoiceId,
  maxAllowed,
  invoiceTotal,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  invoiceId: string;
  maxAllowed?: number;
  invoiceTotal?: number;
  onSuccess: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethodValue>({ method: "cash", fee_amount: 0, total_with_fee: 0 });
  const [amount, setAmount] = useState<string>("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMethod({ method: "cash", fee_amount: 0, total_with_fee: 0 });
      setAmount("");
      setReference("");
    }
  }, [open]);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("ادخل مبلغ صحيح");
      return;
    }
    if (typeof maxAllowed === "number" && amt > maxAllowed + 0.001) {
      toast.error(
        `المبلغ أكبر من المتبقي على الفاتورة (${maxAllowed.toFixed(2)} ج.م${
          invoiceTotal ? ` من إجمالي ${invoiceTotal.toFixed(2)}` : ""
        })`
      );
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("add_invoice_payment" as any, {
        p_invoice_id: invoiceId,
        p_payment_method: method.method,
        p_amount: amt,
        p_reference_number: reference || null,
        p_transfer_to_account: method.transfer_to_account || null,
        p_transfer_from_account: method.transfer_from_account || null,
        p_fee_amount: 0,
        p_fee_on_customer: false,
        p_received_by_name: null,
      });
      if (error) throw error;
      toast.success("تم إضافة الدفعة");
      onOpenChange(false);
      onSuccess();
    } catch (e: any) {
      toast.error(e.message ?? "فشل حفظ الدفعة");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>إضافة دفعة على الفاتورة</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs mb-1 block">طريقة الدفع</Label>
            <PaymentMethodPicker amount={Number(amount) || 0} value={method} onChange={setMethod} showReceivedBy />
          </div>
          <div>
            <Label className="text-xs mb-1 block">المبلغ</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="h-10 text-lg font-bold text-center tabular-nums"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">رقم مرجعي (اختياري)</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="رقم عملية / إيصال"
              className="h-9"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={saving} className="gap-1">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} حفظ الدفعة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
