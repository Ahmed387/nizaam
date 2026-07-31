import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, CalendarOff, Plus, Trash2, Clock } from "lucide-react";
import { BranchSchedule, BranchClosure, WEEK_DAYS, defaultSchedule, fetchClosures, fetchSchedules } from "@/lib/branchSchedule";

export function BranchSchedulesTab() {
  const { branches, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [map, setMap] = useState<Record<string, BranchSchedule>>({});
  const [closures, setClosures] = useState<BranchClosure[]>([]);
  const [newC, setNewC] = useState<{ branch_id: string; start_date: string; end_date: string; reason: string }>({
    branch_id: "", start_date: "", end_date: "", reason: "",
  });

  const load = async () => {
    const [sc, cl] = await Promise.all([fetchSchedules(), fetchClosures()]);
    const merged: Record<string, BranchSchedule> = {};
    for (const b of branches) merged[b.id] = sc[b.id] ?? defaultSchedule(b.id);
    setMap(merged);
    setClosures(cl);
    setLoading(false);
  };

  useEffect(() => { load(); }, [branches.length]);

  const set = (bid: string, patch: Partial<BranchSchedule>) =>
    setMap((m) => ({ ...m, [bid]: { ...m[bid], ...patch } }));

  const save = async (bid: string) => {
    setSaving(bid);
    try {
      const s = map[bid];
      const { error } = await supabase.from("branch_schedules" as any).upsert(
        {
          tenant_id: (profile as any)?.tenant_id,
          branch_id: bid,
          open_time: s.open_time || null,
          close_time: s.close_time || null,
          close_grace_minutes: Number(s.close_grace_minutes) || 0,
          weekly_off: s.weekly_off ?? [],
          reminder_hours: Number(s.reminder_hours) || 12,
          auto_close_hours: Number(s.auto_close_hours) || 16,
          pre_close_warn_minutes: Number(s.pre_close_warn_minutes) || 30,
          block_open_on_off_day: !!s.block_open_on_off_day,
        } as any,
        { onConflict: "branch_id" } as any
      );
      if (error) throw error;
      toast.success("تم حفظ مواعيد الفرع");
      load();
    } catch (e: any) {
      toast.error(e.message ?? "فشل الحفظ");
    } finally {
      setSaving(null);
    }
  };

  const addClosure = async () => {
    if (!newC.branch_id || !newC.start_date || !newC.end_date) {
      toast.error("اختر الفرع وحدد التواريخ");
      return;
    }
    const { error } = await supabase.from("branch_closures" as any).insert({
      tenant_id: (profile as any)?.tenant_id,
      branch_id: newC.branch_id,
      start_date: newC.start_date,
      end_date: newC.end_date,
      reason: newC.reason || null,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("تمت إضافة الإغلاق");
    setNewC({ branch_id: "", start_date: "", end_date: "", reason: "" });
    load();
  };

  const delClosure = async (id: string) => {
    const { error } = await supabase.from("branch_closures" as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setClosures((c) => c.filter((x) => x.id !== id));
  };

  const toggleDay = (bid: string, d: number) => {
    const cur = new Set(map[bid]?.weekly_off ?? []);
    cur.has(d) ? cur.delete(d) : cur.add(d);
    set(bid, { weekly_off: Array.from(cur).sort() });
  };

  if (loading) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {branches.map((b) => {
          const s = map[b.id] ?? defaultSchedule(b.id);
          return (
            <Card key={b.id} className="p-4 space-y-4">
              <div className="flex items-center gap-2 font-bold">
                <Clock className="w-4 h-4 text-primary" /> {b.name}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">وقت الفتح</Label>
                  <Input type="time" dir="ltr" className="mt-1.5" value={s.open_time ?? ""} onChange={(e) => set(b.id, { open_time: e.target.value || null })} />
                </div>
                <div>
                  <Label className="text-xs">وقت القفل</Label>
                  <Input type="time" dir="ltr" className="mt-1.5" value={s.close_time ?? ""} onChange={(e) => set(b.id, { close_time: e.target.value || null })} />
                </div>
                <div>
                  <Label className="text-xs">سماحية بعد القفل (دقيقة)</Label>
                  <Input type="number" min={0} className="mt-1.5" value={s.close_grace_minutes} onChange={(e) => set(b.id, { close_grace_minutes: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">تنبيه قبل القفل (دقيقة)</Label>
                  <Input type="number" min={0} className="mt-1.5" value={s.pre_close_warn_minutes} onChange={(e) => set(b.id, { pre_close_warn_minutes: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">تذكير الوردية المفتوحة (ساعة)</Label>
                  <Input type="number" min={1} className="mt-1.5" value={s.reminder_hours} onChange={(e) => set(b.id, { reminder_hours: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">القفل التلقائي بعد (ساعة)</Label>
                  <Input type="number" min={1} className="mt-1.5" value={s.auto_close_hours} onChange={(e) => set(b.id, { auto_close_hours: Number(e.target.value) })} />
                </div>
              </div>

              <div>
                <Label className="text-xs mb-1.5 block">الإجازة الأسبوعية</Label>
                <div className="flex flex-wrap gap-2">
                  {WEEK_DAYS.map((d) => (
                    <label key={d.v} className="flex items-center gap-1.5 text-xs cursor-pointer px-2 py-1 rounded border bg-background">
                      <Checkbox checked={(s.weekly_off ?? []).includes(d.v)} onCheckedChange={() => toggleDay(b.id, d.v)} />
                      {d.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                <div>
                  <div className="text-sm font-semibold">منع فتح وردية في يوم الإجازة</div>
                  <div className="text-xs text-muted-foreground">لو مقفول: يظهر تنبيه للكاشير فقط ويقدر يكمّل.</div>
                </div>
                <Switch checked={!!s.block_open_on_off_day} onCheckedChange={(v) => set(b.id, { block_open_on_off_day: v })} />
              </div>

              <Button onClick={() => save(b.id)} disabled={saving === b.id}>
                {saving === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 me-2" />حفظ مواعيد الفرع</>}
              </Button>
            </Card>
          );
        })}
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-2 font-bold"><CalendarOff className="w-4 h-4 text-primary" /> إغلاقات استثنائية</div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="md:col-span-1">
            <Label className="text-xs">الفرع</Label>
            <select
              className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={newC.branch_id}
              onChange={(e) => setNewC({ ...newC, branch_id: e.target.value })}
            >
              <option value="">اختر الفرع</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" className="mt-1.5" value={newC.start_date} onChange={(e) => setNewC({ ...newC, start_date: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" className="mt-1.5" value={newC.end_date} onChange={(e) => setNewC({ ...newC, end_date: e.target.value })} />
          </div>
          <div className="md:col-span-1">
            <Label className="text-xs">السبب</Label>
            <Textarea rows={1} className="mt-1.5" value={newC.reason} onChange={(e) => setNewC({ ...newC, reason: e.target.value })} />
          </div>
          <Button onClick={addClosure}><Plus className="w-4 h-4 me-1" />إضافة</Button>
        </div>

        <div className="divide-y">
          {closures.length === 0 && <div className="text-sm text-muted-foreground py-3">لا توجد إغلاقات مسجلة</div>}
          {closures.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-semibold">{branches.find((b) => b.id === c.branch_id)?.name ?? "—"}</span>
                <span className="text-muted-foreground"> — من {c.start_date} إلى {c.end_date}</span>
                {c.reason && <span className="text-muted-foreground"> ({c.reason})</span>}
              </div>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => delClosure(c.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default BranchSchedulesTab;
