import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RecordAttachments } from "@/components/RecordAttachments";
import { formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { addExistingCapital, depositCheck, editExistingCapital, pct, type PartnerCards, type PartnerMovement } from "@/lib/partners";

/** the notes part of «رأس مال موجود بالفعل — …» */
const notesOf = (d?: string | null) => (d ?? "").replace(/^رأس مال موجود بالفعل( — )?/, "");

/**
 * «موجود بالفعل» (0280, owner 2026-11-25): an old contribution that counts in his capital and % of the profit — no till,
 * no journal entry, no ceiling. The screen shows the % before → after so the owner sees the effect before saving.
 * 0288 (owner 2026-11-26): «اتدفعت إمتى» (information only; empty = «بيتحسب من»; never after today; after «بيتحسب من» only
 * warns), the same dialog edits a saved one (`editing`, reason required), and after saving it asks for the proof files.
 */
export function ExistingCapitalDialog({ cards, active, editing, onClose, onDone }: {
  cards: PartnerCards; active: PartnerCards[]; editing?: PartnerMovement | null; onClose: () => void; onDone: () => void;
}) {
  const today = cairoTodayDay();
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [day, setDay] = useState(editing?.date ?? "2026-01-01");
  const [deposited, setDeposited] = useState(editing?.deposited_on ?? "");
  const [notes, setNotes] = useState(editing ? notesOf(editing.description) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const amt = Number(amount || 0);
  const total = active.reduce((s, r) => s + Math.max(Number(r.capital) || 0, 0), 0);
  // editing: his capital and the total without the old amount (it is replaced)
  const old = editing ? Number(editing.amount) : 0;
  const mine = Math.max((Number(cards.capital) || 0) - old, 0);
  const others = Math.max(total - old, 0);
  const before = total > 0 ? Math.max(Number(cards.capital) || 0, 0) / total : 0;
  const after = others + amt > 0 ? (mine + amt) / (others + amt) : 0;
  const dep = depositCheck(day, deposited, today);

  const save = async () => {
    if (!(amt > 0)) return toast.error("اكتب المبلغ");
    if (!day) return toast.error("اختار من إمتى بيتحسب");
    if (dep.error) return toast.error(dep.error);
    if (editing && !reason.trim()) return toast.error("اكتب سبب التعديل");
    setBusy(true);
    try {
      const id = editing
        ? await editExistingCapital(editing.id, { amount: amt, day, deposited: deposited || undefined, notes, reason: reason.trim() })
        : await addExistingCapital(cards.partner.id, amt, day, notes, deposited || undefined);
      toast.success(editing ? `اتعدل رأس المال الموجود بالفعل لـ ${cards.partner.name}` : `اتسجل ${formatEGP(amt)} لـ ${cards.partner.name} «موجود بالفعل»`);
      onDone();
      setSavedId(id);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (savedId) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>اتسجل ✓ — ارفع الإثبات</DialogTitle>
            <DialogDescription>صورة الإيصال أو عقد الشراكة (اختياري). تقدر ترفعها بعدين من زرار المرفقات جنب الحركة.</DialogDescription>
          </DialogHeader>
          <RecordAttachments recordType="partner_transaction" recordId={savedId} />
          <DialogFooter className="sm:justify-start"><Button onClick={onClose}>خلاص</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل رأس مال موجود بالفعل" : "رأس مال موجود بالفعل"} — {cards.partner.name}</DialogTitle>
          <DialogDescription>
            فلوس الشريك دفعها قبل كده. بتتحسب في رأس ماله ونسبته من الربح بس — مش بتدخل خزنة ومالهاش قيد في الدفاتر.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="ex-amount">المبلغ</Label>
              <Input id="ex-amount" type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="ex-day">بيتحسب من</Label>
              <Input id="ex-day" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ex-deposited">اتدفعت إمتى (تاريخ الإيداع)</Label>
              <Input id="ex-deposited" type="date" value={deposited} max={today} onChange={(e) => setDeposited(e.target.value)} />
            </div>
          </div>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            «اتدفعت إمتى» = اليوم اللي الشريك حط فيه الفلوس فعلاً (ينفع يكون قبل 2026). معلومة بس — مش بتغيّر نسبته ولا الربح. لو سبتها فاضية تاخد «بيتحسب من».
          </p>
          {dep.error && <div className="text-sm text-destructive" data-testid="deposit-error">{dep.error}</div>}
          {dep.warning && <div className="rounded border border-warning/40 bg-warning/10 p-2 text-xs" data-testid="deposit-warning">{dep.warning}</div>}
          <div>
            <Label htmlFor="ex-notes">ملاحظات</Label>
            <Textarea id="ex-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثلاً: المساهمة الأولى في المعرض" />
          </div>
          {editing && (
            <div>
              <Label htmlFor="ex-reason">سبب التعديل (إجباري)</Label>
              <Input id="ex-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: المبلغ اتكتب غلط" />
            </div>
          )}
          {amt > 0 && (
            <div className="rounded-lg bg-muted p-3 text-sm space-y-1" data-testid="existing-effect">
              <div>رأس ماله: <b>{formatEGP(Math.max(Number(cards.capital) || 0, 0))}</b> ← <b>{formatEGP(mine + amt)}</b></div>
              <div>نسبته من الربح: <b>{pct(before)}</b> ← <b className="text-primary">{pct(after)}</b> (من شهر {day.slice(0, 7)})</div>
              <div className="text-xs text-muted-foreground">
                {editing ? "الحركة القديمة هتتعلّم «اتعدلت» وتفضل ظاهرة، والجديدة مكانها باسمك. " : ""}الخزن والدفاتر والربح مش هيتغيروا.
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save} disabled={busy || !!dep.error || (!!editing && !reason.trim())}>{editing ? "احفظ التعديل" : "سجّل"}</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
