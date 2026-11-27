import { VesselAccountSelect, useHasVesselAccounts } from "@/components/payments/VesselAccountSelect";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uploadRecordAttachment } from "@/lib/attachmentUpload";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatEGP } from "@/lib/format";
import { choosable, loadAllPaymentMethods, type PaymentMethodOption } from "@/lib/paymentMethods";
import {
  advanceLimitProblem, fetchMoneyBranches, fetchPartnersOverview, monthLabel, repayProblem, setPartnerAdvanceRepay, type RepayMode, partnerMoney, partnerMoneyProblem, pct, splitWithdrawal, suggestCountsFrom,
  withdrawalSentence, type PartnerCards, type WithdrawSource,
} from "@/lib/partners";
import { CountsFromFields, EffectRow, PartnerChips, ProofPicker } from "@/components/partners/PartnerFormParts";
import { RepayModeFields } from "@/components/partners/PartnerAdvancesPanel";

/**
 * «مساهمة» / «سحب» (0137, redesigned 2026-11-27 like «سحب قبل السيستم»): the money moves in the till of the branch and vessel
 * the owner picks, on the exact day it moved; «يتحسب من بداية شهر» is his choice (rule: in → the month after, out → the same
 * month; another month = a warning only). A withdrawal is «من الربح» / «من رأس ماله» / «جزء وجزء»; above his profit it becomes
 * an advance by itself. Proof files are uploaded to the partner movement right after saving.
 */
export function PartnerMoneyDialog({ kind, cards, active: activeIn, onClose, onDone }: {
  kind: "contribution" | "withdrawal";
  cards: PartnerCards;
  /** every active partner (for his % before → after); read here when not given */
  active?: PartnerCards[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const today = cairoTodayDay();
  const isIn = kind === "contribution";
  const [active, setActive] = useState<PartnerCards[] | null>(activeIn ?? null);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [method, setMethod] = useState("cash");
  const [account, setAccount] = useState("");
  const hasAccounts = useHasVesselAccounts(method);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(suggestCountsFrom(isIn ? "in" : "out", today));
  const [touched, setTouched] = useState(false);
  const [source, setSource] = useState<WithdrawSource>("profit");
  const [capitalPart, setCapitalPart] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  // 0296: «تتسد إزاي؟» when this withdrawal makes an advance
  const [repayMode, setRepayMode] = useState<RepayMode>("profit");
  const [monthly, setMonthly] = useState("");

  useEffect(() => {
    fetchMoneyBranches().then(setBranches).catch(() => setBranches([]));
    loadAllPaymentMethods().then((m) => setMethods(m.filter(choosable))).catch(() => setMethods([]));
    if (!activeIn) fetchPartnersOverview().then((r) => setActive(r.filter((x) => x.partner.is_active))).catch(() => setActive([]));
  }, [activeIn]);

  const amt = Number(amount || 0);
  const split = useMemo(() => splitWithdrawal(amt, source, Number(capitalPart || 0), cards), [amt, source, capitalPart, cards]);
  const name = cards.partner.name;
  const capNow = Math.max(Number(cards.capital) || 0, 0);
  const total = (active ?? []).reduce((s, r) => s + Math.max(Number(r.capital) || 0, 0), 0);
  const capDelta = isIn ? amt : -split.capital;
  const capAfter = capNow + capDelta;
  const shareNow = total > 0 ? capNow / total : 0;
  const shareAfter = total + capDelta > 0 ? Math.max(capAfter, 0) / (total + capDelta) : 0;
  const profitNow = Number(cards.profit) || 0;
  const advNow = Number(cards.advances) || 0;
  const isEmployee = cards.partner.role_kind === "employee_partner" && !!cards.partner.employee_id;
  const makesAdvance = !isIn && split.advance > 0;

  // the limit first: it decides whether this withdrawal can happen at all
  const problem = (makesAdvance ? advanceLimitProblem(cards.partner.max_advance, advNow, split.advance) : null)
    ?? partnerMoneyProblem({ kind, amount: amt, branchId, date, today, source, capitalPart: Number(capitalPart || 0), cards })
    ?? (makesAdvance ? repayProblem(repayMode, Number(monthly || 0), split.advance, isEmployee) : null)
    ?? (!month ? "اختار يتحسب من بداية أنهي شهر" : hasAccounts && !account ? (isIn ? "اختار الحساب اللي الفلوس وصلت عليه" : "اختار الحساب اللي الفلوس اتحولت منه") : null);

  const save = async () => {
    if (problem) return toast.error(problem);
    setBusy(true);
    try {
      const r = await partnerMoney({ partnerId: cards.partner.id, kind, amount: amt, source, capitalPart: Number(capitalPart || 0),
        branchId: branchId!, method, date, notes, account: hasAccounts ? account : null, countsFrom: month });
      let failed = 0;
      if (makesAdvance && repayMode !== "profit" && r.advance_id) {
        try { await setPartnerAdvanceRepay(r.advance_id, repayMode, Number(monthly || 0)); }
        catch (e: any) { toast.error(`السحب اتسجل، بس طريقة السداد ماتسجلتش: ${e.message} — غيّرها من «السلف» في صفحته`); }
      }
      if (files.length) {
        const { data } = await supabase.from("partner_transactions").select("id").eq("related_treasury_id", r.treasury_id).order("created_at").limit(1);
        const id = data?.[0]?.id;
        for (const f of files) {
          try { if (!id) throw new Error("no row"); await uploadRecordAttachment("partner_transaction", id, f, user?.id); } catch { failed += 1; }
        }
      }
      toast.success(isIn ? `اتسجلت مساهمة ${formatEGP(amt)} لـ ${name}` : `اتسجل سحب ${formatEGP(amt)}: ${withdrawalSentence(r)}`);
      if (failed) toast.error(`${failed} مرفق مترفعش — ارفعه من زرار 📎 جنب الحركة`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const Icon = isIn ? ArrowUpCircle : ArrowDownCircle;
  const sources: { v: WithdrawSource; t: string; d: string }[] = [
    { v: "profit", t: "من الربح", d: "نسبته تفضل زي ما هي. اللي فوق صافي ربحه يبقى سلفة لوحده." },
    { v: "capital", t: "من رأس ماله", d: "رأس ماله ونسبته من الربح يقلوا من الشهر اللي تختاره." },
    { v: "split", t: "جزء وجزء", d: "جزء من رأس ماله والباقي من الربح." },
  ];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-xl p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col" data-testid="partner-money-dialog">
        <DialogHeader className={`px-6 pt-6 pb-4 border-b ${isIn ? "bg-success/5" : "bg-warning/5"}`}>
          <div className="flex items-start gap-3">
            <div className={`shrink-0 rounded-full p-2.5 ${isIn ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}><Icon className="w-5 h-5" /></div>
            <div className="min-w-0 text-right">
              <DialogTitle className="text-lg">{isIn ? "مساهمة في رأس المال" : "سحب"}</DialogTitle>
              <div className="text-sm font-semibold text-muted-foreground mt-0.5">{name}</div>
            </div>
          </div>
          <DialogDescription className="text-xs leading-5 mt-2 text-right">
            {isIn ? "الفلوس بتدخل خزنة الفرع والوعاء اللي تختارهم، ورأس ماله بيزيد بيها." : "الفلوس بتطلع من خزنة الفرع والوعاء اللي تختارهم."}
          </DialogDescription>
          <PartnerChips items={[
            { label: "رأس ماله", value: formatEGP(capNow) },
            { label: "نسبته من الربح", value: active ? pct(shareNow) : "…" },
            { label: "صافي ربحه", value: formatEGP(profitNow) },
            ...(advNow > 0 ? [{ label: "سلف عليه", value: formatEGP(advNow) }] : []),
          ]} />
        </DialogHeader>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <section>
            <Label htmlFor="pm-amount" className="text-sm font-semibold">المبلغ</Label>
            <div className="relative mt-1.5">
              <Input id="pm-amount" type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus
                className="h-14 text-2xl font-bold tabular-nums pl-14" placeholder="0" data-testid="pm-amount" />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">ج.م</span>
            </div>
            {amt > 0 && <div className="mt-1 text-xs text-muted-foreground tabular-nums">{formatEGP(amt)}</div>}
          </section>

          {!isIn && (
            <section>
              <div className="text-sm font-semibold mb-2">السحب ده من إيه؟</div>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="السحب من إيه">
                {sources.map((o) => (
                  <button key={o.v} type="button" role="radio" aria-checked={source === o.v} data-testid={`pm-source-${o.v}`} onClick={() => setSource(o.v)}
                    className={`rounded-xl border-2 p-3 text-right transition ${source === o.v ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                    <div className="font-semibold text-sm flex items-center gap-2">
                      <span className={`inline-block w-3.5 h-3.5 rounded-full border-2 ${source === o.v ? "border-primary bg-primary" : "border-muted-foreground"}`} />{o.t}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 leading-5">{o.d}</div>
                  </button>
                ))}
              </div>
              {source === "split" && (
                <div className="max-w-xs mt-3">
                  <Label htmlFor="pm-cap-part" className="text-xs">جزء رأس المال</Label>
                  <Input id="pm-cap-part" type="number" inputMode="decimal" min={0} value={capitalPart} onChange={(e) => setCapitalPart(e.target.value)} className="mt-1" />
                </div>
              )}
            </section>
          )}

          {makesAdvance && (
            <section className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-2" data-testid="pm-repay">
              <div className="text-sm font-semibold">السحب ده هيعمل سلفة {formatEGP(split.advance)} — تتسد إزاي؟</div>
              <RepayModeFields mode={repayMode} setMode={setRepayMode} monthly={monthly} setMonthly={setMonthly} remaining={split.advance} isEmployee={isEmployee} />
              {cards.partner.max_advance != null && <div className="text-[11px] text-muted-foreground">الحد الأقصى لسلفه {formatEGP(Number(cards.partner.max_advance))} — عليه دلوقتي {formatEGP(advNow)}</div>}
            </section>
          )}

          <CountsFromFields prefix="pm" dir={isIn ? "in" : "out"} day={date} onDay={setDate} month={month} onMonth={setMonth}
            touched={touched} onTouched={() => setTouched(true)} today={today} minDay="2026-01-01" />

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-sm font-semibold">{isIn ? "تدخل خزنة فرع" : "تطلع من خزنة فرع"}</Label>
              <Select value={branchId ?? ""} onValueChange={setBranchId}>
                <SelectTrigger className="h-11 mt-1.5" data-testid="pm-branch"><SelectValue placeholder="اختار الفرع" /></SelectTrigger>
                <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-semibold">الوعاء</Label>
              <Select value={method} onValueChange={(v) => { setMethod(v); setAccount(""); }}>
                <SelectTrigger className="h-11 mt-1.5" data-testid="pm-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(methods.length ? methods : [{ value: "cash", label: "نقدي" } as PaymentMethodOption]).map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasAccounts && (
                <div className="mt-2">
                  <Label className="text-xs">{isIn ? "الحساب اللي الفلوس وصلت عليه *" : "الحساب اللي الفلوس اتحولت منه *"}</Label>
                  <VesselAccountSelect sending={!isIn} method={method} value={account} onChange={setAccount} className="mt-1" />
                </div>
              )}
            </div>
          </section>

          <section>
            <Label htmlFor="pm-notes" className="text-sm font-semibold">ملاحظات</Label>
            <Textarea id="pm-notes" rows={2} className="mt-1.5" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </section>

          <ProofPicker files={files} setFiles={setFiles} testId="pm-files" />

          {amt > 0 && (
            <section className="rounded-xl border bg-muted/40 p-4 space-y-2 text-sm" data-testid="pm-effect">
              <div className="font-semibold text-xs text-muted-foreground">اللي هيحصل</div>
              <EffectRow label="رأس ماله" before={formatEGP(capNow)} after={formatEGP(Math.max(capAfter, 0))} changed={Math.abs(capDelta) > 0.005}
                note={month ? `من ${monthLabel(month)}` : undefined} />
              <EffectRow label="نسبته من الربح" before={pct(shareNow)} after={pct(shareAfter)} changed={!!active && Math.abs(shareAfter - shareNow) > 1e-6}
                note={month ? `من ${monthLabel(month)}` : undefined} />
              {!isIn && split.profit > 0 && <EffectRow label="صافي ربحه" before={formatEGP(profitNow)} after={formatEGP(profitNow - split.profit)} changed />}
              {!isIn && split.advance > 0 && <EffectRow label="سلف عليه" before={formatEGP(advNow)} after={formatEGP(advNow + split.advance)} changed warn />}
              {!isIn && <div className={`text-xs rounded-md p-2 ${split.advance > 0 ? "bg-warning/10" : "bg-background"}`}>هيتسجل: {withdrawalSentence(split) || "—"}</div>}
            </section>
          )}
        </div>

        <div className="flex items-center gap-2 border-t bg-background px-6 py-3">
          <Button onClick={save} disabled={busy || !!problem} data-testid="pm-save">{busy ? "بيتسجل…" : isIn ? "سجّل المساهمة" : "سجّل السحب"}</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
          {problem && amount !== "" && <span className="text-xs text-muted-foreground mr-auto" data-testid="pm-problem">{problem}</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
