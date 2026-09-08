import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { filterProductsBySearch } from "@/lib/search";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, HelpCircle, Check, ChevronsUpDown, Package } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ProductImage } from "@/components/ProductImage";
import { ClickableImagePreview } from "@/components/ClickableImagePreview";

interface Line {
  product_id: string; product_name: string;
  system_quantity: number; actual_quantity: number; unit_cost: number;
}

function ProductCombobox({
  products, value, onSelect,
}: { products: any[]; value: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = products.find((p) => p.id === value);
  const filtered = useMemo(
    () => filterProductsBySearch(products as any[], q).slice(0, 200),
    [products, q],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" role="combobox"
          className="w-full justify-between font-normal h-10"
        >
          {selected ? (
            <span className="flex items-center gap-2 truncate">
              {selected.image ? (
                <ProductImage src={selected.image} alt="" className="w-6 h-6 rounded object-cover" />
              ) : (
                <Package className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="truncate">{selected.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">({selected.quantity})</span>
            </span>
          ) : (
            <span className="text-muted-foreground">اختر منتج…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="ابحث بالاسم أو الباركود..." value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>لا توجد نتائج</CommandEmpty>
            <CommandGroup>
              {filtered.map((p) => (
                <CommandItem key={p.id} value={p.id} onSelect={() => { onSelect(p.id); setOpen(false); setQ(""); }}>
                  <Check className={cn("ml-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                  {p.image ? (
                    <ClickableImagePreview src={p.image} alt={p.name} title={p.name} className="w-8 h-8 rounded object-cover ml-2" />
                  ) : (
                    <Package className="w-4 h-4 text-muted-foreground ml-2" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {p.sku ? `SKU: ${p.sku}` : ""}
                    </div>
                  </div>
                  <span className={cn(
                    "text-xs font-bold shrink-0 px-2 py-0.5 rounded",
                    Number(p.quantity) > 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
                  )}>
                    {p.quantity}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function NewStockAdjustment() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      const { data } = await supabase.from("products").select("id, name, quantity, cost_price, sku, image").eq("branch_id", branchId).order("name");
      setProducts(data ?? []);
    })();
  }, [branchId]);

  const addLine = () => setLines([...lines, { product_id: "", product_name: "", system_quantity: 0, actual_quantity: 0, unit_cost: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const onProduct = (i: number, pid: string) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return;
    updateLine(i, { product_id: pid, product_name: p.name, system_quantity: p.quantity, actual_quantity: p.quantity, unit_cost: Number(p.cost_price) });
  };

  const submit = async () => {
    if (!reason.trim()) return toast.error("اكتب سبب الجرد");
    if (lines.length === 0) return toast.error("أضف منتج واحد على الأقل");
    for (const l of lines) if (!l.product_id) return toast.error("اختر منتج لكل سطر");
    setBusy(true);
    const number = `ADJ-${Date.now().toString(36).toUpperCase()}`;
    const { data: adj, error } = await supabase.from("stock_adjustments" as any).insert({
      branch_id: branchId, adjustment_number: number,
      reason: reason.trim(), notes: notes.trim() || null, created_by: user!.id,
    }).select().single();
    if (error || !adj) { setBusy(false); return toast.error(error?.message ?? "فشل الحفظ"); }
    const items = lines.map((l) => ({
      adjustment_id: (adj as any).id, product_id: l.product_id, product_name: l.product_name,
      system_quantity: l.system_quantity, actual_quantity: l.actual_quantity,
      difference: l.actual_quantity - l.system_quantity, unit_cost: l.unit_cost,
    }));
    const { error: e2 } = await supabase.from("stock_adjustment_items" as any).insert(items);
    if (e2) { setBusy(false); return toast.error(e2.message); }
    toast.success("تم تسجيل الجرد وتعديل المخزون");
    nav(`/branch/${branchId}/invoices?tab=adjustment`);
  };

  return (
    <BranchLayout>
      <PageHeader
        title="تسوية جديدة في الفرع"
        subtitle="عدّل الكميات في النظام لتطابق الكميات الفعلية بعد الجرد"
        actions={
          <HoverCard openDelay={100}>
            <HoverCardTrigger asChild>
              <Button variant="outline" size="icon" aria-label="ما هي تسوية المخزن في الفرع؟">
                <HelpCircle className="w-4 h-4" />
              </Button>
            </HoverCardTrigger>
            <HoverCardContent className="w-80 text-right" side="bottom" align="end">
              <div className="space-y-2 text-sm">
                <p className="font-semibold">يعني إيه تسوية المخزن في الفرع؟</p>
                <p className="text-muted-foreground">
                  هي تعديل كمية المنتج في النظام عشان تطابق الكمية الفعلية الموجودة في المخزن
                  بعد ما تعمل جرد، لتغطية أي فرق بسبب تلف أو فقد أو خطأ إدخال.
                </p>
                <div className="border-t pt-2">
                  <p className="font-semibold">مثال:</p>
                  <p className="text-muted-foreground">
                    لو النظام بيقول عندك <span className="font-medium">100 قطعة</span>،
                    وبعد الجرد لقيت فعلياً <span className="font-medium">95 قطعة</span> فقط،
                    التسوية هتنقص <span className="font-medium">5 قطع</span> من النظام
                    عشان الرصيد يبقى مطابق للواقع.
                  </p>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        }
      />
      <div className="space-y-4 card-elevated p-5">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>السبب *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر السبب" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="جرد دوري">جرد دوري</SelectItem>
                <SelectItem value="بضاعة تالفة">بضاعة تالفة</SelectItem>
                <SelectItem value="بضاعة مفقودة">بضاعة مفقودة</SelectItem>
                <SelectItem value="تصحيح خطأ إدخال">تصحيح خطأ إدخال</SelectItem>
                <SelectItem value="أخرى">أخرى</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>المنتجات</Label>
            <Button size="sm" variant="outline" onClick={addLine} className="gap-1"><Plus className="w-3 h-3" /> إضافة</Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => {
              const diff = l.actual_quantity - l.system_quantity;
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 border rounded">
                  <div className="col-span-4">
                    <ProductCombobox products={products} value={l.product_id} onSelect={(v) => onProduct(i, v)} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">بالنظام</Label>
                    <Input type="number" value={l.system_quantity} disabled />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">الفعلي</Label>
                    <Input type="number" value={l.actual_quantity} onChange={(e) => updateLine(i, { actual_quantity: Number(e.target.value) })} />
                  </div>
                  <div className="col-span-2 text-center">
                    <Label className="text-xs text-muted-foreground">الفرق</Label>
                    <div className={`font-bold ${diff > 0 ? "text-success" : diff < 0 ? "text-destructive" : ""}`}>
                      {diff > 0 ? "+" : ""}{diff}
                    </div>
                  </div>
                  <div className="col-span-1"><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end pt-3 border-t">
          <Button onClick={submit} disabled={busy} size="lg">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ الجرد"}
          </Button>
        </div>
      </div>
    </BranchLayout>
  );
}
