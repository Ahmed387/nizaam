import { useEffect, useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PaymentMethodPicker, emptyPaymentValue, PaymentMethodValue } from "./PaymentMethodPicker";
import { fetchVoucherCategories, VoucherCategory, VoucherType, PARTY_TYPE_LABEL, VoucherPartyType } from "@/lib/vouchers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string;
  type: VoucherType;
  onSuccess?: () => void;
}

export function VoucherDialog({ open, onOpenChange, branchId, type, onSuccess }: Props) {
  const [cats, setCats] = useState<VoucherCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    category_id: "",
    amount: "",
    party_type: "" as "" | VoucherPartyType,
    party_name: "",
    description: "",
    voucher_date: new Date().toISOString().slice(0, 10),
  });
  const [pm, setPm] = useState<PaymentMethodValue>(emptyPaymentValue());

  useEffect(() => {
    if (!open) return;
    fetchVoucherCategories(type).then(setCats).catch((e) => toast.error(e.message));
    setForm({
      category_id: "",
      amount: "",
      party_type: "",
      party_name: "",
      description: "",
      voucher_date: new Date().toISOString().slice(0, 10),
    });
    setPm(emptyPaymentValue());
  }, [open, type]);

  // System categories produced automatically by other flows — hide from manual dialog
  const AUTO_KEYS = new Set([
    "advance", "salary", "supplier_payment", "cash_sale", "installment",
    "customer_return", "transfer_fee", "branch_transfer_in", "branch_transfer_out",
    "shipping",
  ]);
  const grouped = useMemo(() => {
    const visible = cats.filter((c) => !c.system_key || !AUTO_KEYS.has(c.system_key));
    const roots = visible.filter((c) => !c.parent_id);
    return roots.map((r) => ({ root: r, children: visible.filter((c) => c.parent_id === r.id) }));
  }, [cats]);

  const submit = async () => {
    const amt = Number(form.amount);
    if (!form.category_id) return toast.error("اختر التصنيف");
    if (!amt || amt <= 0) return toast.error("أدخل مبلغ صحيح");
    if (pm.method !== "cash" && !pm.reference_number?.trim()) return toast.error("أدخل رقم العملية");
    setBusy(true);
    try {
      const { error } = await supabase.rpc("create_manual_voucher" as any, {
        p_branch_id: branchId,
        p_type: type,
        p_category_id: form.category_id,
        p_amount: amt,
        p_payment_method: pm.method,
        p_reference_number: pm.reference_number ?? null,
        p_transferred_to: pm.transfer_to_account ?? null,
        p_fee_amount: pm.fee_amount ?? 0,
        p_party_type: form.party_type || null,
        p_party_id: null,
        p_party_name: form.party_name.trim() || null,
        p_description: form.description.trim() || null,
        p_voucher_date: form.voucher_date,
      });
      if (error) throw error;
      toast.success(type === "receipt" ? "تم حفظ سند القبض" : "تم حفظ سند الصرف");
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      toast.error(e.message ?? "فشل الحفظ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{type === "receipt" ? "سند قبض جديد" : "سند صرف جديد"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>التصنيف *</Label>
            <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
              <SelectContent>
                {grouped.map(({ root, children }) => (
                  <div key={root.id}>
                    <SelectItem value={root.id}>{root.name}</SelectItem>
                    {children.map((c) => (
                      <SelectItem key={c.id} value={c.id}>— {c.name}</SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>المبلغ *</Label>
              <Input type="number" min={0} step="0.01" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>التاريخ</Label>
              <Input type="date" value={form.voucher_date}
                onChange={(e) => setForm({ ...form, voucher_date: e.target.value })} className="mt-1.5" />
            </div>
          </div>

          <PaymentMethodPicker amount={Number(form.amount) || 0} value={pm} onChange={setPm} />

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>الجهة</Label>
              <Select value={form.party_type} onValueChange={(v) => setForm({ ...form, party_type: v as any })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر النوع" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PARTY_TYPE_LABEL) as VoucherPartyType[]).map((k) => (
                    <SelectItem key={k} value={k}>{PARTY_TYPE_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>اسم الجهة</Label>
              <Input value={form.party_name} onChange={(e) => setForm({ ...form, party_name: e.target.value })}
                placeholder={type === "receipt" ? "استُلم من" : "صُرف إلى"} className="mt-1.5" />
            </div>
          </div>

          <div>
            <Label>وصف / ملاحظات</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1.5" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={busy} className="gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} حفظ السند
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
