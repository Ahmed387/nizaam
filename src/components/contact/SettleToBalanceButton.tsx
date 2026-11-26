import { useEffect, useMemo, useState } from "react";
import { TrendingUpDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatEGP } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  balanceText, branchesWithBalance, fetchContactSettlements, fetchSettleInfo, settleContactToBalance, sideNet,
  toBalanceEffect, toBalanceProblem, toBalanceResult, type BranchBalance, type ContactSettlement, type SettleSide,
} from "@/lib/contactSettlement";
import { BranchBalancePick, ChoiceCards, SettlementList } from "./SettlementList";

type Props = { contactId: string; contactName: string; side: SettleSide; sides: SettleSide[]; defaultBranch: string | null; onDone?: () => void };

/**
 * «تسوية برصيد — الفرق ربح أو خسارة» (0291, owner 2026-11-26 «والسالب ينزل خسارة»، «(أ) الـ 1,100 تتسجل ربح»).
 * The owner types the balance the account should have in a branch; the difference is a 2026 loss («خسائر تسوية أرصدة»)
 * or gain («إيرادات أخرى») in the settlement's month. Two vouchers in the book vessel, real tills never move.
 * Example: كريم عاطف عليه 3,600 → «اتفقنا على 2,000» → خسارة 1,600 في نوفمبر.
 */
export function SettleToBalanceButton(p: Props) {
  const { isOwner } = useAuth();
  const [open, setOpen] = useState(false);
  if (!isOwner) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="stb-open">
        <TrendingUpDown className="w-4 h-4 ml-1" /> تسوية برصيد (ربح / خسارة)
      </Button>
      {open && <SettleToBalanceDialog {...p} open={open} onOpenChange={setOpen} />}
    </>
  );
}

export function SettleToBalanceDialog({ contactId, contactName, side, sides, defaultBranch, onDone, open, onOpenChange }: Props & {
  open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const [sd, setSd] = useState<SettleSide>(side);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [otherSide, setOtherSide] = useState(false);
  const [date, setDate] = useState(cairoTodayDay());
  const [reason, setReason] = useState("");
  const [flip, setFlip] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<BranchBalance[] | null>(null);
  const [list, setList] = useState<ContactSettlement[]>([]);

  const load = () => {
    fetchSettleInfo(contactId).then(setInfo).catch(() => setInfo([]));
    fetchContactSettlements(contactId).then(setList).catch(() => setList([]));
  };
  useEffect(() => { if (open) load(); }, [open, contactId]);

  const withBal = useMemo(() => branchesWithBalance(info ?? [], sd), [info, sd]);
  useEffect(() => {
    if (!info) return;
    const keep = withBal.find((b) => b.branch_id === branchId) ?? withBal.find((b) => b.branch_id === defaultBranch) ?? withBal[0];
    if ((keep?.branch_id ?? null) !== branchId) setBranchId(keep?.branch_id ?? null);
  }, [info, sd, branchId]);

  const net = sideNet(info ?? [], branchId, sd);
  const typed = amount.trim() === "" ? NaN : Math.abs(Number(amount));
  // the typed balance sits on his side unless the owner ticked «الناحية التانية»
  const target = Number.isFinite(typed) ? (otherSide ? -1 : 1) * Math.sign(net || 1) * typed : NaN;
  const res = Number.isFinite(target) ? toBalanceResult(sd, net, target) : null;
  const flips = !!res?.flips;
  const sendTarget = flips && flip === "zero" ? 0 : target;
  const effect = Number.isFinite(sendTarget) ? toBalanceEffect(sd, net, sendTarget, date) : "";
  const effRes = Number.isFinite(sendTarget) ? toBalanceResult(sd, net, sendTarget) : null;
  useEffect(() => { setFlip(null); }, [amount, otherSide, branchId, sd]);

  const branchName = (id: string) => (info ?? []).find((b) => b.branch_id === id)?.branch ?? "—";
  const sideWords = (s: SettleSide, positive: boolean) =>
    s === "customer" ? (positive ? "عليه" : "ليه عندنا") : (positive ? "علينا ليه" : "عليه لينا");

  const save = async () => {
    const problem = toBalanceProblem({ branchId, net, target: sendTarget, date, reason }, cairoTodayDay());
    if (problem) return toast.error(problem);
    if (flips && !flip) return toast.error("الرصيد اللي كتبته في الناحية التانية — اختار: صفّر بس ولا كمّل ويقلب");
    setBusy(true);
    try {
      const r = await settleContactToBalance(contactId, { branchId: branchId!, side: sd, target: sendTarget, date, reason }, flips && flip === "flip");
      toast.success(`اتسجلت التسوية ${r?.settlement_number ?? ""} — ${r?.result === "gain" ? "ربح" : "خسارة"} ${formatEGP(r?.amount ?? 0)}`);
      setAmount(""); setReason(""); setOtherSide(false);
      load(); onDone?.();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر تسجيل التسوية");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="stb-dialog">
        <DialogHeader>
          <DialogTitle>تسوية رصيد {contactName} برصيد متفق عليه</DialogTitle>
          <DialogDescription>
            اكتب الرصيد اللي اتفقتوا عليه. الفرق بيتسجل ربح أو خسارة في شهر التسوية. مفيش فلوس بتدخل أو تطلع من أي خزنة.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {sides.length > 1 && (
            <div className="flex gap-2">
              {sides.map((s) => (
                <Button key={s} size="sm" variant={sd === s ? "default" : "outline"} data-testid={`stb-side-${s}`} onClick={() => setSd(s)}>
                  {s === "customer" ? "حساب العميل" : "حساب المورد"}
                </Button>
              ))}
            </div>
          )}

          {info === null ? <div className="text-muted-foreground">بيحمّل الرصيد…</div>
            : withBal.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-center text-muted-foreground" data-testid="stb-empty">
                مفيش رصيد على حساب ال{sd === "customer" ? "عميل" : "مورد"} في أي فرع — مفيش حاجة تتسوّى.
              </div>
            ) : (
              <>
                <div>
                  <Label>الفرع (اللي ليه فيه رصيد بس)</Label>
                  <div className="mt-1">
                    <BranchBalancePick prefix="stb" value={branchId} onPick={setBranchId} text={(n) => balanceText(sd, n)}
                      items={withBal.map((b) => ({ id: b.branch_id, name: b.branch, net: Number(b[sd]) }))} />
                  </div>
                </div>
                <div>
                  <Label>الرصيد اللي اتفقتوا عليه</Label>
                  <div className="mt-1 flex gap-2">
                    <Input type="number" inputMode="decimal" min={0} data-testid="stb-target" value={amount} placeholder={String(Math.abs(net))}
                      onChange={(e) => setAmount(e.target.value)} />
                    <Button type="button" variant="outline" data-testid="stb-zero" onClick={() => { setAmount("0"); setOtherSide(false); }}>صفّر الرصيد</Button>
                  </div>
                  <div className="mt-2 flex gap-2" role="radiogroup">
                    {[false, true].map((o) => (
                      <button key={String(o)} type="button" role="radio" aria-checked={otherSide === o} data-testid={`stb-way-${o ? "other" : "same"}`}
                        onClick={() => setOtherSide(o)}
                        className={cn("rounded-md border px-3 py-1 text-xs",
                          otherSide === o ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>
                        {sideWords(sd, o ? net < 0 : net > 0)}
                      </button>
                    ))}
                  </div>
                </div>
                {flips && (
                  <div className="rounded-md border border-warning/50 bg-warning/5 p-2 space-y-2" data-testid="stb-flip">
                    <div className="font-semibold">الرصيد اللي كتبته في الناحية التانية من رصيده ({balanceText(sd, net)}) — انت تقرر:</div>
                    <ChoiceCards prefix="stb-flip" value={flip} onPick={setFlip} options={[
                      { value: "zero", title: "صفّر بس", note: `الفرق ${formatEGP(Math.abs(net))} ويبقى رصيده صفر.` },
                      { value: "flip", title: "كمّل ويقلب", note: `يبقى رصيده ${balanceText(sd, target)} — الفرق ${formatEGP(res?.amount ?? 0)}.` },
                    ]} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>التاريخ</Label>
                    <Input type="date" className="mt-1" value={date} min="2026-01-01" max={cairoTodayDay()} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>السبب</Label>
                    <Input className="mt-1" data-testid="stb-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                </div>
                {effect && (!flips || flip) && (
                  <div data-testid="stb-effect"
                    className={cn("rounded-md border p-2 text-xs",
                      effRes?.result === "loss" ? "border-destructive/40 bg-destructive/5" : "border-success/40 bg-success/5")}>
                    {effect}
                  </div>
                )}
              </>
            )}
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save} disabled={busy || !withBal.length} data-testid="stb-save">سجّل التسوية</Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>رجوع</Button>
        </DialogFooter>

        <SettlementList list={list} branchName={branchName} onChanged={() => { load(); onDone?.(); }} />
      </DialogContent>
    </Dialog>
  );
}
