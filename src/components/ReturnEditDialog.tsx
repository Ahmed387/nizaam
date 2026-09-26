import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { saveDocAnnotations } from "@/lib/docAnnotations";

type Kind = "sale_return" | "purchase_return";

const cairoDay = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(iso)) : "";

/** One modal: return date (existing sovereign RPC, only if changed) + recipient/notes (existing annotations RPC). */
export function ReturnEditDialog({
  kind, record, originalInvoiceDate, canEditDate = true, onOpenChange, onSaved,
}: {
  kind: Kind;
  record: { id: string; return_number?: string | null; invoice_date?: string | null; created_at?: string | null; notes?: string | null; recipient_name?: string | null } | null;
  originalInvoiceDate?: string | null;
  canEditDate?: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
}) {
  const [date, setDate] = useState("");
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const today = cairoDay(new Date().toISOString());
  const minDay = cairoDay(originalInvoiceDate);
  const initialDate = record ? cairoDay(record.invoice_date ?? record.created_at) : "";

  useEffect(() => {
    if (record) {
      setDate(cairoDay(record.invoice_date ?? record.created_at));
      setRecipient(record.recipient_name ?? "");
      setNotes(record.notes ?? "");
    }
  }, [record]);

  const save = async () => {
    if (!record) return;
    const dateChanged = canEditDate && date !== initialDate;
    if (dateChanged) {
      if (!date) return toast.error("اختر التاريخ");
      if (date > today) return toast.error("مينفعش تاريخ في المستقبل");
      if (minDay && date < minDay) return toast.error("تاريخ المرتجع لا يمكن أن يسبق تاريخ الفاتورة الأصلية");
    }
    setBusy(true);
    try {
      if (dateChanged) {
        const { error } = await supabase.rpc("update_return_sovereign" as any, {
          p_kind: kind, p_return_id: record.id, p_date: date, p_notes: notes,
        });
        if (error) throw error;
      }
      await saveDocAnnotations(kind, record.id, recipient, notes);
      toast.success(dateChanged ? "تم تعديل المرتجع وتحديث القيد والخزينة" : "تم حفظ المستلم والملاحظات");
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!record} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>تعديل {kind === "sale_return" ? "مرتجع بيع" : "مرتجع شراء"} {record?.return_number ?? ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>تاريخ المرتجع</Label>
            <Input type="date" value={date} max={today} min={minDay || undefined} disabled={!canEditDate}
              onChange={(e) => setDate(e.target.value)} className="mt-1.5" />
            {minDay && <p className="text-xs text-muted-foreground mt-1">لا يسبق تاريخ الفاتورة الأصلية ({minDay})</p>}
            {!canEditDate && <p className="text-xs text-muted-foreground mt-1">تعديل التاريخ للإدارة فقط</p>}
          </div>
          <div>
            <Label>المستلم</Label>
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label>الملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" rows={3} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} حفظ</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
