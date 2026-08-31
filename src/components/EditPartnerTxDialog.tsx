import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Tx = {
  id: string;
  transaction_type: string;
  amount: number;
  description: string | null;
  month_year: string | null;
  created_at: string;
  related_voucher_id?: string | null;
  related_treasury_id?: string | null;
};

export function EditPartnerTxDialog({
  tx,
  open,
  onOpenChange,
  onSaved,
}: {
  tx: Tx | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ type: "contribution", amount: "", description: "", month_year: "", date: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tx && open) {
      setForm({
        type: tx.transaction_type,
        amount: String(tx.amount),
        description: tx.description || "",
        month_year: tx.month_year || "",
        date: tx.created_at ? new Date(tx.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      });
    }
  }, [tx, open]);

  const save = async () => {
    if (!tx) return;
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return toast.error("المبلغ غير صحيح");
    // الشهر بيتولد برمجياً من التاريخ عشان الـ payload يفضل مكتمل
    const baseDate = form.date ? new Date(form.date + "T12:00:00") : new Date();
    const monthStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, "0")}`;
    setSaving(true);
    const { error } = await supabase.rpc("edit_partner_transaction" as any, {
      _tx_id: tx.id,
      _transaction_type: form.type,
      _amount: amt,
      _description: form.description || null,
      _month_year: monthStr,
      _created_at: form.date ? new Date(form.date + "T12:00:00").toISOString() : null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تعديل الحركة — الرصيد اتحدّث تلقائيًا");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>تعديل الحركة</DialogTitle></DialogHeader>
        {(tx?.related_voucher_id || tx?.related_treasury_id) && (
          <div className="text-xs border border-warning/40 bg-warning/10 text-warning-foreground rounded-md p-2">
            تنبيه: الحركة دي مرتبطة بسند/خزينة — تعديل المبلغ أو النوع هنا مش هيعدّل قيد الخزينة المرتبط.
          </div>
        )}
        <div className="space-y-3">
          <div><Label>النوع</Label>
            <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contribution">مساهمة (زيادة رصيد)</SelectItem>
                <SelectItem value="drawing">مسحوبة (نقص رصيد)</SelectItem>
                <SelectItem value="profit_share">توزيع أرباح</SelectItem>
                <SelectItem value="capital_adjustment">تسوية رأس مال</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>المبلغ (ج.م) *</Label>
            <Input type="number" min={0} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div><Label>التاريخ</Label>
            <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>
          <div><Label>الوصف</Label>
            <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
            حفظ التعديل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
