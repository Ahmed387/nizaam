import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { AlertCircle, Banknote, Wallet } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice: any;
  onDone?: () => void;
}

export function CancelInvoiceDialog({ open, onOpenChange, invoice, onDone }: Props) {
  const [reason, setReason] = useState("");
  const [paidIns, setPaidIns] = useState<any[]>([]);
  const [pendingIns, setPendingIns] = useState<any[]>([]);
  const [directPaid, setDirectPaid] = useState(0);
  const [refundMethod, setRefundMethod] = useState<"cash" | "credit" | "none">("none");
  const [busy, setBusy] = useState(false);
  const [customerName, setCustomerName] = useState<string>("");

  useEffect(() => {
    if (!open || !invoice?.id) return;
    setReason(""); setRefundMethod("none");
    (async () => {
      const { data: pp } = await supabase
        .from("payment_plans").select("id")
        .eq("reference_type", "invoice").eq("reference_id", invoice.id).maybeSingle();
      if (pp?.id) {
        const { data: ins } = await supabase
          .from("payment_installments").select("*")
          .eq("payment_plan_id", pp.id).order("installment_number");
        setPaidIns((ins ?? []).filter((i: any) => Number(i.paid_amount) > 0));
        setPendingIns((ins ?? []).filter((i: any) => ["pending","overdue","partial"].includes(i.status)));
      } else { setPaidIns([]); setPendingIns([]); }
      const { data: pays } = await supabase
        .from("invoice_payments").select("amount").eq("invoice_id", invoice.id);
      setDirectPaid((pays ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0));
      if (invoice.contact_id) {
        const { data: c } = await supabase.from("contacts").select("name").eq("id", invoice.contact_id).maybeSingle();
        setCustomerName(c?.name ?? "");
      }
    })();
  }, [open, invoice?.id, invoice?.contact_id]);

  const totalPaid = useMemo(() => {
    const insPaid = paidIns.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
    return insPaid + directPaid;
  }, [paidIns, directPaid]);

  const hasPaid = totalPaid > 0.01;
  const needsChoice = hasPaid;
  const confirmDisabled = !reason.trim() || busy || (needsChoice && refundMethod === "none");

  const confirm = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("cancel_invoice_with_refund" as any, {
      _invoice_id: invoice.id,
      _reason: reason.trim(),
      _refund_method: hasPaid ? refundMethod : "none",
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    const r = data as any;
    if (r?.refund_method === "credit") toast.success(`تم الإلغاء — تمت إضافة ${formatEGP(r.total_paid)} كرصيد للعميل`);
    else if (r?.refund_method === "cash") toast.success(`تم الإلغاء — تم رد ${formatEGP(r.total_paid)} نقداً`);
    else toast.success("تم إلغاء الفاتورة");
    onOpenChange(false);
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{hasPaid ? "تم إلغاء الفاتورة — اختر طريقة رد المبلغ" : "إلغاء الفاتورة"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 bg-surface-2 p-3 rounded-lg">
            <div><span className="text-muted-foreground">العميل: </span><b>{customerName || "عميل نقدي"}</b></div>
            <div><span className="text-muted-foreground">رقم الفاتورة: </span><b className="font-mono">{invoice?.invoice_number}</b></div>
            <div><span className="text-muted-foreground">إجمالي الفاتورة: </span><b>{formatEGP(invoice?.total ?? 0)}</b></div>
            <div><span className="text-muted-foreground">إجمالي المدفوع: </span>
              <b className={hasPaid ? "text-success" : ""}>{formatEGP(totalPaid)}</b>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">أقساط ستلغى: </span>
              <Badge variant={pendingIns.length > 0 ? "destructive" : "secondary"}>{pendingIns.length} قسط</Badge>
            </div>
          </div>

          <Textarea
            placeholder="سبب الإلغاء * (مطلوب)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />

          {!hasPaid ? (
            <div className="p-3 rounded-md bg-muted text-center text-muted-foreground">
              لم يتم دفع أي مبلغ — لا يوجد مبلغ للرد
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-semibold flex items-center gap-1">
                <AlertCircle className="w-4 h-4 text-warning" /> اختر طريقة رد {formatEGP(totalPaid)}:
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRefundMethod("cash")}
                  className={`p-3 rounded-lg border text-right transition ${refundMethod === "cash" ? "border-primary bg-primary/10" : "border-border hover:bg-surface-2"}`}
                >
                  <Banknote className="w-5 h-5 mb-1 text-success" />
                  <div className="font-bold">رد المبلغ نقداً</div>
                  <div className="text-xs text-muted-foreground">يخصم من خزنة الفرع</div>
                </button>
                <button
                  type="button"
                  disabled={!invoice?.contact_id}
                  onClick={() => setRefundMethod("credit")}
                  className={`p-3 rounded-lg border text-right transition disabled:opacity-50 ${refundMethod === "credit" ? "border-primary bg-primary/10" : "border-border hover:bg-surface-2"}`}
                >
                  <Wallet className="w-5 h-5 mb-1 text-primary" />
                  <div className="font-bold">إضافة كرصيد للعميل</div>
                  <div className="text-xs text-muted-foreground">
                    {invoice?.contact_id ? "يمكن استخدامه في فواتير قادمة" : "غير متاح — لا يوجد عميل مسجل"}
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>تراجع</Button>
          <Button variant="destructive" onClick={confirm} disabled={confirmDisabled}>
            {busy ? "جاري التنفيذ..." : "تأكيد الإلغاء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
