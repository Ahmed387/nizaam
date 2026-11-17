import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { choosable, loadAllPaymentMethods, type PaymentMethodOption } from "@/lib/paymentMethods";
import { VesselAccountSelect, useHasVesselAccounts } from "@/components/payments/VesselAccountSelect";
import { capitalOfBranch, capitalProblem, vesselBalance, type CapitalRow } from "@/lib/branchCapital";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatEGP } from "@/lib/format";
import { rpcErrorText } from "@/lib/rpcError";

type Branch = { id: string; name: string; code: string };
export type CapitalMode = "allocate" | "out";

/**
 * «تحويل رأس مال» (partners' treasury → a branch) and «رجّع / انقل رأس مال» (a branch → the partners' treasury or
 * another branch), migration 0250: one vessel on both sides, the accounts when the vessel has some (required),
 * a branch gives back its capital only (never more), the vessel must hold the amount.
 */
export function CapitalMoveDialog({ mode, open, onClose, onDone, branches, partnerId, rows }: {
  mode: CapitalMode; open: boolean; onClose: () => void; onDone: () => void;
  branches: Branch[]; partnerId: string | null; rows: CapitalRow[];
}) {
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(cairoTodayDay());
  const [notes, setNotes] = useState("");
  const [fromAcc, setFromAcc] = useState("");
  const [toAcc, setToAcc] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const needsAccounts = useHasVesselAccounts(method);

  useEffect(() => {
    loadAllPaymentMethods().then((m) => setMethods(m.filter((x) => choosable(x) && x.kind !== "virtual"))).catch(() => setMethods([]));
  }, []);
  useEffect(() => {
    if (!open) return;
    setFrom(mode === "allocate" ? partnerId ?? "" : ""); setTo(mode === "out" ? partnerId ?? "" : "");
    setMethod("cash"); setAmount(""); setDate(cairoTodayDay()); setNotes(""); setFromAcc(""); setToAcc("");
  }, [open, mode, partnerId]);

  const src = from;
  useEffect(() => {
    setBalance(null);
    if (!src) return;
    let off = false;
    fetchAllRows<any>(() => (supabase.from("treasury") as any).select("id,type,amount,payment_method").eq("branch_id", src).order("id"))
      .then((t) => { if (!off) setBalance(vesselBalance(t ?? [], method)); })
      .catch(() => { if (!off) setBalance(0); });
    return () => { off = true; };
  }, [src, method]);

  const fromIsPartners = from === partnerId;
  const capital = useMemo(() => (from && !fromIsPartners ? capitalOfBranch(rows, from) : 0), [rows, from, fromIsPartners]);
  const nameOf = (id: string) => (id === partnerId ? "خزينة الشركاء" : branches.find((b) => b.id === id)?.name ?? "—");
  const amt = Number(amount || 0);
  const problem = capitalProblem({
    from, to, amount: amt, capital, balance: balance ?? Infinity, needsAccounts,
    fromAccount: needsAccounts ? fromAcc : "", toAccount: needsAccounts ? toAcc : "", fromIsPartners,
  });

  const save = async () => {
    if (problem) return toast.error(problem);
    setSaving(true);
    const acc = needsAccounts ? { p_from_account: fromAcc, p_to_account: toAcc } : {};
    const { error } = mode === "allocate"
      ? await (supabase.rpc as any)("allocate_branch_capital", {
          p_branch: to, p_amount: amt, p_date: date, p_notes: notes || null, p_method: method, ...acc })
      : await (supabase.rpc as any)("move_branch_capital", {
          p_from: from, p_to: to === partnerId ? null : to, p_amount: amt, p_date: date, p_method: method, p_notes: notes || null, ...acc });
    setSaving(false);
    if (error) return toast.error(rpcErrorText(error, "رأس المال"));
    toast.success(`اتنقل ${formatEGP(amt)} من «${nameOf(from)}» لـ «${nameOf(to)}»`);
    onDone(); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>{mode === "allocate" ? "تحويل رأس مال لفرع" : "رجّع / انقل رأس مال"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          {mode === "out" && (
            <div>
              <Label>من فرع *</Label>
              <Select value={from} onValueChange={(v) => { setFrom(v); if (to === v) setTo(partnerId ?? ""); }}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختار الفرع" /></SelectTrigger>
                <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
              {from && <div className="mt-1 text-xs text-muted-foreground">رأس ماله الحالي: <b>{formatEGP(capital)}</b> — ده أقصى حاجة تطلع منه</div>}
            </div>
          )}
          <div>
            <Label>{mode === "allocate" ? "للفرع *" : "رايح فين *"}</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختار" /></SelectTrigger>
              <SelectContent>
                {mode === "out" && partnerId && <SelectItem value={partnerId}>يرجع لخزينة الشركاء</SelectItem>}
                {branches.filter((b) => b.id !== from).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{mode === "out" ? `ينتقل لفرع ${b.name}` : b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>الوعاء (نفس الوعاء في الناحيتين) *</Label>
            <Select value={method} onValueChange={(v) => { setMethod(v); setFromAcc(""); setToAcc(""); }}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>{methods.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
            {from && <div className="mt-1 text-xs text-muted-foreground">المتاح في «{nameOf(from)}» على الوعاء ده: <b>{balance === null ? "..." : formatEGP(balance)}</b></div>}
          </div>
          {needsAccounts && (
            <div className="grid sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">الحساب اللي هيتحول منه *</Label>
                <VesselAccountSelect sending method={method} value={fromAcc} onChange={setFromAcc} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">الحساب اللي هيوصل عليه *</Label>
                <VesselAccountSelect method={method} value={toAcc} onChange={setToAcc} className="mt-1" />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>المبلغ *</Label>
              <Input type="number" min={0} step="0.01" dir="ltr" className="mt-1.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>التاريخ</Label>
              <Input type="date" className="mt-1.5" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Textarea rows={2} className="mt-1.5" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {amt > 0 && from && to && !problem && (
            <div className="rounded-lg border-r-4 border-primary bg-primary/5 p-2.5 leading-7">
              هيطلع <b>{formatEGP(amt)}</b> من «{nameOf(from)}» ويدخل «{nameOf(to)}» على نفس الوعاء.
              {!fromIsPartners && <> رأس مال «{nameOf(from)}» يبقى <b>{formatEGP(capital - amt)}</b>.</>}
              <div className="text-xs text-muted-foreground">مش إيراد ولا مصروف — الربح ما بيتغيرش.</div>
            </div>
          )}
          {amt > 0 && problem && <div className="text-xs text-destructive font-semibold">{problem}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>رجوع</Button>
          <Button className="btn-gradient" onClick={save} disabled={saving || !!problem}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
