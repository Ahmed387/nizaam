import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaymentMethodPicker, emptyPaymentValue, PaymentMethodValue } from "./PaymentMethodPicker";
import { validateTransferPayment } from "@/lib/paymentMethods";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  installmentId?: string;
  defaultAmount: number;
  /** 'in' = we receive (customer pays us); 'out' = we pay (we pay supplier/employee) */
  direction: "in" | "out";
  /** label override e.g. "استلم دفعة" / "ادفع للمورد" */
  title?: string;
  onSuccess?: () => void;
}

export function RecordPaymentDialog({
  open, onOpenChange, planId, installmentId, defaultAmount, direction, title, onSuccess,
}: Props) {
  const { profile } = useAuth();
  const [amount, setAmount] = useState(defaultAmount);
  const [pm, setPm] = useState<PaymentMethodValue>(emptyPaymentValue());
  const [feeOnCustomer, setFeeOnCustomer] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setAmount(defaultAmount); setPm(emptyPaymentValue()); setFeeOnCustomer(false); } }, [open, defaultAmount]);

  const submit = async () => {
    if (amount <= 0) return toast.error("أدخل مبلغ صحيح");
    if (pm.method !== "cash" && !pm.reference_number?.trim()) return toast.error("أدخل رقم العملية");
    setBusy(true);
    try {
      const { error } = await supabase.rpc("record_payment_transaction", {
        p_payment_plan_id: planId,
        p_installment_id: installmentId ?? null,
        p_amount: amount,
        p_payment_method: pm.method,
        p_reference_number: pm.reference_number ?? null,
        p_transfer_to_account: pm.transfer_to_account ?? null,
        p_received_by_name: pm.received_by_name ?? profile?.name ?? null,
        p_fee_amount: pm.fee_amount,
        p_fee_type: pm.fee_type ?? null,
        p_fee_on_customer: direction === "in" ? feeOnCustomer : false,
        p_direction: direction,
      });
      if (error) throw error;
      toast.success("تم تسجيل الدفعة");
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      toast.error(e.message ?? "فشل التسجيل");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{title ?? (direction === "in" ? "استلم دفعة" : "سجل دفعة")}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>المبلغ</Label>
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mt-1.5" />
          </div>
          <PaymentMethodPicker
            amount={amount}
            value={pm}
            onChange={setPm}
            showReceivedBy={direction === "in"}
            showFeeBearerToggle={direction === "in"}
            feeOnCustomer={feeOnCustomer}
            onFeeBearerChange={setFeeOnCustomer}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={busy} className="gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} تأكيد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
