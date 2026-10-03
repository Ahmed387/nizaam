import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchContacts, getContactsByIds, type ContactKind, type ContactLookupRow } from "@/lib/contactLookup";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

interface Props {
  branchId: string | null | undefined;
  kind: ContactKind;
  value: string | null | undefined;
  onChange: (id: string, contact: ContactLookupRow | null) => void;
  placeholder?: string;
  /** When set, shows a first option that clears the selection (e.g. cash customer). */
  emptyLabel?: string;
  className?: string;
  triggerClassName?: string;
}

/** Async, server-searched contact picker shared by all documents. */
export function ContactLookup({ branchId, kind, value, onChange, placeholder = "— اختر —", emptyLabel, className, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ContactLookupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ContactLookupRow | null>(null);
  const [tick, setTick] = useState(0);
  const reqId = useRef(0);

  useRealtimeRefresh(["contacts"], () => setTick((t) => t + 1));
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("party:refresh", h);
    return () => window.removeEventListener("party:refresh", h);
  }, []);

  // Resolve the label of the current value (it may not be in the search page).
  useEffect(() => {
    if (!value) { setSelected(null); return; }
    if (selected?.id === value) return;
    const hit = rows.find((r) => r.id === value);
    if (hit) { setSelected(hit); return; }
    getContactsByIds(branchId, [value]).then((r) => setSelected(r[0] ?? null)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, branchId, tick]);

  // Debounced server search while open.
  useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(() => {
      searchContacts(branchId, kind, query)
        .then((r) => { if (id === reqId.current) setRows(r); })
        .catch(() => { if (id === reqId.current) setRows([]); })
        .finally(() => { if (id === reqId.current) setLoading(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [open, query, branchId, kind, tick]);

  const pick = (c: ContactLookupRow | null) => {
    setSelected(c);
    onChange(c?.id ?? "", c);
    setOpen(false);
  };

  const label = selected ? `${selected.name}${selected.phone ? ` (${selected.phone})` : ""}` : value ? "…" : (emptyLabel && !placeholder ? emptyLabel : placeholder);

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className={cn("w-full justify-between font-normal", triggerClassName)}>
            <span className="truncate">{label}</span>
            <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={setQuery} placeholder="ابحث بالاسم أو رقم الهاتف..." />
            <CommandList>
              {loading && (
                <div className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> جاري البحث...
                </div>
              )}
              {!loading && <CommandEmpty>لا توجد نتائج</CommandEmpty>}
              <CommandGroup>
                {emptyLabel && (
                  <CommandItem value="__empty__" onSelect={() => pick(null)}>
                    <Check className={cn("ml-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                    {emptyLabel}
                  </CommandItem>
                )}
                {rows.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={() => pick(c)}>
                    <Check className={cn("ml-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{c.name}</span>
                    {c.phone && <span className="text-xs text-muted-foreground" dir="ltr">{c.phone}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
