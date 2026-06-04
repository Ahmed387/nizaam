import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEGP } from "@/lib/format";

export type PartyType = "supplier" | "customer" | "employee";

interface Props {
  type: PartyType;
  value: string;
  onChange: (id: string, label?: string) => void;
  placeholder?: string;
}

/** Searchable party picker with live balance badge. */
export function PartyCombobox({ type, value, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [bal, setBal] = useState<{ label: string; amount: number; tone: "good" | "bad" | "neutral" } | null>(null);

  const loadItems = useCallback(async () => {
    if (type === "supplier") {
      const { data } = await supabase.from("contacts").select("id, name").order("name");
      setItems((data ?? []).map((d: any) => ({ id: d.id, name: d.name })));
    } else if (type === "customer") {
      const { data } = await supabase.from("contacts").select("id, name").order("name");
      setItems((data ?? []).map((d: any) => ({ id: d.id, name: d.name })));
    } else {
      const { data } = await supabase.from("employees").select("id, name").order("name");
      setItems((data ?? []).map((d: any) => ({ id: d.id, name: d.name })));
    }
  }, [type]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useRealtimeRefresh(
    [type === "supplier" ? "suppliers" : type === "customer" ? "customers" : "employees"],
    loadItems,
  );

  useEffect(() => {
    if (!value) { setBal(null); return; }
    (async () => {
      try {
        if (type === "supplier") {
          const { data } = await supabase.from("contacts").select("balance").eq("id", value).maybeSingle();
          const amt = Number((data as any)?.balance ?? 0);
          // الجديد: + = لنا (مرتجع/رصيد لصالحنا)، − = علينا للمورد
          setBal({
            label: amt < 0 ? "مستحق للمورد علينا" : amt > 0 ? "رصيد لصالحنا" : "لا توجد مديونية",
            amount: Math.abs(amt),
            tone: amt < 0 ? "bad" : amt > 0 ? "good" : "neutral",
          });
        } else if (type === "customer") {
          const { data } = await supabase.from("invoices" as any).select("total, paid_amount").eq("contact_id", value).eq("status", "active");
          const total = (data ?? []).reduce((s: number, r: any) => s + (Number(r.total) - Number(r.paid_amount ?? 0)), 0);
          setBal({ label: "مستحق على العميل", amount: total, tone: total > 0 ? "good" : "neutral" });
        } else {
          const { data } = await supabase.from("advances" as any).select("remaining_amount").eq("employee_id", value).in("status", ["approved", "active"]);
          const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.remaining_amount ?? 0), 0);
          setBal({ label: "سلف مستحقة على الموظف", amount: total, tone: total > 0 ? "bad" : "neutral" });
        }
      } catch { setBal(null); }
    })();
  }, [value, type]);

  const selected = useMemo(() => items.find((i) => i.id === value), [items, value]);

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
            {selected ? selected.name : (placeholder ?? "— اختر —")}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="ابحث..." />
            <CommandList>
              <CommandEmpty>لا توجد نتائج</CommandEmpty>
              <CommandGroup>
                {items.map((it) => (
                  <CommandItem key={it.id} value={it.name} onSelect={() => { onChange(it.id, it.name); setOpen(false); }}>
                    <Check className={cn("ml-2 h-4 w-4", value === it.id ? "opacity-100" : "opacity-0")} />
                    {it.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {bal && value && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{bal.label}</span>
          <Badge variant={bal.tone === "bad" ? "destructive" : bal.tone === "good" ? "default" : "secondary"}>
            {formatEGP(bal.amount)}
          </Badge>
        </div>
      )}
    </div>
  );
}
