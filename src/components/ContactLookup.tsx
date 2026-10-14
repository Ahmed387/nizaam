import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchContacts, getContactsByIds, CONTACT_PAGE, type ContactKind, type ContactLookupRow } from "@/lib/contactLookup";
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

/**
 * Drop-down of every customer / supplier of the company (own branch first). Opening it lists them all,
 * the next page loads while scrolling, and typing any letter filters on the server (name / phone).
 */
export function ContactLookup({ branchId, kind, value, onChange, placeholder = "— اختر —", emptyLabel, className, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ContactLookupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<ContactLookupRow | null>(null);
  const [tick, setTick] = useState(0);
  const reqId = useRef(0);
  const loadingMore = useRef(false);

  useRealtimeRefresh(["contacts"], () => setTick((t) => t + 1));
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("party:refresh", h);
    return () => window.removeEventListener("party:refresh", h);
  }, []);

  // Resolve the label of the current value (it may not be in the loaded pages).
  useEffect(() => {
    if (!value) { setSelected(null); return; }
    if (selected?.id === value) return;
    const hit = rows.find((r) => r.id === value);
    if (hit) { setSelected(hit); return; }
    getContactsByIds(branchId, [value]).then((r) => setSelected(r[0] ?? null)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, branchId, tick]);

  // First page (debounced) whenever the list opens or the search changes.
  useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(() => {
      searchContacts(branchId, kind, query, CONTACT_PAGE, 0)
        .then((r) => { if (id === reqId.current) { setRows(r); setMore(r.length === CONTACT_PAGE); } })
        .catch(() => { if (id === reqId.current) { setRows([]); setMore(false); } })
        .finally(() => { if (id === reqId.current) setLoading(false); });
    }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [open, query, branchId, kind, tick]);

  const loadMore = () => {
    if (!more || loading || loadingMore.current) return;
    loadingMore.current = true;
    const id = reqId.current;
    searchContacts(branchId, kind, query, CONTACT_PAGE, rows.length)
      .then((r) => {
        if (id !== reqId.current) return;
        setRows((prev) => [...prev, ...r.filter((x) => !prev.some((p) => p.id === x.id))]);
        setMore(r.length === CONTACT_PAGE);
      })
      .catch(() => setMore(false))
      .finally(() => { loadingMore.current = false; });
  };

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
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={setQuery} placeholder="اكتب أي حرف من الاسم أو رقم الهاتف..." />
            <CommandList
              className="max-h-72"
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) loadMore();
              }}
            >
              {loading && (
                <div className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> جاري التحميل...
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
                    {c.branch_name && c.branch_id !== branchId && (
                      <span className="mr-2 max-w-[7rem] truncate rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{c.branch_name}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              {!loading && more && (
                <button type="button" className="w-full p-2 text-center text-xs text-primary hover:underline" onClick={loadMore}>
                  عرض المزيد
                </button>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
