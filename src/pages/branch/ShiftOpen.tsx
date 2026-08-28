import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, DoorOpen, ShoppingCart, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { getOpenShift, openShiftSecure, isMissingAttendanceError, fetchExpectedOpeningCash, fetchCurrentSchedule, ShiftSchedule } from "@/lib/shifts";
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
  const [expectedCash, setExpectedCash] = useState<number>(0);
  const [shiftSchedule, setShiftSchedule] = useState<ShiftSchedule | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [countedCash, setCountedCash] = useState<number>(0);

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      try {
        const [s, scheds, closures, exp, cur] = await Promise.all([
          getOpenShift(branchId),
          fetchSchedules(),
          fetchClosures(branchId),
          fetchExpectedOpeningCash(branchId).catch(() => 0),
          fetchCurrentSchedule(branchId).catch(() => null),
        ]);
        setExisting(s);
        const sch = scheds[branchId];
        setSchedule(sch);
        setOffReason(offDayReason(sch, closures));
        setExpectedCash(exp);
        setOpeningCash(exp);
        setCountedCash(exp);
        setShiftSchedule(cur);
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
      const row = await openShiftSecure(branchId, Number(countedCash) || 0, notes || undefined, autoAttendance);
      setHandoverOpen(false);
      if (row.opening_status === "accepted") {
        toast.success(autoAttendance ? "تم تسجيل حضورك وفتح الوردية" : "تم استلام العهدة وفتح الوردية");
        nav(returnTo || `/branch/${branchId}/sales/new`, { replace: true });
      } else {
        toast.error("تم إبلاغ الإدارة بفرق العهدة — البيع متوقف لحد الاعتماد");
        nav(`/branch/${branchId}/dashboard`, { replace: true });
      }
    } catch (e: any) {
      if (isMissingAttendanceError(e)) {
        setNeedsAttendance(true);
        setHandoverOpen(false);
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
    setCountedCash(Number(openingCash) || 0);
    setHandoverOpen(true);
  };



  if (loading) {
    return <BranchLayout><div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></BranchLayout>;
  }

  if (existing) {
    const pending = existing.opening_status && existing.opening_status !== "accepted";
    return (
      <BranchLayout>
        <PageHeader title="وردية الكاشير" subtitle={pending ? "وردية بانتظار اعتماد الإدارة" : "لديك وردية مفتوحة بالفعل"} />
        <Card className="p-6 max-w-xl mx-auto space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-muted-foreground">تاريخ الفتح</div><div className="font-semibold">{new Date(existing.opened_at).toLocaleString("ar-EG")}</div></div>
            <div><div className="text-muted-foreground">الرصيد الافتتاحي</div><div className="font-semibold">{formatEGP(existing.opening_cash)}</div></div>
          </div>
          {pending && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-bold text-destructive">تم إبلاغ الإدارة — بانتظار الاعتماد</div>
                <div className="text-muted-foreground">
                  المتوقع {formatEGP(existing.expected_opening_cash ?? 0)} والمعدود {formatEGP(existing.reported_opening_cash ?? existing.opening_cash)} — البيع متوقف لحد ما الأونر أو مدير الفرع يعتمد الفرق.
                </div>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={pending} onClick={() => nav(`/branch/${branchId}/sales/new`)}>
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

          <div className="rounded-lg border border-border p-3 text-sm space-y-1 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">الرصيد المتوقع (ختامي آخر وردية)</span>
              <span className="font-bold text-primary">{formatEGP(expectedCash)}</span>
            </div>
            {shiftSchedule && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">الوردية المجدولة</span>
                <span className="font-semibold">{shiftSchedule.shift_name} ({String(shiftSchedule.start_time).slice(0,5)} — {String(shiftSchedule.end_time).slice(0,5)})</span>
              </div>
            )}
          </div>

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
          {needsAttendance && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-bold text-destructive">لازم تسجل حضورك الأول قبل ما تفتح الوردية</div>
                  <div className="text-muted-foreground">تقدر تسجل حضورك وتفتح الوردية في خطوة واحدة من الزرار ده.</div>
                </div>
              </div>
              <Button type="button" variant="secondary" className="w-full h-11" disabled={busy || blocked}
                onClick={() => doOpen(true)}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "سجل حضوري وافتح الوردية دلوقتي"}
              </Button>
            </div>
          )}
          <Button type="submit" disabled={busy || blocked} className="w-full h-11">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><DoorOpen className="w-4 h-4 me-2" />فتح الوردية</>)}
          </Button>
        </form>
      </Card>
    </BranchLayout>
  );
}
