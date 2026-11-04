import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatEGP } from "@/lib/format";
import { loadAllPaymentMethods, type PaymentMethodOption } from "@/lib/paymentMethods";
import {
  fetchMoneyBranches, partnerMoney, partnerMoneyProblem, splitWithdrawal, withdrawalSentence,
  type PartnerCards, type WithdrawSource,
} from "@/lib/partners";

/**
 * «مساهمة» / «سحب» (0137): the owner picks the branch, the vessel and the day; the money moves in THAT till.
 * A withdrawal is «من رأس المال» / «من الربح» / «جزء من ده وجزء من ده»; above his profit it becomes an advance by itself.
 */
export function PartnerMoneyDialog({ kind, cards, onClose, onDone }: {
  kind: "contribution" | "withdrawal";
  cards: PartnerCards;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = cairoTodayDay();
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [source, setSource] = useState<WithdrawSource>("profit");
  const [capitalPart, setCapitalPart] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMoneyBranches().then(setBranches).catch(() => setBranches([]));
    loadAllPaymentMethods().then((m) => setMethods(m.filter((x) => x.is_enabled !== false))).catch(() => setMethods([]));
  }, []);

  const amt = Number(amount || 0);
  const split = useMemo(() => splitWithdrawal(amt, source, Number(capitalPart || 0), cards), [amt, source, capitalPart, cards]);
  const name = cards.partner.name;

  const save = async () => {
    const problem = partnerMoneyProblem({ kind, amount: amt, branchId, date, today, source, capitalPart: Number(capitalPart || 0), cards });
    if (problem) return toast.error(problem);
    setBusy(true);
    try {
      const r = await partnerMoney({ partnerId: cards.partner.id, kind, amount: amt, source, capitalPart: Number(capitalPart || 0),
        branchId: branchId!, method, date, notes });
      toast.success(kind === "contribution"
        ? `اتسجلت مساهمة ${formatEGP(amt)} لـ ${name}`
        : `اتسجل سحب ${formatEGP(amt)}: ${withdrawalSentence(r)}`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{kind === "contribution" ? `مساهمة في رأس المال — ${name}` : `سحب — ${name}`}</DialogTitle>
          <DialogDescription>
            {kind === "contribution"
              ? "الفلوس بتدخل خزنة الفرع اللي هتختاره، في الوعاء والتاريخ اللي تختارهم، ورأس ماله بيزيد بيها."
              : `رأس ماله ${formatEGP(cards.capital)} • صافي ربحه ${formatEGP(cards.profit)} • سلف ${formatEGP(cards.advances)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>المبلغ</Label>
              <Input type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div>
              <Label>التاريخ</Label>
              <Input type="date" value={date} min="2026-01-01" max={today} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{kind === "contribution" ? "تدخل خزنة فرع" : "تطلع من خزنة فرع"}</Label>
              <Select value={branchId ?? ""} onValueChange={setBranchId}>
                <SelectTrigger><SelectValue placeholder="اختار الفرع" /></SelectTrigger>
                <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>الوعاء</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(methods.length ? methods : [{ value: "cash", label: "نقدي" } as PaymentMethodOption]).map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {kind === "withdrawal" && (
            <div className="rounded-lg border p-3 space-y-2">
              <Label>السحب ده من إيه؟</Label>
              <RadioGroup value={source} onValueChange={(v) => setSource(v as WithdrawSource)} className="grid gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="profit" /> من الربح <span className="text-xs text-muted-foreground">(اللي فوق ربحه بيبقى سلفة لوحده)</span></label>
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="capital" /> من رأس المال</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="split" /> جزء من رأس المال والباقي من الربح</label>
              </RadioGroup>
              {source === "split" && (
                <div className="max-w-xs">
                  <Label className="text-xs">جزء رأس المال</Label>
                  <Input type="number" inputMode="decimal" min={0} value={capitalPart} onChange={(e) => setCapitalPart(e.target.value)} />
                </div>
              )}
              {amt > 0 && (
                <div className={`text-sm rounded-md p-2 ${split.advance > 0 ? "bg-warning/10 text-warning" : "bg-muted"}`}>
                  هيتسجل: {withdrawalSentence(split) || "—"}
                </div>
              )}
            </div>
          )}

          <div>
            <Label>ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save} disabled={busy}>{kind === "contribution" ? "سجّل المساهمة" : "سجّل السحب"}</Button>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
