import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Voucher, VOUCHER_TYPE_LABEL } from "@/lib/vouchers";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";
import { formatEGP, formatDate } from "@/lib/format";
import { RecordAttachments } from "./RecordAttachments";
import { useAuth } from "@/contexts/AuthContext";
import {
  Calendar, Wallet, Tag, CreditCard, User2, CheckCircle2, XCircle, FileText, Paperclip, Hash,
} from "lucide-react";
import { ReactNode } from "react";

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

  const isReceipt = voucher.type === "receipt";
  const accent = isReceipt ? "success" : "destructive";
  const bannerBg = isReceipt
    ? "bg-gradient-to-l from-success/15 via-success/5 to-transparent border-success/30"
    : "bg-gradient-to-l from-destructive/15 via-destructive/5 to-transparent border-destructive/30";
  const amountColor = isReceipt ? "text-success" : "text-destructive";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0" dir="rtl">
        {/* Banner */}
        <div className={`px-6 pt-6 pb-5 border-b ${bannerBg}`}>
          <DialogHeader>
            <DialogTitle asChild>
              <div className="flex items-center justify-between gap-3 pl-10">
                <div className="flex items-center gap-3">
                  <Badge variant={isReceipt ? "default" : "destructive"} className="text-sm px-3 py-1">
                    {VOUCHER_TYPE_LABEL[voucher.type]}
                  </Badge>
                  <span className="font-mono text-base text-foreground/80 flex items-center gap-1">
                    <Hash className="w-4 h-4 opacity-60" />
                    {voucher.voucher_number}
                  </span>
                </div>
                {voucher.status === "active" ? (
                  <Badge className="bg-success text-success-foreground gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> نشط
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <XCircle className="w-3.5 h-3.5" /> ملغي
                  </Badge>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>

          {/* Big amount */}
          <div className="mt-5 text-center">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">المبلغ</div>
            <div className={`text-4xl md:text-5xl font-extrabold tabular-nums ${amountColor}`}>
              {formatEGP(Number(voucher.amount))}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field icon={<Calendar className="w-4 h-4" />} label="التاريخ" value={formatDate(voucher.voucher_date)} />
            <Field icon={<CreditCard className="w-4 h-4" />} label="طريقة الدفع" value={PAYMENT_METHOD_LABELS[voucher.payment_method] ?? voucher.payment_method} />
            <Field icon={<Tag className="w-4 h-4" />} label="التصنيف" value={categoryName ?? "—"} />
            <Field icon={<User2 className="w-4 h-4" />} label="الجهة" value={voucher.party_name ?? "—"} />
          </div>

          {voucher.description && (
            <div className="rounded-lg border border-border bg-surface-2/50 p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <FileText className="w-4 h-4" /> الوصف
              </div>
              <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                {voucher.description}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 text-sm font-bold mb-3">
              <Paperclip className="w-4 h-4" /> المرفقات
            </div>
            <RecordAttachments recordType="voucher" recordId={voucher.id} canEdit={canEdit && voucher.status === "active"} />
          </div>
        </div>

        <DialogFooter className="px-6 pb-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 flex items-start gap-3">
      <div className="mt-0.5 w-8 h-8 rounded-md bg-surface-2 flex items-center justify-center text-muted-foreground shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
        <div className="text-sm font-semibold text-foreground break-words">{value}</div>
      </div>
    </div>
  );
}
