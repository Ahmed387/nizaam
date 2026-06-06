import { useCallback, useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronsUpDown, Loader2, Package, Tag, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { ProductPicker, ProductRow } from "@/components/ProductPicker";

export type Source = "inventory" | "pricelist" | "manual";

export interface PickedProduct {
  product_id: string | null;
  product_name: string;
  sku: string;
  cost_price: number;
  image: string;
  source: Source;
  available?: number | null;
}

interface PriceListRow {
  id: string;
  product_name: string;
  model_code: string | null;
  supplier_name: string | null;
  display_price: number | null;
}

export function ShipmentLineProductCell({
  branchId,
  value,
  onChange,
}: {
  branchId: string;
  value: { product_id: string | null; product_name: string; sku: string; image: string };
  onChange: (p: PickedProduct) => void;
}) {
  const [source, setSource] = useState<Source>(value.product_id ? "inventory" : "manual");
  const [available, setAvailable] = useState<number | null>(null);
  const [manualMatches, setManualMatches] = useState<{
    inventory: { id: string; name: string; sku: string; quantity: number; cost_price: number; image: string | null }[];
    pricelist: PriceListRow[];
  }>({ inventory: [], pricelist: [] });

  // keep "available" in sync when product changes
  const refreshAvailable = useCallback(async () => {
    if (!value.product_id) { setAvailable(null); return; }
    const { data } = await supabase.from("products").select("quantity").eq("id", value.product_id).maybeSingle();
    setAvailable(data ? Number(data.quantity) : null);
  }, [value.product_id]);
  useEffect(() => { refreshAvailable(); }, [refreshAvailable]);
  useRealtimeRefresh(["products"], refreshAvailable);

  // Search inventory + price list when typing manually
  useEffect(() => {
    if (source !== "manual") { setManualMatches({ inventory: [], pricelist: [] }); return; }
    const q = value.product_name.trim();
    if (q.length < 2) { setManualMatches({ inventory: [], pricelist: [] }); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const esc = q.replace(/[%,()]/g, " ");
      const [invRes, plRes] = await Promise.all([
        supabase.from("products")
          .select("id, name, sku, quantity, cost_price, image")
          .eq("branch_id", branchId)
          .or(`name.ilike.%${esc}%,sku.ilike.%${esc}%`)
          .limit(5),
        supabase.from("price_list_items_public")
          .select("id, product_name, model_code, supplier_name, display_price")
          .eq("is_active", true)
          .or(`product_name.ilike.%${esc}%,model_code.ilike.%${esc}%`)
          .limit(5),
      ]);
      if (cancelled) return;
      setManualMatches({
        inventory: (invRes.data ?? []) as any,
        pricelist: (plRes.data ?? []) as any,
      });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [source, value.product_name, branchId]);

  return (
    <div className="space-y-2">
      {/* Source switch */}
      <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5 text-[11px]">
        <SrcBtn active={source === "inventory"} onClick={() => setSource("inventory")} icon={<Package className="w-3 h-3" />}>مخزون الفرع</SrcBtn>
        <SrcBtn active={source === "pricelist"} onClick={() => setSource("pricelist")} icon={<Tag className="w-3 h-3" />}>قائمة الأسعار</SrcBtn>
        <SrcBtn active={source === "manual"} onClick={() => setSource("manual")} icon={<Pencil className="w-3 h-3" />}>كتابة يدوية</SrcBtn>
      </div>

      {/* Picker per source */}
      {source === "inventory" && (
        <ProductPicker
          branchId={branchId}
          value={value.product_id}
          onPick={(p: ProductRow) => onChange({
            product_id: p.id,
            product_name: p.name,
            sku: p.sku,
            cost_price: Number(p.cost_price),
            image: p.image ?? "",
            source: "inventory",
            available: Number(p.quantity),
          })}
          triggerLabel="— اختر من مخزون الفرع —"
        />
      )}

      {source === "pricelist" && (
        <PriceListPicker
          value={value.product_name}
          onPick={(r) => onChange({
            product_id: null,
            product_name: r.product_name,
            sku: r.model_code || "",
            cost_price: Number(r.display_price ?? 0),
            image: "",
            source: "pricelist",
            available: null,
          })}
        />
      )}

      {source === "manual" && (
        <Input
          autoFocus={!value.product_name}
          placeholder="اكتب اسم المنتج..."
          value={value.product_name}
          onChange={(e) => onChange({
            product_id: null,
            product_name: e.target.value,
            sku: value.sku,
            cost_price: 0,
            image: value.image,
            source: "manual",
            available: null,
          })}
        />
      )}

      {/* Selected product info */}
      {value.product_name && (
        <div className="flex items-center flex-wrap gap-1.5 text-[11px]">
          <span className="font-semibold text-foreground bg-primary/10 text-primary px-2 py-0.5 rounded">
            {value.product_name}
          </span>
          {source === "inventory" && available !== null && (
            <span className={cn(
              "px-2 py-0.5 rounded font-semibold",
              available > 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
            )}>
              متاح: {available}
            </span>
          )}
          {source === "pricelist" && (
            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">من قائمة الأسعار — سيُنشأ صنف جديد</span>
          )}
          {source === "manual" && (
            <span className="px-2 py-0.5 rounded bg-success/15 text-success">صنف جديد</span>
          )}
        </div>
      )}
    </div>
  );
}

function SrcBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded transition-colors",
        active ? "bg-background shadow-sm text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}{children}
    </button>
  );
}

function PriceListPicker({ value, onPick }: { value: string; onPick: (r: PriceListRow) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PriceListRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("price_list_items_public")
      .select("id, product_name, model_code, supplier_name, display_price")
      .eq("is_active", true)
      .order("product_name");
    setRows((data ?? []) as PriceListRow[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["price_list_items"], load);

  const selected = useMemo(() => rows.find((r) => r.product_name === value), [rows, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal">
          <span className="truncate text-right flex-1">
            {selected ? selected.product_name : <span className="text-muted-foreground">— اختر من قائمة الأسعار —</span>}
          </span>
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter>
          <CommandInput placeholder="ابحث في قائمة الأسعار..." />
          <CommandList>
            {loading ? (
              <div className="text-center py-6"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>
            ) : rows.length === 0 ? (
              <CommandEmpty>لا توجد عناصر في قائمة الأسعار</CommandEmpty>
            ) : (
              <CommandGroup>
                {rows.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={`${r.product_name} ${r.model_code ?? ""} ${r.supplier_name ?? ""}`}
                    onSelect={() => { onPick(r); setOpen(false); }}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.product_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.model_code ?? "—"}{r.supplier_name ? ` · ${r.supplier_name}` : ""}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-primary font-semibold">
                      {Number(r.display_price ?? 0).toLocaleString()} ج
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
