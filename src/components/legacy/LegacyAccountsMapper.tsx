import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Link2, Info, Search, UserPlus, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ربط أسماء الحسابات اللي في ملف النظام القديم بحسابات موجودة فعلًا على النظام.
 * لو الاسم مش موجود → يتعمل حساب جديد وقت الترحيل مع تنبيه إن بياناته لازم تتكمّل بعدين.
 */

interface Props {
  /** أسماء الحسابات اللي في الملف */
  names: string[];
  /** عميل ولا مورد */
  isPurchase: boolean;
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

const norm = (s: string) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

export function LegacyAccountsMapper({ names, isPurchase, value, onChange }: Props) {
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState("");

  const load = async () => {
    const { data } = await supabase.from("contacts").select("id, name").order("name");
    setContacts((data ?? []) as any);
  };
  useEffect(() => { load(); }, []);

  // مطابقة تلقائية بالاسم أول ما الملف يتقرا أو الحسابات تتحمّل
  useEffect(() => {
    if (!names.length || !contacts.length) return;
    const next = { ...value };
    let changed = false;
    for (const n of names) {
      if (next[n]) continue;
      const hit = contacts.find((c) => norm(c.name) === norm(n));
      if (hit) { next[n] = hit.id; changed = true; }
    }
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, contacts]);

  const filtered = useMemo(() => {
    const t = norm(q);
    return t ? names.filter((n) => norm(n).includes(t)) : names;
  }, [names, q]);

  const linked = names.filter((n) => value[n]).length;
  const fresh = names.length - linked;

  const setOne = (name: string, id: string) => onChange({ ...value, [name]: id });
  const clearOne = (name: string) => {
    const next = { ...value };
    delete next[name];
    onChange(next);
  };

  return (
    <div className="rounded-xl border-2 border-primary/25 overflow-hidden bg-gradient-to-b from-primary/5 to-transparent animate-fade-in">
      <div className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-primary/10 border-b border-primary/20">
        <div className="text-sm font-bold flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          ربط {isPurchase ? "الموردين" : "العملاء"} اللي في الملف بحسابات النظام
          <Badge className="bg-success/15 text-success gap-1"><Link2 className="w-3 h-3" /> {linked} مربوط</Badge>
          {fresh > 0 && <Badge className="bg-warning/15 text-warning gap-1"><UserPlus className="w-3 h-3" /> {fresh} جديد</Badge>}
        </div>
        <div className="relative w-52">
          <Search className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر باسم الحساب" className="h-8 pr-7 text-xs" />
        </div>
      </div>

      <div className="max-h-[340px] overflow-y-auto divide-y divide-border/60">
        {filtered.map((n) => {
          const id = value[n];
          const c = contacts.find((x) => x.id === id);
          return (
            <div key={n} className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-primary/5 transition-colors">
              <div className="min-w-[130px] flex-1 text-xs font-semibold truncate">{n}</div>
              <span className="text-muted-foreground text-xs">←</span>
              <div className="w-full sm:w-[240px]">
                <ContactPicker
                  contacts={contacts}
                  value={id}
                  onPick={(cid) => setOne(n, cid)}
                  isPurchase={isPurchase}
                />
              </div>
              {c ? (
                <Badge className="bg-success/15 text-success shrink-0 gap-1">
                  <Check className="w-3 h-3" /> مربوط
                </Badge>
              ) : (
                <Badge className="bg-warning/15 text-warning shrink-0 gap-1 animate-pulse">
                  <UserPlus className="w-3 h-3" /> هيتعمل جديد
                </Badge>
              )}
              {c && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => clearOne(n)}>
                  فك الربط
                </Button>
              )}
            </div>
          );
        })}
        {!filtered.length && <div className="p-4 text-center text-xs text-muted-foreground">مفيش نتائج</div>}
      </div>

      {fresh > 0 && (
        <div className="px-3 py-2 text-[11px] text-warning bg-warning/5 border-t border-warning/20 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            فيه <b>{fresh}</b> {isPurchase ? "مورد" : "عميل"} مش موجودين على النظام — هيتعملوا تلقائي بالاسم بس،
            و<b>لازم تكمّل بياناتهم بعدين</b> (تليفون / عنوان / رصيد افتتاحي) من صفحة جهات التواصل.
          </span>
        </div>
      )}
    </div>
  );
}

function ContactPicker({
  contacts, value, onPick, isPurchase,
}: { contacts: { id: string; name: string }[]; value?: string; onPick: (id: string) => void; isPurchase: boolean }) {
  const [open, setOpen] = useState(false);
  const sel = contacts.find((c) => c.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox"
          className={cn("w-full justify-between h-8 text-xs font-normal", !sel && "border-warning/60 text-muted-foreground")}>
          {sel ? sel.name : `اربط بـ${isPurchase ? "مورد" : "عميل"} موجود…`}
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="ابحث بالاسم..." />
          <CommandList>
            <CommandEmpty>مفيش حساب بالاسم ده — هيتعمل جديد</CommandEmpty>
            <CommandGroup>
              {contacts.map((c) => (
                <CommandItem key={c.id} value={c.name} onSelect={() => { onPick(c.id); setOpen(false); }}>
                  <Check className={cn("ml-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                  {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
