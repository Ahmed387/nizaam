import { useEffect, useState } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PermTable } from "@/components/PermTable";
import { useAuth } from "@/contexts/AuthContext";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatDate, formatEGP } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  cancelContactSettlement, fetchContactSettlements, settleContactWithoutMoney, settleDirections, settleEffect, settleProblem,
  type ContactSettlement, type SettleDirection, type SettleSide,
} from "@/lib/contactSettlement";

/**
 * «تسوية رصيد بدون فلوس» in the contact file — owner only (migration 0148). Lowers his balance against «أرباح السنين
 * اللي فاتت» without moving a real till; lists his settlements with «إلغاء» (cancelled on their own day).
 */
export function SettleWithoutMoneyButton({ contactId, contactName, side, sides, defaultBranch, onDone }: {
  contactId: string; contactName: string; side: SettleSide; sides: SettleSide[]; defaultBranch: string | null; onDone?: () => void;
}) {
  const { isOwner, branches } = useAuth();
  const [open, setOpen] = useState(false);
  const [sd, setSd] = useState<SettleSide>(side);
  const [direction, setDirection] = useState<SettleDirection | null>(null);
  const [branchId, setBranchId] = useState<string | null>(defaultBranch);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(cairoTodayDay());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<ContactSettlement[]>([]);
  const [cancelRow, setCancelRow] = useState<ContactSettlement | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const branchList = (branches ?? []).filter((b: any) => !b.is_system);
  const branchName = (id: string) => branchList.find((b: any) => b.id === id)?.name ?? "—";
  const dirs = settleDirections(sd);
  const amt = Number(amount) || 0;
  const effect = settleEffect(sd, direction, amt);

  const load = () => fetchContactSettlements(contactId).then(setList).catch(() => setList([]));
  useEffect(() => { if (open) load(); }, [open, contactId]);

  if (!isOwner) return null;

  const start = () => {
    setSd(side); setDirection(side === "supplier" ? "we_owe_less" : null);
    setBranchId(defaultBranch ?? (branchList.length === 1 ? branchList[0].id : null));
    setAmount(""); setDate(cairoTodayDay()); setReason(""); setOpen(true);
  };

  const save = async () => {
    const input = { branchId, side: sd, direction, amount: amt, date, reason };
    const problem = settleProblem(input, cairoTodayDay());
    if (problem) return toast.error(problem);
    setBusy(true);
    try {
      const res = await settleContactWithoutMoney(contactId, input);
      toast.success(`اتسجلت التسوية ${res?.settlement_number ?? ""} — ${effect.split(" — ")[0]}`);
      setAmount(""); setReason("");
      load(); onDone?.();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر تسجيل التسوية");
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!cancelRow) return;
    if (!cancelReason.trim()) return toast.error("اكتب سبب الإلغاء");
    setBusy(true);
    try {
      await cancelContactSettlement(cancelRow.id, cancelReason);
      toast.success(`اتلغت التسوية ${cancelRow.settlement_number} في يومها`);
      setCancelRow(null); setCancelReason("");
      load(); onDone?.();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر الإلغاء");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={start}><Scale className="w-4 h-4 ml-1" /> تسوية رصيد بدون فلوس</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
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
                  <Button key={s} size="sm" variant={sd === s ? "default" : "outline"}
                    onClick={() => { setSd(s); setDirection(s === "supplier" ? "we_owe_less" : null); }}>
                    {s === "customer" ? "حساب العميل" : "حساب المورد"}
                  </Button>
                ))}
              </div>
            )}
            <div className="space-y-2" role="radiogroup">
              {dirs.map((d) => (
                <button key={d.value} type="button" role="radio" aria-checked={direction === d.value} onClick={() => setDirection(d.value)}
                  className={cn("w-full text-right rounded-md border p-2 transition-colors",
                    direction === d.value ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted")}>
                  <div className="font-semibold">{d.label}</div>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>الفرع</Label>
                <Select value={branchId ?? ""} onValueChange={setBranchId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="اختار الفرع" /></SelectTrigger>
                  <SelectContent>{branchList.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>التاريخ</Label>
                <Input type="date" className="mt-1" value={date} min="2026-01-01" max={cairoTodayDay()} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>المبلغ</Label>
              <Input type="number" inputMode="decimal" className="mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>السبب</Label>
              <Textarea rows={2} className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {effect && <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">{effect}</div>}
          </div>

          <DialogFooter className="gap-2 sm:justify-start">
            <Button onClick={save} disabled={busy}>سجّل التسوية</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>رجوع</Button>
          </DialogFooter>

          {list.length > 0 && (
            <div className="mt-2 border-t pt-3">
              <div className="mb-2 text-sm font-semibold">التسويات اللي اتعملت</div>
              <PermTable className="w-full text-xs">
                <thead><tr><th className="text-right">الرقم</th><th className="text-right">التاريخ</th><th className="text-right">الحساب</th>
                  <th className="text-right">المبلغ</th><th className="text-right">الفرع</th><th className="text-right">الحالة</th><th /></tr></thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} className={cn(s.status === "cancelled" && "text-muted-foreground line-through")}>
                      <td>{s.settlement_number}</td>
                      <td>{formatDate(s.settlement_date)}</td>
                      <td>{s.side === "customer" ? "عميل" : "مورد"} · {s.direction === "he_owes_less" ? "قلّ اللي عليه" : "قلّ اللي علينا"}</td>
                      <td>{formatEGP(s.amount)}</td>
                      <td>{branchName(s.branch_id)}</td>
                      <td>{s.status === "active" ? "شغالة" : "ملغية"}</td>
                      <td>{s.status === "active" && <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => { setCancelRow(s); setCancelReason(""); }}>إلغاء</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </PermTable>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelRow} onOpenChange={(o) => !o && setCancelRow(null)}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>إلغاء التسوية {cancelRow?.settlement_number}</DialogTitle>
            <DialogDescription>الرصيد يرجع زي ما كان، والإلغاء بيتسجل في يوم التسوية نفسه.</DialogDescription>
          </DialogHeader>
          <Textarea rows={2} placeholder="سبب الإلغاء" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          <DialogFooter className="gap-2 sm:justify-start">
            <Button variant="destructive" onClick={doCancel} disabled={busy}>الغيها</Button>
            <Button variant="ghost" onClick={() => setCancelRow(null)}>رجوع</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
