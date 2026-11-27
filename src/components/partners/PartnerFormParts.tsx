import { useRef } from "react";
import { toast } from "sonner";
import { ArrowLeft, CalendarDays, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { isSupportedAttachment } from "@/lib/attachmentUpload";
import { countsFromWarning, monthChoices, monthLabel, suggestCountsFrom, type MoneyDir } from "@/lib/partners";

/** Parts shared by the partner money forms (مساهمة / سحب / موجود بالفعل / سحب قبل السيستم). */

export function DayField({ id, label, value, max, min, onChange, hint }: {
  id: string; label: string; value: string; max: string; min?: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-sm font-semibold">{label}</Label>
      <Input id={id} type="date" lang="ar-EG" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} className="h-11 tabular-nums mt-1.5" />
      <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-foreground/80 min-h-4">
        {value ? <><CalendarDays className="w-3.5 h-3.5" /><span>{formatDate(value)}</span></> : <span className="font-normal text-muted-foreground">مش متحدد</span>}
      </div>
      {hint && <div className="text-[11px] leading-4 text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

/**
 * «اتدفعت/اتسحبت إمتى» (the exact day) + «يتحسب من بداية شهر» (owner 2026-11-27). Picking the day suggests the month by the
 * rule (in → the month after, out → the same month) until the owner picks a month himself; another month = a warning only.
 */
export function CountsFromFields({ dir, day, onDay, month, onMonth, touched, onTouched, today, minDay, maxMonth, dayLabel, prefix }: {
  dir: MoneyDir; day: string; onDay: (v: string) => void; month: string; onMonth: (v: string) => void;
  touched: boolean; onTouched: () => void; today: string; minDay?: string; maxMonth?: string; dayLabel?: string; prefix: string;
}) {
  const suggested = suggestCountsFrom(dir, day);
  const choices = monthChoices(today, month).filter((m) => !maxMonth || m <= maxMonth || m === month);
  const warn = countsFromWarning(dir, day, month);
  const setDay = (v: string) => {
    onDay(v);
    if (!touched && v) {
      const s = suggestCountsFrom(dir, v);
      onMonth(maxMonth && s > maxMonth ? maxMonth : s);
    }
  };
  return (
    <section className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <DayField id={`${prefix}-day`} label={dayLabel ?? (dir === "in" ? "اتدفعت إمتى" : "اتسحبت إمتى")} value={day} min={minDay} max={today} onChange={setDay}
          hint={`اليوم اللي الفلوس ${dir === "in" ? "دخلت" : "طلعت"} فيه فعلاً`} />
        <div>
          <Label htmlFor={`${prefix}-month`} className="text-sm font-semibold">يتحسب من بداية شهر</Label>
          <Select value={month} onValueChange={(v) => { onTouched(); onMonth(v); }}>
            <SelectTrigger id={`${prefix}-month`} className="h-11 mt-1.5" data-testid={`${prefix}-month`}><SelectValue placeholder="اختار الشهر" /></SelectTrigger>
            <SelectContent>
              {choices.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}{m === suggested ? " (القاعدة)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="text-[11px] leading-4 text-muted-foreground mt-1.5">
            {dir === "in" ? "من الشهر ده رأس ماله ونسبته يزيدوا" : "من الشهر ده رأس ماله ونسبته يقلوا"}
            {suggested && <> — القاعدة: <b data-testid={`${prefix}-rule`}>{monthLabel(suggested)}</b></>}
          </div>
        </div>
      </div>
      {warn && <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs leading-5" data-testid={`${prefix}-warning`}>{warn}</div>}
    </section>
  );
}

export function EffectRow({ label, before, after, changed, note, warn }: { label: string; before: string; after: string; changed: boolean; note?: string; warn?: boolean }) {
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

/** «الإثبات»: pick images / PDFs before saving; they are uploaded right after the row is saved */
export function ProofPicker({ files, setFiles, oldCount, testId }: { files: File[]; setFiles: (f: File[] | ((p: File[]) => File[])) => void; oldCount?: number; testId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = (list: FileList | null) => {
    const ok = Array.from(list ?? []).filter((f) => {
      if (!isSupportedAttachment(f)) { toast.error(`«${f.name}» — صورة أو PDF بس`); return false; }
      return true;
    });
    setFiles((p) => [...p, ...ok]);
  };
  return (
    <section>
      <div className="text-sm font-semibold">الإثبات <span className="font-normal text-muted-foreground text-xs">(صورة إيصال أو تحويل — اختياري)</span></div>
      <input ref={ref} type="file" accept="image/*,application/pdf" multiple className="hidden" data-testid={testId}
        onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => ref.current?.click()}><Paperclip className="w-4 h-4" /> اختار ملف</Button>
        {files.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs max-w-[220px]">
            <span className="truncate">{f.name}</span>
            <button type="button" aria-label={`شيل ${f.name}`} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" /></button>
          </span>
        ))}
        {!!oldCount && <span className="text-[11px] text-muted-foreground">+ {oldCount} مرفق قديم بيتنقل مع التعديل</span>}
      </div>
    </section>
  );
}

/** the chips under a form's title: his capital, % and net profit now */
export function PartnerChips({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2 mt-3 text-xs">
      {items.map((c) => <span key={c.label} className="rounded-full border bg-background px-2.5 py-1">{c.label}: <b className="tabular-nums">{c.value}</b></span>)}
    </div>
  );
}
