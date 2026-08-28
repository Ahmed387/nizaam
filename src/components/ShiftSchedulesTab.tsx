import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Clock } from "lucide-react";
import { ShiftSchedule } from "@/lib/shifts";

interface Draft {
  branch_id: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  is_extra: boolean;
  shift_date: string;
}

const emptyDraft = (branchId: string): Draft => ({
  branch_id: branchId,
  shift_name: "",
  start_time: "10:00",
  end_time: "16:00",
  is_extra: false,
  shift_date: "",
});

export function ShiftSchedulesTab() {
  const { branches } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ShiftSchedule[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft(""));

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("shift_schedules" as any)
      .select("id,branch_id,shift_name,start_time,end_time,is_extra,shift_date,is_active")
      .order("branch_id")
      .order("start_time");
    if (error) toast.error(error.message);
    setRows(((data ?? []) as any[]).map((r) => ({ ...r, start_time: String(r.start_time).slice(0, 5), end_time: String(r.end_time).slice(0, 5) })) as ShiftSchedule[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!draft.branch_id && branches.length) setDraft((d) => ({ ...d, branch_id: branches[0].id }));
  }, [branches.length]);

  const add = async () => {
    if (!draft.branch_id) return toast.error("اختار الفرع");
    if (!draft.shift_name.trim()) return toast.error("اكتب اسم الوردية");
    if (draft.is_extra && !draft.shift_date) return toast.error("حدد تاريخ الوردية الاستثنائية");
    setSaving(true);
    const { error } = await supabase.from("shift_schedules" as any).insert({
      branch_id: draft.branch_id,
      shift_name: draft.shift_name.trim(),
      start_time: draft.start_time,
      end_time: draft.end_time,
      is_extra: draft.is_extra,
      shift_date: draft.is_extra ? draft.shift_date : null,
    } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تمت إضافة الوردية");
    setDraft(emptyDraft(draft.branch_id));
    load();
  };

  const toggleActive = async (r: ShiftSchedule, val: boolean) => {
    const { error } = await supabase.from("shift_schedules" as any).update({ is_active: val } as any).eq("id", r.id);
    if (error) return toast.error(error.message);
    setRows((p) => p.map((x) => (x.id === r.id ? { ...x, is_active: val } : x)));
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("shift_schedules" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    setRows((p) => p.filter((x) => x.id !== id));
  };

  if (loading) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-primary" />إضافة وردية للفرع</div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs">الفرع</Label>
            <select
              className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={draft.branch_id}
              onChange={(e) => setDraft({ ...draft, branch_id: e.target.value })}
            >
              {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">اسم الوردية</Label>
            <Input className="mt-1.5" placeholder="صباحية" value={draft.shift_name} onChange={(e) => setDraft({ ...draft, shift_name: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">من</Label>
            <Input type="time" dir="ltr" className="mt-1.5" value={draft.start_time} onChange={(e) => setDraft({ ...draft, start_time: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">إلى</Label>
            <Input type="time" dir="ltr" className="mt-1.5" value={draft.end_time} onChange={(e) => setDraft({ ...draft, end_time: e.target.value })} />
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={draft.is_extra} onCheckedChange={(v) => setDraft({ ...draft, is_extra: v })} />
              وردية استثنائية
            </label>
            {draft.is_extra && (
              <Input type="date" dir="ltr" value={draft.shift_date} onChange={(e) => setDraft({ ...draft, shift_date: e.target.value })} />
            )}
          </div>
        </div>
        <Button onClick={add} disabled={saving} className="h-10">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Plus className="w-4 h-4 me-2" />إضافة الوردية</>)}
        </Button>
        <div className="text-[11px] text-muted-foreground">
          الوردية اللي بتعدي منتصف الليل (مثلاً 16:15 إلى 00:00) مدعومة تلقائيًا. البيع بيتوقف قبل نهاية الوردية بـ 10 دقائق.
        </div>
      </Card>

      {branches.map((b: any) => {
        const list = rows.filter((r) => r.branch_id === b.id);
        return (
          <Card key={b.id} className="p-4">
            <div className="font-bold text-sm mb-3">{b.name}</div>
            {list.length === 0 ? (
              <div className="text-xs text-muted-foreground">مفيش ورديات محددة للفرع ده — القفل التلقائي هيشتغل بالساعات الافتراضية.</div>
            ) : (
              <div className="space-y-2">
                {list.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 bg-muted/30">
                    <div className="text-sm">
                      <span className="font-semibold">{r.shift_name}</span>
                      <span className="text-muted-foreground"> — من {r.start_time} إلى {r.end_time}</span>
                      {r.is_extra && <span className="ms-2 text-[11px] px-1.5 py-0.5 rounded-full bg-warning/20 text-warning-foreground">استثنائية {r.shift_date}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <Switch checked={r.is_active} onCheckedChange={(v) => toggleActive(r, v)} />
                        مفعّلة
                      </label>
                      <Button variant="ghost" size="sm" className="text-destructive h-8" onClick={() => remove(r.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default ShiftSchedulesTab;
