import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Archive } from "lucide-react";
import { LEDGER_START } from "@/lib/ledger";
import { rpcErrorText } from "@/lib/rpcError";
import { CancelMoneyChoice, type CancelPreview, type MoneyChoice } from "@/components/documents/CancelMoneyChoice";
import { attachPaymentProofs, proofClock } from "@/lib/paymentProofs";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice: any;
  onDone?: () => void;
}

/**
 * Cancel a sale invoice (owner rules, migration 0085). One question about the money paid ON the invoice:
 * stays on his account / given back today / the invoice was wrong and no money came in (payments cancelled on
 * their own day). Money that reached it from his account (advance, return, general receipt) goes back by itself.
 */
export function CancelInvoiceDialog({ open, onOpenChange, invoice, onDone }: Props) {
  const [reason, setReason] = useState("");
  const [pendingIns, setPendingIns] = useState<any[]>([]);
  const [paidIns, setPaidIns] = useState<any[]>([]);
  const [directPaid, setDirectPaid] = useState(0);
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [choice, setChoice] = useState<MoneyChoice | null>(null);
  const [method, setMethod] = useState("cash");
  const [proofs, setProofs] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [customerName, setCustomerName] = useState<string>("");
  const [docDate, setDocDate] = useState<string>("");

  useEffect(() => {
    if (!open || !invoice?.id) return;
    setReason(""); setChoice(null); setMethod("cash"); setPreview(null); setProofs([]);
    (async () => {
      const { data: pp } = await supabase
        .from("payment_plans").select("id")
        .eq("reference_type", "invoice").eq("reference_id", invoice.id).maybeSingle();
      if (pp?.id) {
        const { data: ins } = await supabase
          .from("payment_installments").select("*")
          .eq("payment_plan_id", pp.id).order("installment_number");
        setPaidIns((ins ?? []).filter((i: any) => Number(i.paid_amount) > 0));
        setPendingIns((ins ?? []).filter((i: any) => ["pending", "overdue", "partial"].includes(i.status)));
      } else { setPaidIns([]); setPendingIns([]); }
      // real money only: no voided payments or their reversals, no advance use / settlement rows
      const { data: pays } = await supabase
        .from("invoice_payments").select("amount, payment_method, voided_at, reverses_payment_id").eq("invoice_id", invoice.id);
      setDirectPaid((pays ?? [])
        .filter((p: any) => !p.voided_at && !p.reverses_payment_id && !["credit_balance", "credit_applied", "settlement"].includes(p.payment_method))
        .reduce((s: number, p: any) => s + Number(p.amount), 0));
      const { data: inv } = await supabase.from("invoices").select("invoice_date").eq("id", invoice.id).maybeSingle();
      setDocDate(String(inv?.invoice_date ?? invoice.invoice_date ?? "").slice(0, 10));
      const { data: pv, error } = await supabase.rpc("document_cancel_preview" as any, { p_doc_type: "invoice", p_doc_id: invoice.id });
      if (error) toast.error(rpcErrorText(error, "إلغاء الفاتورة باختيار الفلوس"));
      else setPreview(pv as any);
      if (invoice.contact_id) {
        const { data: c } = await supabase.from("contacts").select("name").eq("id", invoice.contact_id).maybeSingle();
        setCustomerName(c?.name ?? "");
      }
    })();
  }, [open, invoice?.id, invoice?.contact_id]);

  const isArchive = !!docDate && docDate < LEDGER_START;
  const hasContact = !!invoice?.contact_id;
  // From 2026 a customer's money on the invoice comes from the ledger (any branch, counted once); a walk-in /
  // archive invoice counts its own payments (a plan collection is mirrored as an invoice payment: once).
  const fromLedger = hasContact && !isArchive && !!preview;
  const direct = useMemo(() => {
    if (fromLedger) return Number(preview!.direct ?? 0);
    const insPaid = paidIns.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
    return Math.max(insPaid, directPaid);
  }, [fromLedger, preview, paidIns, directPaid]);
  const toAccount = fromLedger ? Number(preview!.to_account ?? 0) : 0;
  const needsChoice = direct > 0.005 || (preview?.void_payments?.length ?? 0) > 0;
  const confirmDisabled = !reason.trim() || busy || (needsChoice && !choice);

  const confirm = async () => {
    setBusy(true);
    const proofSince = proofClock();
    const refund = !needsChoice ? "none" : choice === "refund" ? "cash" : choice === "void" ? "void" : "credit";
    const { data, error } = await supabase.rpc("cancel_invoice_with_refund" as any, {
      _invoice_id: invoice.id,
      _reason: reason.trim(),
      _refund_method: refund,
      _refund_pay_method: method,
    });
    setBusy(false);
    if (error) return toast.error(rpcErrorText(error, "إلغاء الفاتورة باختيار الفلوس"));
    const r = data as any;
    if (r?.refund_method === "cash" && method !== "cash" && Number(r.refunded) > 0)
      await attachPaymentProofs([{ files: proofs, method, amount: Number(r.refunded), branchId: invoice.branch_id ?? null }], proofSince);
    if (r?.refund_method === "credit") toast.success(`تم الإلغاء — ${formatEGP(r.total_paid)} بقوا تحت حسابه`);
    else if (r?.refund_method === "cash") toast.success(`تم الإلغاء — اترد له ${formatEGP(r.refunded)}${Number(r.to_account) > 0 ? ` و${formatEGP(r.to_account)} رجعوا تحت حسابه` : ""}`);
    else if (r?.refund_method === "void") toast.success(`تم الإلغاء — اتلغت ${r.voided_payments} دفعة على يومها`);
    else toast.success("تم إلغاء الفاتورة");
    onOpenChange(false);
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>إلغاء الفاتورة {invoice?.invoice_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3">
            <div><span className="text-muted-foreground">العميل: </span><b>{customerName || "عميل نقدي"}</b></div>
            <div><span className="text-muted-foreground">رقم الفاتورة: </span><b className="font-mono">{invoice?.invoice_number}</b></div>
            <div><span className="text-muted-foreground">إجمالي الفاتورة: </span><b>{formatEGP(invoice?.total ?? 0)}</b></div>
            <div><span className="text-muted-foreground">المدفوع عليها: </span><b className={direct > 0 ? "text-success" : ""}>{formatEGP(direct + toAccount)}</b></div>
            <div className="col-span-2">
              <span className="text-muted-foreground">أقساط ستلغى: </span>
              <Badge variant={pendingIns.length > 0 ? "destructive" : "secondary"}>{pendingIns.length} قسط</Badge>
            </div>
          </div>

          {isArchive && (
            <div className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="flex items-center gap-1 font-semibold"><Archive className="h-4 w-4" /> فاتورة من قبل بداية الدفتر الموحد ({docDate})</div>
              <div>• الإلغاء بيتسجل النهارده كـ«مرتجع مبيعات» — مبيعات 2025 وتكلفتها في دفاترها زي ما هي، والبضاعة بترجع المخزن.</div>
              {hasContact && <div>• الباقي عليها بيتخصم من رصيد العميل الافتتاحي (في حدود الرصيد ده). اللي دفعه عليها في 2026 بيتحسب مرة واحدة بس، والرد نقدي بس.</div>}
            </div>
          )}

          <Textarea placeholder="سبب الإلغاء * (مطلوب)" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />

          {!needsChoice ? (
            <div className="rounded-md bg-muted p-3 text-center text-muted-foreground">
              {toAccount > 0.005
                ? `مفيش فلوس مدفوعة على الفاتورة دي نفسها — ${formatEGP(toAccount)} اتخصموا من تحت حسابه وهيرجعوا لحسابه لوحدهم`
                : "لم يتم دفع أي مبلغ — لا يوجد مبلغ للرد"}
            </div>
          ) : (
            <CancelMoneyChoice
              side="customer"
              direct={direct}
              toAccount={toAccount}
              preview={preview}
              canCredit={hasContact}
              cashOnly={isArchive}
              value={choice}
              method={method}
              onChange={setChoice}
              onMethod={setMethod}
              proofs={proofs}
              onProofs={setProofs}
            />
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
