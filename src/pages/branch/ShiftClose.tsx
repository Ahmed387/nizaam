import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Loader2, DoorClosed, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getOpenShift, closeShift, shiftCashSales, shiftPaymentBreakdown, fetchShiftHandovers, CashierShift, ShiftPaymentLine, ShiftHandover } from "@/lib/shifts";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";
import { formatEGP } from "@/lib/format";

export default function ShiftClose() {
  const { id: branchId = "" } = useParams();
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shift, setShift] = useState<CashierShift | null>(null);
  const [cashSales, setCashSales] = useState<number>(0);
  const [breakdown, setBreakdown] = useState<ShiftPaymentLine[]>([]);
  const [handovers, setHandovers] = useState<ShiftHandover[]>([]);
  const [closingCash, setClosingCash] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [autoCheckout, setAutoCheckout] = useState(true);


  useEffect(() => {
    if (!branchId) return;
    (async () => {
      try {
        const s = await getOpenShift(branchId);
        if (!s) {
          toast.error("مفيش وردية مفتوحة لك في هذا الفرع");
          nav(`/branch/${branchId}/shifts/open`, { replace: true });
          return;
        }
        setShift(s);
        const [sales, lines, hos] = await Promise.all([
          shiftCashSales(s.id),
          shiftPaymentBreakdown(s.id),
          fetchShiftHandovers(s.id).catch(() => []),
        ]);
        setCashSales(sales);
        setBreakdown(lines);
        setHandovers(hos);
        setClosingCash(Number(s.opening_cash) + sales);
      } catch (e: any) {
        toast.error(e.message ?? "خطأ");
      } finally {
        setLoading(false);
      }
    })();
  }, [branchId, nav]);

  const expected = shift ? Number(shift.opening_cash) + cashSales : 0;
  const variance = Number(closingCash) - expected;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shift) return;
    setBusy(true);
    try {
      const closed = await closeShift(shift.id, Number(closingCash) || 0, notes || undefined, autoCheckout);
      const v = Number(closed.variance ?? 0);
      if (Math.abs(v) < 0.01) toast.success("تم قفل الوردية — الدرج مطابق");
      else if (v > 0) toast.success(`تم قفل الوردية — زيادة ${formatEGP(v)}`);
      else toast.error(`تم قفل الوردية — عجز ${formatEGP(Math.abs(v))}`);
      nav(`/branch/${branchId}/dashboard`, { replace: true });
    } catch (e: any) {
      toast.error(e.message ?? "فشل قفل الوردية");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <BranchLayout><div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></BranchLayout>;
  }
  if (!shift) return null;

  return (
    <BranchLayout>
      <PageHeader title="قفل الوردية" subtitle="عدّ الكاش الفعلي في الدرج قبل القفل" />
      <Card className="p-6 max-w-2xl mx-auto space-y-5">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><div className="text-muted-foreground">فُتحت في</div><div className="font-semibold">{new Date(shift.opened_at).toLocaleString("ar-EG")}</div></div>
          <div><div className="text-muted-foreground">الرصيد الافتتاحي</div><div className="font-semibold">{formatEGP(shift.opening_cash)}</div></div>
          <div><div className="text-muted-foreground">مبيعات كاش خلال الوردية</div><div className="font-semibold">{formatEGP(cashSales)}</div></div>
          <div><div className="text-muted-foreground">المتوقع في الدرج</div><div className="font-bold text-primary text-lg">{formatEGP(expected)}</div></div>
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="font-bold text-sm mb-2">تحصيل الوردية حسب وسيلة الدفع</div>
          {breakdown.length === 0 ? (
            <div className="text-xs text-muted-foreground">مفيش تحصيلات في الوردية دي لحد دلوقتي</div>
          ) : (
            <div className="space-y-1.5">
              {breakdown.map((b) => (
                <div key={b.payment_method} className="flex items-center justify-between text-sm">
                  <span>
                    {(PAYMENT_METHOD_LABELS as Record<string, string>)[b.payment_method] ?? b.payment_method}
                    <span className="text-muted-foreground text-xs"> ({b.payments_count} عملية)</span>
                  </span>
                  <span className="font-semibold">{formatEGP(b.total)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm border-t pt-1.5 font-bold">
                <span>الإجمالي</span>
                <span>{formatEGP(breakdown.reduce((s, b) => s + b.total, 0))}</span>
              </div>
              <div className="text-[11px] text-muted-foreground pt-1">
                الكاش بس هو اللي بيتحسب في الدرج — باقي الوسائل بتروح للمحفظة بتاعتها.
              </div>
            </div>
          )}
        </div>

        {handovers.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
            <div className="font-bold text-sm mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              تسليم عهدة طارئ أثناء الوردية
            </div>
            <div className="space-y-1.5">
              {handovers.map((h) => (
                <div key={h.id} className="text-xs flex flex-wrap items-center justify-between gap-2 border-b border-border/50 last:border-0 pb-1.5 last:pb-0">
                  <span>
                    الكاشير <span className="font-semibold">{h.cashier_name ?? "—"}</span> سلّم لمدير الفرع{" "}
                    <span className="font-semibold">{h.manager_name ?? "—"}</span> في {new Date(h.occurred_at).toLocaleString("ar-EG")}
                    {h.notes ? ` — ${h.notes}` : ""}
                  </span>
                  <span className="font-bold">{formatEGP(h.amount)}</span>
                </div>
              ))}
              <div className="text-[11px] text-muted-foreground pt-1">
                التسليم ده إقرار عهدة داخلي — مش مبيعات ولا مصروف، ومش بيغيّر المتوقع في الدرج.
              </div>
            </div>
          </div>
        )}


        <form onSubmit={submit} className="space-y-4 pt-2 border-t">
          <div>
            <Label>الرصيد الفعلي في الدرج (جنيه)</Label>
            <Input
              type="number" min={0} step="0.01" required
              value={closingCash}
              onChange={(e) => setClosingCash(Number(e.target.value))}
              className="mt-1.5 text-lg"
              autoFocus
            />
          </div>

          <div className={`p-3 rounded-lg border font-semibold flex items-center gap-2 ${
            Math.abs(variance) < 0.01 ? "bg-success/10 border-success text-success"
              : variance > 0 ? "bg-warning/10 border-warning text-warning-foreground"
              : "bg-destructive/10 border-destructive text-destructive"
          }`}>
            {Math.abs(variance) < 0.01
              ? <><CheckCircle2 className="w-5 h-5" />مطابق تماماً</>
              : variance > 0
              ? <><AlertTriangle className="w-5 h-5" />زيادة: {formatEGP(variance)}</>
              : <><AlertTriangle className="w-5 h-5" />عجز: {formatEGP(Math.abs(variance))}</>}
          </div>

          <div>
            <Label>ملاحظات (اختياري)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" placeholder="سبب العجز/الزيادة إن وُجد" />
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer rounded-lg border border-border p-3">
            <input type="checkbox" className="mt-1" checked={autoCheckout} onChange={(e) => setAutoCheckout(e.target.checked)} />
            <span>
              <span className="font-semibold">سجّل انصرافي تلقائي بتوقيت قفل الوردية</span>
              <span className="block text-xs text-muted-foreground">لو سجلت انصرافك يدوي النهارده، مش هيتغير.</span>
            </span>
          </label>

          <Button type="submit" disabled={busy} className="w-full h-11">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><DoorClosed className="w-4 h-4 me-2" />قفل الوردية</>)}
          </Button>
        </form>
      </Card>
    </BranchLayout>
  );
}
