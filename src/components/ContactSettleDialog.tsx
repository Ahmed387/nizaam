import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
/** An open sale invoice of the contact (remaining from the unified ledger). */
export interface ContactOpenInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  branch_id: string;
  branch_name: string;
  total: number;
  paid: number;
  remaining: number;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contactId: string;
  contactName: string;
  receivingBranchId: string;
  openInvoices: ContactOpenInvoice[];
  onDone: () => void;
}

const METHODS = [
  { value: "cash", label: "نقدي" },
  { value: "instapay", label: "إنستاباي" },
  { value: "vodafone", label: "فودافون كاش" },
  { value: "bank", label: "تحويل بنكي" },
];

/** سداد وإقفال فواتير الجهة عبر الفروع — يستدعي الـ RPC السيادي الذري. */
export function ContactSettleDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  receivingBranchId,
  openInvoices,
  onDone,
}: Props) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const totalOpen = useMemo(
    () => openInvoices.reduce((s, i) => s + Number(i.remaining ?? 0), 0),
    [openInvoices],
  );
  const selectedTotal = useMemo(
    () =>
      openInvoices
        .filter((i) => selected.includes(i.id))
        .reduce((s, i) => s + Number(i.remaining ?? 0), 0),
    [openInvoices, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("اكتب مبلغ صحيح");
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("settle_contact_invoices_sovereign", {
        p_contact_id: contactId,
        p_payment_amount: amt,
        p_payment_method: method,
        p_receiving_branch_id: receivingBranchId,
        p_selected_invoices: selected.length
          ? selected.map((id) => ({ invoice_id: id }))
          : null,
        p_settlement_type: selected.length ? "selected" : "fifo",
      });
      if (error) throw error;
      const res = (data ?? {}) as any;
      const surplus = Number(res.surplus ?? 0);
      toast.success(
        `تم سداد ${res.allocated_count ?? 0} فاتورة بمبلغ ${formatEGP(Number(res.allocated_total ?? 0))}` +
          (surplus > 0 ? ` • الفائض ${formatEGP(surplus)} أُضيف كرصيد دائن للجهة` : ""),
      );
      setAmount("");
      setSelected([]);
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر تنفيذ السداد");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>سداد وإقفال فواتير — {contactName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>المبلغ المستلم *</Label>
              <Input
                dir="ltr"
                className="mt-1.5 text-right"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                إجمالي المتبقي على فواتير العميل في كل الفروع: <b>{formatEGP(totalOpen)}</b>
              </p>
            </div>
            <div>
              <Label>طريقة الدفع *</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-2 text-sm font-bold">
              <span>اختر فواتير معينة (اختياري)</span>
              <span className="text-muted-foreground">
                {selected.length ? `محدد: ${formatEGP(selectedTotal)}` : "بدون اختيار = الأقدم أولاً"}
              </span>
            </div>
            <div className="max-h-56 overflow-y-auto p-2">
              {openInvoices.map((inv) => (
                <label
                  key={inv.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
                >
                  <Checkbox checked={selected.includes(inv.id)} onCheckedChange={() => toggle(inv.id)} />
                  <span className="flex-1 font-semibold">{inv.invoice_number}</span>
                  <span className="text-xs text-muted-foreground">{inv.branch_name}</span>
                  <span className="tabular-nums font-bold">{formatEGP(inv.remaining)}</span>
                </label>
              ))}
              {!openInvoices.length && (
                <div className="p-3 text-center text-sm text-muted-foreground">لا توجد فواتير مفتوحة</div>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            الفلوس بتتسجل في خزنة الفرع ده. أي فائض بعد إقفال الفواتير يفضل مقدم للعميل (حساب العميل بس — مش بيتخصم من حساب المورد)، والعملية كلها تُنفَّذ أو تُلغى بالكامل.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>إلغاء</Button>
          <Button className="btn-gradient" onClick={submit} disabled={busy}>
            {busy ? "جارٍ التنفيذ..." : "سداد وإقفال"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
