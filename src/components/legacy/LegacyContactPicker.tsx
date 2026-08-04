import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, UserPlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type PartyType = "customer" | "supplier";

interface Props {
  /** اسم الحساب اللي جاي من الشيت */
  value: string;
  onChange: (name: string) => void;
  type: PartyType;
  className?: string;
}

let cache: { id: string; name: string; type: string }[] | null = null;
const listeners = new Set<() => void>();

async function loadContacts(force = false) {
  if (cache && !force) return cache;
  const { data } = await supabase.from("contacts").select("id, name, type").order("name");
  cache = (data ?? []).map((d: any) => ({ id: d.id, name: String(d.name ?? ""), type: d.type }));
  listeners.forEach((l) => l());
  return cache;
}

/**
 * منتقي العميل/المورد في ترحيل الفواتير القديمة.
 * بيقرأ الحسابات الموجودة فعلاً على النظام، ولو الاسم مش موجود بيسمح بإضافته كحساب جديد.
 */
export function LegacyContactPicker({ value, onChange, type, className }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<{ id: string; name: string; type: string }[]>(cache ?? []);
  const [saving, setSaving] = useState(false);

  const sync = useCallback(() => setItems(cache ?? []), []);

  useEffect(() => {
    listeners.add(sync);
    loadContacts().then(sync);
    return () => { listeners.delete(sync); };
  }, [sync]);

  const options = useMemo(
    () => items.filter((i) => !i.type || i.type === type || type === "customer"),
    [items, type],
  );

  const exists = useMemo(
    () => !!value && options.some((o) => o.name.trim().toLowerCase() === value.trim().toLowerCase()),
    [options, value],
  );

  const typed = q.trim();

  const createNew = async (name: string) => {
    if (!name) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("contacts").insert({ name, type } as any);
      if (error) throw error;
      await loadContacts(true);
      onChange(name);
      setOpen(false);
      setQ("");
      toast.success(`اتضاف ${type === "supplier" ? "مورد" : "عميل"} جديد: ${name}`, {
        description: "كمّل بياناته (تليفون/عنوان) بعدين من صفحة الحسابات.",
      });
    } catch (e: any) {
      toast.error(e.message ?? "مقدرناش نضيف الحساب");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className={cn("h-8 justify-between font-normal text-xs gap-2", className)}
        >
          <span className="truncate">{value || (type === "supplier" ? "اختر المورد" : "اختر العميل")}</span>
          <span className="flex items-center gap-1 shrink-0">
            {value && (
              <Badge variant={exists ? "secondary" : "destructive"} className="text-[10px] px-1.5 py-0">
                {exists ? "موجود" : "جديد"}
              </Badge>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0 z-50 bg-popover" align="start">
        <Command shouldFilter>
          <CommandInput value={q} onValueChange={setQ} placeholder="دوّر بالاسم..." />
          <CommandList>
            <CommandEmpty className="p-2">
              <div className="text-xs text-muted-foreground mb-2">مفيش حساب بالاسم ده</div>
              <Button size="sm" className="w-full" disabled={!typed || saving} onClick={() => createNew(typed)}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" /> : <UserPlus className="w-3.5 h-3.5 ml-1" />}
                ضيف «{typed}» {type === "supplier" ? "كمورد" : "كعميل"} جديد
              </Button>
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.id} value={o.name} onSelect={() => { onChange(o.name); setOpen(false); setQ(""); }}>
                  <Check className={cn("ml-2 h-3.5 w-3.5", value.trim() === o.name.trim() ? "opacity-100" : "opacity-0")} />
                  <span className="text-xs">{o.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {typed && !options.some((o) => o.name.trim().toLowerCase() === typed.toLowerCase()) && (
              <div className="p-2 border-t">
                <Button size="sm" variant="secondary" className="w-full" disabled={saving} onClick={() => createNew(typed)}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" /> : <UserPlus className="w-3.5 h-3.5 ml-1" />}
                  ضيف «{typed}» {type === "supplier" ? "كمورد" : "كعميل"} جديد
                </Button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
