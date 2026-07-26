import { Calendar as CalendarIcon, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  /** ISO string or `YYYY-MM-DDTHH:mm` — accepts both. */
  value: string;
  onChange: (v: string) => void;
  label?: string;
}

/** Format a Date to the value shape a `datetime-local` input expects (local, no seconds). */
const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const normalize = (v: string): string => {
  if (!v) return toLocalInput(new Date());
  // Already `YYYY-MM-DDTHH:mm`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return v;
  // Legacy date-only string: keep the day, add current time
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const now = new Date();
    return `${v}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? toLocalInput(new Date()) : toLocalInput(d);
};

/**
 * Date + time input for new invoices. Only admin / super_admin can pick a non-now value.
 * For other roles the field is locked to the current moment (matches the DB trigger that
 * blocks backdating after creation).
 */
export function InvoiceDateInput({ value, onChange, label = "تاريخ ووقت الفاتورة" }: Props) {
  const { isAdmin } = useAuth();
  const canBackdate = isAdmin;
  const nowLocal = toLocalInput(new Date());
  const current = normalize(value);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        <CalendarIcon className="w-3.5 h-3.5 text-primary" />
        {label}
        {!canBackdate && <Lock className="w-3 h-3 text-muted-foreground" />}
      </Label>
      <Input
        type="datetime-local"
        value={current}
        max={nowLocal}
        onChange={(e) => onChange(e.target.value)}
        disabled={!canBackdate}
        className="h-10"
        title={canBackdate ? "اختر تاريخ ووقت الفاتورة" : "تعديل التاريخ متاح لصاحب الشركة فقط"}
      />
    </div>
  );
}
