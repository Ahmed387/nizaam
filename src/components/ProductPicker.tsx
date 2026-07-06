import { useCallback, useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronsUpDown, Plus, Check, Loader2, PackageSearch, Upload, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { uploadProductImage } from "@/lib/uploadImage";
import { toast } from "sonner";

export interface ProductRow {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  cost_price: number;
  selling_price: number;
  image: string | null;
  branch_id: string;
}

/**
 * Searchable product picker with realtime updates.
 * - filter "all" => every product in the branch
 * - filter "out_of_stock" => only products with quantity = 0
 * - allows inline create of a new product (quantity 0)
 */
export function ProductPicker({
  branchId,
  value,
  onPick,
  filter = "all",
  triggerLabel = "— اختر منتج —",
  className,
  allowCreate = true,
}: {
  branchId: string;
  value?: string | null;
  onPick: (p: ProductRow) => void;
  filter?: "all" | "out_of_stock";
  triggerLabel?: string;
  className?: string;
  allowCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    const { data } = await supabase
      .from("products")
      .select("id,name,sku,quantity,cost_price,selling_price,image,branch_id")
      .eq("branch_id", branchId)
      .is("archived_at", null)
      .order("name");
    setRows((data ?? []) as ProductRow[]);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["products"], load);

  const list = useMemo(
    () => (filter === "out_of_stock" ? rows.filter((r) => Number(r.quantity) <= 0) : rows),
    [rows, filter],
  );

  const selected = value ? rows.find((r) => r.id === value) : null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className={cn("w-full justify-between font-normal", className)}
          >
            <span className="truncate text-right flex-1">
              {selected ? (
                <>
                  {selected.name}
                  <span className="text-xs text-muted-foreground mr-2">
                    {selected.sku} · متوفر: {selected.quantity}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">{triggerLabel}</span>
              )}
            </span>
            <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter>
            <CommandInput placeholder="ابحث بالاسم أو الكود..." />
            <CommandList>
              {loading ? (
                <div className="text-center py-6"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>
              ) : list.length === 0 ? (
                <CommandEmpty>
                  <div className="flex flex-col items-center gap-2 py-4 text-sm">
                    <PackageSearch className="w-6 h-6 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {filter === "out_of_stock" ? "لا توجد أصناف غير متوفرة" : "لا توجد منتجات"}
                    </span>
                  </div>
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {list.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.name} ${p.sku}`}
                      onSelect={() => { onPick(p); setOpen(false); }}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {value === p.id && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{p.name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">{p.sku}</div>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-[11px] px-2 py-0.5 rounded-full font-semibold",
                          p.quantity > 0
                            ? "bg-success/15 text-success"
                            : "bg-destructive/15 text-destructive",
                        )}
                      >
                        المخزون: {p.quantity}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
            {allowCreate && (
              <div className="border-t border-border p-1">
                <Button
                  type="button" variant="ghost" size="sm"
                  className="w-full justify-start gap-2 text-primary"
                  onClick={() => { setOpen(false); setAddOpen(true); }}
                >
                  <Plus className="w-4 h-4" /> صنف جديد
                </Button>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>

      {allowCreate && (
        <NewProductDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          branchId={branchId}
          onCreated={(p) => { setAddOpen(false); onPick(p); load(); }}
        />
      )}
    </>
  );
}

function genSku() {
  return `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function NewProductDialog({
  open, onClose, branchId, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
  onCreated: (p: ProductRow) => void;
}) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [cost, setCost] = useState(0);
  const [sell, setSell] = useState(0);
  const [low, setLow] = useState(5);
  const [image, setImage] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setName(""); setSku(genSku()); setCost(0); setSell(0); setLow(5); setImage(""); }
  }, [open]);

  const uploadImg = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadProductImage(file, branchId);
      setImage(url);
      toast.success("تم رفع الصورة");
    } catch (e: any) {
      toast.error(e.message ?? "فشل رفع الصورة");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("اكتب اسم الصنف");
    setBusy(true);
    const { data, error } = await supabase
      .from("products")
      .insert({
        branch_id: branchId,
        name: name.trim(),
        sku: sku.trim() || genSku(),
        cost_price: cost,
        selling_price: sell || cost,
        market_price: sell || cost,
        quantity: 0,
        low_stock_alert: low,
        image: image || null,
      })
      .select("id,name,sku,quantity,cost_price,selling_price,image,branch_id")
      .single();
    setBusy(false);
    if (error || !data) return toast.error(error?.message ?? "فشل الإضافة");
    toast.success("تمت إضافة الصنف");
    onCreated(data as ProductRow);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>إضافة صنف جديد للمخزن</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">اسم الصنف *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" autoFocus />
          </div>
          <div>
            <Label className="text-xs">الكود (SKU)</Label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} className="mt-1.5 font-mono text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">سعر التكلفة</Label>
              <Input type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(Number(e.target.value))} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">سعر البيع</Label>
              <Input type="number" min={0} step="0.01" value={sell} onChange={(e) => setSell(Number(e.target.value))} className="mt-1.5" />
            </div>
          </div>
          <div>
            <Label className="text-xs">تنبيه عند انخفاض المخزون</Label>
            <Input type="number" min={0} value={low} onChange={(e) => setLow(Number(e.target.value))} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">صورة المنتج (اختياري)</Label>
            <div className="mt-1.5 flex items-center gap-3 flex-wrap">
              {image ? (
                <img src={image} alt="" className="w-16 h-16 rounded-md object-cover border" />
              ) : (
                <div className="w-16 h-16 rounded-md border border-dashed flex items-center justify-center text-[10px] text-muted-foreground">لا توجد</div>
              )}
              <label className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 border rounded-md cursor-pointer text-xs hover:bg-muted ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {image ? "تغيير" : "رفع"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImg(e.target.files[0])} />
              </label>
              {image && (
                <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:bg-destructive/10" onClick={() => setImage("")}>
                  <Trash2 className="w-3.5 h-3.5 ml-1" /> حذف
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">يتم ضغط الصورة تلقائيًا.</p>
          </div>
          <div className="text-[11px] text-muted-foreground bg-muted/50 rounded p-2">
            سيتم إضافة الصنف بكمية 0، وتقدر تعدلها بعد كده.
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button onClick={submit} disabled={busy} className="gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            إضافة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
