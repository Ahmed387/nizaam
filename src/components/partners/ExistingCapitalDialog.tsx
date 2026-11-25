import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { addExistingCapital, pct, type PartnerCards } from "@/lib/partners";

/**
 * «موجود بالفعل» (0280, owner 2026-11-25): an old contribution that counts in his capital and % of the profit — no till,
 * no journal entry, no ceiling. The screen shows the % before → after so the owner sees the effect before saving.
 */
export function ExistingCapitalDialog({ cards, active, onClose, onDone }: {
  cards: PartnerCards; active: PartnerCards[]; onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("2026-01-01");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const amt = Number(amount || 0);
  const total = active.reduce((s, r) => s + Math.max(Number(r.capital) || 0, 0), 0);
  const mine = Math.max(Number(cards.capital) || 0, 0);
  const before = total > 0 ? mine / total : 0;
  const after = total + amt > 0 ? (mine + amt) / (total + amt) : 0;

  const save = async () => {
    if (!(amt > 0)) return toast.error("اكتب المبلغ");
    if (!day) return toast.error("اختار من إمتى بيتحسب");
    setBusy(true);
    try {
      await addExistingCapital(cards.partner.id, amt, day, notes);
      toast.success(`اتسجل ${formatEGP(amt)} لـ ${cards.partner.name} «موجود بالفعل»`);
      onDone(); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>رأس مال موجود بالفعل — {cards.partner.name}</DialogTitle>
          <DialogDescription>
            فلوس الشريك دفعها قبل كده. بتتحسب في رأس ماله ونسبته من الربح بس — مش بتدخل خزنة ومالهاش قيد في الدفاتر.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ex-amount">المبلغ</Label>
              <Input id="ex-amount" type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="ex-day">بيتحسب من</Label>
              <Input id="ex-day" type="date" value={day} max={cairoTodayDay()} onChange={(e) => setDay(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="ex-notes">ملاحظات</Label>
            <Textarea id="ex-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثلاً: المساهمة الأولى في المعرض" />
          </div>
          {amt > 0 && (
            <div className="rounded-lg bg-muted p-3 text-sm space-y-1" data-testid="existing-effect">
              <div>رأس ماله: <b>{formatEGP(mine)}</b> ← <b>{formatEGP(mine + amt)}</b></div>
              <div>نسبته من الربح: <b>{pct(before)}</b> ← <b className="text-primary">{pct(after)}</b> (من شهر {day.slice(0, 7)})</div>
              <div className="text-xs text-muted-foreground">الخزن والدفاتر والربح مش هيتغيروا.</div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save} disabled={busy}>سجّل</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
