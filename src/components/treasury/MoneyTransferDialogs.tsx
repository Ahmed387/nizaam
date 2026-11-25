import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";
import { rpcErrorText } from "@/lib/rpcError";
import { FeeField } from "@/components/payments/FeeField";
import { feeOf, type FeeMode } from "@/lib/paymentFee";

/** The owner's approval limits (0285): {money, goods}, 0 = none. */
export function useTransferLimits() {
  const [limits, setLimits] = useState({ money: 0, goods: 0 });
  useEffect(() => {
    supabase.rpc("get_transfer_approval_limits" as any).then(({ data }) => {
      if (data) setLimits({ money: Number((data as any).money) || 0, goods: Number((data as any).goods) || 0 });
    });
  }, []);
  return limits;
}

/** «تعديل التحويل» — amount and fee, while the transfer is not received (0285). */
export function EditMoneyTransferDialog({ row, vesselLabel, onClose, onDone }: {
  row: any | null; vesselLabel: string; onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<FeeMode>("none");
  const [feeValue, setFeeValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!row) return;
    setAmount(String(Number(row.amount)));
    const m = (row.fee_mode as FeeMode) || (Number(row.fee_amount) > 0 ? "fixed" : "none");
    setMode(m);
    setFeeValue(m === "none" ? "" : String(row.fee_value ?? row.fee_amount ?? ""));
    setReason("");
  }, [row]);
  if (!row) return null;
  const amt = Number(amount) || 0;
  const fee = feeOf(row.payment_method ?? "cash", amt, mode, feeValue);
  const save = async () => {
    if (amt <= 0) return toast.error("المبلغ لازم يكون أكبر من صفر");
    if (!reason.trim()) return toast.error("اكتب سبب التعديل");
    setBusy(true);
    const { error } = await supabase.rpc("edit_money_transfer" as any, {
      p_id: row.id, p_amount: amt, p_fee_mode: mode, p_fee_value: Number(feeValue) || 0, p_reason: reason.trim(),
    } as any);
    setBusy(false);
    if (error) return toast.error(rpcErrorText(error));
    toast.success("اتعدّل التحويل");
    onDone(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>تعديل تحويل {formatEGP(Number(row.amount))} لـ {row.to_branch?.name ?? "الفرع"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground leading-6">
            {row.approval_status === "waiting"
              ? "التحويل لسه مستني موافقة المالك — التعديل بيتغيّر في الطلب نفسه، ومفيش فلوس اتحركت."
              : "الحركة القديمة بتتلغي في يومها ويتسجّل المبلغ الجديد في نفس يوم التحويل. الفرع التاني لسه ما استلمش."}
          </p>
          <div><Label>المبلغ</Label><Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5" /></div>
          <FeeField method={row.payment_method ?? "cash"} amount={amt} mode={mode} value={feeValue} direction="both" vesselLabel={vesselLabel}
            onChange={(m, v) => { setMode(m); setFeeValue(v); }} />
          {fee > 0 && <div className="text-xs">هيطلع من خزنتك: <b>{formatEGP(amt + fee)}</b></div>}
          <div><Label>سبب التعديل *</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>رجوع</Button>
          <Button onClick={save} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ التعديل"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** «إلغاء التحويل» — by the sender, while it is not received (0285). */
export function CancelMoneyTransferDialog({ row, onClose, onDone }: { row: any | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(""); }, [row]);
  if (!row) return null;
  const waiting = row.approval_status === "waiting";
  const save = async () => {
    if (!reason.trim()) return toast.error("اكتب سبب الإلغاء");
    setBusy(true);
    const { error } = await supabase.rpc("cancel_money_transfer" as any, { p_id: row.id, p_reason: reason.trim() } as any);
    setBusy(false);
    if (error) return toast.error(rpcErrorText(error));
    toast.success("اتلغى التحويل");
    onDone(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader><DialogTitle className="text-destructive">إلغاء تحويل {formatEGP(Number(row.amount))}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="leading-6">
            {waiting
              ? "التحويل لسه مستني موافقة المالك — هيتشال من عنده ومفيش فلوس اتحركت."
              : `الـ ${formatEGP(Number(row.amount))}${Number(row.fee_amount) > 0 ? ` والعمولة ${formatEGP(Number(row.fee_amount))}` : ""} بيرجعوا لخزنتك في يوم التحويل نفسه، والفرع التاني بيتبلغ.`}
          </p>
          <div><Label>سبب الإلغاء *</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>رجوع</Button>
          <Button variant="destructive" onClick={save} disabled={busy}>{busy ? "جاري..." : "تأكيد الإلغاء"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
