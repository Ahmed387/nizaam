import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { createApprovalRequest } from "@/lib/approvalRequests";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { LEDGER_START } from "@/lib/ledger";
import { rpcErrorText } from "@/lib/rpcError";
import { CancelMoneyChoice, type CancelPreview, type MoneyChoice } from "@/components/documents/CancelMoneyChoice";
import { attachPaymentProofs, proofClock } from "@/lib/paymentProofs";

/**
 * Cancel a purchase invoice (no hard delete — owner rule).
 * Admin: cancel_purchase_invoice RPC (stock out, batches closed, plan cancelled, journal reversed, audit row).
 * Branch manager: sends an approval request carrying the money choice; approving it runs the same RPC.
 * The money paid ON the invoice (migration 0085): stays with the supplier as our advance / the supplier gives it
 * back today / the invoice was wrong and nothing was paid (payments cancelled on their own day).
 */
interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  shipment: { id: string; shipment_number?: string | null; total_cost?: number | null; branch_id?: string | null; invoice_date?: string | null; created_at?: string | null; contacts?: { name?: string | null } | null } | null;
  onDone?: () => void;
}

export function CancelPurchaseDialog({ open, onOpenChange, shipment, onDone }: Props) {
  const { isAdmin, hasRole, tenantId, user, profile } = useAuth();
  const isManager = hasRole("branch_manager");
  const asRequest = !isAdmin && isManager;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [choice, setChoice] = useState<MoneyChoice | null>(null);
  const [method, setMethod] = useState("cash");
  const [proofs, setProofs] = useState<File[]>([]);

  useEffect(() => {
    if (!open || !shipment?.id) return;
    setReason(""); setChoice(null); setMethod("cash"); setPreview(null); setProofs([]);
    supabase.rpc("document_cancel_preview" as any, { p_doc_type: "shipment", p_doc_id: shipment.id }).then(({ data, error }) => {
      if (error) toast.error(rpcErrorText(error, "إلغاء فاتورة الشراء باختيار الفلوس"));
      else setPreview(data as any);
    });
  }, [open, shipment?.id]);

  const label = `فاتورة شراء ${shipment?.shipment_number ?? ""} - ${shipment?.contacts?.name ?? ""}`;
  const isArchive = String(shipment?.invoice_date ?? shipment?.created_at ?? "").slice(0, 10) < LEDGER_START && !!(shipment?.invoice_date ?? shipment?.created_at);
  const direct = Number(preview?.direct ?? 0);
  const toAccount = Number(preview?.to_account ?? 0);
  const needsChoice = !isArchive && (direct > 0.005 || (preview?.void_payments?.length ?? 0) > 0);
  const action = !needsChoice ? "credit" : choice ?? "credit";

  const submit = async () => {
    if (!shipment) return;
    if (!reason.trim()) return toast.error("اكتب سبب الإلغاء");
    if (needsChoice && !choice) return toast.error("اختار هيحصل إيه في الفلوس المدفوعة");
    setBusy(true);
    if (isAdmin) {
      const proofSince = proofClock();
      const { error } = await (supabase.rpc as any)("cancel_purchase_invoice", {
        p_shipment_id: shipment.id, p_reason: reason.trim(), p_money_action: action, p_refund_method: method,
      });
      setBusy(false);
      if (error) return toast.error(rpcErrorText(error, "إلغاء فاتورة الشراء باختيار الفلوس"));
      if (action === "refund" && method !== "cash")
        await attachPaymentProofs([{ files: proofs, method, amount: direct, branchId: shipment.branch_id ?? null, anyAmount: true }], proofSince);
      toast.success(`تم إلغاء ${label}`);
    } else if (isManager) {
      const ok = await createApprovalRequest({
        tenantId: tenantId!, branchId: shipment.branch_id ?? null,
        entityType: "shipment", entityId: shipment.id, entityLabel: label,
        action: "delete", reason: reason.trim(),
        payload: { money_action: action, refund_method: method },
        requestedBy: user!.id, requestedByName: profile?.name ?? "—",
      });
      setBusy(false);
      if (!ok) return;
    } else {
      setBusy(false);
      return toast.error("غير مصرح");
    }
    onOpenChange(false);
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{asRequest ? "طلب إلغاء فاتورة شراء للموافقة" : "إلغاء فاتورة الشراء"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3">
            <div><span className="text-muted-foreground">المورد: </span><b>{shipment?.contacts?.name ?? "—"}</b></div>
            <div><span className="text-muted-foreground">رقم الفاتورة: </span><b className="font-mono">{shipment?.shipment_number ?? "—"}</b></div>
            <div><span className="text-muted-foreground">الإجمالي: </span><b>{formatEGP(shipment?.total_cost ?? 0)}</b></div>
            <div><span className="text-muted-foreground">المدفوع عليها: </span><b>{formatEGP(direct + toAccount)}</b></div>
          </div>
          <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed">
            <div>• الفاتورة هتفضل ظاهرة بحالة «ملغاة» ومش هتتمسح.</div>
            <div>• كميات الأصناف هتخرج من المخزن، وقيد اليومية هيتعكس بتاريخ النهارده.</div>
            <div>• الأقساط المتبقية هتتلغي.</div>
            <div>• لو جزء من البضاعة اتباع أو اتحول، الإلغاء هيترفض — اعمل مرتجع شراء بدلاً منه.</div>
          </div>
          {isArchive && (
            <div className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="font-semibold">فاتورة من قبل بداية الدفتر الموحد</div>
              <div>• الباقي عليها بيتخصم من رصيد المورد الافتتاحي (في حدود الرصيد ده)، واللي اتدفع عليها قبل 2026 بيبقى رصيد مقدم لينا عنده.</div>
            </div>
          )}
          <Textarea placeholder="سبب الإلغاء * (مطلوب)" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          {needsChoice ? (
            <CancelMoneyChoice
              side="supplier"
              direct={direct}
              toAccount={toAccount}
              preview={preview}
              canCredit
              value={choice}
              method={method}
              onChange={setChoice}
              onMethod={setMethod}
              proofs={isAdmin ? proofs : undefined}
              onProofs={isAdmin ? setProofs : undefined}
            />
          ) : toAccount > 0.005 ? (
            <div className="rounded-md bg-muted p-3 text-center text-xs text-muted-foreground">
              {formatEGP(toAccount)} اتخصموا عليها من فلوسنا عند المورد — هيرجعوا رصيد لينا عنده لوحدهم.
            </div>
          ) : null}
          {asRequest && <div className="text-xs text-muted-foreground">الطلب هيروح لمدير الشركة باختيارك، وبعد الموافقة الإلغاء بيتنفذ بنفس الخطوات.</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>تراجع</Button>
          <Button variant="destructive" onClick={submit} disabled={busy || !reason.trim() || (needsChoice && !choice)}>
            {busy ? "جاري..." : asRequest ? "إرسال الطلب" : "تأكيد الإلغاء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
