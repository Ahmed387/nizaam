import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { isWorkDay } from "@/components/ShiftEditor";
import { cairoTodayDay } from "@/lib/cairoDate";
import { KINDS, WEEKDAYS, daysIn, kindOf, type DayKind } from "./AttendanceBoard";

const pad = (n: number) => String(n).padStart(2, "0");

/** One employee's month: a calendar with each day's recorded status, and the month's counts. */
export function EmployeeAttendanceTab({ employee }: { employee: any }) {
  const today = cairoTodayDay();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let off = false;
    setLoading(true);
    supabase.from("attendance").select("id,date,status,hours,check_in,check_out,notes")
      .eq("employee_id", employee.id).gte("date", `${ym}-01`).lte("date", `${ym}-${pad(daysIn(ym))}`).order("date")
      .then(({ data }) => { if (!off) { setRows(data ?? []); setLoading(false); } });
    return () => { off = true; };
  }, [employee.id, ym]);

  const byDate = new Map(rows.map((r) => [r.date, r]));
  const counts: Record<DayKind | "unrecorded", number> = { present: 0, absent: 0, leave: 0, half_day: 0, hourly: 0, unrecorded: 0 };
  const cells: (string | null)[] = [...Array(new Date(`${ym}-01T00:00:00`).getDay()).fill(null),
    ...Array.from({ length: daysIn(ym) }, (_, i) => `${ym}-${pad(i + 1)}`)];
  for (const d of cells) {
    if (!d || d > today) continue;
    const k = kindOf(byDate.get(d)?.status);
    if (k) counts[k]++; else if (isWorkDay(d, employee.work_days)) counts.unrecorded++;
  }
  const move = (delta: number) => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };

  return (
    <div className="card-elevated p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => move(-1)} aria-label="الشهر السابق"><ChevronRight className="w-5 h-5" /></Button>
        <div className="font-extrabold text-lg">{new Date(`${ym}-01T00:00:00`).toLocaleDateString("ar-EG", { month: "long", year: "numeric" })}</div>
        <Button variant="ghost" size="icon" onClick={() => move(1)} aria-label="الشهر التالي"><ChevronLeft className="w-5 h-5" /></Button>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {KINDS.map((k) => <span key={k.key} className={`rounded-md px-2 py-1 font-bold ${k.cls}`}>{k.label}: {counts[k.key]}</span>)}
        <span className="rounded-md px-2 py-1 bg-muted">من غير تسجيل (يوم عادي): {counts.unrecorded}</span>
        {loading && <span className="text-muted-foreground">...</span>}
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {WEEKDAYS.map((w) => <div key={w} className="text-[11px] font-bold text-muted-foreground py-1">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const r = byDate.get(d);
          const k = KINDS.find((x) => x.key === kindOf(r?.status));
          const off = !isWorkDay(d, employee.work_days);
          return (
            <div key={d} title={r?.notes ?? ""}
              className={`min-h-[60px] rounded-lg border p-1.5 text-right flex flex-col justify-between ${d > today ? "opacity-40" : ""} ${d === today ? "border-primary" : "border-border"} ${off && !k ? "bg-muted/40" : ""}`}>
              <span className="text-sm tabular-nums">{Number(d.slice(8))}</span>
              {k ? <span className={`text-[11px] rounded px-1 py-0.5 font-bold ${k.cls}`}>{k.label}{k.key === "hourly" && r?.hours ? ` ${r.hours}س` : ""}</span>
                : off ? <span className="text-[10px] text-muted-foreground">راحة</span> : null}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">التسجيل والتعديل من صفحة الحضور في الفرع (تقدر تختار أكتر من موظف وأكتر من يوم مرة واحدة).</p>
    </div>
  );
}
