import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  restoreChoices, restoreMoneyLeft, restorePayload, shipmentRestoreQuestion, submitDocumentEdit, submitMessage,
  type RestoreKind, type RestoreMoney,
} from "@/lib/documentEdit";

const KIND_LABEL: Record<RestoreKind, string> = {
  invoice: "فاتورة", voucher: "سند", sale_return: "مرتجع", purchase_return: "مرتجع شراء", shipment: "فاتورة شراء",
};
const KIND_NOTE: Record<RestoreKind, string> = {
  invoice: "بنفس الرقم والتاريخ. البضاعة هتطلع من المخزن تاني (حتى لو المخزن هينزل تحت الصفر)، والبيع والتكلفة يرجعوا في يومها.",
  voucher: "بنفس الرقم والتاريخ. الفلوس هترجع للخزنة في يومها الأصلي.",
  sale_return: "بنفس الرقم والتاريخ. القطع ترجع المخزن تاني، والفلوس اللي رجعت الخزنة وقت الإلغاء تطلع تاني في يوم المرتجع.",
  purchase_return: "بنفس الرقم والتاريخ. القطع تطلع من المخزن تاني، والفلوس اللي طلعت وقت الإلغاء ترجع الخزنة في يوم المرتجع.",
  shipment: "بنفس الرقم والتاريخ. البضاعة ترجع المخزن، والقيد يرجع، وخطة السداد ترجع زي ما كانت.",
};

/**
 * «استرجاع من الملغاة» (migrations 0142 / 0146 / 0149): a cancelled sale invoice, hand-written voucher, sale return,
 * purchase return or purchase invoice comes back with the same number and day. The owner's runs now; anybody else's goes
 * to the owner as «طلب موافقة» carrying the choice. When money left at the cancellation whoever restores picks one, and
 * every choice shows its effect under it (`restoreChoices`): sale invoice «يدفع تاني دلوقتي» / «تفضل عليه»; purchase
 * refunded by the supplier «ترجعهوله النهارده» / «كأن الاسترداد ماحصلش» / «تفضل معانا وتبقى علينا له»; purchase voided
 * «ندفعله تاني دلوقتي» / «تفضل علينا».
 */
export function RestoreCancelledButton({ kind, doc, onDone }: {
  kind: RestoreKind;
  doc: { id: string; number?: string | null; refund_method?: string | null; refund_amount?: number | null;
         total_paid_before_cancel?: number | null; contact_id?: string | null; source_type?: string | null; type?: string | null;
         money_action?: string | null };
  onDone?: () => void;
}) {
  const { isOwner, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [money, setMoney] = useState<RestoreMoney | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const perm = kind === "invoice" ? "sales.update"
    : kind === "shipment" ? "shipments.update"
    : kind === "voucher" ? (doc.type === "receipt" ? "receipt_vouchers.create" : "payment_vouchers.create")
    : "returns.update";
  const allowed = isOwner || can(perm);
  // an automatic voucher (of an invoice / return / purchase) comes back with its document, not alone
  if (!allowed || (kind === "voucher" && doc.source_type)) return null;

  const left = kind === "invoice" ? restoreMoneyLeft(doc) : 0;
  const shipQ = kind === "shipment" ? shipmentRestoreQuestion(doc) : null;
  const choices = restoreChoices(kind, doc, left);
  const label = `${KIND_LABEL[kind]} ${doc.number ?? ""}`.trim();
  const needsAnswer = choices.length > 0;
  const question = kind === "invoice" ? `وقت الإلغاء رجع للعميل ${formatEGP(left)}. هيحصل فيهم إيه؟`
    : shipQ === "refund" ? `وقت الإلغاء المورد رجّعلنا ${formatEGP(doc.refund_amount ?? 0)}. هيحصل فيهم إيه؟`
    : "وقت الإلغاء دفعات الفاتورة اتلغت (غلط ومفيش فلوس). دلوقتي:";

  const send = async () => {
    if (needsAnswer && !money) return toast.error("اختار هيحصل إيه في الفلوس");
    if (!isOwner && !reason.trim()) return toast.error("اكتب السبب");
    setBusy(true);
    try {
      const res = await submitDocumentEdit({ entity: kind, entityId: doc.id, label, reason: reason.trim() || null,
        payload: restorePayload(kind, doc.id, needsAnswer ? money : null, left, doc) });
      toast.success(res.mode === "requested" ? submitMessage(res, `استرجاع ${label}`) : `رجع ${label} زي ما كان`);
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
            <DialogTitle>ترجّع {label} زي ما كان؟</DialogTitle>
            <DialogDescription>{KIND_NOTE[kind]}</DialogDescription>
          </DialogHeader>
          {needsAnswer && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2 text-sm">
              <div className="font-semibold">{question}</div>
              <div className="space-y-2" role="radiogroup">
                {choices.map((c) => (
                  <button key={c.action} type="button" role="radio" aria-checked={money?.action === c.action} disabled={c.disabled}
                    onClick={() => setMoney({ action: c.action, ...(c.method ? { method: c.method } : {}) } as RestoreMoney)}
                    className={cn("w-full text-right rounded-md border p-2 transition-colors",
                      money?.action === c.action ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted",
                      c.disabled && "opacity-50 cursor-not-allowed hover:bg-background")}>
                    <div className="font-semibold">{c.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{c.effect}</div>
                    {c.disabled && c.why && <div className="text-xs text-destructive mt-0.5">{c.why}</div>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!isOwner && (
            <div>
              <Label>السبب (هيتبعت للمالك)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1.5" />
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button onClick={send} disabled={busy}>{isOwner ? "رجّعه" : "ابعت طلب للمالك"}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>رجوع</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
