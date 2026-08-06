import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Loader2, DoorOpen, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { getOpenShift, openShift, isMissingAttendanceError } from "@/lib/shifts";
import { formatEGP } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import { BranchSchedule, fetchClosures, fetchSchedules, offDayReason } from "@/lib/branchSchedule";
import { AlertTriangle } from "lucide-react";


export default function ShiftOpen() {
  const { id: branchId = "" } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { user } = useAuth();
  const returnTo = (loc.state as any)?.returnTo as string | undefined;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openingCash, setOpeningCash] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [existing, setExisting] = useState<any>(null);
  const [offReason, setOffReason] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<BranchSchedule | undefined>(undefined);
  const [ack, setAck] = useState(false);
  const [needsAttendance, setNeedsAttendance] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      try {
        const [s, scheds, closures] = await Promise.all([
          getOpenShift(branchId),
          fetchSchedules(),
          fetchClosures(branchId),
        ]);
        setExisting(s);
        const sch = scheds[branchId];
        setSchedule(sch);
        setOffReason(offDayReason(sch, closures));
      } catch (e: any) {
        toast.error(e.message ?? "خطأ في قراءة الوردية");
      } finally {
        setLoading(false);
      }
    })();
  }, [branchId, user?.id]);

  const blocked = !!offReason && !!schedule?.block_open_on_off_day && !ack;

  const doOpen = async (autoAttendance: boolean) => {
    setBusy(true);
    try {
      await openShift(branchId, Number(openingCash) || 0, notes || undefined, autoAttendance);
      toast.success(autoAttendance ? "تم تسجيل حضورك وفتح الوردية" : "تم فتح الوردية");
      nav(returnTo || `/branch/${branchId}/sales/new`, { replace: true });
    } catch (e: any) {
      if (isMissingAttendanceError(e)) {
        setNeedsAttendance(true);
        toast.error("لازم تسجل حضورك الأول قبل ما تفتح الوردية");
      } else {
        toast.error(e.message ?? "فشل فتح الوردية");
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked) {
      toast.error("الفرع مقفول اليوم — تحتاج تأكيد المالك لفتح وردية");
      return;
    }
    await doOpen(false);
  };


  if (loading) {
    return <BranchLayout><div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></BranchLayout>;
  }

  if (existing) {
    return (
      <BranchLayout>
        <PageHeader title="وردية الكاشير" subtitle="لديك وردية مفتوحة بالفعل" />
        <Card className="p-6 max-w-xl mx-auto space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-muted-foreground">تاريخ الفتح</div><div className="font-semibold">{new Date(existing.opened_at).toLocaleString("ar-EG")}</div></div>
            <div><div className="text-muted-foreground">الرصيد الافتتاحي</div><div className="font-semibold">{formatEGP(existing.opening_cash)}</div></div>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => nav(`/branch/${branchId}/sales/new`)}>
              <ShoppingCart className="w-4 h-4 me-2" />بدء البيع
            </Button>
            <Button variant="outline" onClick={() => nav(`/branch/${branchId}/shifts/close`)}>قفل الوردية</Button>
          </div>
        </Card>
      </BranchLayout>
    );
  }

  return (
    <BranchLayout>
      <PageHeader title="فتح وردية جديدة" subtitle="أدخل رصيد الدرج الافتتاحي قبل بدء البيع" />
      <Card className="p-6 max-w-xl mx-auto">
        {offReason && (
          <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" style={{ animation: "shift-shake 0.9s ease-in-out infinite" }} />
            <div className="flex-1 text-sm">
              <div className="font-bold">الفرع مقفول اليوم</div>
              <div className="text-muted-foreground">{offReason}</div>
              {schedule?.block_open_on_off_day && (
                <label className="flex items-center gap-2 mt-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  تأكيد المالك بفتح الوردية استثناءً
                </label>
              )}
            </div>
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">

          <div>
            <Label>الرصيد الافتتاحي في الدرج (جنيه)</Label>
            <Input
              type="number" min={0} step="0.01" required
              value={openingCash}
              onChange={(e) => setOpeningCash(Number(e.target.value))}
              className="mt-1.5 text-lg"
              autoFocus
            />
          </div>
          <div>
            <Label>ملاحظات (اختياري)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
          </div>
          <Button type="submit" disabled={busy || blocked} className="w-full h-11">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><DoorOpen className="w-4 h-4 me-2" />فتح الوردية</>)}
          </Button>
        </form>
      </Card>
    </BranchLayout>
  );
}
