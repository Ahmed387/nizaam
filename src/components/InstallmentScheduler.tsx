import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatEGP } from "@/lib/format";
import { Calculator, Trash2, Plus } from "lucide-react";

export interface InstallmentRow {
  due_date: string;
  amount: number;
}

interface Props {
  remaining: number;
  value: InstallmentRow[];
  onChange: (rows: InstallmentRow[]) => void;
}

export function InstallmentScheduler({ remaining, value, onChange }: Props) {
  const [count, setCount] = useState(3);
  const [firstDate, setFirstDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split("T")[0];
  });

  const autoCalc = () => {
    if (count <= 0 || remaining <= 0) return;
    const each = Math.round((remaining / count) * 100) / 100;
    const rows: InstallmentRow[] = [];
    const start = new Date(firstDate);
    for (let i = 0; i < count; i++) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i);
      const amt = i === count - 1 ? Math.round((remaining - each * (count - 1)) * 100) / 100 : each;
      rows.push({ due_date: d.toISOString().split("T")[0], amount: amt });
    }
    onChange(rows);
  };

  const total = value.reduce((s, r) => s + Number(r.amount || 0), 0);
  const diff = Math.round((remaining - total) * 100) / 100;

  return (
    <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div>
          <Label>عدد الأقساط</Label>
          <Input type="number" min={1} max={24} value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-1.5" />
        </div>
        <div>
          <Label>أول قسط في</Label>
          <Input type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} className="mt-1.5" />
        </div>
        <Button type="button" variant="secondary" onClick={autoCalc} className="gap-2">
          <Calculator className="w-4 h-4" /> احسب تلقائياً
        </Button>
      </div>

      {value.length > 0 && (
        <div className="space-y-1.5">
          {value.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16">قسط {i + 1}</span>
              <Input type="date" value={r.due_date} onChange={(e) => {
                const c = [...value]; c[i] = { ...c[i], due_date: e.target.value }; onChange(c);
              }} className="flex-1" />
              <Input type="number" min={0} step="0.01" value={r.amount} onChange={(e) => {
                const c = [...value]; c[i] = { ...c[i], amount: Number(e.target.value) }; onChange(c);
              }} className="w-32" />
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="text-destructive">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...value, { due_date: firstDate, amount: 0 }])} className="gap-1">
            <Plus className="w-3 h-3" /> قسط
          </Button>
          <div className="text-sm flex justify-between border-t pt-2 mt-2">
            <span>إجمالي الأقساط: <b>{formatEGP(total)}</b></span>
            <span className={diff === 0 ? "text-success" : "text-destructive"}>
              {diff === 0 ? "✓ مطابق" : `الفرق: ${formatEGP(diff)}`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
