import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Voucher, VOUCHER_TYPE_LABEL } from "@/lib/vouchers";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";
import { formatEGP, formatDate } from "@/lib/format";
import { RecordAttachments } from "./RecordAttachments";
import { useAuth } from "@/contexts/AuthContext";

export function VoucherViewDialog({
  voucher,
  open,
  onOpenChange,
  categoryName,
}: {
  voucher: Voucher | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categoryName?: string;
}) {
  const { isAdmin, hasRole } = useAuth();
  const canEdit = isAdmin || hasRole("branch_manager") || hasRole("accountant") || hasRole("cashier");
  if (!voucher) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge variant={voucher.type === "receipt" ? "default" : "destructive"}>
              {VOUCHER_TYPE_LABEL[voucher.type]}
            </Badge>
            <span className="font-mono">{voucher.voucher_number}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="التاريخ" value={formatDate(voucher.voucher_date)} />
          <Field label="المبلغ" value={<span className={voucher.type === "receipt" ? "text-success font-bold" : "text-destructive font-bold"}>{formatEGP(Number(voucher.amount))}</span>} />
          <Field label="التصنيف" value={categoryName ?? "—"} />
          <Field label="طريقة الدفع" value={PAYMENT_METHOD_LABELS[voucher.payment_method] ?? voucher.payment_method} />
          <Field label="الجهة" value={voucher.party_name ?? "—"} />
          <Field label="الحالة" value={voucher.status === "active" ? <Badge>نشط</Badge> : <Badge variant="destructive">ملغي</Badge>} />
          {voucher.description && (
            <div className="col-span-2">
              <div className="text-xs text-muted-foreground mb-1">الوصف</div>
              <div className="bg-surface-2 rounded p-2 text-sm">{voucher.description}</div>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-3 mt-2">
          <RecordAttachments recordType="voucher" recordId={voucher.id} canEdit={canEdit && voucher.status === "active"} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div>{value}</div>
    </div>
  );
}
