import { useState } from "react";
import { Calendar as CalendarIcon, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";

type InvoiceTable = "invoices" | "shipments" | "returns" | "purchase_returns";

interface Props {
  table: InvoiceTable;
  recordId: string;
  /** Current invoice_date value (ISO timestamp). May be null/undefined for legacy rows. */
  value?: string | null;
  /** Fallback (e.g. created_at) used only if value is missing. */
  fallback?: string | null;
  /** Compact label variant (used inline in tables/views). */
  compact?: boolean;
  /** When true, render as plain read-only text (no pencil, no popover). */
  readOnly?: boolean;
  /** Called after successful save with the new ISO timestamp. */
  onSaved?: (newDate: string) => void;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Shows the invoice date + time. Only admin / super_admin can edit it (UI + DB-enforced).
 */
export function EditableInvoiceDate({ table, recordId, value, fallback, compact, readOnly, onSaved }: Props) {
  const { isAdmin } = useAuth();
  const canEdit = isAdmin && !readOnly;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const initial = toLocalInput(value ?? fallback ?? "");
  const [draft, setDraft] = useState(initial);

  const display = value ?? fallback ?? null;

  const save = async () => {
    if (!draft) return toast.error("اختر تاريخاً ووقتاً صالحاً");
    setBusy(true);
    // datetime-local → treat as local time, send as ISO.
    const isoValue = new Date(draft).toISOString();
    const { error } = table === "invoices"
      ? await supabase.rpc("update_invoice_date_sovereign", {
          p_invoice_id: recordId,
          p_new_date: isoValue,
          p_reason: "تعديل تاريخ الفاتورة من شاشة المستندات",
        })
      : table === "returns" || table === "purchase_returns"
      ? await supabase.rpc("update_return_sovereign" as any, {
          p_kind: table === "returns" ? "sale_return" : "purchase_return",
          p_return_id: recordId,
          p_date: new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(draft)),
          p_notes: null,
        })
      : await (supabase.from(table as any) as any)
          .update({ invoice_date: isoValue })
          .eq("id", recordId);
    setBusy(false);
    if (error) {
      return toast.error(error.message);
    }
    toast.success("تم تحديث تاريخ ووقت الفاتورة");
    setOpen(false);
    onSaved?.(isoValue);
  };

  const dateNode = (
    <span className="inline-flex items-center gap-1.5">
      <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
      <span className={compact ? "" : "font-semibold"}>{display ? formatDateTime(display) : "—"}</span>
    </span>
  );

  if (!canEdit) return dateNode;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(initial); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 hover:text-primary transition-colors"
          title="تعديل تاريخ ووقت الفاتورة (صاحب الشركة فقط)"
          onClick={(e) => e.stopPropagation()}
        >
          {dateNode}
          <Pencil className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-2">
          <div className="text-xs font-semibold">تعديل تاريخ ووقت الفاتورة</div>
          <Input
            type="datetime-local"
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
