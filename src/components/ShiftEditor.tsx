import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export type ShiftValue = {
  work_start: string | null;
  work_end: string | null;
  work_days: number[];
  late_grace_minutes: number;
};

export const emptyShift = (): ShiftValue => ({
  work_start: null,
  work_end: null,
  work_days: [0, 1, 2, 3, 4, 5],
  late_grace_minutes: 15,
});

const DAYS = [
  { v: 6, label: "السبت" },
  { v: 0, label: "الأحد" },
  { v: 1, label: "الإثنين" },
  { v: 2, label: "الثلاثاء" },
  { v: 3, label: "الأربعاء" },
  { v: 4, label: "الخميس" },
  { v: 5, label: "الجمعة" },
];

export function ShiftEditor({ value, onChange }: { value: ShiftValue; onChange: (v: ShiftValue) => void }) {
  const toggleDay = (d: number) => {
    const set = new Set(value.work_days || []);
    if (set.has(d)) set.delete(d); else set.add(d);
    onChange({ ...value, work_days: Array.from(set).sort() });
  };
  return (
    <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
      <div className="text-sm font-semibold">مواعيد العمل (الشيفت)</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">بداية الدوام</Label>
          <Input type="time" dir="ltr" className="mt-1.5"
            value={value.work_start ?? ""}
            onChange={(e) => onChange({ ...value, work_start: e.target.value || null })} />
        </div>
        <div>
          <Label className="text-xs">نهاية الدوام</Label>
          <Input type="time" dir="ltr" className="mt-1.5"
            value={value.work_end ?? ""}
            onChange={(e) => onChange({ ...value, work_end: e.target.value || null })} />
        </div>
      </div>
      <div>
        <Label className="text-xs">سماحية التأخير (دقائق)</Label>
        <Input type="number" min={0} className="mt-1.5"
          value={value.late_grace_minutes}
          onChange={(e) => onChange({ ...value, late_grace_minutes: Number(e.target.value) || 0 })} />
      </div>
      <div>
        <Label className="text-xs mb-1.5 block">أيام العمل</Label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <label key={d.v} className="flex items-center gap-1.5 text-xs cursor-pointer px-2 py-1 rounded border bg-background">
              <Checkbox checked={value.work_days?.includes(d.v)} onCheckedChange={() => toggleDay(d.v)} />
              {d.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Returns "present" | "late" based on shift; null if no shift defined. */
export function computeLate(checkInIso: string, shift: Partial<ShiftValue> | null | undefined): "present" | "late" | null {
  if (!shift?.work_start) return null;
  const ci = new Date(checkInIso);
  const [h, m] = shift.work_start.split(":").map(Number);
  const start = new Date(ci);
  start.setHours(h, m, 0, 0);
  const grace = (shift.late_grace_minutes ?? 0) * 60_000;
  return ci.getTime() > start.getTime() + grace ? "late" : "present";
}

/** Is `date` (YYYY-MM-DD) a working day for this shift? */
export function isWorkDay(dateStr: string, workDays: number[] | null | undefined): boolean {
  if (!workDays || workDays.length === 0) return true;
  const d = new Date(dateStr + "T00:00:00").getDay();
  return workDays.includes(d);
}
