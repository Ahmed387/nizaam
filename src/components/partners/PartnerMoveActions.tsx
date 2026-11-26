import { useState } from "react";
import { toast } from "sonner";
import { Ban, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { editKindOf, editPartnerCapitalMove, moveStatusText, TX_LABEL, type PartnerCards, type PartnerMovement } from "@/lib/partners";
import { ExistingCapitalDialog } from "./ExistingCapitalDialog";

/**
 * 0288 (owner 2026-11-26): the actions of one partner movement — «تعديل» (existing capital: amount / بيتحسب من /
 * اتدفعت إمتى / notes; a till contribution / capital withdrawal: amount / day / notes — any day, reason required),
 * the proof files (📎, also on cancelled ones, read only) and «إلغاء» (handled by the caller).
 */
export function PartnerMoveActions({ m, cards, active, canWrite, onCancel, onChanged }: {
  m: PartnerMovement; cards?: PartnerCards | null; active: PartnerCards[]; canWrite: boolean;
  onCancel?: (m: PartnerMovement) => void; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const kind = canWrite ? editKindOf(m) : null;
  return (
    <div className="flex items-center gap-1 whitespace-nowrap">
      {kind && (
        <Button size="sm" variant="ghost" data-testid={`edit-move-${m.id}`} onClick={() => setOpen(true)}>
          <Pencil className="w-4 h-4 ml-1" /> تعديل
        </Button>
      )}
      <AttachmentsDialogButton recordType="partner_transaction" recordId={m.id} canEdit={canWrite && !m.void} count={m.files ?? 0}
        label="إثبات الحركة (إيصال / عقد)" />
      {canWrite && m.cancellable && onCancel && (
        <Button size="sm" variant="ghost" className="text-destructive" data-testid={`cancel-move-${m.id}`} onClick={() => onCancel(m)}>
          <Ban className="w-4 h-4 ml-1" /> إلغاء
        </Button>
      )}
      {open && kind === "existing" && cards && (
        <ExistingCapitalDialog cards={cards} active={active} editing={m} onClose={() => setOpen(false)} onDone={onChanged} />
      )}
      {open && kind === "till" && <TillMoveEditDialog m={m} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onChanged(); }} />}
    </div>
  );
}

/** the status cell: «شغال», or who edited / cancelled it, when and why (0288) — a box, not a pill (long text) */
export function PartnerMoveStatus({ m }: { m: PartnerMovement }) {
  if (!m.void && !m.replaces) return <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">شغال</span>;
  return (
    <div data-testid={`move-status-${m.id}`} className={`min-w-[190px] max-w-[260px] rounded-md border px-2 py-1 text-[11px] leading-5 ${m.void
      ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/5 text-foreground"}`}>
      {moveStatusText(m)}
    </div>
  );
}

/** a contribution / capital withdrawal that went through the till: cancelled on its own day + the corrected one */
function TillMoveEditDialog({ m, onClose, onDone }: { m: PartnerMovement; onClose: () => void; onDone: () => void }) {
  const today = cairoTodayDay();
  const [amount, setAmount] = useState(String(m.amount));
  const [date, setDate] = useState(m.date);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const amt = Number(amount || 0);
  const inFlow = m.type === "contribution";
  const changed = amt !== Number(m.amount) || date !== m.date || notes.trim() !== "";
  const save = async () => {
    if (!(amt > 0)) return toast.error("اكتب المبلغ");
    if (!date || date > today) return toast.error("التاريخ مينفعش يكون بعد النهارده");
    if (!reason.trim()) return toast.error("اكتب سبب التعديل");
    setBusy(true);
    try {
      await editPartnerCapitalMove(m.id, { amount: amt, date, notes: notes.trim() || null, reason: reason.trim() });
      toast.success(`اتعدلت ${TX_LABEL[m.type]}: ${formatEGP(Number(m.amount))} ← ${formatEGP(amt)}`);
      onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل {TX_LABEL[m.type]}</DialogTitle>
          <DialogDescription>الحركة القديمة بتتلغي في يومها والجديدة بتتسجل بنفس الفرع والوعاء، وبيفضل مكتوب مين عدّل وليه.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="tm-amount">المبلغ الصح</Label><Input id="tm-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
            <div><Label htmlFor="tm-date">اليوم الصح</Label><Input id="tm-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div><Label htmlFor="tm-notes">البيان (سيبه فاضي = زي ما هو)</Label><Textarea id="tm-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div><Label htmlFor="tm-reason">سبب التعديل (إجباري)</Label><Input id="tm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: اتكتب يوم غلط" /></div>
          {changed && (
            <div className="rounded-lg bg-muted p-3 text-xs space-y-1" data-testid="till-edit-effect">
              <div>• يوم {m.date}: {inFlow ? "يطلع" : "يرجع"} {formatEGP(Number(m.amount))} {inFlow ? "من" : "لـ"} الخزنة (إلغاء الحركة القديمة) والقيد بيتعكس في نفس اليوم.</div>
              <div>• يوم {date}: {inFlow ? "يدخل" : "يطلع"} {formatEGP(amt)} {inFlow ? "الخزنة" : "من الخزنة"} بنفس الفرع والوعاء.</div>
              {amt !== Number(m.amount) && (
                <div>• رأس ماله {(inFlow ? amt > Number(m.amount) : amt < Number(m.amount)) ? "يزيد" : "يقل"} {formatEGP(Math.abs(amt - Number(m.amount)))} — والنسبة تتغير من أول الشهر اللي بعد {date.slice(0, 7)}.</div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save} disabled={busy || !changed || !reason.trim()}>احفظ التعديل</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
