import { useState } from "react";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pack units (migration 0192): quantities are ALWAYS pieces in the system; a product only knows how many pieces its pack
 * («كرتونة») holds. These helpers show a quantity as packs + pieces and let a line add / remove a whole pack.
 */
export const packOf = (p: any): { size: number; name: string } => ({ size: Math.max(1, Number(p?.pack_size) || 1), name: p?.pack_name || "كرتونة" });
/** Price of one full pack: the special `pack_price` when the owner set one, else pack size × the piece price. */
export const packPriceOf = (p: any, piecePrice?: number): number => {
  const sp = Number(p?.pack_price);
  return sp > 0 ? sp : packOf(p).size * (Number(piecePrice ?? p?.selling_price) || 0);
};
/** What a line of `qty` pieces costs when full packs go at the pack price and the rest at the piece price. */
export const packLineTotal = (qty: number, p: any, piecePrice: number): number => {
  const { size } = packOf(p); const q = Math.max(0, Math.trunc(Number(qty) || 0));
  return Math.floor(q / size) * packPriceOf(p, piecePrice) + (q % size) * piecePrice;
};

/** «2 كرتونة + 1 قطعة» — empty when the product is sold by the piece only. */
export function packText(qty: number, size: number, name = "كرتونة"): string {
  const q = Math.trunc(Number(qty) || 0);
  if (size <= 1 || q === 0) return "";
  const sign = q < 0 ? "−" : "";
  const a = Math.abs(q), packs = Math.floor(a / size), rest = a % size;
  return sign + [packs ? `${packs} ${name}` : "", rest ? `${rest} قطعة` : ""].filter(Boolean).join(" + ");
}

/** Under a quantity input of a sale / purchase line: «= 2 كرتونة + 1 قطعة» and −/+ a whole pack. Renders nothing for size 1. */
export function PackStepper({ qty, product, onChange, min = 1, piecePrice, onApplyDiscount }: {
  qty: number; product: any; onChange: (q: number) => void; min?: number;
  /** sale lines only: the line's piece price and a setter of its discount — offers the special pack price as a discount */
  piecePrice?: number; onApplyDiscount?: (discount: number) => void;
}) {
  const { size, name } = packOf(product);
  if (size <= 1) return null;
  const q = Number(qty) || 0;
  const special = Number(product?.pack_price) > 0 && piecePrice != null;
  const saving = special ? Math.round((q * piecePrice! - packLineTotal(q, product, piecePrice!)) * 100) / 100 : 0;
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-1 text-[11px] text-muted-foreground">
      {special && (
        <span className="basis-full text-center">
          سعر ال{name}: <b className="tabular-nums">{packPriceOf(product, piecePrice).toLocaleString("en-US")}</b>
          {saving > 0.005 && onApplyDiscount && (
            <button type="button" className="mr-1 rounded border border-primary/40 px-1.5 py-0.5 text-primary hover:bg-primary/10"
              title={`يخصم ${saving.toLocaleString("en-US")} عشان الكراتين الكاملة تتحسب بسعر ال${name}`} onClick={() => onApplyDiscount(saving)}>طبّق سعر ال{name}</button>
          )}
        </span>
      )}
      <button type="button" className="rounded border border-border px-1.5 py-0.5 hover:bg-muted disabled:opacity-40" disabled={q - size < min}
        title={`نقّص ${name} (${size} قطعة)`} onClick={() => onChange(Math.max(min, q - size))}>− {name}</button>
      <span className="tabular-nums whitespace-nowrap">= {packText(q, size, name) || "0"}</span>
      <button type="button" className="rounded border border-border px-1.5 py-0.5 hover:bg-muted"
        title={`زوّد ${name} (${size} قطعة)`} onClick={() => onChange(q <= 1 && q < size ? size : q + size)}>+ {name}</button>
    </div>
  );
}

/** Small button + dialog to set how many pieces the pack of a product holds (all branches of the same code). */
export function PackSizeButton({ product, onDone }: { product: any; onDone?: () => void }) {
  const cur = packOf(product);
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(String(cur.size > 1 ? cur.size : 3));
  const [name, setName] = useState(cur.name);
  const [price, setPrice] = useState(Number(product?.pack_price) > 0 ? String(product.pack_price) : "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = parseInt(size) || 0;
    if (n < 1) return toast.error("عدد القطع لازم يكون 1 أو أكتر");
    setBusy(true);
    try {
      const { error } = await (supabase.rpc as any)("set_product_pack", { p_product: product.id, p_size: n, p_name: name.trim() || null, p_pack_price: Number(price) > 0 ? Number(price) : null });
      if (error) throw error;
      toast.success(n > 1 ? `${name || "كرتونة"} «${product.name}» = ${n} قطعة` : "الصنف بقى بالقطعة بس");
      setOpen(false); onDone?.();
    } catch (e: any) { toast.error(e?.message ?? "تعذر الحفظ"); } finally { setBusy(false); }
  };
  return (
    <>
      <Button size="icon" variant="outline" className="h-8 w-8" title={cur.size > 1 ? `${cur.name} = ${cur.size} قطعة — تعديل` : "تحديد الكرتونة (كام قطعة)"}
        onClick={() => { setSize(String(cur.size > 1 ? cur.size : 3)); setName(cur.name); setPrice(Number(product?.pack_price) > 0 ? String(product.pack_price) : ""); setOpen(true); }}>
        <Package className="w-4 h-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>وحدة الصنف</DialogTitle>
            <DialogDescription>
              المخزون والأسعار والفواتير بتفضل بالقطعة. هنا بتحدد الكرتونة فيها كام قطعة عشان الكميات تتعرض وتتكتب بالكرتونة كمان. بيتطبق على نفس الكود في كل الفروع.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>اسم الوحدة الكبيرة</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="كرتونة" className="mt-1.5" /></div>
            <div><Label>فيها كام قطعة (1 = بالقطعة بس)</Label><Input type="number" min={1} value={size} onChange={(e) => setSize(e.target.value)} className="mt-1.5" /></div>
            <div>
              <Label>سعر بيع ال{name || "كرتونة"} (اختياري)</Label>
              <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1.5"
                placeholder={`${((parseInt(size) || 1) * (Number(product?.selling_price) || 0)).toLocaleString("en-US")} — محسوب من سعر القطعة`} />
              <p className="mt-1 text-[11px] text-muted-foreground">سعر القطعة {Number(product?.selling_price || 0).toLocaleString("en-US")}. سيبه فاضي والسيستم يحسب ال{name || "كرتونة"} = عدد القطع × سعر القطعة. اكتب سعر لو ال{name || "كرتونة"} ليها سعر مخصوص.</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>إلغاء</Button>
            <Button className="btn-gradient" onClick={save} disabled={busy}>{busy ? "بحفظ…" : "حفظ"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
