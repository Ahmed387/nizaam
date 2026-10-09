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

/**
 * Cancel a purchase invoice (no hard delete — owner rule).
 * Admin: cancel_purchase_invoice RPC (stock out, batches closed, plan cancelled, journal reversed, audit row).
 * Branch manager: sends an approval request; approving it runs the same RPC on the server.
 * The invoice stays in the list as «ملغاة». Money already paid stays with the supplier as an advance.
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

  useEffect(() => { if (open) setReason(""); }, [open, shipment?.id]);

  const label = `فاتورة شراء ${shipment?.shipment_number ?? ""} - ${shipment?.contacts?.name ?? ""}`;

  const submit = async () => {
    if (!shipment) return;
    if (!reason.trim()) return toast.error("اكتب سبب الإلغاء");
    setBusy(true);
    if (isAdmin) {
      const { error } = await (supabase.rpc as any)("cancel_purchase_invoice", { p_shipment_id: shipment.id, p_reason: reason.trim() });
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success(`تم إلغاء ${label}`);
    } else if (isManager) {
      const ok = await createApprovalRequest({
        tenantId: tenantId!, branchId: shipment.branch_id ?? null,
        entityType: "shipment", entityId: shipment.id, entityLabel: label,
        action: "delete", reason: reason.trim(),
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{asRequest ? "طلب إلغاء فاتورة شراء للموافقة" : "إلغاء فاتورة الشراء"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 bg-surface-2 p-3 rounded-lg">
            <div><span className="text-muted-foreground">المورد: </span><b>{shipment?.contacts?.name ?? "—"}</b></div>
            <div><span className="text-muted-foreground">رقم الفاتورة: </span><b className="font-mono">{shipment?.shipment_number ?? "—"}</b></div>
            <div className="col-span-2"><span className="text-muted-foreground">الإجمالي: </span><b>{formatEGP(shipment?.total_cost ?? 0)}</b></div>
          </div>
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed space-y-1">
            <div>• الفاتورة هتفضل ظاهرة بحالة «ملغاة» ومش هتتمسح.</div>
            <div>• كميات الأصناف هتخرج من المخزن، وقيد اليومية هيتعكس بتاريخ النهارده.</div>
            <div>• الأقساط المتبقية هتتلغي، وأي مبلغ اتدفع للمورد يفضل رصيد مقدم عنده.</div>
            <div>• لو جزء من البضاعة اتباع أو اتحول، الإلغاء هيترفض — اعمل مرتجع شراء بدلاً منه.</div>
          </div>
          {String(shipment?.invoice_date ?? shipment?.created_at ?? "").slice(0, 10) < LEDGER_START && !!(shipment?.invoice_date ?? shipment?.created_at) && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs space-y-1">
              <div className="font-semibold">فاتورة من قبل بداية الدفتر الموحد</div>
              <div>• الباقي عليها بيتخصم من رصيد المورد الافتتاحي (في حدود الرصيد ده)، واللي اتدفع عليها قبل 2026 بيبقى رصيد مقدم لينا عنده.</div>
            </div>
          )}
          <Textarea placeholder="سبب الإلغاء * (مطلوب)" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          {asRequest && <div className="text-xs text-muted-foreground">الطلب هيروح لمدير الشركة، وبعد الموافقة الإلغاء بيتنفذ بنفس الخطوات.</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>تراجع</Button>
          <Button variant="destructive" onClick={submit} disabled={busy || !reason.trim()}>
            {busy ? "جاري..." : asRequest ? "إرسال الطلب" : "تأكيد الإلغاء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
