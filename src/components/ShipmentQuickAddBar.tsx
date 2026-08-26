import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, Package, Tag, Plus, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface QuickAddPick {
  product_id: string | null;
  product_name: string;
  sku: string;
  cost_price: number;
  image: string;
  source: "inventory" | "pricelist" | "manual";
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  product_type?: string | null;
  capacity?: string | null;
  size?: string | null;
}

interface InvRow {
  id: string; name: string; sku: string; quantity: number; cost_price: number; image: string | null;
  brand: string | null; model: string | null; color: string | null; product_type: string | null; capacity: string | null; size: string | null;
}
interface PlRow { id: string; product_name: string; model_code: string | null; supplier_name: string | null; display_price: number | null }

/**
 * شريط بحث واحد فوق قسم المنتجات:
 * تكتب اسم/كود المنتج → تختار من نتائج المخزون أو قائمة الأسعار → الصنف يتضاف فورًا للجدول.
 * ولو مش موجود، تقدر تضيفه كصنف جديد من نفس الشريط.
 */
export function ShipmentQuickAddBar({
  branchId,
  onPick,
  autoFocus,
}: {
  branchId: string;
  onPick: (p: QuickAddPick) => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [inv, setInv] = useState<InvRow[]>([]);
  const [pl, setPl] = useState<PlRow[]>([]);
  const [openList, setOpenList] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setInv([]); setPl([]); setLoading(false); return; }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const esc = term.replace(/[%,()]/g, " ");
      const [invRes, plRes] = await Promise.all([
        supabase.from("products")
          .select("id, name, sku, quantity, cost_price, image, brand, model, color, product_type, capacity, size")
          .eq("branch_id", branchId)
          .or(`name.ilike.%${esc}%,sku.ilike.%${esc}%,model.ilike.%${esc}%,brand.ilike.%${esc}%`)
          .limit(8),
        supabase.from("price_list_items_public" as any)
          .select("id, product_name, model_code, supplier_name, display_price")
          .eq("is_active", true)
          .or(`product_name.ilike.%${esc}%,model_code.ilike.%${esc}%`)
          .limit(6),
      ]);
      if (cancelled) return;
      setInv((invRes.data ?? []) as any);
      setPl((plRes.data ?? []) as any);
      setLoading(false);
      setCursor(0);
      setOpenList(true);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, branchId]);

  const manualOption: QuickAddPick | null = q.trim().length >= 2
    ? { product_id: null, product_name: q.trim(), sku: "", cost_price: 0, image: "", source: "manual" }
    : null;

  const options: QuickAddPick[] = [
    ...inv.map((p) => ({
      product_id: p.id, product_name: p.name, sku: p.sku, cost_price: Number(p.cost_price), image: p.image ?? "",
      source: "inventory" as const, brand: p.brand, model: p.model, color: p.color, product_type: p.product_type, capacity: p.capacity, size: p.size,
    })),
    ...pl.map((r) => ({
      product_id: null, product_name: r.product_name, sku: r.model_code || "", cost_price: Number(r.display_price ?? 0),
      image: "", source: "pricelist" as const,
    })),
    ...(manualOption ? [manualOption] : []),
  ];

  const choose = (p: QuickAddPick) => {
    onPick(p);
    setQ("");
    setInv([]); setPl([]);
    setOpenList(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border-2 border-primary/30 bg-primary/5 px-3 py-2 focus-within:border-primary transition-colors">
        <Search className="w-4 h-4 text-primary shrink-0" />
        <Input
          ref={inputRef}
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q.trim().length >= 2 && setOpenList(true)}
          onKeyDown={(e) => {
            if (!options.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % options.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + options.length) % options.length); }
            else if (e.key === "Enter") { e.preventDefault(); choose(options[cursor] ?? options[0]); }
            else if (e.key === "Escape") setOpenList(false);
          }}
          placeholder="ابحث بالاسم أو الكود أو الموديل… واضغط Enter لإضافة الصنف"
          className="border-0 bg-transparent focus-visible:ring-0 h-9 px-0 text-sm"
        />
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
        {q && !loading && (
          <button type="button" onClick={() => { setQ(""); setOpenList(false); }} className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {openList && options.length > 0 && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpenList(false)} />
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-popover shadow-lg overflow-hidden max-h-80 overflow-y-auto">
            {options.map((o, idx) => (
              <button
                key={`${o.source}-${o.product_id ?? o.product_name}-${idx}`}
                type="button"
                onMouseEnter={() => setCursor(idx)}
                onClick={() => choose(o)}
                className={cn(
                  "w-full text-right flex items-center gap-2 px-3 py-2 text-sm border-b border-border/50 last:border-0",
                  idx === cursor ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                {o.source === "inventory" && <Package className="w-4 h-4 text-primary shrink-0" />}
                {o.source === "pricelist" && <Tag className="w-4 h-4 text-amber-600 shrink-0" />}
                {o.source === "manual" && <Plus className="w-4 h-4 text-emerald-600 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium truncate">
                    {o.source === "manual" ? `إضافة «${o.product_name}» كصنف جديد` : o.product_name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground truncate">
                    {o.source === "inventory" ? [o.sku, o.brand, o.model].filter(Boolean).join(" · ")
                      : o.source === "pricelist" ? `من قائمة الأسعار${o.sku ? ` · ${o.sku}` : ""}`
                      : "هيتسجل في المخزن بعد الحفظ"}
                  </span>
                </span>
                {o.cost_price > 0 && (
                  <span className="shrink-0 text-[11px] font-semibold text-primary">{o.cost_price.toLocaleString()}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
