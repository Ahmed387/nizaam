import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Check, ChevronsUpDown, Palette, X, Trash2 } from "lucide-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function ColorSwatch({ hex, name, size = 16 }: { hex?: string | null; name?: string | null; size?: number }) {
  if (!hex && !name) return null;
  return (
    <span
      className="inline-block rounded-full border border-border shrink-0"
      style={{ background: hex ?? "#ccc", width: size, height: size }}
      title={name ?? ""}
    />
  );
}

/** Compact chip: swatch + name, for display in tables and cards. */
export function ColorChip({ name, hex }: { name?: string | null; hex?: string | null }) {
  if (!name) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-2 border border-border text-xs">
      <ColorSwatch hex={hex} name={name} size={10} />
      <span>{name}</span>
    </span>
  );
}

export function ColorPicker({
  value,
  onChange,
  compact,
  placeholder = "اختر لون",
  allowClear = true,
}: {
  value?: string | null;
  onChange: (name: string | null) => void;
  compact?: boolean;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const { colors, addColor, removeColor, hexFor } = useColors();
  const { isOwner, isAdmin } = useAuth();
  const canDelete = isOwner || isAdmin;
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newHex, setNewHex] = useState("#3b82f6");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const currentHex = hexFor(value);

  const save = async () => {
    if (!newName.trim()) return toast.error("اسم اللون مطلوب");
    try {
      const c = await addColor(newName, newHex);
      onChange(c.name);
      setAddOpen(false);
      setNewName("");
      setOpen(false);
      toast.success("تمت الإضافة");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await removeColor(pendingDelete.id);
      if (value === pendingDelete.name) onChange(null);
      toast.success("تم حذف اللون من المقترحات");
      setPendingDelete(null);
    } catch (e: any) {
      toast.error(e.message || "تعذر الحذف");
    } finally {
      setDeleting(false);
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
              {value ? <ColorSwatch hex={currentHex} name={value} size={compact ? 12 : 16} /> : <Palette className="w-4 h-4 text-muted-foreground" />}
              <span className="truncate">{value || placeholder}</span>
            </span>
            <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-64" align="start">
          <Command>
            <CommandInput placeholder="ابحث عن لون..." />
            <CommandList>
              <CommandEmpty>لا توجد ألوان</CommandEmpty>
              <CommandGroup>
                {colors.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.name}
                    onSelect={() => {
                      onChange(c.name === value ? null : c.name);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <ColorSwatch hex={c.hex} name={c.name} />
                    <span className="flex-1 truncate">{c.name}</span>
                    {value === c.name && <Check className="w-4 h-4 shrink-0" />}
                    {canDelete && (
                      <button
                        type="button"
                        aria-label={`حذف ${c.name}`}
                        title="حذف اللون"
                        className="mr-auto p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPendingDelete({ id: c.id, name: c.name }); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </CommandItem>

                ))}
              </CommandGroup>
              <div className="p-1 border-t flex gap-1">
                <Button type="button" variant="ghost" size="sm" className="flex-1 justify-start gap-1" onClick={() => setAddOpen(true)}>
                  <Plus className="w-3.5 h-3.5" /> لون جديد
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
          <DialogHeader><DialogTitle>لون جديد</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>الاسم</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1.5" autoFocus />
            </div>
            <div>
              <Label>الكود اللوني</Label>
              <div className="flex items-center gap-2 mt-1.5">
                <input type="color" value={newHex} onChange={(e) => setNewHex(e.target.value)} className="h-10 w-14 rounded border border-border cursor-pointer" />
                <Input value={newHex} onChange={(e) => setNewHex(e.target.value)} className="font-mono" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>إلغاء</Button>
            <Button onClick={save}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف لون</DialogTitle>
            <DialogDescription>
              حذف «{pendingDelete?.name}» نهائياً من المقترحات؟ المنتجات والفواتير القديمة لن تتأثر.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "جارٍ الحذف..." : "حذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>

  );
}
