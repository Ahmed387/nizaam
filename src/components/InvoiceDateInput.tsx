import { Calendar as CalendarIcon, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
  label?: string;
}

/**
 * Date input for new invoices. Only admin / super_admin can pick a non-today date.
 * For other roles the field is locked to today (matches the DB trigger that blocks
 * backdating after creation).
 */
export function InvoiceDateInput({ value, onChange, label = "تاريخ الفاتورة" }: Props) {
  const { isAdmin } = useAuth();
  const canBackdate = isAdmin;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs flex items-center gap-1.5">
        <CalendarIcon className="w-3.5 h-3.5 text-primary" />
        {label}
        {!canBackdate && <Lock className="w-3 h-3 text-muted-foreground" />}
      </Label>
      <Input
        type="date"
        value={value || today}
        max={today}
        onChange={(e) => onChange(e.target.value)}
        disabled={!canBackdate}
        className="h-9"
        title={canBackdate ? "اختر تاريخ الفاتورة" : "تعديل التاريخ متاح لصاحب الشركة فقط"}
      />
    </div>
  );
}
