import { useEffect, useMemo, useState } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatEGP } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  balanceAfter, balanceText, branchesWithBalance, directionAllowed, fetchContactSettlements, fetchSettleInfo, overBalance,
  settleContactWithoutMoney, settleDirections, settleEffect, settleProblem, sideNet,
  type BranchBalance, type ContactSettlement, type SettleDirection, type SettleSide,
} from "@/lib/contactSettlement";
import { BranchBalancePick, ChoiceCards, SettlementList } from "./SettlementList";

type Props = { contactId: string; contactName: string; side: SettleSide; sides: SettleSide[]; defaultBranch: string | null; onDone?: () => void };

/**
 * «تسوية رصيد بدون فلوس» in the contact file — owner only (0148, safety 0291). Lowers his balance against «أرباح السنين
 * اللي فاتت» without moving a real till. 0291: only a branch where that side has a balance, only the direction that
 * matches it, and an amount above it asks the owner «لحد الصفر بس» or «كمّل ويقلب».
 */
export function SettleWithoutMoneyButton(p: Props) {
  const { isOwner } = useAuth();
  const [open, setOpen] = useState(false);
  if (!isOwner) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><Scale className="w-4 h-4 ml-1" /> تسوية رصيد بدون فلوس</Button>
      {open && <SettleWithoutMoneyDialog {...p} open={open} onOpenChange={setOpen} />}
    </>
  );
}

export function SettleWithoutMoneyDialog({ contactId, contactName, side, sides, defaultBranch, onDone, open, onOpenChange }: Props & {
  open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const [sd, setSd] = useState<SettleSide>(side);
  const [direction, setDirection] = useState<SettleDirection | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(cairoTodayDay());
  const [reason, setReason] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<BranchBalance[] | null>(null);
  const [list, setList] = useState<ContactSettlement[]>([]);

  const load = () => {
    fetchSettleInfo(contactId).then(setInfo).catch(() => setInfo([]));
    fetchContactSettlements(contactId).then(setList).catch(() => setList([]));
  };
  useEffect(() => { if (open) load(); }, [open, contactId]);

  const withBal = useMemo(() => branchesWithBalance(info ?? [], sd), [info, sd]);
  const net = sideNet(info ?? [], branchId, sd);
  const amt = Number(amount) || 0;
  const isOver = !!direction && amt > 0 && overBalance(net, amt);
  const effect = settleEffect(sd, direction, amt);

  // pick a branch with a balance and the direction that matches it
  useEffect(() => {
    if (!info) return;
    const keep = withBal.find((b) => b.branch_id === branchId) ?? withBal.find((b) => b.branch_id === defaultBranch) ?? withBal[0];
    const id = keep?.branch_id ?? null;
    if (id !== branchId) setBranchId(id);
    const n = sideNet(info, id, sd);
    const ok = settleDirections(sd).find((d) => directionAllowed(sd, d.value, n));
    setDirection(ok?.value ?? null);
  }, [info, sd, branchId]);
  useEffect(() => { setOver(null); }, [amount, branchId, sd, direction]);

  const branchName = (id: string) => (info ?? []).find((b) => b.branch_id === id)?.branch ?? "—";

  const save = async () => {
    const input = { branchId, side: sd, direction, amount: amt, date, reason };
    const problem = settleProblem(input, cairoTodayDay());
    if (problem) return toast.error(problem);
    if (direction && !directionAllowed(sd, direction, net)) return toast.error("الاتجاه ده عكس رصيده في الفرع ده");
    if (isOver && !over) return toast.error("المبلغ أكبر من رصيده — اختار: لحد الصفر بس ولا كمّل ويقلب");
    const send = isOver && over === "zero" ? { ...input, amount: Math.abs(net) } : input;
    setBusy(true);
    try {
      const res = await settleContactWithoutMoney(contactId, send, isOver && over === "flip");
      toast.success(`اتسجلت التسوية ${res?.settlement_number ?? ""} — ${settleEffect(sd, direction, send.amount).split(" — ")[0]}`);
      setAmount(""); setReason("");
      load(); onDone?.();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر تسجيل التسوية");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="swm-dialog">
        <DialogHeader>
          <DialogTitle>تسوية رصيد {contactName} بدون فلوس</DialogTitle>
          <DialogDescription>
            الرصيد بيقل على «أرباح السنين اللي فاتت». مفيش فلوس بتدخل أو تطلع من أي خزنة، وربح 2026 ما بيتغيرش.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {sides.length > 1 && (
            <div className="flex gap-2">
              {sides.map((s) => (
                <Button key={s} size="sm" variant={sd === s ? "default" : "outline"} data-testid={`swm-side-${s}`} onClick={() => setSd(s)}>
                  {s === "customer" ? "حساب العميل" : "حساب المورد"}
                </Button>
              ))}
            </div>
          )}

          {info === null ? <div className="text-muted-foreground">بيحمّل الرصيد…</div>
            : withBal.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-center text-muted-foreground" data-testid="swm-empty">
                مفيش رصيد على حساب ال{sd === "customer" ? "عميل" : "مورد"} في أي فرع — مفيش حاجة تتسوّى.
              </div>
            ) : (
              <>
                <div>
                  <Label>الفرع (اللي ليه فيه رصيد بس)</Label>
                  <div className="mt-1">
                    <BranchBalancePick prefix="swm" value={branchId} onPick={setBranchId} text={(n) => balanceText(sd, n)}
                      items={withBal.map((b) => ({ id: b.branch_id, name: b.branch, net: Number(b[sd]) }))} />
                  </div>
                </div>
                <div className="space-y-2" role="radiogroup">
                  {settleDirections(sd).map((d) => {
                    const ok = directionAllowed(sd, d.value, net);
                    return (
                      <button key={d.value} type="button" role="radio" aria-checked={direction === d.value} disabled={!ok}
                        data-testid={`swm-dir-${d.value}`} onClick={() => ok && setDirection(d.value)}
                        className={cn("w-full text-right rounded-md border p-2 transition-colors",
                          direction === d.value ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted",
                          !ok && "opacity-50 cursor-not-allowed hover:bg-background")}>
                        <div className="font-semibold">{d.label}</div>
                        {!ok && <div className="text-xs text-muted-foreground">مش متاح — رصيده {balanceText(sd, net)}</div>}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>المبلغ</Label>
                    <Input type="number" inputMode="decimal" className="mt-1" data-testid="swm-amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div>
                    <Label>التاريخ</Label>
                    <Input type="date" className="mt-1" value={date} min="2026-01-01" max={cairoTodayDay()} onChange={(e) => setDate(e.target.value)} />
                  </div>
                </div>
                {isOver && (
                  <div className="rounded-md border border-warning/50 bg-warning/5 p-2 space-y-2" data-testid="swm-over">
                    <div className="font-semibold">المبلغ {formatEGP(amt)} أكبر من رصيده ({balanceText(sd, net)}) — انت تقرر:</div>
                    <ChoiceCards prefix="swm-over" value={over} onPick={setOver} options={[
                      { value: "zero", title: `سوّي لحد الصفر بس (${formatEGP(Math.abs(net))})`, note: "رصيده يبقى صفر، والباقي ما يتسجلش." },
                      { value: "flip", title: `كمّل بـ ${formatEGP(amt)} ويقلب`, note: `رصيده يبقى ${balanceText(sd, balanceAfter(net, amt))}.` },
                    ]} />
                  </div>
                )}
                <div>
                  <Label>السبب</Label>
                  <Textarea rows={2} className="mt-1" data-testid="swm-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                {effect && !isOver && (
                  <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs" data-testid="swm-effect">
                    {effect} — رصيده يبقى {balanceText(sd, balanceAfter(net, amt))}.
                  </div>
                )}
              </>
            )}
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save} disabled={busy || !withBal.length} data-testid="swm-save">سجّل التسوية</Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>رجوع</Button>
        </DialogFooter>

        <SettlementList list={list} branchName={branchName} onChanged={() => { load(); onDone?.(); }} />
      </DialogContent>
    </Dialog>
  );
}
