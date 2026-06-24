import { useState } from "react";
import { Calendar as CalendarIcon, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";

type InvoiceTable = "invoices" | "shipments" | "returns" | "purchase_returns";

interface Props {
  table: InvoiceTable;
  recordId: string;
  /** Current invoice_date value (YYYY-MM-DD or ISO). May be null/undefined for legacy rows. */
  value?: string | null;
  /** Fallback (e.g. created_at) used only if value is missing. */
  fallback?: string | null;
  /** Compact label variant (used inline in tables/views). */
  compact?: boolean;
  /** Called after successful save with the new YYYY-MM-DD string. */
  onSaved?: (newDate: string) => void;
}

/**
 * Shows the invoice date. Only admin / super_admin can edit it (UI + DB-enforced).
 */
export function EditableInvoiceDate({ table, recordId, value, fallback, compact, onSaved }: Props) {
  const { isAdmin } = useAuth();
  const canEdit = isAdmin;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const initial = (value ?? fallback ?? "").slice(0, 10);
  const [draft, setDraft] = useState(initial);

  const display = value ?? fallback ?? null;

  const save = async () => {
    if (!draft) return toast.error("اختر تاريخاً صالحاً");
    setBusy(true);
    const { error } = await (supabase.from(table as any) as any)
      .update({ invoice_date: draft })
      .eq("id", recordId);
    setBusy(false);
    if (error) {
      const msg = /owner|admin or super_admin|super_admin/i.test(error.message)
        ? "تعديل تاريخ الفاتورة متاح لصاحب الشركة فقط"
        : error.message;
      return toast.error(msg);
    }
    toast.success("تم تحديث تاريخ الفاتورة");
    setOpen(false);
    onSaved?.(draft);
  };

  const dateNode = (
    <span className="inline-flex items-center gap-1.5">
      <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
      <span className={compact ? "" : "font-semibold"}>{display ? formatDate(display) : "—"}</span>
    </span>
  );

  if (!canEdit) return dateNode;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(initial); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 hover:text-primary transition-colors"
          title="تعديل تاريخ الفاتورة (صاحب الشركة فقط)"
          onClick={(e) => e.stopPropagation()}
        >
          {dateNode}
          <Pencil className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-2">
          <div className="text-xs font-semibold">تعديل تاريخ الفاتورة</div>
          <Input
            type="date"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-9"
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              <X className="w-4 h-4 ml-1" /> إلغاء
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={busy || !draft || draft === initial}>
              <Check className="w-4 h-4 ml-1" /> حفظ
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground leading-tight">
            يتم تسجيل أي تعديل في سجل التدقيق.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
