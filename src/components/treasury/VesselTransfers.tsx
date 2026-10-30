import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/components/DataTable";
import { useAuth } from "@/contexts/AuthContext";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatDate, formatEGP } from "@/lib/format";
import { rpcErrorText } from "@/lib/rpcError";
import { loadAllPaymentMethods, vesselTransferFee, type PaymentMethodOption } from "@/lib/paymentMethods";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Repeat } from "lucide-react";
import { toast } from "sonner";

type FeeMode = "none" | "fixed" | "percent";

/**
 * «تحويل بين الأوعية» (migration 0139): money moves between two vessels of ONE branch (cash ↔ wallet ↔ bank ↔ PayMob …).
 * The owner decides the fee each time — none, a fixed amount or a percentage — and the fee is an expense.
 * Server: `transfer_between_vessels` / `cancel_vessel_transfer` (cancel = both rows and the fee reversed on its own day).
 */
export function VesselTransferButton({ branchId, onDone }: { branchId: string; onDone?: () => void }) {
  const { isAdmin, hasRole } = useAuth();
  const canBackdate = isAdmin || hasRole("owner");
  const [open, setOpen] = useState(false);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [from, setFrom] = useState("vodafone");
  const [to, setTo] = useState("cash");
  const [amount, setAmount] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>("none");
  const [feeValue, setFeeValue] = useState("");
  const [date, setDate] = useState(cairoTodayDay());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) loadAllPaymentMethods(true).then((m) => setMethods(m.filter((x) => x.is_enabled))); }, [open]);
  const label = (k: string) => methods.find((m) => m.value === k)?.label ?? k;
  const fee = vesselTransferFee(Number(amount) || 0, feeMode, Number(feeValue) || 0);

  const submit = async () => {
    const a = Number(amount);
    if (!(a > 0)) return toast.error("اكتب المبلغ");
    if (from === to) return toast.error("اختار وعاءين مختلفين");
    setSaving(true);
    const { error } = await supabase.rpc("transfer_between_vessels" as any, {
      p_branch: branchId, p_from: from, p_to: to, p_amount: a, p_fee_mode: feeMode, p_fee_value: Number(feeValue) || 0,
      p_date: date || null, p_notes: notes.trim() || null,
    } as any);
    setSaving(false);
    if (error) return toast.error(rpcErrorText(error, "التحويل بين الأوعية"));
    toast.success(`اتحول ${formatEGP(a)} من ${label(from)} إلى ${label(to)}${fee > 0 ? ` — العمولة ${formatEGP(fee)} مصروف` : ""}`);
    setOpen(false); setAmount(""); setFeeMode("none"); setFeeValue(""); setNotes(""); setDate(cairoTodayDay());
    onDone?.();
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><Repeat className="w-4 h-4 ml-1" /> تحويل بين الأوعية</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>تحويل بين أوعية الفرع</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>من</Label>
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>{methods.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>إلى</Label>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>{methods.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>المبلغ</Label><Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5" /></div>
            <div>
              <Label>العمولة</Label>
              <div className="mt-1.5 flex gap-2">
                {([["none", "من غير عمولة"], ["fixed", "مبلغ ثابت"], ["percent", "نسبة %"]] as [FeeMode, string][]).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setFeeMode(k)}
                    className={`flex-1 rounded border px-2 py-1.5 text-xs ${feeMode === k ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>{l}</button>
                ))}
              </div>
              {feeMode !== "none" && (
                <Input type="number" min={0} step="0.01" value={feeValue} onChange={(e) => setFeeValue(e.target.value)} className="mt-2"
                  placeholder={feeMode === "percent" ? "النسبة %" : "المبلغ بالجنيه"} />
              )}
            </div>
            {canBackdate && <div><Label>التاريخ</Label><Input type="date" value={date} max={cairoTodayDay()} onChange={(e) => setDate(e.target.value)} className="mt-1.5" /></div>}
            <div><Label>ملاحظات</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" /></div>
            {Number(amount) > 0 && from !== to && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 leading-6">
                {label(from)} هيقل <b>{formatEGP(Number(amount) + fee)}</b>، و{label(to)} هيزيد <b>{formatEGP(Number(amount))}</b>.
                {fee > 0 && <> العمولة <b>{formatEGP(fee)}</b> هتتسجل مصروف «عمولات تحويل».</>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>رجوع</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "..." : "تحويل"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VesselTransfersTable({ branchId, canCancel }: { branchId: string; canCancel: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [cancelRow, setCancelRow] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const load = () =>
    (supabase.from("vessel_transfers" as any) as any).select("*").eq("branch_id", branchId).order("transfer_date", { ascending: false }).limit(500)
      .then(({ data }: any) => setRows(data ?? []));
  useEffect(() => { load(); loadAllPaymentMethods().then((m) => setLabels(Object.fromEntries(m.map((x) => [x.value, x.label])))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [branchId]);
  useRealtimeRefresh(["vessel_transfers"], load);
  const lb = (k: string) => labels[k] ?? k;
  const total = useMemo(() => rows.filter((r) => r.status === "active").reduce((s, r) => s + Number(r.fee_amount || 0), 0), [rows]);

  const doCancel = async () => {
    if (!reason.trim()) return toast.error("اكتب سبب الإلغاء");
    const { error } = await supabase.rpc("cancel_vessel_transfer" as any, { p_id: cancelRow.id, p_reason: reason.trim() } as any);
    if (error) return toast.error(rpcErrorText(error, "إلغاء التحويل"));
    toast.success("اتلغى التحويل في يومه");
    setCancelRow(null); setReason(""); load();
  };

  return (
    <div className="space-y-2">
      {total > 0 && <div className="text-xs text-muted-foreground">إجمالي عمولات التحويل بين الأوعية: <b className="text-warning">{formatEGP(total)}</b></div>}
      <DataTable rows={rows} empty="مفيش تحويلات بين الأوعية"
        columns={[
          { key: "transfer_date", header: "التاريخ", render: (r: any) => formatDate(r.transfer_date) },
          { key: "from_method", header: "من", render: (r: any) => lb(r.from_method) },
          { key: "to_method", header: "إلى", render: (r: any) => lb(r.to_method) },
          { key: "amount", header: "المبلغ", render: (r: any) => <b>{formatEGP(r.amount)}</b> },
          { key: "fee_amount", header: "العمولة (مصروف)", render: (r: any) => Number(r.fee_amount) > 0 ? <span className="text-warning">{formatEGP(r.fee_amount)}</span> : "—" },
          { key: "notes", header: "ملاحظات", render: (r: any) => r.notes ?? "—" },
          { key: "status", header: "الحالة", render: (r: any) => r.status === "cancelled"
              ? <span className="text-xs text-destructive" title={r.cancel_reason ?? ""}>ملغي{r.cancel_reason ? ` — ${r.cancel_reason}` : ""}</span>
              : <span className="text-xs text-success">تم</span> },
          { key: "actions", header: "", render: (r: any) => canCancel && r.status === "active"
              ? <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelRow(r)}>إلغاء</Button> : null },
        ]} />
      <Dialog open={!!cancelRow} onOpenChange={(o) => { if (!o) setCancelRow(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>إلغاء التحويل بين الأوعية</DialogTitle></DialogHeader>
          {cancelRow && <p className="text-sm text-muted-foreground leading-6">
            هيرجع {formatEGP(cancelRow.amount)} من {lb(cancelRow.to_method)} إلى {lb(cancelRow.from_method)}
            {Number(cancelRow.fee_amount) > 0 ? ` والعمولة ${formatEGP(cancelRow.fee_amount)}` : ""} في يوم التحويل نفسه.
          </p>}
          <div><Label>سبب الإلغاء *</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelRow(null)}>رجوع</Button>
            <Button variant="destructive" onClick={doCancel}>إلغاء التحويل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
