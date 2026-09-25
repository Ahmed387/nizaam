import { useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";

const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

/**
 * Inline date edit for a voucher (admins only). Uses the sovereign edit_voucher RPC,
 * which atomically cancels the old voucher (reversing its JE + treasury line) and
 * recreates it on the new date. Closed fiscal periods are enforced server-side.
 */
export function InlineVoucherDate({ voucher, onSaved }: { voucher: any; onSaved?: () => void }) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string>(voucher.voucher_date?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  const label = formatDate(voucher.voucher_date);

  if (!isAdmin || voucher.status !== "active") return <span>{label}</span>;

  const save = async () => {
    const today = cairoToday();
    if (!date) return toast.error("اختر التاريخ");
    if (date > today) return toast.error("مينفعش تاريخ في المستقبل");
    if (date === voucher.voucher_date?.slice(0, 10)) return setOpen(false);
    setBusy(true);
    const { error } = await supabase.rpc("edit_voucher" as any, {
      p_voucher_id: voucher.id,
      p_category_id: voucher.category_id,
      p_amount: Number(voucher.amount),
      p_payment_method: voucher.payment_method,
      p_voucher_date: date,
      p_party_type: voucher.party_type ?? null,
      p_party_id: voucher.party_id ?? null,
      p_party_name: voucher.party_name ?? null,
      p_description: voucher.description ?? null,
      p_reference_number: voucher.reference_number ?? null,
      p_transferred_to: voucher.transferred_to ?? null,
      p_transferred_from: voucher.transferred_from ?? null,
      p_fee_amount: Number(voucher.fee_amount ?? 0),
      p_edit_reason: "تعديل سريع لتاريخ السند",
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم نقل السند وقيده وحركة الخزنة للتاريخ الجديد");
    setOpen(false);
    onSaved?.();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()} title="اضغط لتعديل التاريخ"
          className="inline-flex items-center gap-1.5 rounded px-1 cursor-pointer hover:bg-primary/10 hover:text-primary transition">
          <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" className="w-64 space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="text-xs font-semibold text-muted-foreground">تاريخ السند {voucher.voucher_number}</div>
        <Input type="date" autoFocus value={date} max={cairoToday()} onChange={(e) => setDate(e.target.value)} />
        <Button className="w-full" size="sm" onClick={save} disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} حفظ التاريخ
        </Button>
      </PopoverContent>
    </Popover>
  );
}
