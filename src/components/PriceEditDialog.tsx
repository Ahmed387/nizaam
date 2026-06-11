import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";

/**
 * Modal for manual price edits that REQUIRES a reason (>=10 chars).
 * Calls the `update_product_price_with_reason` RPC which enforces
 * the rule server-side and writes the audit log via trigger.
 */
export function PriceEditDialog({
  open, onOpenChange, product, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: { id: string; name: string; selling_price: number | null; cost_price: number | null; market_price: number | null };
  onSaved?: () => void;
}) {
  const [selling, setSelling] = useState<string>(String(product.selling_price ?? ""));
  const [cost, setCost] = useState<string>(String(product.cost_price ?? ""));
  const [market, setMarket] = useState<string>(String(product.market_price ?? ""));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const changed =
    Number(selling) !== Number(product.selling_price ?? 0) ||
    Number(cost) !== Number(product.cost_price ?? 0) ||
    Number(market) !== Number(product.market_price ?? 0);

  const save = async () => {
    if (!changed) { toast.info("لم يتم تعديل أي سعر"); return; }
    if (reason.trim().length < 10) { toast.error("يجب إدخال سبب التعديل (10 أحرف على الأقل)"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("update_product_price_with_reason" as any, {
      _product_id: product.id,
      _selling_price: selling === "" ? null : Number(selling),
      _cost_price: cost === "" ? null : Number(cost),
      _market_price: market === "" ? null : Number(market),
      _reason: reason.trim(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم حفظ التعديل");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل أسعار: {product.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>سعر البيع (الحالي: {formatEGP(product.selling_price ?? 0)})</Label>
            <Input type="number" value={selling} onChange={(e) => setSelling(e.target.value)} />
          </div>
          <div>
            <Label>سعر التكلفة (الحالي: {formatEGP(product.cost_price ?? 0)})</Label>
            <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div>
            <Label>سعر السوق (الحالي: {formatEGP(product.market_price ?? 0)})</Label>
            <Input type="number" value={market} onChange={(e) => setMarket(e.target.value)} />
          </div>
          <div>
            <Label className="text-destructive">سبب تعديل السعر (إجباري — 10 أحرف على الأقل)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: زيادة في تكلفة الاستيراد..." rows={3} />
            <div className="text-xs text-muted-foreground mt-1">{reason.trim().length}/10</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} disabled={busy || !changed || reason.trim().length < 10}>
            {busy ? "جاري الحفظ..." : "حفظ التعديل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
