import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEGP, balanceLabel } from "@/lib/format";
import { searchMatch } from "@/lib/search";
import { useParams } from "react-router-dom";
import { ContactLookup } from "@/components/ContactLookup";

export type PartyType = "supplier" | "customer" | "employee";

interface Props {
  type: PartyType;
  value: string;
  onChange: (id: string, label?: string) => void;
  placeholder?: string;
  /** Defaults to the :id route param. */
  branchId?: string | null;
}

/** Searchable party picker with live balance badge. */
export function PartyCombobox({ type, value, onChange, placeholder, branchId: branchIdProp }: Props) {
  const params = useParams<{ id: string }>();
  const branchId = branchIdProp ?? params.id ?? null;
  const isContact = type !== "employee";
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [bal, setBal] = useState<{ label: string; amount: number; tone: "good" | "bad" | "neutral" } | null>(null);

  // Employees only — contacts are searched server-side through ContactLookup.
  const loadItems = useCallback(async () => {
    if (type !== "employee") { setItems([]); return; }
    const { data } = await supabase.from("employees").select("id, name").order("name");
    setItems((data ?? []).map((d: any) => ({ id: d.id, name: d.name })));
  }, [type]);

  useEffect(() => { loadItems(); }, [loadItems]);
  // realtime على الجداول الحقيقية (contacts / employees) + حدث محلي فوري بعد الإضافة
  useRealtimeRefresh(["employees"], loadItems);
  useEffect(() => {
    const h = () => loadItems();
    window.addEventListener("party:refresh", h);
    return () => window.removeEventListener("party:refresh", h);
  }, [loadItems]);


  useEffect(() => {
    if (!value) { setBal(null); return; }
    (async () => {
      try {
        if (type === "supplier" || type === "customer") {
          // TODO Phase 2.2B: Remove after contacts.balance column is dropped
          // مصدر موحّد لكلا الجهتين: v_contact_balances (يقرأ من GL مباشرة)
          const { data } = await supabase.from("v_contact_balances" as any).select("total_balance").eq("contact_id", value).maybeSingle();
          const amt = Number((data as any)?.total_balance ?? 0);
          setBal(balanceLabel(amt));
        } else {
          const { data } = await supabase.from("advances" as any).select("remaining").eq("employee_id", value);
          const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.remaining ?? 0), 0);
          setBal({ label: "سلف مستحقة على الموظف", amount: total, tone: total > 0 ? "bad" : "neutral" });
        }
      } catch { setBal(null); }
    })();
  }, [value, type]);


  const selected = useMemo(() => items.find((i) => i.id === value), [items, value]);

  return (
    <div className="space-y-1.5">
      {isContact ? (
        <ContactLookup branchId={branchId} kind={type as "customer" | "supplier"} value={value} onChange={(id, c) => onChange(id, c?.name)} placeholder={placeholder ?? "— اختر —"} />
      ) : (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
            {selected ? selected.name : (placeholder ?? "— اختر —")}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command filter={(value, search) => (searchMatch(search, value) ? 1 : 0)}>
            <CommandInput placeholder="ابحث..." />
            <CommandList>
              <CommandEmpty>لا توجد نتائج</CommandEmpty>
              <CommandGroup>
                {items.map((it) => (
                  <CommandItem key={it.id} value={`${it.name} ${(it as any).phone ?? ""} ${it.id}`} onSelect={() => { onChange(it.id, it.name); setOpen(false); }}>
                    <Check className={cn("ml-2 h-4 w-4", value === it.id ? "opacity-100" : "opacity-0")} />
                    {it.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      )}
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
