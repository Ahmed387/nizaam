import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlarmClock, BellRing, X, DoorClosed, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { BranchSchedule, fetchSchedules, hoursOpen, minutesToClose } from "@/lib/branchSchedule";

interface OpenShift {
  id: string;
  branch_id: string;
  cashier_id: string;
  opened_at: string;
}

type Level = "warn" | "danger";
interface Alert {
  id: string;
  level: Level;
  title: string;
  body: string;
  branchId: string;
  mine: boolean;
}

const SNOOZE_MS = 15 * 60 * 1000;

export function ShiftAlertBar() {
  const { user, isAdmin, isOwner } = useAuth();
  const nav = useNavigate();
  const [shifts, setShifts] = useState<OpenShift[]>([]);
  const [schedules, setSchedules] = useState<Record<string, BranchSchedule>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => new Date());
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  const load = async () => {
    if (!user) return;
    const [{ data: sh }, sc, { data: br }] = await Promise.all([
      supabase.from("cashier_shifts").select("id,branch_id,cashier_id,opened_at").eq("status", "open"),
      fetchSchedules(),
      supabase.from("branches").select("id,name"),
    ]);
    setShifts((sh ?? []) as any);
    setSchedules(sc);
    const map: Record<string, string> = {};
    for (const b of (br ?? []) as any[]) map[b.id] = b.name;
    setNames(map);
  };

  useEffect(() => {
    if (!user) { setShifts([]); return; }
    load();
    const t = setInterval(() => setNow(new Date()), 30_000);
    const poll = setInterval(load, 5 * 60_000);
    const ch = supabase
      .channel(`shift-alerts-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cashier_shifts" }, load)
      .subscribe();
    return () => {
      clearInterval(t);
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  const alerts = useMemo<Alert[]>(() => {
    const out: Alert[] = [];
    for (const s of shifts) {
      const sc = schedules[s.branch_id];
      const mine = s.cashier_id === user?.id;
      if (!mine && !isAdmin && !isOwner) continue;
      const who = mine ? "ورديتك" : `وردية الكاشير`;
      const branch = names[s.branch_id] ? ` — فرع ${names[s.branch_id]}` : "";
      const hrs = hoursOpen(s.opened_at, now);
      const autoAt = sc?.auto_close_hours ?? 16;
      const remindAt = sc?.reminder_hours ?? 12;
      const warnMins = sc?.pre_close_warn_minutes ?? 30;
      const mins = minutesToClose(sc?.close_time, now);

      if (hrs >= autoAt - 1) {
        out.push({
          id: s.id, level: "danger", branchId: s.branch_id, mine,
          title: `${who} هتتقفل تلقائيًا قريبًا${branch}`,
          body: `مفتوحة من ${Math.floor(hrs)} ساعة — القفل التلقائي بعد ${Math.max(0, Math.ceil(autoAt - hrs))} ساعة.`,
        });
      } else if (mins !== null && mins <= 0 && mins > -(sc?.close_grace_minutes ?? 60) - 240) {
        out.push({
          id: s.id, level: "danger", branchId: s.branch_id, mine,
          title: `عدّى ميعاد قفل الفرع${branch}`,
          body: `الفرع بيقفل ${sc?.close_time?.slice(0, 5)} — ${who} لسه مفتوحة من ${Math.floor(hrs)} ساعة.`,
        });
      } else if (mins !== null && mins <= warnMins) {
        out.push({
          id: s.id, level: "warn", branchId: s.branch_id, mine,
          title: `قرب ميعاد قفل الفرع${branch}`,
          body: `فاضل ${mins} دقيقة على القفل (${sc?.close_time?.slice(0, 5)}) — جهّز قفل الوردية.`,
        });
      } else if (hrs >= remindAt) {
        out.push({
          id: s.id, level: "warn", branchId: s.branch_id, mine,
          title: `وردية مفتوحة من فترة طويلة${branch}`,
          body: `${who} مفتوحة من ${Math.floor(hrs)} ساعة.`,
        });
      }
    }
    return out;
  }, [shifts, schedules, names, now, user?.id, isAdmin, isOwner]);

  if (!user || alerts.length === 0 || Date.now() < snoozedUntil) return null;

  const danger = alerts.some((a) => a.level === "danger");
  const main = alerts.find((a) => a.level === "danger") ?? alerts[0];

  return (
    <div className="fixed bottom-4 inset-x-0 z-[60] flex justify-center px-3 pointer-events-none animate-[shift-slide-up_.35s_ease-out]">
      <div
        className={`pointer-events-auto w-full max-w-2xl rounded-2xl border shadow-2xl backdrop-blur-md overflow-hidden ${
          danger
            ? "border-destructive/50 bg-destructive/10 shadow-[0_0_40px_-8px_hsl(var(--destructive)/0.6)]"
            : "border-warning/50 bg-warning/10 shadow-[0_0_40px_-10px_hsl(var(--warning)/0.55)]"
        }`}
      >
        <div className="flex items-start gap-3 p-3">
          <div className="relative shrink-0 mt-0.5">
            <span
              className={`absolute inset-0 rounded-full ${danger ? "bg-destructive/40" : "bg-warning/40"} animate-[shift-ring_1.6s_ease-out_infinite]`}
            />
            <div
              className={`relative w-10 h-10 rounded-full flex items-center justify-center ${
                danger ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground"
              }`}
            >
              {danger ? (
                <AlarmClock className="w-5 h-5 animate-[shift-shake_.9s_ease-in-out_infinite]" />
              ) : (
                <BellRing className="w-5 h-5 animate-[shift-shake_1.4s_ease-in-out_infinite]" />
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className={`font-extrabold text-sm ${danger ? "text-destructive" : "text-warning"}`}>
              {main.title}
              {alerts.length > 1 && (
                <span className="ms-2 text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground">
                  +{alerts.length - 1}
                </span>
              )}
            </div>
            <div className="text-xs text-foreground/80 mt-0.5">{main.body}</div>

            {!collapsed && alerts.length > 1 && (
              <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                {alerts.slice(1).map((a) => (
                  <div key={a.id} className="text-[11px] text-foreground/75">
                    • <span className="font-semibold">{a.title}</span> — {a.body}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-2">
              <Button
                size="sm"
                variant={danger ? "destructive" : "default"}
                className="h-8 text-xs"
                onClick={() =>
                  main.mine ? nav(`/branch/${main.branchId}/shifts/close`) : nav("/admin/shifts")
                }
              >
                <DoorClosed className="w-3.5 h-3.5 me-1" />
                {main.mine ? "قفل الوردية" : "عرض الورديات"}
              </Button>
              {alerts.length > 1 && (
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setCollapsed((c) => !c)}>
                  {collapsed ? <ChevronDown className="w-3.5 h-3.5 me-1" /> : <ChevronUp className="w-3.5 h-3.5 me-1" />}
                  {collapsed ? "عرض الكل" : "إخفاء التفاصيل"}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}>
                تأجيل 15 دقيقة
              </Button>
            </div>
          </div>

          <button
            onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground shrink-0"
            aria-label="إغلاق التنبيه"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShiftAlertBar;
