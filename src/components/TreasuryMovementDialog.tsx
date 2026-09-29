import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatEGP, resolveTreasuryOperationNumber, sanitizeOperationalDescription, treasuryCategoryLabel } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, PaymentMethod } from "@/lib/paymentMethods";

export interface TreasuryMovement {
  id: string;
  type: "income" | "expense";
  category: string;
  amount: number;
  description: string | null;
  payment_method: string | null;
  reference_id?: string | null;
  reference_number?: string | null;
  voucher_number?: string | null;
  invoice_number?: string | null;
  transaction_date: string;
  created_at: string;
}

interface Props {
  movement: TreasuryMovement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchName?: string;
}

export function TreasuryMovementDialog({ movement, open, onOpenChange, branchName }: Props) {
  const description = sanitizeOperationalDescription(movement?.description);
  const reference = resolveTreasuryOperationNumber(movement?.voucher_number, movement?.invoice_number, movement?.reference_number);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader><DialogTitle>تفاصيل حركة الخزينة</DialogTitle></DialogHeader>
        {movement && (
          <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-surface-2 p-4 text-sm">
            <div><span className="text-muted-foreground">رقم العملية:</span> <b dir="ltr" className="unicode-isolate">{reference}</b></div>
            <div><span className="text-muted-foreground">تاريخ السند / الحركة:</span> {formatDate(movement.transaction_date)}</div>
            {branchName && <div><span className="text-muted-foreground">الفرع:</span> {branchName}</div>}
            <div><span className="text-muted-foreground">النوع:</span> {movement.type === "income" ? "وارد" : "صادر"}</div>
            <div><span className="text-muted-foreground">التصنيف:</span> {treasuryCategoryLabel(movement.category)}</div>
            <div><span className="text-muted-foreground">طريقة الدفع:</span> {PAYMENT_METHOD_LABELS[movement.payment_method as PaymentMethod] ?? movement.payment_method ?? "—"}</div>
            <div className="col-span-2"><span className="text-muted-foreground">المبلغ:</span> <b>{formatEGP(Number(movement.amount))}</b></div>
            <div className="col-span-2"><span className="text-muted-foreground">الملاحظات / البيان:</span> <span dir="rtl" className="unicode-isolate whitespace-pre-wrap">{description || "—"}</span></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}