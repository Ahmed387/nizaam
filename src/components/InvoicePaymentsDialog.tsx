import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";
import { Plus, Undo2, Loader2, ShieldCheck, Info, RefreshCw } from "lucide-react";
import { MultiMethodPaymentDialog } from "./MultiMethodPaymentDialog";
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  branchId: string;
  paymentPlanId: string | null;
  invoiceNumber?: string;
  onChanged?: () => void;
}

export function InvoicePaymentsDialog({
  open,
  onOpenChange,
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
  const [addOpen, setAddOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);

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
    if (open) load();
  }, [open, load]);

  // Realtime subscriptions
  useEffect(() => {
    if (!open) return;
    const channel = supabase
      .channel(`inv-pay-dialog-${invoiceId}-${Date.now()}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "invoice_payments", filter: `invoice_id=eq.${invoiceId}` },
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
  }, [open, invoiceId, paymentPlanId, load]);

  const confirmVoid = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    try {
      const { error } = await supabase.rpc("void_payment_transaction" as any, {
        p_tx_id: voidTarget.id,
        p_reason: voidReason || null,
      });
      if (error) throw error;
      toast.success("تم إلغاء الدفعة، الحسابات اتصححت تلقائياً");
      setVoidTarget(null);
      setVoidReason("");
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message ?? "فشل إلغاء الدفعة");
    } finally {
      setVoiding(false);
    }
  };

  const activeTxs = txs.filter((t) => !t.voided_at && !t.reverses_tx_id);
  const voidedTxs = txs.filter((t) => t.voided_at || t.reverses_tx_id);
  const totalActive =
    initialPayments.reduce((s, p) => s + Number(p.amount || 0), 0) +
    activeTxs.reduce((s, t) => s + Number(t.amount || 0), 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              دفعات الفاتورة {invoiceNumber ? `#${invoiceNumber}` : ""}
              <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="mr-auto h-8">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Info banner */}
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs flex gap-2 leading-relaxed">
              <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <b>إلغاء الدفعة</b> بيسجل قيد عكسي بنفس المبلغ في الخزنة ورصيد العميل والخطة تلقائياً — بدون أي حسابات يدوية.
                الدفعة الأصلية والعكسية بيفضلوا في السجل للتدقيق.
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

            {/* Initial payments (from invoice creation) */}
            {initialPayments.length > 0 && (
              <div>
                <div className="text-sm font-bold mb-2">الدفعات الأولية عند إنشاء الفاتورة ({initialPayments.length})</div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-2">
                      <tr className="font-bold">
                        <th className="p-2 text-right">التاريخ</th>
                        <th className="p-2 text-right">الطريقة</th>
                        <th className="p-2 text-center">المبلغ</th>
                        <th className="p-2 text-right">مرجع</th>
                        <th className="p-2 text-right">استلم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {initialPayments.map((p) => (
                        <tr key={p.id} className="border-t border-border">
                          <td className="p-2 tabular-nums" dir="ltr">{new Date(p.created_at).toLocaleString("ar-EG")}</td>
                          <td className="p-2 font-semibold">{p.payment_method}</td>
                          <td className="p-2 text-center font-bold tabular-nums text-success" dir="ltr">{formatEGP(Number(p.amount || 0))}</td>
                          <td className="p-2 text-muted-foreground">{p.reference_number ?? "—"}</td>
                          <td className="p-2">{p.received_by_name ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  💡 الدفعات الأولية بتتحفظ محاسبياً مع الفاتورة نفسها ومش قابلة للإلغاء من هنا. لتعديلها استخدم إلغاء الفاتورة كاملة.
                </div>
              </div>
            )}

            {/* Plan transactions (voidable) */}
            {paymentPlanId && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold">دفعات الخطة ({activeTxs.length} نشطة{voidedTxs.length ? ` + ${voidedTxs.length} ملغية` : ""})</div>
                  <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1 h-8">
                    <Plus className="w-4 h-4" /> إضافة دفعة جديدة
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
                          <th className="p-2 text-center w-24">إجراء</th>
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
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 gap-1 text-destructive hover:bg-destructive/10"
                                    onClick={() => setVoidTarget(t)}
                                  >
                                    <Undo2 className="w-3.5 h-3.5" /> إلغاء
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {voidedTxs.length > 0 && (
                  <div className="text-[11px] text-muted-foreground mt-2 space-y-1">
                    {voidedTxs
                      .filter((t) => t.voided_at)
                      .map((t) => (
                        <div key={`vr-${t.id}`}>
                          • دفعة {formatEGP(Number(t.amount || 0))} اتلغت في{" "}
                          <span dir="ltr">{new Date(t.voided_at).toLocaleString("ar-EG")}</span>
                          {t.void_reason ? ` — السبب: ${t.void_reason}` : ""}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {!paymentPlanId && initialPayments.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-6 border border-dashed border-border rounded-lg">
                لا توجد دفعات مسجلة على هذه الفاتورة
              </div>
            )}

            {!paymentPlanId && initialPayments.length > 0 && (
              <div className="text-[11px] text-muted-foreground bg-muted/30 rounded p-2 leading-relaxed">
                ℹ️ هذه الفاتورة نقدية بالكامل ولا يوجد بها خطة دفع، لذلك لا يمكن إضافة دفعات جديدة أو إلغاء دفعات من هنا.
              </div>
            )}

            {/* Totals footer */}
            <div className="bg-primary/5 border-2 border-primary/20 rounded-lg p-3 flex justify-between items-center">
              <span className="font-bold">إجمالي المدفوعات النشطة:</span>
              <span className="text-xl font-extrabold text-primary tabular-nums" dir="ltr">{formatEGP(totalActive)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add new payment via existing MultiMethodPaymentDialog (unchanged logic) */}
      {addOpen && paymentPlanId && plan && (
        <MultiMethodPaymentDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          mode={{ kind: "plan", planId: paymentPlanId }}
          defaultAmount={Math.max(Number(plan.remaining_amount || 0), 0)}
          direction="in"
          title="إضافة دفعة على الفاتورة"
          onSuccess={() => {
            onChanged?.();
            load();
          }}
        />
      )}

      {/* Void confirmation */}
      <AlertDialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد إلغاء الدفعة</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  هيتسجل قيد عكسي بمبلغ{" "}
                  <b className="text-warning tabular-nums" dir="ltr">
                    {voidTarget ? formatEGP(Number(voidTarget.amount || 0)) : ""}
                  </b>
                  . الخزنة ورصيد العميل والخطة هيتصححوا تلقائياً.
                </div>
                <div>
                  <Label className="text-xs">سبب الإلغاء (اختياري)</Label>
                  <Input
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="مثال: طريقة الدفع كانت غلط، اتحولت instapay بدل نقدي..."
                    className="mt-1 h-9"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voiding}>رجوع</AlertDialogCancel>
            <AlertDialogAction onClick={confirmVoid} disabled={voiding} className="gap-1 bg-destructive hover:bg-destructive/90">
              {voiding && <Loader2 className="w-4 h-4 animate-spin" />} تأكيد الإلغاء
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
