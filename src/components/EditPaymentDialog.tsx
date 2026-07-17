import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";
import { PaymentMethodPicker, PaymentMethodValue } from "./PaymentMethodPicker";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: { kind: "invpay" | "tx"; row: any } | null;
  onSuccess: () => void;
}

export function EditPaymentDialog({ open, onOpenChange, target, onSuccess }: Props) {
  const [method, setMethod] = useState<PaymentMethodValue>({ method: "cash", fee_amount: 0, total_with_fee: 0 });
  const [amount, setAmount] = useState<string>("");
  const [reference, setReference] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [reason, setReason] = useState("");
  const [feeOnCustomer, setFeeOnCustomer] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && target) {
      const r = target.row;
      setMethod({
        method: r.payment_method || "cash",
        fee_amount: Number(r.fee_amount || 0),
        total_with_fee: Number(r.amount || 0) + Number(r.fee_amount || 0),
        transfer_to_account: r.transfer_to_account ?? undefined,
        transfer_from_account: r.transfer_from_account ?? undefined,
      });
      setFeeOnCustomer(!!r.fee_on_customer);
      setAmount(String(r.amount ?? ""));
      setReference(r.reference_number ?? "");
      setReceivedBy(r.received_by_name ?? "");
      setReason("");
    }
  }, [open, target]);

  const submit = async () => {
    if (!target) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("ادخل مبلغ صحيح");
      return;
    }
    if (!reason.trim()) {
      toast.error("سبب التعديل مطلوب");
      return;
    }
    setSaving(true);
    try {
      if (target.kind === "invpay") {
        const { error } = await supabase.rpc("edit_invoice_payment" as any, {
          p_payment_id: target.row.id,
          p_amount: amt,
          p_payment_method: method.method,
          p_reference_number: reference || null,
          p_transfer_to_account: method.transfer_to_account || null,
          p_transfer_from_account: method.transfer_from_account || null,
          p_fee_amount: Number(method.fee_amount || 0),
          p_fee_on_customer: method.fee_on_customer ?? false,
          p_received_by_name: receivedBy || null,
          p_reason: reason,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("edit_payment_transaction" as any, {
          p_tx_id: target.row.id,
          p_amount: amt,
          p_payment_method: method.method,
          p_reference_number: reference || null,
          p_transfer_to_account: method.transfer_to_account || null,
          p_transfer_from_account: method.transfer_from_account || null,
          p_fee_amount: Number(method.fee_amount || 0),
          p_received_by_name: receivedBy || null,
          p_reason: reason,
        });
        if (error) throw error;
      }
      toast.success("تم تعديل الدفعة، الحسابات اتحدثت تلقائياً");
      onOpenChange(false);
      onSuccess();
    } catch (e: any) {
      toast.error(e.message ?? "فشل التعديل");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" />
            تعديل الدفعة
          </DialogTitle>
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
              className="h-11 text-lg font-bold text-center tabular-nums"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">رقم مرجعي</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">استلم بواسطة</Label>
            <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs mb-1 block text-destructive">سبب التعديل *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: طريقة الدفع كانت غلط، كانت instapay مش cash..."
              className="min-h-[70px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button>
          <Button onClick={submit} disabled={saving} className="gap-1">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} حفظ التعديل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
