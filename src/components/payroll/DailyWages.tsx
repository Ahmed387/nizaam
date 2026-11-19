import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentMethodPicker, emptyPaymentValue, type PaymentMethodValue } from "@/components/PaymentMethodPicker";
import { formatEGP } from "@/lib/format";
import { rpcErrorText } from "@/lib/rpcError";
import { attachPaymentProofs, proofClock } from "@/lib/paymentProofs";
import { DAILY_STATE_LABEL, PAY_TYPE_LABEL, type DailyState, type PayType } from "@/lib/payType";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { toast } from "sonner";

const n = (v: unknown) => Number(v ?? 0) || 0;
const STATUS_AR: Record<string, string> = { present: "حضر", late: "حضر", half_day: "نص يوم", hourly: "بالساعة", absent: "غاب", leave: "إجازة" };
const dayText = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "numeric" });

/** نوع القبض + أجر اليوم (فورم الموظف). */
export function PayTypeFields({ payType, dailyWage, onChange }: {
  payType: PayType; dailyWage: string; onChange: (v: { payType: PayType; dailyWage: string }) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3" data-testid="pay-type-fields">
      <div>
        <Label>نوع القبض</Label>
        <div className="flex gap-1 mt-1.5">
          {(["monthly", "daily"] as PayType[]).map((t) => (
            <button key={t} type="button" onClick={() => onChange({ payType: t, dailyWage })}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-bold ${payType === t ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
              {PAY_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      {payType === "daily" && (
        <div>
          <Label>أجر اليوم</Label>
          <Input type="number" min={0} value={dailyWage} onChange={(e) => onChange({ payType, dailyWage: e.target.value })} className="mt-1.5" placeholder="مثلاً 200" />
        </div>
      )}
    </div>
  );
}

interface PendingRow { employee_id: string; name: string; branch_id: string; day: string; state: DailyState; status: string | null; units: number; amount: number }

/** الأيام المستنية لموظف يومي (أو لكل يوميين الفرع): حضور مش متسجل / مستني الصرف + صرف كل يوم. */
export function DailyPendingList({ branchId, employeeId, canPay, onPaid }: {
  branchId?: string | null; employeeId?: string | null; canPay: boolean; onPaid?: () => void;
}) {
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<PendingRow | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("daily_wage_pending" as any, { p_branch: branchId ?? null, p_employee: employeeId ?? null } as any);
    if (error) { setErr(rpcErrorText(error, "اليوميات المستنية")); setRows([]); return; }
    setErr(null); setRows((data as any[]) ?? []);
  }, [branchId, employeeId]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["attendance", "daily_wages"], load);

  if (rows === null) return <div className="text-sm text-muted-foreground">بيحمّل الأيام المستنية…</div>;
  return (
    <div className="space-y-2" data-testid="daily-pending">
      {err && <div className="text-sm text-destructive">{err}</div>}
      {!err && rows.length === 0 && <div className="text-sm text-muted-foreground">مفيش أيام مستنية — كل الأيام اتسجل حضورها واتصرفت.</div>}
      {rows.map((r) => (
        <div key={`${r.employee_id}-${r.day}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm">
          {!employeeId && <b className="min-w-[120px]">{r.name}</b>}
          <span className="min-w-[120px]">{dayText(r.day)}</span>
          <span className={`rounded px-2 py-0.5 text-xs font-bold ${r.state === "no_attendance" ? "bg-warning/15 text-warning" : "bg-info/15 text-info"}`}>
            {DAILY_STATE_LABEL[r.state]}{r.status ? ` — ${STATUS_AR[r.status] ?? r.status}` : ""}
          </span>
          {r.state === "payable" && <b className="tabular-nums">{formatEGP(n(r.amount))}</b>}
          <span className="flex-1" />
          {r.state === "payable" && canPay && <Button size="sm" onClick={() => setPayFor(r)}>صرف اليومية</Button>}
          {r.state === "no_attendance" && <span className="text-xs text-muted-foreground">سجّل حضوره من صفحة الحضور الأول</span>}
        </div>
      ))}
      {payFor && <PayDailyDialog employeeId={payFor.employee_id} name={payFor.name} day={payFor.day} branchId={payFor.branch_id}
        onClose={() => setPayFor(null)} onDone={() => { setPayFor(null); load(); onPaid?.(); }} />}
    </div>
  );
}

/** صرف يومية يوم واحد: أجر اليوم بالحضور + بونص / جزاء اليوم ده − خصم سلف (اختياري) = الصافي. */
export function PayDailyDialog({ employeeId, name, day, branchId, onClose, onDone }: {
  employeeId: string; name: string; day: string; branchId?: string | null; onClose: () => void; onDone: () => void;
}) {
  const { user, profile } = useAuth();
  const [pv, setPv] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bonus, setBonus] = useState("0");
  const [ded, setDed] = useState("0");
  const [adv, setAdv] = useState("0");
  const [notes, setNotes] = useState("");
  const [pm, setPm] = useState<PaymentMethodValue>(emptyPaymentValue());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    supabase.rpc("daily_wage_preview" as any, { p_employee_id: employeeId, p_day: day } as any)
      .then(({ data, error }) => error ? setErr(rpcErrorText(error, "حساب اليومية")) : setPv(data));
  }, [employeeId, day]);
  const recB = n(pv?.adjustments?.bonus), recP = n(pv?.adjustments?.penalty);
  const gross = Math.round((n(pv?.amount) + recB - recP + n(bonus) - n(ded)) * 100) / 100;
  const net = Math.round((gross - n(adv)) * 100) / 100;

  const submit = async () => {
    if (!pv) return;
    if (gross <= 0) return toast.error("مفيش أجر لليوم ده");
    if (n(adv) > n(pv.advance_remaining) + 0.009) return toast.error("خصم السلف أكبر من رصيد السلف");
    if (n(adv) > gross) return toast.error("خصم السلف أكبر من اليومية");
    const { validateTransferPayment } = await import("@/lib/paymentMethods");
    const pErr = net > 0 ? validateTransferPayment(pm) : null;
    if (pErr) return toast.error(pErr);
    setSaving(true);
    const since = proofClock();
    const { data, error } = await supabase.rpc("pay_daily_wage" as any, {
      p_employee_id: employeeId, p_day: day, p_bonuses: n(bonus), p_deductions: n(ded), p_advance_deduct: n(adv),
      p_payment_method: pm.method, p_reference_number: pm.reference_number ?? null,
      p_transfer_to_account: pm.transfer_to_account ?? null, p_transfer_from_account: pm.transfer_from_account ?? null,
      p_notes: notes.trim() || null,
    } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    if (net > 0) await attachPaymentProofs([{ files: pm.proof_files, method: pm.method, amount: net }], since);
    try {
      const { logAudit } = await import("@/lib/roles");
      await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId: branchId ?? null, action: "CREATE", entity: "daily_wage",
        entityId: data as unknown as string, details: { employee: name, day, net } } as any);
    } catch { /* never blocks the payment */ }
    toast.success(`اتصرفت يومية ${name} — ${formatEGP(net)}`);
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>صرف يومية {name} — {dayText(day)}</DialogTitle></DialogHeader>
        {err && <div className="text-sm text-destructive">{err}</div>}
        {!pv && !err && <div className="text-sm text-muted-foreground">بيحسب…</div>}
        {pv && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg bg-surface-2 p-3 space-y-1">
              <div className="flex justify-between"><span>أجر اليوم</span><b className="tabular-nums">{formatEGP(n(pv.daily_wage))}</b></div>
              <div className="flex justify-between"><span>الحضور: {STATUS_AR[pv.status] ?? "—"}{pv.paid_extra ? " (يوم إجازته واتحسب)" : ""}</span><b className="tabular-nums">× {n(pv.units)}</b></div>
              {recB > 0 && <div className="flex justify-between text-success"><span>بونص متسجل اليوم ده</span><b>+ {formatEGP(recB)}</b></div>}
              {recP > 0 && <div className="flex justify-between text-destructive"><span>جزاء متسجل اليوم ده</span><b>− {formatEGP(recP)}</b></div>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-success">بونص (+)</Label><Input type="number" min={0} value={bonus} onChange={(e) => setBonus(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-destructive">خصم (−)</Label><Input type="number" min={0} value={ded} onChange={(e) => setDed(e.target.value)} className="mt-1" /></div>
              <div><Label>من السلفة</Label><Input type="number" min={0} value={adv} onChange={(e) => setAdv(e.target.value)} className="mt-1" title={`رصيد السلف ${formatEGP(n(pv.advance_remaining))}`} /></div>
            </div>
            <div><Label>ملاحظات (اختياري)</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" /></div>
            <div className="rounded-lg bg-primary/10 p-3 flex justify-between text-base"><span className="font-bold">الصافي من الخزنة</span><b className="tabular-nums text-primary" data-testid="daily-net">{formatEGP(net)}</b></div>
            {net > 0 && <PaymentMethodPicker amount={net} value={pm} onChange={setPm} direction="out" />}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
          <Button onClick={submit} disabled={!pv || saving}>{saving ? "بيصرف…" : "صرف"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** اليوميات اللي اتصرفت لموظف + «إلغاء» للمالك / المدير. */
export function DailyWagesHistory({ employeeId, canCancel, refreshKey }: { employeeId: string; canCancel: boolean; refreshKey?: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from("daily_wages" as any).select("id,day,units,wage,amount,bonuses,deductions,advance_deduct,net,status,cancel_reason")
      .eq("employee_id", employeeId).order("day", { ascending: false }).limit(60);
    setRows((data as any[]) ?? []);
  }, [employeeId]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const cancel = async (r: any) => {
    const reason = window.prompt(`سبب إلغاء يومية ${r.day}؟`);
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc("cancel_daily_wage" as any, { p_id: r.id, p_reason: reason.trim() } as any);
    if (error) return toast.error(error.message);
    toast.success("اتلغت اليومية والفلوس رجعت للخزنة");
    load();
  };
  if (!rows.length) return <div className="text-sm text-muted-foreground">لسه مفيش يوميات اتصرفت.</div>;
  return (
    <div className="space-y-1 text-sm" data-testid="daily-history">
      {rows.map((r) => (
        <div key={r.id} className={`flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1 ${r.status !== "active" ? "opacity-60 line-through" : ""}`}>
          <span className="min-w-[120px]">{dayText(r.day)}</span>
          <span className="text-xs text-muted-foreground">{formatEGP(n(r.wage))} × {n(r.units)}{n(r.bonuses) ? ` + ${formatEGP(n(r.bonuses))}` : ""}{n(r.deductions) ? ` − ${formatEGP(n(r.deductions))}` : ""}{n(r.advance_deduct) ? ` − سلفة ${formatEGP(n(r.advance_deduct))}` : ""}</span>
          <span className="flex-1" />
          <b className="tabular-nums">{formatEGP(n(r.net))}</b>
          {r.status === "active" && canCancel && <Button size="sm" variant="outline" onClick={() => cancel(r)}>إلغاء</Button>}
          {r.status !== "active" && <span className="text-xs">ملغية: {r.cancel_reason}</span>}
        </div>
      ))}
    </div>
  );
}
