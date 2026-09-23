import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

export interface DayRange { from: string; to: string } // YYYY-MM-DD local

export const toDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDay = (s: string) => new Date(s + "T00:00:00");
const show = (s: string) => s.replace(/-/g, "/");

type PresetKey = "today" | "week" | "month" | "prevMonth" | "quarter" | "custom";

export function presetRange(k: Exclude<PresetKey, "custom">): DayRange {
  const now = new Date();
  const today = toDay(now);
  if (k === "today") return { from: today, to: today };
  if (k === "week") {
    // الأسبوع يبدأ السبت
    const d = new Date(now);
    d.setDate(d.getDate() - ((d.getDay() + 1) % 7));
    return { from: toDay(d), to: today };
  }
  if (k === "month") return { from: toDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  if (k === "prevMonth")
    return {
      from: toDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: toDay(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  const qStart = Math.floor(now.getMonth() / 3) * 3;
  return { from: toDay(new Date(now.getFullYear(), qStart, 1)), to: today };
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "week", label: "هذا الأسبوع" },
  { key: "month", label: "هذا الشهر" },
  { key: "prevMonth", label: "الشهر السابق" },
  { key: "quarter", label: "الربع الحالي" },
  { key: "custom", label: "فترة مخصصة" },
];

export function ProfitDateRangePicker({ value, onChange }: { value: DayRange; onChange: (r: DayRange) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<PresetKey>("month");
  const [draft, setDraft] = useState<{ from?: Date; to?: Date }>({ from: parseDay(value.from), to: parseDay(value.to) });

  const pick = (k: PresetKey) => {
    setActive(k);
    if (k === "custom") return;
    const r = presetRange(k);
    setDraft({ from: parseDay(r.from), to: parseDay(r.to) });
    onChange(r);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-card transition-colors"
        >
          <CalendarIcon className="w-3.5 h-3.5 text-success" />
          <span dir="rtl" className="tabular-nums">
            من: {show(value.from)} &nbsp; إلى: {show(value.to)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start" dir="rtl">
        <div className="flex flex-wrap gap-1.5 mb-3 max-w-[320px]">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pick(p.key)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md border transition-colors",
                active === p.key ? "bg-success/15 border-success/40 text-success font-bold" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {active === "custom" && (
          <div className="space-y-2">
            <Calendar
              mode="range"
              selected={draft as any}
              onSelect={(r: any) => setDraft(r ?? {})}
              numberOfMonths={1}
              className="p-0 pointer-events-auto"
            />
            <button
              type="button"
              disabled={!draft.from}
              onClick={() => {
                const f = draft.from!;
                const t = draft.to ?? f;
                onChange({ from: toDay(f), to: toDay(t) });
                setOpen(false);
              }}
              className="w-full py-1.5 text-xs font-bold rounded-md bg-success text-success-foreground disabled:opacity-50"
            >
              تطبيق
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
