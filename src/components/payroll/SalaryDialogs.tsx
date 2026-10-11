import { useEffect, useState } from "react";
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
import { toast } from "sonner";

/** What `employee_salary_preview` returns (migration 0074) — the server is the only place the absence deduction is computed. */
export interface SalaryPreview {
  employee_id: string; name: string; month: string;
  base: number; work_days: number; paid_days: number; daily_rate: number;
  counts: { present: number; absent: number; leave: number; half_day: number; hourly: number; not_recorded: number };
  attendance_deduction: number; attendance_amount: number;
  advance_due: number; advance_remaining: number;
  paid: any | null;
}

export async function fetchSalaryPreview(employeeId: string, month: string): Promise<SalaryPreview> {
  const { data, error } = await supabase.rpc("employee_salary_preview" as any, { p_employee_id: employeeId, p_month: month } as any);
  if (error) throw new Error(rpcErrorText(error, "حساب المرتب من الحضور"));
  return data as unknown as SalaryPreview;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * صرف مرتب: الأساسي − خصم الغياب (محسوب على السيرفر) + بونص − خصم − قسط السلف = الصافي.
 * الإجازة حالة بس ومدفوعة. اليوم اللي مفيهوش تسجيل = يوم عادي مدفوع.
 */
export function PaySalaryDialog({ employee, month: initialMonth, monthEditable = false, onClose, onDone }: {
  employee: { id: string; name: string; branch_id?: string | null; user_id?: string | null };
  month: string; monthEditable?: boolean; onClose: () => void; onDone: () => void;
}) {
  const { user, profile } = useAuth();
  const [month, setMonth] = useState(initialMonth);
  const [pv, setPv] = useState<SalaryPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bonus, setBonus] = useState("0");
  const [extraDed, setExtraDed] = useState("0");
  const [advDed, setAdvDed] = useState("0");
  const [notes, setNotes] = useState("");
  const [pm, setPm] = useState<PaymentMethodValue>(emptyPaymentValue());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) { setPv(null); return; }
    let off = false;
    setErr(null); setPv(null);
    fetchSalaryPreview(employee.id, month)
      .then((p) => { if (!off) setPv(p); })
      .catch((e) => { if (!off) setErr(e.message); });
    return () => { off = true; };
  }, [employee.id, month]);

  const afterAttendance = n(pv?.attendance_amount);
  const gross = r2(afterAttendance + n(bonus) - n(extraDed));
  const required = r2(Math.min(n(pv?.advance_due), Math.max(0, gross)));
  useEffect(() => { if (pv) setAdvDed(String(required)); }, [pv, required]);
  const adv = n(advDed);
  const net = r2(gross - adv);

  const submit = async () => {
    if (!pv) return;
    if (pv.paid) return toast.error("مرتب الشهر ده اتصرف بالفعل — لو فيه غلط ألغِ الصرف الأول");
    if (n(bonus) < 0 || n(extraDed) < 0 || adv < 0) return toast.error("مفيش قيم بالسالب");
    if (gross <= 0) return toast.error("إجمالي المرتب لازم يكون أكبر من صفر");
    if (adv + 0.009 < required) return toast.error(`لازم تخصم قسط السلف المستحق: ${formatEGP(required)}`);
    if (adv > n(pv.advance_remaining) + 0.009) return toast.error("خصم السلف أكبر من رصيد السلف");
    if (adv > gross + 0.009) return toast.error("خصم السلف أكبر من المرتب");
    const { validateTransferPayment } = await import("@/lib/paymentMethods");
    const pErr = net > 0 ? validateTransferPayment(pm) : null;
    if (pErr) return toast.error(pErr);
    setSaving(true);
    const { data: salaryId, error } = await supabase.rpc("pay_employee_salary" as any, {
      p_employee_id: employee.id, p_month: month, p_bonuses: n(bonus), p_deductions: n(extraDed), p_advance_deduct: adv,
      p_payment_method: pm.method, p_reference_number: pm.reference_number ?? null,
      p_transfer_to_account: pm.transfer_to_account ?? null, p_transfer_from_account: pm.transfer_from_account ?? null,
      p_fee_amount: pm.fee_amount ?? 0, p_notes: notes.trim() || null,
    } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    try {
      const { logAudit } = await import("@/lib/roles");
      await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId: employee.branch_id ?? null, action: "CREATE", entity: "salary",
        entityId: salaryId as unknown as string, details: { employee: employee.name, month, net, absence: pv.attendance_deduction, bonus: n(bonus), deduction: n(extraDed), advance: adv, method: pm.method } } as any);
      if (employee.user_id) {
        const parts = [`صافي: ${formatEGP(net)}`, `أساسي: ${formatEGP(pv.base)}`];
        if (pv.attendance_deduction > 0) parts.push(`خصم غياب: ${formatEGP(pv.attendance_deduction)}`);
        if (n(bonus) > 0) parts.push(`بونص: ${formatEGP(n(bonus))}`);
        if (n(extraDed) > 0) parts.push(`خصم: ${formatEGP(n(extraDed))}`);
        if (adv > 0) parts.push(`قسط سلف: ${formatEGP(adv)}`);
        const { notify } = await import("@/lib/notifications");
        await notify({ userId: employee.user_id, title: `💰 تم صرف مرتبك لشهر ${month}`, body: parts.join(" — "), type: "salary_paid",
          link: "/profile", relatedEntity: "salary", relatedEntityId: salaryId as unknown as string });
      }
    } catch { /* audit / notification never block the payment */ }
    toast.success("تم صرف المرتب");
    onDone();
  };

  const c = pv?.counts;
  const Row = ({ label, value, tone = "", sign = "" }: { label: React.ReactNode; value: number; tone?: string; sign?: string }) => (
    <div className="flex justify-between gap-3 py-1"><span>{label}</span><b className={`tabular-nums ${tone}`}>{sign}{formatEGP(value)}</b></div>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>صرف مرتب {employee.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label>الشهر</Label>
            <Input type="month" value={month} disabled={!monthEditable} onChange={(e) => setMonth(e.target.value)} className="mt-1.5" />
          </div>
          {err && <div className="text-destructive">{err}</div>}
          {!pv && !err && <div className="text-muted-foreground">بيحسب من الحضور...</div>}
          {pv?.paid && (
            <div className="rounded-lg border border-success/40 bg-success/10 p-3">
              مرتب الشهر ده اتصرف بالفعل ({formatEGP(n(pv.paid.net_salary))}). لو فيه غلط: «إلغاء الصرف» من جدول المرتبات وبعدين اصرف تاني.
            </div>
          )}
          {pv && !pv.paid && (
            <>
              <div className="rounded-lg bg-surface-2 p-3">
                <Row label="الأساسي" value={pv.base} />
                <Row label={<>خصم الغياب <span className="text-[11px] text-muted-foreground">
                  ({c!.absent} غياب{c!.half_day ? ` • ${c!.half_day} نص يوم` : ""}{c!.hourly ? ` • ${c!.hourly} بالساعة` : ""} من {pv.work_days} يوم شغل — اليوم بـ {formatEGP(pv.daily_rate)})</span></>}
                  value={pv.attendance_deduction} tone="text-destructive" sign="− " />
                <div className="text-[11px] text-muted-foreground pb-1">
                  حضر {c!.present} • إجازة {c!.leave} (مدفوعة) • من غير تسجيل {c!.not_recorded} (بتتحسب أيام عادية)
                </div>
                <div className="border-t border-border mt-1 pt-1"><Row label="المستحق بالحضور" value={pv.attendance_amount} /></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-success">بونص / حافز (+)</Label>
                  <Input type="number" min={0} value={bonus} onChange={(e) => setBonus(e.target.value)} className="mt-1.5" />
                </div>
                <div>
                  <Label className="text-destructive">خصم إضافي (−)</Label>
                  <Input type="number" min={0} value={extraDed} onChange={(e) => setExtraDed(e.target.value)} className="mt-1.5" />
                </div>
              </div>
              <div>
                <Label>قسط السلف (المستحق إجباري {formatEGP(required)} — رصيد السلف {formatEGP(pv.advance_remaining)})</Label>
                <Input type="number" min={required} value={advDed} onChange={(e) => setAdvDed(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label>سبب البونص / الخصم (اختياري)</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
              </div>

              <div className="rounded-lg bg-primary/10 p-3">
                <Row label="الأساسي" value={pv.base} />
                {pv.attendance_deduction > 0 && <Row label="خصم الغياب" value={pv.attendance_deduction} tone="text-destructive" sign="− " />}
                {n(bonus) > 0 && <Row label="بونص" value={n(bonus)} tone="text-success" sign="+ " />}
                {n(extraDed) > 0 && <Row label="خصم إضافي" value={n(extraDed)} tone="text-destructive" sign="− " />}
                {adv > 0 && <Row label="قسط السلف" value={adv} tone="text-warning" sign="− " />}
                <div className="flex justify-between border-t border-border mt-1 pt-2 text-base"><span className="font-bold">الصافي اللي هيخرج من الخزنة</span><b className="tabular-nums text-primary">{formatEGP(net)}</b></div>
              </div>
              {net > 0 && <PaymentMethodPicker amount={net} value={pm} onChange={setPm} />}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
          <Button onClick={submit} disabled={saving || !pv || !!pv.paid}>{saving ? "جاري الصرف..." : "صرف المرتب"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** إلغاء صرف مرتب: الفلوس بترجع الخزنة بسند عكسي، قسط السلف يرجع على الموظف، والقيد يتعكس. الصف بيفضل ظاهر «ملغي». */
export function CancelSalaryDialog({ salary, onClose, onDone }: { salary: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason.trim()) return toast.error("اكتب سبب الإلغاء");
    setSaving(true);
    const { error } = await supabase.rpc("cancel_salary_payment" as any, { p_salary_id: salary.id, p_reason: reason.trim() } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("اتلغى الصرف — الفلوس رجعت الخزنة وقسط السلف رجع على الموظف");
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>إلغاء صرف مرتب {salary.month}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground leading-6">
            هيرجع {formatEGP(n(salary.net_salary))} للخزنة بسند عكسي{n(salary.advance_deduct) > 0 ? `، و${formatEGP(n(salary.advance_deduct))} قسط السلف هيرجع على الموظف` : ""}.
            الصرف القديم بيفضل في السجل «ملغي» — وبعدها تقدر تصرف الشهر تاني صح.
          </p>
          <div><Label>سبب الإلغاء *</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>رجوع</Button>
          <Button variant="destructive" onClick={submit} disabled={saving}>{saving ? "..." : "إلغاء الصرف"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
