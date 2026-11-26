import { useRef, useState } from "react";
import { toast } from "sonner";
import { Archive, ArrowLeft, CalendarDays, History, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate, formatEGP } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { isSupportedAttachment, uploadRecordAttachment } from "@/lib/attachmentUpload";
import {
  addExistingCapital, addPreSystemWithdrawal, depositCheck, editExistingCapital, pct,
  type PartnerCards, type PartnerMovement,
} from "@/lib/partners";

type Kind = "in" | "out";
type Mode = "capital" | "profit";

/** the notes part of «رأس مال موجود بالفعل — …» / «سحب قبل السيستم — …» */
const notesOf = (d?: string | null) => (d ?? "").replace(/^(رأس مال موجود بالفعل|سحب قبل السيستم)( — )?/, "");

/**
 * Money before the system, both ways, in ONE polished form (owner 2026-11-26 «الفورم … يبقي افضل في الديزاين»):
 *  - kind "in"  = «رأس مال موجود بالفعل» (0280 / 0288): old money he put in — counts in his capital and % from «بيتحسب من»;
 *  - kind "out" = «سحب قبل السيستم» (0290): old money he took — the owner picks each time (owner «(ج)»): from his capital
 *    (capital and % go down) or from the profit (his % stays, his «صافي الربح» card goes down, maybe below zero).
 * No till, no journal entry in either. The proof files are picked in the form and uploaded right after saving; editing
 * (reason required) keeps the old files (they move to the corrected row).
 */
export function OldMoneyDialog({ kind, cards, active, editing, onClose, onDone }: {
  kind: Kind; cards: PartnerCards; active: PartnerCards[]; editing?: PartnerMovement | null; onClose: () => void; onDone: () => void;
}) {
  const { user } = useAuth();
  const today = cairoTodayDay();
  const isIn = kind === "in";
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [mode, setMode] = useState<Mode | null>(editing ? (editing.type === "profit_withdrawal" ? "profit" : "capital") : null);
  const [day, setDay] = useState(editing?.date ?? "2026-01-01");
  const [moneyDay, setMoneyDay] = useState(editing?.deposited_on ?? "");
  const [notes, setNotes] = useState(editing ? notesOf(editing.description) : "");
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const amt = Number(amount || 0);
  const old = editing ? Number(editing.amount) : 0;
  const capNow = Math.max(Number(cards.capital) || 0, 0);
  const total = active.reduce((s, r) => s + Math.max(Number(r.capital) || 0, 0), 0);
  // what this movement does to his capital (the edited one is taken out first)
  const capDelta = (m: Mode | null, a: number) => (isIn ? a : m === "capital" ? -a : 0);
  const base = editing ? capNow - capDelta(mode, old) : capNow;
  const baseTotal = editing ? total - capDelta(mode, old) : total;
  const capAfter = base + capDelta(mode, amt);
  const totalAfter = baseTotal + capDelta(mode, amt);
  const shareNow = total > 0 ? capNow / total : 0;
  const shareAfter = totalAfter > 0 ? Math.max(capAfter, 0) / totalAfter : 0;
  const profitNow = Number(cards.profit) || 0;
  const profitAfter = !isIn && mode === "profit" ? profitNow + (editing ? old : 0) - amt : profitNow;
  const dep = depositCheck(day, moneyDay, today);
  const overCapital = !isIn && mode === "capital" && amt > base + 0.005;
  const problem = !(amt > 0) ? "اكتب المبلغ" : !isIn && !mode ? "اختار السحبة دي من رأس ماله ولا من الربح"
    : overCapital ? `رأس ماله ${formatEGP(base)} بس` : !day ? "اختار من إمتى بيتحسب" : day > today ? "التاريخ مينفعش يكون بعد النهارده"
    : dep.error ? dep.error : editing && !reason.trim() ? "اكتب سبب التعديل" : null;

  const pick = (list: FileList | null) => {
    const ok = Array.from(list ?? []).filter((f) => {
      if (!isSupportedAttachment(f)) { toast.error(`«${f.name}» — صورة أو PDF بس`); return false; }
      return true;
    });
    setFiles((p) => [...p, ...ok]);
  };

  const save = async () => {
    if (problem) return toast.error(problem);
    setBusy(true);
    try {
      const id = editing
        ? await editExistingCapital(editing.id, { amount: amt, day, deposited: moneyDay || undefined, notes, reason: reason.trim() })
        : isIn
          ? await addExistingCapital(cards.partner.id, amt, day, notes, moneyDay || undefined)
          : await addPreSystemWithdrawal(cards.partner.id, { amount: amt, day, mode: mode!, withdrawnOn: moneyDay || undefined, notes });
      let failed = 0;
      for (const f of files) {
        try { await uploadRecordAttachment("partner_transaction", id, f, user?.id); } catch { failed += 1; }
      }
      toast.success(`${editing ? "اتعدلت" : "اتسجلت"} ${isIn ? "«موجود بالفعل»" : "«سحب قبل السيستم»"} لـ ${cards.partner.name}${files.length ? ` — ${files.length - failed} مرفق` : ""}`);
      if (failed) toast.error(`${failed} مرفق مترفعش — ارفعه من زرار 📎 جنب الحركة`);
      onDone(); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const Icon = isIn ? Archive : History;
  const title = `${editing ? "تعديل " : ""}${isIn ? "رأس مال موجود بالفعل" : "سحب قبل السيستم"}`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-xl p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col" data-testid="old-money-dialog">
        <DialogHeader className={`px-6 pt-6 pb-4 border-b ${isIn ? "bg-success/5" : "bg-warning/5"}`}>
          <div className="flex items-start gap-3">
            <div className={`shrink-0 rounded-full p-2.5 ${isIn ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}><Icon className="w-5 h-5" /></div>
            <div className="min-w-0 text-right">
              <DialogTitle className="text-lg">{title}</DialogTitle>
              <div className="text-sm font-semibold text-muted-foreground mt-0.5">{cards.partner.name}</div>
            </div>
          </div>
          <DialogDescription className="text-xs leading-5 mt-2 text-right">
            {isIn ? "فلوس الشريك دفعها قبل السيستم. بتتحسب في رأس ماله ونسبته من الربح بس."
              : "فلوس الشريك سحبها قبل السيستم."} الخزن والدفاتر مش بتتحرك.
          </DialogDescription>
          <div className="flex flex-wrap gap-2 mt-3 text-xs">
            <span className="rounded-full border bg-background px-2.5 py-1">رأس ماله: <b className="tabular-nums">{formatEGP(capNow)}</b></span>
            <span className="rounded-full border bg-background px-2.5 py-1">نسبته من الربح: <b className="tabular-nums">{pct(shareNow)}</b></span>
            {!isIn && <span className="rounded-full border bg-background px-2.5 py-1">صافي ربحه: <b className="tabular-nums">{formatEGP(profitNow)}</b></span>}
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <section>
            <Label htmlFor="om-amount" className="text-sm font-semibold">المبلغ</Label>
            <div className="relative mt-1.5">
              <Input id="om-amount" type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus
                className="h-14 text-2xl font-bold tabular-nums pl-14" placeholder="0" />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">ج.م</span>
            </div>
            {amt > 0 && <div className="mt-1 text-xs text-muted-foreground tabular-nums" data-testid="om-amount-text">{formatEGP(amt)}</div>}
          </section>

          {!isIn && (
            <section>
              <div className="text-sm font-semibold mb-2">السحبة دي اتحسبت من فين؟</div>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="السحبة من فين">
                {([
                  { v: "capital" as Mode, t: "من رأس ماله", d: "رأس ماله ونسبته من الربح يقلوا من الشهر اللي تختاره تحت." },
                  { v: "profit" as Mode, t: "من الربح", d: "نسبته تفضل زي ما هي. المبلغ يتخصم من كارت «صافي الربح» بتاعه — لو أكبر من ربحه يبان بالسالب لحد ما يتغطى من التوزيع الجاي." },
                ]).map((o) => (
                  <button key={o.v} type="button" role="radio" aria-checked={mode === o.v} disabled={!!editing && mode !== o.v}
                    data-testid={`om-mode-${o.v}`} onClick={() => !editing && setMode(o.v)}
                    className={`rounded-xl border-2 p-3 text-right transition ${mode === o.v ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"} disabled:opacity-40`}>
                    <div className="font-semibold text-sm flex items-center gap-2">
                      <span className={`inline-block w-3.5 h-3.5 rounded-full border-2 ${mode === o.v ? "border-primary bg-primary" : "border-muted-foreground"}`} />{o.t}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 leading-5">{o.d}</div>
                  </button>
                ))}
              </div>
              {editing && <div className="text-[11px] text-muted-foreground mt-1">عشان تغيّر «من فين» الغي الحركة واعمل واحدة جديدة.</div>}
            </section>
          )}

          <section className="grid gap-4 sm:grid-cols-2">
            <DayField id="om-day" label="بيتحسب من" value={day} max={today} onChange={setDay}
              hint={isIn ? "من الشهر ده بياخد نسبة من الربح" : mode === "profit" ? "الشهر اللي يتسجل فيه" : "من الشهر ده نسبته تقل"} />
            <DayField id="om-money-day" label={isIn ? "اتدفعت إمتى (اختياري)" : "اتسحبت إمتى (اختياري)"} value={moneyDay} max={today} onChange={setMoneyDay}
              hint={`اليوم اللي ${isIn ? "حط" : "سحب"} فيه الفلوس فعلاً — ينفع قبل 2026. فاضية = «بيتحسب من»`} />
          </section>
          {dep.error && <div className="text-sm text-destructive" data-testid="deposit-error">{dep.error}</div>}
          {dep.warning && isIn && <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs" data-testid="deposit-warning">{dep.warning}</div>}

          <section>
            <Label htmlFor="om-notes" className="text-sm font-semibold">ملاحظات</Label>
            <Textarea id="om-notes" rows={2} className="mt-1.5" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={isIn ? "مثلاً: المساهمة الأولى في المعرض" : "مثلاً: سحبها لشراء عربية سنة 2025"} />
          </section>

          <section>
            <div className="text-sm font-semibold">الإثبات <span className="font-normal text-muted-foreground text-xs">(صورة إيصال أو عقد — اختياري)</span></div>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" data-testid="om-files"
              onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}><Paperclip className="w-4 h-4" /> اختار ملف</Button>
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs max-w-[220px]">
                  <span className="truncate">{f.name}</span>
                  <button type="button" aria-label={`شيل ${f.name}`} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" /></button>
                </span>
              ))}
              {editing && (editing.files ?? 0) > 0 && <span className="text-[11px] text-muted-foreground">+ {editing.files} مرفق قديم بيتنقل مع التعديل</span>}
            </div>
          </section>

          {editing && (
            <section>
              <Label htmlFor="om-reason" className="text-sm font-semibold">سبب التعديل <span className="text-destructive">*</span></Label>
              <Input id="om-reason" className="mt-1.5" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: المبلغ اتكتب غلط" />
            </section>
          )}

          {amt > 0 && (isIn || mode) && (
            <section className="rounded-xl border bg-muted/40 p-4 space-y-2 text-sm" data-testid="existing-effect">
              <div className="font-semibold text-xs text-muted-foreground">اللي هيحصل</div>
              <EffectRow label="رأس ماله" before={formatEGP(capNow)} after={formatEGP(Math.max(capAfter, 0))} changed={capAfter !== capNow} />
              <EffectRow label="نسبته من الربح" before={pct(shareNow)} after={pct(shareAfter)} changed={Math.abs(shareAfter - shareNow) > 1e-6}
                note={isIn || mode === "capital" ? `من شهر ${day.slice(0, 7)}` : undefined} />
              {!isIn && mode === "profit" && (
                <EffectRow label="صافي ربحه" before={formatEGP(profitNow)} after={formatEGP(profitAfter)} changed warn={profitAfter < 0} />
              )}
              {overCapital && <div className="text-xs text-destructive">رأس ماله {formatEGP(base)} بس — مينفعش يتسحب منه أكتر.</div>}
              <div className="text-[11px] text-muted-foreground pt-1 border-t">الخزن والدفاتر والربح مش هيتغيروا.{editing ? " الحركة القديمة هتتعلّم «اتعدلت» وتروح «الملغاة»." : ""}</div>
            </section>
          )}
        </div>

        <div className="flex items-center gap-2 border-t bg-background px-6 py-3">
          <Button onClick={save} disabled={busy || !!problem} data-testid="om-save">{busy ? "بيتسجل…" : editing ? "احفظ التعديل" : "سجّل"}</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
          {problem && amount !== "" && <span className="text-xs text-muted-foreground mr-auto" data-testid="om-problem">{problem}</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DayField({ id, label, value, max, onChange, hint }: { id: string; label: string; value: string; max: string; onChange: (v: string) => void; hint: string }) {
  return (
    <div>
      <Label htmlFor={id} className="text-sm font-semibold">{label}</Label>
      <div className="relative mt-1.5">
        <Input id={id} type="date" lang="ar-EG" value={value} max={max} onChange={(e) => onChange(e.target.value)} className="h-11 tabular-nums" />
      </div>
      <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-foreground/80 min-h-4">
        {value ? <><CalendarDays className="w-3.5 h-3.5" /><span>{formatDate(value)}</span></> : <span className="font-normal text-muted-foreground">مش متحدد</span>}
      </div>
      <div className="text-[11px] leading-4 text-muted-foreground mt-0.5">{hint}</div>
    </div>
  );
}

function EffectRow({ label, before, after, changed, note, warn }: { label: string; before: string; after: string; changed: boolean; note?: string; warn?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground w-28">{label}</span>
      <b className="tabular-nums">{before}</b>
      {changed && <><ArrowLeft className="w-4 h-4 text-muted-foreground" /><b className={`tabular-nums ${warn ? "text-destructive" : "text-primary"}`}>{after}</b></>}
      {!changed && <span className="text-xs text-muted-foreground">(زي ما هو)</span>}
      {note && changed && <span className="text-[11px] text-muted-foreground">{note}</span>}
    </div>
  );
}

/** «رأس مال موجود بالفعل» (kept name for the old imports) */
export function ExistingCapitalDialog(p: { cards: PartnerCards; active: PartnerCards[]; editing?: PartnerMovement | null; onClose: () => void; onDone: () => void }) {
  const out = !!p.editing && p.editing.type !== "capital_adjustment";
  return <OldMoneyDialog kind={out ? "out" : "in"} {...p} />;
}

/** «سحب قبل السيستم» (0290) */
export function PreSystemWithdrawalDialog(p: { cards: PartnerCards; active: PartnerCards[]; onClose: () => void; onDone: () => void }) {
  return <OldMoneyDialog kind="out" {...p} />;
}
