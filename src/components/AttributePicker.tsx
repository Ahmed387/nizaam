import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Check, ChevronsUpDown, Tag, X } from "lucide-react";
import { useTextLookup } from "@/hooks/useTextLookup";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type LookupTable = "product_types" | "capacities" | "sizes" | "brands";

/** Compact chip that shows a labelled attribute value inline. */
export function AttributeChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value?: string | null;
  tone?: "neutral" | "primary" | "warning" | "success";
}) {
  if (!value) return null;
  const toneCls =
    tone === "primary"
      ? "bg-primary/10 text-primary border-primary/20"
      : tone === "warning"
      ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
      : tone === "success"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
      : "bg-surface-2 text-foreground border-border";
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px]", toneCls)}>
      <span className="opacity-60">{label}:</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

export function AttributePicker({
  table,
  value,
  onChange,
  placeholder,
  compact,
  allowClear = true,
}: {
  table: LookupTable;
  value?: string | null;
  onChange: (name: string | null) => void;
  placeholder?: string;
  compact?: boolean;
  allowClear?: boolean;
}) {
  const { items, add } = useTextLookup(table);
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const save = async () => {
    if (!newName.trim()) return toast.error("الاسم مطلوب");
    try {
      const it = await add(newName);
      onChange(it.name);
      setAddOpen(false);
      setNewName("");
      setOpen(false);
      toast.success("تمت الإضافة");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size={compact ? "sm" : "default"}
            className={cn("justify-between gap-2", compact ? "h-8 text-xs px-2" : "w-full")}
          >
            <span className="flex items-center gap-1.5 truncate">
              <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{value || placeholder || "اختر"}</span>
            </span>
            <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-64" align="start">
          <Command>
            <CommandInput placeholder="ابحث..." />
            <CommandList>
              <CommandEmpty>لا توجد نتائج</CommandEmpty>
              <CommandGroup>
                {items.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.name}
                    onSelect={() => {
                      onChange(c.name === value ? null : c.name);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <span className="flex-1">{c.name}</span>
                    {value === c.name && <Check className="w-4 h-4" />}
                  </CommandItem>
                ))}
              </CommandGroup>
              <div className="p-1 border-t flex gap-1">
                <Button type="button" variant="ghost" size="sm" className="flex-1 justify-start gap-1" onClick={() => setAddOpen(true)}>
                  <Plus className="w-3.5 h-3.5" /> إضافة جديد
                </Button>
                {allowClear && value && (
                  <Button type="button" variant="ghost" size="sm" className="gap-1 text-destructive" onClick={() => { onChange(null); setOpen(false); }}>
                    <X className="w-3.5 h-3.5" /> إزالة
                  </Button>
                )}
              </div>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>إضافة جديد</DialogTitle></DialogHeader>
          <div className="py-2">
            <Label>الاسم</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1.5" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>إلغاء</Button>
            <Button onClick={save}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
