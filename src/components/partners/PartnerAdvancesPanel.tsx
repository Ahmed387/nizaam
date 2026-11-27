import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, HandCoins, Landmark, Settings2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PermTable } from "@/components/PermTable";
import { VesselAccountSelect, useHasVesselAccounts } from "@/components/payments/VesselAccountSelect";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatEGP } from "@/lib/format";
import { choosable, loadAllPaymentMethods, type PaymentMethodOption } from "@/lib/paymentMethods";
import {
  cancelAdvanceRepay, cancellableRepay, fetchMoneyBranches, monthsToRepay, PAY_METHOD_LABEL, REPAY_MODE_LABEL, repayAdvanceCash,
  repayAdvanceFromCapital, repayProblem, setPartnerAdvanceLimit, setPartnerAdvanceRepay,
  type PartnerAdvance, type PartnerCards, type RepayMode,
} from "@/lib/partners";
import { DayField } from "@/components/partners/PartnerFormParts";

const ADV_STATUS: Record<string, string> = { active: "مفتوحة", partially_paid: "اتسدد جزء", fully_paid: "اتسددت", cancelled: "ملغية" };

/**
 * «السلف» on the partner page (0296, owner «نفذ» 2026-11-27): his open advances, how each is paid back (من الربح / من المرتب /
 * الاتنين — an employee-partner only for the salary), «رد سلفة» in cash into a branch till / vessel, «سداد من رأس ماله» with
 * no money, the maximum advance, and every payment with «إلغاء» (cash / capital ones, on their own day).
 */
export function PartnerAdvancesPanel({ cards, canWrite, onChanged }: { cards: PartnerCards; canWrite: boolean; onChanged: () => void }) {
  const list = cards.advances_list ?? [];
  const open = Number(cards.advances) || 0;
  const p = cards.partner;
  const [dlg, setDlg] = useState<null | "cash" | "capital" | "limit" | { mode: PartnerAdvance } | { cancel: { refId: string; amount: number; label: string } }>(null);
  const isEmployee = p.role_kind === "employee_partner" && !!p.employee_id;
  return (
    <Card data-testid="partner-advances">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>السلف</CardTitle>
          <div className="text-xs text-muted-foreground mt-1">
            عليه دلوقتي <b className="tabular-nums text-warning">{formatEGP(open)}</b>
            {" — "}الحد الأقصى: <b data-testid="advance-limit">{p.max_advance == null ? "مفيش حد" : formatEGP(Number(p.max_advance))}</b>
          </div>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1" disabled={open <= 0} onClick={() => setDlg("cash")} data-testid="adv-repay-cash"><HandCoins className="w-4 h-4" /> رد سلفة</Button>
            <Button size="sm" variant="outline" className="gap-1" disabled={open <= 0 || Number(cards.capital) <= 0} onClick={() => setDlg("capital")} data-testid="adv-repay-capital"><Landmark className="w-4 h-4" /> سداد من رأس ماله</Button>
            <Button size="sm" variant="ghost" className="gap-1" onClick={() => setDlg("limit")} data-testid="adv-limit"><ShieldAlert className="w-4 h-4" /> الحد الأقصى</Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        {list.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">مفيش سلف على {p.name}.</div>
        ) : (
          <PermTable className="w-full text-sm" permTable="partner_advances">
            <thead className="bg-muted/40"><tr className="text-right">
              <th className="p-2">التاريخ</th><th className="p-2 text-center">السلفة</th><th className="p-2 text-center">اتسدد</th><th className="p-2 text-center">الباقي</th>
              <th className="p-2 text-center">بتتسد إزاي</th><th className="p-2 text-center">الحالة</th><th className="p-2">الدفعات</th>
            </tr></thead>
            <tbody>
              {list.map((a) => {
                const live = a.status === "active" || a.status === "partially_paid";
                return (
                  <tr key={a.id} className="border-t align-top" data-testid={`adv-row-${a.id}`}>
                    <td className="p-2 whitespace-nowrap tabular-nums">{a.date}<div className="text-[11px] text-muted-foreground max-w-[220px] truncate" title={a.reason ?? ""}>{a.reason}</div></td>
                    <td className="p-2 text-center tabular-nums">{formatEGP(a.amount)}</td>
                    <td className="p-2 text-center tabular-nums text-success">{formatEGP(a.paid_back)}</td>
                    <td className="p-2 text-center tabular-nums font-semibold text-warning">{formatEGP(a.remaining)}</td>
                    <td className="p-2 text-center whitespace-nowrap">
                      <div data-testid={`adv-mode-${a.id}`}>{REPAY_MODE_LABEL[a.repay_mode ?? "profit"]}</div>
                      {a.repay_mode && a.repay_mode !== "profit" && a.monthly ? <div className="text-[11px] text-muted-foreground">قسط {formatEGP(Number(a.monthly))} — {monthsToRepay(a.remaining, Number(a.monthly))} شهر</div> : null}
                      {canWrite && live && (
                        <Button size="sm" variant="link" className="h-auto p-0 text-xs gap-1" onClick={() => setDlg({ mode: a })} data-testid={`adv-mode-btn-${a.id}`}><Settings2 className="w-3 h-3" /> غيّر</Button>
                      )}
                    </td>
                    <td className="p-2 text-center"><Badge variant={a.status === "cancelled" ? "destructive" : "secondary"}>{ADV_STATUS[a.status] ?? a.status}</Badge></td>
                    <td className="p-2 min-w-[280px]">
                      {(a.payments ?? []).length === 0 ? <span className="text-xs text-muted-foreground">—</span> : (
                        <ul className="space-y-1 text-xs">
                          {(a.payments ?? []).map((x) => (
                            <li key={x.id} className={`flex items-center gap-1.5 whitespace-nowrap ${x.status !== "active" ? "line-through text-muted-foreground" : ""}`}>
                              <span className="tabular-nums">{x.date}</span><span>{PAY_METHOD_LABEL[x.method] ?? x.method}</span><b className="tabular-nums">{formatEGP(x.amount)}</b>
                              {canWrite && cancellableRepay(x) && (
                                <button type="button" className="text-destructive inline-flex items-center gap-0.5 hover:underline" data-testid={`adv-cancel-${x.id}`}
                                  onClick={() => setDlg({ cancel: { refId: x.ref!, amount: x.amount, label: PAY_METHOD_LABEL[x.method] } })}><Ban className="w-3 h-3" /> إلغاء</button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </PermTable>
        )}
      </CardContent>
      {dlg === "cash" && <RepayCashDialog cards={cards} onClose={() => setDlg(null)} onDone={onChanged} />}
      {dlg === "capital" && <RepayCapitalDialog cards={cards} onClose={() => setDlg(null)} onDone={onChanged} />}
      {dlg === "limit" && <LimitDialog cards={cards} onClose={() => setDlg(null)} onDone={onChanged} />}
      {dlg && typeof dlg === "object" && "mode" in dlg && <RepayModeDialog advance={dlg.mode} isEmployee={isEmployee} name={p.name} onClose={() => setDlg(null)} onDone={onChanged} />}
      {dlg && typeof dlg === "object" && "cancel" in dlg && <CancelRepayDialog {...dlg.cancel} onClose={() => setDlg(null)} onDone={onChanged} />}
    </Card>
  );
}

function Shell({ title, desc, children, onClose, onSave, busy, problem, testId, saveText = "سجّل" }: {
  title: string; desc: string; children: React.ReactNode; onClose: () => void; onSave: () => void; busy: boolean; problem: string | null; testId: string; saveText?: string;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-lg" data-testid={testId}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="text-right leading-6">{desc}</DialogDescription></DialogHeader>
        <div className="grid gap-4">{children}</div>
        <DialogFooter className="gap-2 sm:justify-start items-center">
          <Button onClick={onSave} disabled={busy || !!problem} data-testid={`${testId}-save`}>{busy ? "لحظة…" : saveText}</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
          {problem && <span className="text-xs text-muted-foreground">{problem}</span>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const Amount = ({ value, onChange, max }: { value: string; onChange: (v: string) => void; max: number }) => (
  <div>
    <Label htmlFor="adv-amount" className="text-sm font-semibold">المبلغ</Label>
    <div className="flex items-center gap-2 mt-1.5">
      <Input id="adv-amount" type="number" inputMode="decimal" min={0} value={value} onChange={(e) => onChange(e.target.value)} autoFocus className="h-12 text-xl font-bold tabular-nums" />
      <Button type="button" variant="outline" size="sm" onClick={() => onChange(String(max))}>الكل ({formatEGP(max)})</Button>
    </div>
  </div>
);

function RepayCashDialog({ cards, onClose, onDone }: { cards: PartnerCards; onClose: () => void; onDone: () => void }) {
  const today = cairoTodayDay();
  const open = Number(cards.advances) || 0;
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(today);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [branchId, setBranchId] = useState("");
  const [method, setMethod] = useState("cash");
  const [account, setAccount] = useState("");
  const hasAccounts = useHasVesselAccounts(method);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchMoneyBranches().then(setBranches).catch(() => setBranches([]));
    loadAllPaymentMethods().then((m) => setMethods(m.filter(choosable))).catch(() => setMethods([]));
  }, []);
  const amt = Number(amount || 0);
  const problem = !(amt > 0) ? "اكتب المبلغ" : amt > open + 0.005 ? `عليه ${formatEGP(open)} بس` : !day || day > today ? "اختار اليوم"
    : !branchId ? "اختار الخزنة" : hasAccounts && !account ? "اختار الحساب اللي الفلوس وصلت عليه" : null;
  const save = async () => {
    setBusy(true);
    try {
      const r = await repayAdvanceCash({ partnerId: cards.partner.id, amount: amt, branchId, method, date: day, notes, account: hasAccounts ? account : null });
      toast.success(`اتسجل رد سلفة ${formatEGP(r.paid)} — فاضل عليه ${formatEGP(r.left)}`);
      onDone(); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell title={`رد سلفة — ${cards.partner.name}`} desc={`الفلوس بتدخل خزنة الفرع والوعاء اللي تختارهم، والسلف بتقل (الأقدم الأول). عليه دلوقتي ${formatEGP(open)}.`}
      onClose={onClose} onSave={save} busy={busy} problem={problem} testId="adv-cash-dialog">
      <Amount value={amount} onChange={setAmount} max={open} />
      <DayField id="adv-day" label="اتدفعت إمتى" value={day} min="2026-01-01" max={today} onChange={setDay} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-sm font-semibold">تدخل خزنة فرع</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-11 mt-1.5" data-testid="adv-branch"><SelectValue placeholder="اختار الفرع" /></SelectTrigger>
            <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-sm font-semibold">الوعاء</Label>
          <Select value={method} onValueChange={(v) => { setMethod(v); setAccount(""); }}>
            <SelectTrigger className="h-11 mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>{(methods.length ? methods : [{ value: "cash", label: "نقدي" } as PaymentMethodOption]).map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
          {hasAccounts && <VesselAccountSelect sending={false} method={method} value={account} onChange={setAccount} className="mt-2" />}
        </div>
      </div>
      <div><Label htmlFor="adv-notes" className="text-sm font-semibold">ملاحظات</Label><Textarea id="adv-notes" rows={2} className="mt-1.5" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      {amt > 0 && !problem && <div className="rounded-lg bg-muted/50 p-3 text-xs" data-testid="adv-cash-effect">الخزنة +{formatEGP(amt)} — السلف {formatEGP(open)} ← {formatEGP(open - amt)}</div>}
    </Shell>
  );
}

function RepayCapitalDialog({ cards, onClose, onDone }: { cards: PartnerCards; onClose: () => void; onDone: () => void }) {
  const today = cairoTodayDay();
  const open = Number(cards.advances) || 0;
  const cap = Number(cards.capital) || 0;
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const amt = Number(amount || 0);
  const max = Math.min(open, cap);
  const problem = !(amt > 0) ? "اكتب المبلغ" : amt > open + 0.005 ? `عليه ${formatEGP(open)} بس` : amt > cap + 0.005 ? `رأس ماله ${formatEGP(cap)} بس`
    : !day || day > today ? "اختار اليوم" : null;
  const save = async () => {
    setBusy(true);
    try {
      const r = await repayAdvanceFromCapital(cards.partner.id, amt, day, reason);
      toast.success(`اتسدد ${formatEGP(r.paid)} من رأس ماله — فاضل عليه ${formatEGP(r.left)}`);
      onDone(); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell title={`سداد سلفة من رأس ماله — ${cards.partner.name}`} desc="من غير فلوس: رأس ماله ونسبته من الربح يقلوا من الشهر ده، والسلف تقل بنفس المبلغ. الخزن مش بتتحرك."
      onClose={onClose} onSave={save} busy={busy} problem={problem} testId="adv-capital-dialog">
      <Amount value={amount} onChange={setAmount} max={max} />
      <DayField id="adv-cap-day" label="اليوم" value={day} min="2026-01-01" max={today} onChange={setDay} hint="رأس ماله يقل من أول الشهر ده" />
      <div><Label htmlFor="adv-reason" className="text-sm font-semibold">السبب</Label><Input id="adv-reason" className="mt-1.5" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: اتفقنا تتخصم من رأس ماله" /></div>
      {amt > 0 && !problem && <div className="rounded-lg bg-muted/50 p-3 text-xs" data-testid="adv-capital-effect">رأس ماله {formatEGP(cap)} ← {formatEGP(cap - amt)} — السلف {formatEGP(open)} ← {formatEGP(open - amt)}</div>}
    </Shell>
  );
}

function LimitDialog({ cards, onClose, onDone }: { cards: PartnerCards; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(cards.partner.max_advance == null ? "" : String(cards.partner.max_advance));
  const [busy, setBusy] = useState(false);
  const n = v === "" ? null : Number(v);
  const problem = n != null && (!(n >= 0) || Number.isNaN(n)) ? "اكتب رقم صح" : null;
  const save = async () => {
    setBusy(true);
    try { await setPartnerAdvanceLimit(cards.partner.id, n); toast.success(n == null ? "اتشال الحد" : `الحد بقى ${formatEGP(n)}`); onDone(); onClose(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell title={`الحد الأقصى للسلفة — ${cards.partner.name}`} desc="أي سحب «من الربح» يخلّي السلف المفتوحة عليه أكتر من الحد ده بيترفض. فاضي = مفيش حد."
      onClose={onClose} onSave={save} busy={busy} problem={problem} testId="adv-limit-dialog" saveText="احفظ">
      <div>
        <Label htmlFor="adv-limit-input" className="text-sm font-semibold">الحد</Label>
        <Input id="adv-limit-input" type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} className="mt-1.5 h-11 tabular-nums" placeholder="مفيش حد" autoFocus />
        <div className="text-xs text-muted-foreground mt-1">عليه دلوقتي {formatEGP(Number(cards.advances) || 0)}</div>
      </div>
    </Shell>
  );
}

/** «تتسد إزاي؟» — also used right after a withdrawal makes an advance */
export function RepayModeFields({ mode, setMode, monthly, setMonthly, remaining, isEmployee }: {
  mode: RepayMode; setMode: (m: RepayMode) => void; monthly: string; setMonthly: (v: string) => void; remaining: number; isEmployee: boolean;
}) {
  const opts: { v: RepayMode; d: string }[] = [
    { v: "profit", d: "بتتخصم من نصيبه في توزيع الأرباح الجاي" },
    { v: "salary", d: "قسط كل شهر بيتخصم من مرتبه (زي سلف الموظفين)" },
    { v: "both", d: "القسط من المرتب + أي نصيب في التوزيع" },
  ];
  const m = Number(monthly || 0);
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="تتسد إزاي">
        {opts.map((o) => {
          const off = o.v !== "profit" && !isEmployee;
          return (
            <button key={o.v} type="button" role="radio" aria-checked={mode === o.v} disabled={off} data-testid={`repay-${o.v}`} onClick={() => setMode(o.v)}
              className={`rounded-xl border-2 p-3 text-right transition ${mode === o.v ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"} disabled:opacity-40`}>
              <div className="font-semibold text-sm">{REPAY_MODE_LABEL[o.v]}</div>
              <div className="text-[11px] text-muted-foreground mt-1 leading-5">{off ? "مش موظف — مالوش مرتب" : o.d}</div>
            </button>
          );
        })}
      </div>
      {mode !== "profit" && (
        <div className="max-w-xs">
          <Label htmlFor="repay-monthly" className="text-xs font-semibold">القسط الشهري من المرتب</Label>
          <Input id="repay-monthly" type="number" min={0} value={monthly} onChange={(e) => setMonthly(e.target.value)} className="mt-1 tabular-nums" />
          {m > 0 && <div className="text-[11px] text-muted-foreground mt-1">{formatEGP(remaining)} ÷ {formatEGP(m)} = {monthsToRepay(remaining, m)} شهر</div>}
        </div>
      )}
    </div>
  );
}

function RepayModeDialog({ advance, isEmployee, name, onClose, onDone }: { advance: PartnerAdvance; isEmployee: boolean; name: string; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<RepayMode>(advance.repay_mode ?? "profit");
  const [monthly, setMonthly] = useState(advance.repay_mode && advance.repay_mode !== "profit" && advance.monthly ? String(advance.monthly) : "");
  const [busy, setBusy] = useState(false);
  const problem = repayProblem(mode, Number(monthly || 0), advance.remaining, isEmployee);
  const save = async () => {
    setBusy(true);
    try { await setPartnerAdvanceRepay(advance.id, mode, Number(monthly || 0)); toast.success(`السلفة بتتسد ${REPAY_MODE_LABEL[mode]}`); onDone(); onClose(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell title={`السلفة دي تتسد إزاي؟ — ${name}`} desc={`فاضل منها ${formatEGP(advance.remaining)}. تقدر تغيّرها بعدين.`}
      onClose={onClose} onSave={save} busy={busy} problem={problem} testId="adv-mode-dialog" saveText="احفظ">
      <RepayModeFields mode={mode} setMode={setMode} monthly={monthly} setMonthly={setMonthly} remaining={advance.remaining} isEmployee={isEmployee} />
    </Shell>
  );
}

function CancelRepayDialog({ refId, amount, label, onClose, onDone }: { refId: string; amount: number; label: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await cancelAdvanceRepay(refId, reason.trim()); toast.success("اتلغى — السلفة رجعت زي ما كانت"); onDone(); onClose(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell title={`إلغاء ${label} ${formatEGP(amount)}`} desc="بيتلغي في يومه: الخزنة / رأس المال والقيد بيرجعوا، والسلف بتزيد تاني بنفس المبلغ."
      onClose={onClose} onSave={save} busy={busy} problem={!reason.trim() ? "اكتب السبب" : null} testId="adv-cancel-dialog" saveText="الغي">
      <div><Label htmlFor="adv-cancel-reason" className="text-sm font-semibold">السبب</Label><Input id="adv-cancel-reason" className="mt-1.5" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
    </Shell>
  );
}
