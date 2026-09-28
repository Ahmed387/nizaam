import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchMatch } from "@/lib/search";

export interface CustomerOption { id: string; name: string; phone?: string | null }

interface Props {
  customers: CustomerOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}

/** Searchable customer dropdown over an already-loaded (branch-scoped) list. */
export function CustomerSelect({ customers, value, onChange, placeholder = "— اختر عميل (اختياري) —", className }: Props) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => customers.find((c) => c.id === value), [customers, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className={cn("justify-between font-normal", className)}>
          <span className="truncate">{selected ? `${selected.name}${selected.phone ? ` (${selected.phone})` : ""}` : placeholder}</span>
          <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command filter={(v, search) => (v === "__cash__" || searchMatch(search, v) ? 1 : 0)}>
          <CommandInput placeholder="ابحث بالاسم أو رقم الهاتف..." />
          <CommandList>
            <CommandEmpty>لا توجد نتائج</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__cash__" onSelect={() => { onChange(""); setOpen(false); }}>
                <Check className={cn("ml-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                عميل نقدي / غير محدد (اختياري)
              </CommandItem>
              {customers.map((c) => (
                <CommandItem key={c.id} value={`${c.name} ${c.phone ?? ""} ${c.id}`} onSelect={() => { onChange(c.id); setOpen(false); }}>
                  <Check className={cn("ml-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1">{c.name}</span>
                  {c.phone && <span className="text-xs text-muted-foreground" dir="ltr">{c.phone}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
