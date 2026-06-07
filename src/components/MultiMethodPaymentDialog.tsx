import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  TransferFee,
  PAYMENT_METHOD_OPTIONS,
  loadTransferFees,
  calculateFee,
  methodRequiresReference,
  methodReceiverLabel,
  methodSenderLabel,
} from "@/lib/paymentMethods";
import { formatEGP } from "@/lib/format";

export interface PaymentLine {
  id: string;
  method: string;
  amount: number;
  reference_number?: string;
  transfer_to_account?: string;
  transfer_from_account?: string;
  fee_amount: number;
  fee_type?: "percentage" | "fixed";
  fee_on_customer: boolean; // per-line
}

type Mode =
  | { kind: "plan"; planId: string; installmentId?: string }
  | { kind: "contact"; contactId: string; branchId: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  /** الإجمالي المطلوب تحصيله/سداده */
  defaultAmount: number;
  /** 'in' = استلام من عميل، 'out' = سداد لمورد/موظف */
  direction: "in" | "out";
  title?: string;
  /** يسمح بقفل المبلغ الإجمالي (للأقساط) */
  lockTotal?: boolean;
  onSuccess?: () => void;
}

const newLine = (amount = 0): PaymentLine => ({
  id: crypto.randomUUID(),
  method: "cash",
  amount,
  fee_amount: 0,
  fee_on_customer: false,
});

export function MultiMethodPaymentDialog({
  open, onOpenChange, mode, defaultAmount, direction, title, lockTotal = false, onSuccess,
}: Props) {
  const { profile } = useAuth();
  const [lines, setLines] = useState<PaymentLine[]>([newLine(defaultAmount)]);
  const [receivedBy, setReceivedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [fees, setFees] = useState<TransferFee[]>([]);
  const [busy, setBusy] = useState(false);
  // Live values for contact-supplier mode (real-time)
  const [liveOwed, setLiveOwed] = useState<number>(defaultAmount);
  const [supplierCredit, setSupplierCredit] = useState<number>(0);

  const isContactOut = mode.kind === "contact" && direction === "out";
  const effectiveRequired = isContactOut ? liveOwed : defaultAmount;

  useEffect(() => {
    if (open) {
      setLines([newLine(isContactOut ? liveOwed : defaultAmount)]);
      setReceivedBy(profile?.name ?? "");
      setNotes("");
      loadTransferFees().then(setFees);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Live balance subscription for contact-supplier mode
  useEffect(() => {
    if (!open || mode.kind !== "contact") return;
    let cancelled = false;
    const refresh = async () => {
      const { data } = await supabase.from("contacts").select("balance").eq("id", mode.contactId).maybeSingle();
      if (cancelled || !data) return;
      const bal = Number(data.balance || 0);
      // Convention: +balance = credit at supplier (they owe us), -balance = we owe them
      setSupplierCredit(bal > 0 ? bal : 0);
      setLiveOwed(bal < 0 ? Math.abs(bal) : 0);
    };
    refresh();
    const ch = supabase
      .channel(`contact-${mode.contactId}-pay-dialog-${Date.now()}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "contacts", filter: `id=eq.${mode.contactId}` }, refresh)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "payment_transactions", filter: `contact_id=eq.${mode.contactId}` }, refresh)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [open, mode]);

  // Recompute fees per line whenever method/amount changes
  useEffect(() => {
    setLines((prev) =>
      prev.map((l) => {
        const fee = calculateFee(l.method, l.amount, fees);
        const feeRow = fees.find((f) => f.payment_method === l.method);
        return { ...l, fee_amount: fee, fee_type: feeRow?.fee_type };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fees]);

  const updateLine = (id: string, patch: Partial<PaymentLine>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const merged = { ...l, ...patch };
        const fee = calculateFee(merged.method, merged.amount, fees);
        const feeRow = fees.find((f) => f.payment_method === merged.method);
        return { ...merged, fee_amount: fee, fee_type: feeRow?.fee_type };
      })
    );
  };

  const addLine = () => {
    const remaining = Math.max(0, effectiveRequired - sumAmounts);
    setLines((prev) => [...prev, newLine(remaining)]);
  };

  const removeLine = (id: string) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const sumAmounts = useMemo(() => lines.reduce((s, l) => s + Number(l.amount || 0), 0), [lines]);
  const sumFeesOnUs = useMemo(
    () => lines.reduce((s, l) => s + (l.fee_on_customer ? 0 : Number(l.fee_amount || 0)), 0),
    [lines]
  );
  const sumFeesOnCustomer = useMemo(
    () => lines.reduce((s, l) => s + (l.fee_on_customer ? Number(l.fee_amount || 0) : 0), 0),
    [lines]
  );
  const grandTotal = sumAmounts + (direction === "in" ? sumFeesOnCustomer : 0);
  const diff = Math.round((effectiveRequired - sumAmounts) * 100) / 100;
  const overpayAmount = isContactOut && sumAmounts > effectiveRequired + 0.01 ? sumAmounts - effectiveRequired : 0;

  const submit = async () => {
    if (sumAmounts <= 0) return toast.error("أدخل مبلغ صحيح");
    if (lockTotal && Math.abs(diff) > 0.01) {
      return toast.error(`مجموع السطور ${formatEGP(sumAmounts)} لا يساوي المطلوب ${formatEGP(effectiveRequired)}`);
    }
    for (const l of lines) {
      if (Number(l.amount) <= 0) return toast.error("كل سطر لازم يكون مبلغه > 0");
      if (methodRequiresReference(l.method) && !l.reference_number?.trim()) {
        return toast.error("أدخل رقم العملية لكل تحويل");
      }
    }

    setBusy(true);
    try {
      for (const l of lines) {
        if (mode.kind === "plan") {
          const { error } = await supabase.rpc("record_payment_transaction" as any, {
            p_payment_plan_id: mode.planId,
            p_installment_id: mode.installmentId ?? null,
            p_amount: l.amount,
            p_payment_method: l.method,
            p_reference_number: l.reference_number ?? null,
            p_transfer_to_account: l.transfer_to_account ?? null,
            p_received_by_name: receivedBy || profile?.name || null,
            p_fee_amount: l.fee_amount,
            p_fee_type: l.fee_type ?? null,
            p_fee_on_customer: direction === "in" ? l.fee_on_customer : false,
            p_direction: direction,
            p_transfer_from_account: l.transfer_from_account ?? null,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc("record_contact_payment" as any, {
            p_contact_id: mode.contactId,
            p_branch_id: mode.branchId,
            p_direction: direction,
            p_amount: l.amount,
            p_payment_method: l.method,
            p_reference_number: l.reference_number ?? null,
            p_transfer_to_account: l.transfer_to_account ?? null,
            p_received_by_name: receivedBy || profile?.name || null,
            p_fee_amount: l.fee_amount,
            p_fee_type: l.fee_type ?? null,
            p_fee_on_customer: direction === "in" ? l.fee_on_customer : false,
            p_notes: notes || null,
            p_transfer_from_account: l.transfer_from_account ?? null,
          });
          if (error) throw error;
        }
      }
      toast.success(`تم تسجيل ${lines.length} ${lines.length > 1 ? "سطور" : "سطر"} دفع`);
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      toast.error(e.message ?? "فشل التسجيل");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title ?? (direction === "in" ? "استلام دفعة" : "سداد دفعة")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Supplier credit banner (when paying a supplier and we have credit with them) */}
          {isContactOut && supplierCredit > 0 && (
            <div className="card-elevated p-3 bg-success/10 border-success/30 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-success font-semibold">💰 رصيد ليك عند المورد</span>
                <span className="font-bold text-success">{formatEGP(supplierCredit)}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                هيتخصم تلقائياً من أي شحنة جديدة من نفس المورد.
              </div>
            </div>
          )}

          {/* Header summary */}
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="card-elevated p-2.5 text-center">
              <div className="text-xs text-muted-foreground">المطلوب</div>
              <div className="font-bold">{formatEGP(effectiveRequired)}</div>
            </div>
            <div className="card-elevated p-2.5 text-center">
              <div className="text-xs text-muted-foreground">مجموع السطور</div>
              <div className="font-bold">{formatEGP(sumAmounts)}</div>
            </div>
            <div className={`card-elevated p-2.5 text-center ${Math.abs(diff) > 0.01 ? "border-warning border-2" : ""}`}>
              <div className="text-xs text-muted-foreground">{diff > 0 ? "متبقي" : diff < 0 ? "زيادة" : "متطابق"}</div>
              <div className={`font-bold ${diff > 0.01 ? "text-warning" : diff < -0.01 ? "text-destructive" : "text-success"}`}>
                {formatEGP(Math.abs(diff))}
              </div>
            </div>
          </div>

          {/* Overpayment alert for supplier */}
          {overpayAmount > 0 && (
            <div className="card-elevated p-3 bg-warning/10 border-warning border-2 text-sm space-y-1">
              <div className="font-bold text-warning flex items-center gap-2">⚠️ تنبيه: دفعة زائدة</div>
              <div className="text-xs">
                هتدفع <b>{formatEGP(overpayAmount)}</b> أكتر من المتبقي. هتتسجل كـ<b> رصيد ليك عند المورد</b> وهتتخصم تلقائياً من أي شحنة جاية.
              </div>
            </div>
          )}
          {/* Fully paid notice */}
          {isContactOut && effectiveRequired <= 0.01 && supplierCredit === 0 && (
            <div className="card-elevated p-3 bg-success/10 border-success/30 text-sm text-center text-success font-semibold">
              ✓ كل المستحقات على المورد ده مدفوعة
            </div>
          )}

          {/* Lines */}
          {lines.map((l, idx) => {
            const requiresRef = methodRequiresReference(l.method);
            const enabledOpts = PAYMENT_METHOD_OPTIONS.filter((o) => {
              if (o.value === "cash") return true;
              const f = fees.find((x) => x.payment_method === (o.value as any));
              return f ? f.is_enabled !== false : true;
            });
            return (
              <div key={l.id} className="card-elevated p-3 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm">طريقة #{idx + 1}</div>
                  {lines.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => removeLine(l.id)} className="text-destructive h-7 w-7 p-0">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">المبلغ</Label>
                    <Input
                      type="number" min={0} step="0.01" value={l.amount}
                      onChange={(e) => updateLine(l.id, { amount: Number(e.target.value) })}
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">الطريقة</Label>
                    <Select value={l.method} onValueChange={(v) => updateLine(l.id, { method: v })}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {enabledOpts.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {requiresRef && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">رقم العملية *</Label>
                      <Input
                        value={l.reference_number ?? ""}
                        onChange={(e) => updateLine(l.id, { reference_number: e.target.value })}
                        className="mt-1 h-9" placeholder="مرجع التحويل"
                      />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">
                          {direction === "in" ? methodSenderLabel(l.method) : "حسابنا (المُحوَّل منه)"}
                        </Label>
                        <Input
                          dir="ltr" className="text-right mt-1 h-9"
                          value={l.transfer_from_account ?? ""}
                          onChange={(e) => updateLine(l.id, { transfer_from_account: e.target.value })}
                          placeholder={direction === "in" ? "حساب العميل" : "حسابنا اللي اتحول منه"}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">
                          {direction === "in" ? "حسابنا (المُستلِم)" : methodReceiverLabel(l.method)}
                        </Label>
                        <Input
                          dir="ltr" className="text-right mt-1 h-9"
                          value={l.transfer_to_account ?? ""}
                          onChange={(e) => updateLine(l.id, { transfer_to_account: e.target.value })}
                          placeholder={direction === "in" ? "حسابنا اللي وصل عليه" : "حساب المورد"}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {l.fee_amount > 0 && (
                  <div className="bg-warning/10 border border-warning/30 rounded p-2 text-xs space-y-1.5">
                    <div className="flex justify-between">
                      <span>عمولة: {formatEGP(l.fee_amount)}</span>
                      <span className="font-bold">
                        إجمالي: {formatEGP(l.amount + (l.fee_on_customer ? l.fee_amount : 0))}
                      </span>
                    </div>
                    {direction === "in" && (
                      <div className="flex items-center justify-between border-t border-warning/20 pt-1.5">
                        <span>العمولة على العميل؟</span>
                        <Switch
                          checked={l.fee_on_customer}
                          onCheckedChange={(v) => updateLine(l.id, { fee_on_customer: v })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <Button variant="outline" onClick={addLine} className="w-full">
            <Plus className="w-4 h-4 ml-1" /> إضافة طريقة دفع أخرى
          </Button>

          {direction === "in" && (
            <div>
              <Label className="text-xs">اسم المستلم</Label>
              <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className="mt-1 h-9" />
            </div>
          )}
          {mode.kind === "contact" && (
            <div>
              <Label className="text-xs">ملاحظات</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 h-9" placeholder="اختياري" />
            </div>
          )}

          <div className="card-elevated p-3 flex justify-between items-center bg-primary/5">
            <span className="font-bold">الإجمالي الكلي:</span>
            <span className="text-xl font-extrabold text-primary">{formatEGP(grandTotal)}</span>
          </div>
          {sumFeesOnUs > 0 && (
            <div className="text-xs text-muted-foreground text-center">
              عمولات على الشركة (مصروف): {formatEGP(sumFeesOnUs)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={busy} className="gap-2 btn-gradient">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} تأكيد الدفع
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
