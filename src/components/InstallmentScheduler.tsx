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
    if (count <= 0) {
      alert("أدخل عدد أقساط صحيح");
      return;
    }
    if (remaining <= 0) {
      alert("لا يوجد مبلغ متبقي لتقسيمه — قلل المبلغ المدفوع الآن أولاً");
      return;
    }
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
    <div className="space-y-4 p-4 rounded-lg border bg-muted/20">
      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div>
          <Label className="text-sm font-semibold">عدد الأقساط</Label>
          <Input type="number" min={1} max={24} value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-1.5 h-11 text-base" />
        </div>
        <div>
          <Label className="text-sm font-semibold">أول قسط في</Label>
          <Input type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} className="mt-1.5 h-11 text-base" />
        </div>
        <Button type="button" variant="default" onClick={autoCalc} className="gap-2 h-11 text-base font-semibold">
          <Calculator className="w-5 h-5" /> احسب تلقائياً
        </Button>
      </div>


      {value.length > 0 && (
        <div className="space-y-3">
          {value.map((r, i) => (
            <div key={i} className="flex items-center gap-2 p-2 rounded-lg border bg-background shadow-sm">
              <span className="text-sm font-bold text-muted-foreground w-14 text-right shrink-0">قسط {i + 1}</span>
              <Input type="date" value={r.due_date} onChange={(e) => {
                const c = [...value]; c[i] = { ...c[i], due_date: e.target.value }; onChange(c);
              }} className="flex-1 h-11 text-base" />
              <Input type="number" min={0} step="0.01" value={r.amount} onChange={(e) => {
                const c = [...value]; c[i] = { ...c[i], amount: Number(e.target.value) }; onChange(c);
              }} className="w-32 h-11 text-base" />
              <Button type="button" size="icon" variant="ghost" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="text-destructive shrink-0 h-10 w-10 hover:bg-destructive/10">
                <Trash2 className="w-5 h-5" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => onChange([...value, { due_date: firstDate, amount: 0 }])} className="gap-2 h-11 w-full text-base font-semibold">
            <Plus className="w-5 h-5" /> إضافة قسط جديد
          </Button>
          <div className="text-sm flex justify-between items-center p-3 rounded-lg bg-muted/30 border">
            <span>إجمالي الأقساط: <b className="text-base">{formatEGP(total)}</b></span>
            <span className={diff === 0 ? "text-success font-semibold" : "text-destructive font-semibold"}>
              {diff === 0 ? "✓ مطابق" : `الفرق: ${formatEGP(diff)}`}
            </span>
          </div>
        </div>
      )}


    </div>
  );
}
