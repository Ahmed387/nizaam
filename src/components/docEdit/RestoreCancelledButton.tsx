import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { restoreMoneyLeft, restorePayload, submitDocumentEdit, submitMessage, type RestoreMoney } from "@/lib/documentEdit";

/**
 * «استرجاع من الملغاة» (migration 0142): a cancelled sale invoice or hand-written voucher comes back with the same
 * number and day. The owner's runs now; anybody else's goes to the owner as «طلب موافقة».
 * When money left at the cancellation (given back / payments voided) the owner is asked every time:
 * «يدفع تاني دلوقتي» or «تفضل عليه».
 */
export function RestoreCancelledButton({ kind, doc, onDone }: {
  kind: "invoice" | "voucher";
  doc: { id: string; number?: string | null; refund_method?: string | null; refund_amount?: number | null;
         total_paid_before_cancel?: number | null; contact_id?: string | null; source_type?: string | null; type?: string | null };
  onDone?: () => void;
}) {
  const { isOwner, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [money, setMoney] = useState<RestoreMoney | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const allowed = isOwner || (kind === "invoice" ? can("sales.update") : can(doc.type === "receipt" ? "receipt_vouchers.create" : "payment_vouchers.create"));
  // an automatic voucher (of an invoice / return / purchase) comes back with its document, not alone
  if (!allowed || (kind === "voucher" && doc.source_type)) return null;

  const left = kind === "invoice" ? restoreMoneyLeft(doc) : 0;
  const walkIn = !doc.contact_id;
  const label = `${kind === "invoice" ? "فاتورة" : "سند"} ${doc.number ?? ""}`.trim();

  const send = async () => {
    if (left > 0 && !money) return toast.error("اختار: العميل هيدفع تاني دلوقتي ولا الفلوس تفضل عليه");
    if (!isOwner && !reason.trim()) return toast.error("اكتب السبب");
    setBusy(true);
    try {
      const res = await submitDocumentEdit({ entity: kind, entityId: doc.id, label, reason: reason.trim() || null,
        payload: restorePayload(kind, doc.id, left > 0 ? money : null, left) });
      toast.success(res.mode === "requested" ? submitMessage(res, `استرجاع ${label}`) : `رجعت ${label} زي ما كانت`);
      setOpen(false);
      onDone?.();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر الاسترجاع");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setMoney(null); setReason(""); setOpen(true); }}>
        <RotateCcw className="w-4 h-4 ml-1" /> استرجاع من الملغاة
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>ترجع {label} زي ما كانت؟</DialogTitle>
            <DialogDescription>
              {kind === "invoice"
                ? "بنفس الرقم والتاريخ. البضاعة هتطلع من المخزن تاني (حتى لو المخزن هينزل تحت الصفر)، والبيع والتكلفة يرجعوا في يومها."
                : "بنفس الرقم والتاريخ. الفلوس هترجع للخزنة في يومها الأصلي."}
            </DialogDescription>
          </DialogHeader>
          {left > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2 text-sm">
              <div className="font-semibold">وقت الإلغاء رجع للعميل {formatEGP(left)}. هيحصل فيهم إيه؟</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={money?.action === "collect" ? "default" : "outline"} onClick={() => setMoney({ action: "collect", method: "cash" })}>
                  يدفعهم تاني دلوقتي
                </Button>
                <Button size="sm" variant={money?.action === "debt" ? "default" : "outline"} disabled={walkIn && doc.refund_method === "cash"}
                  onClick={() => setMoney({ action: "debt" })}>
                  يفضلوا عليه
                </Button>
              </div>
              {walkIn && doc.refund_method === "cash" && <p className="text-xs text-muted-foreground">عميل نقدي من غير اسم: الفلوس لازم ترجع.</p>}
            </div>
          )}
          {!isOwner && (
            <div>
              <Label>السبب (هيتبعت للمالك)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1.5" />
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button onClick={send} disabled={busy}>{isOwner ? "رجّعها" : "ابعت طلب للمالك"}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>رجوع</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
