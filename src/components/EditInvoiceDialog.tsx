import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";
import { Trash2, Plus } from "lucide-react";


type Item = {
  id?: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  cost_price: number;
  selling_price: number;
  market_price: number;
  line_discount: number;
};

export function EditInvoiceDialog({
  open,
  onOpenChange,
  invoice,
  branchId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice: any;
  branchId: string;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [openSuggestIdx, setOpenSuggestIdx] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);


  useEffect(() => {
    if (!open || !invoice?.id) return;
    (async () => {
      const { data: its } = await supabase.from("invoice_items").select("*").eq("invoice_id", invoice.id);
      setItems(
        (its ?? []).map((it: any) => ({
          id: it.id,
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: Number(it.quantity ?? 0),
          cost_price: Number(it.cost_price ?? 0),
          selling_price: Number(it.selling_price ?? 0),
          market_price: Number(it.market_price ?? 0),
          line_discount: Number(it.line_discount ?? 0),
        }))
      );
      setCustomerId(invoice.contact_id ?? null);
      const [{ data: c }, { data: p }] = await Promise.all([
        supabase.from("contacts").select("id, name").eq("branch_id", branchId).order("name"),
        supabase.from("products").select("id, name, sku, quantity, cost_price, selling_price, market_price").eq("branch_id", branchId).order("name"),
      ]);
      setCustomers(c ?? []);
      setProducts(p ?? []);
    })();
  }, [open, invoice?.id, branchId]);

  const updateItem = (idx: number, patch: Partial<Item>) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const removeItem = (idx: number) => setItems((arr) => arr.filter((_, i) => i !== idx));

  const addBlankItem = () => {
    setItems((arr) => [
      ...arr,
      { product_id: null, product_name: "", quantity: 1, cost_price: 0, selling_price: 0, market_price: 0, line_discount: 0 },
    ]);
    setOpenSuggestIdx(items.length);
  };

  const pickProduct = (idx: number, p: any) => {
    updateItem(idx, {
      product_id: p.id,
      product_name: p.name,
      cost_price: Number(p.cost_price ?? 0),
      selling_price: Number(p.selling_price ?? 0),
      market_price: Number(p.market_price ?? 0),
    });
    setOpenSuggestIdx(null);
  };

  const suggestionsFor = (q: string) => {
    const s = q.trim().toLowerCase();
    if (!s) return products.slice(0, 8);
    return products.filter((p) => `${p.name} ${p.sku ?? ""}`.toLowerCase().includes(s)).slice(0, 8);
  };

  const subtotal = items.reduce((s, it) => s + it.selling_price * it.quantity, 0);
  const lineDiscounts = items.reduce((s, it) => s + Number(it.line_discount || 0), 0);
  const invDiscount = Number(invoice?.discount_amount ?? 0);
  const total = Math.max(subtotal - lineDiscounts - invDiscount, 0);

  const save = async () => {
    const clean = items.filter((it) => it.product_name.trim() && it.quantity > 0);
    if (clean.length === 0) return toast.error("لازم يكون فيه منتج واحد على الأقل");
    setSaving(true);
    const { error } = await supabase.rpc("edit_invoice" as any, {
      _invoice_id: invoice.id,
      _customer_id: customerId,
      _items: clean as any,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تعديل الفاتورة وتحديث المخزون والإجماليات");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تعديل الفاتورة {invoice?.invoice_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">العميل</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={customerId ?? ""}
              onChange={(e) => setCustomerId(e.target.value || null)}
            >
              <option value="">عميل نقدي</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-bold">بنود الفاتورة</Label>
              <Button size="sm" variant="outline" onClick={addBlankItem} className="gap-1">
                <Plus className="w-4 h-4" /> إضافة بند
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-border">
                <thead className="bg-surface-2">
                  <tr>
                    <th className="p-2 text-right">المنتج</th>
                    <th className="p-2 text-center w-20">الكمية</th>
                    <th className="p-2 text-center w-28">سعر البيع</th>
                    <th className="p-2 text-center w-24">خصم البند</th>
                    <th className="p-2 text-left w-28">الإجمالي</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className="border-t border-border">
                      <td className="p-1 relative">
                        <Input
                          value={it.product_name}
                          onChange={(e) => {
                            updateItem(idx, { product_name: e.target.value, product_id: null });
                            setOpenSuggestIdx(idx);
                          }}
                          onFocus={() => setOpenSuggestIdx(idx)}
                          onBlur={() => setTimeout(() => setOpenSuggestIdx((cur) => (cur === idx ? null : cur)), 150)}
                          placeholder="ابحث باسم المنتج أو SKU..."
                          className={`h-8 ${!it.product_id ? "border-warning" : ""}`}
                        />
                        {openSuggestIdx === idx && (
                          <div className="absolute z-50 mt-1 w-72 max-h-64 overflow-y-auto bg-popover border border-border rounded-md shadow-lg right-0">
                            {suggestionsFor(it.product_name).length === 0 ? (
                              <div className="p-2 text-xs text-muted-foreground text-center">لا توجد منتجات مطابقة في المخزن</div>
                            ) : (
                              suggestionsFor(it.product_name).map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onMouseDown={(e) => { e.preventDefault(); pickProduct(idx, p); }}
                                  className="w-full text-right p-2 hover:bg-muted text-xs border-b border-border last:border-0"
                                >
                                  <div className="font-semibold">{p.name}</div>
                                  <div className="text-[10px] text-muted-foreground flex justify-between">
                                    <span>SKU: {p.sku ?? "—"}</span>
                                    <span>متاح: {p.quantity} | {formatEGP(p.selling_price)}</span>
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                        {!it.product_id && it.product_name && (
                          <div className="text-[10px] text-warning mt-0.5">⚠️ منتج غير مربوط بالمخزون</div>
                        )}
                      </td>
                      <td className="p-1">
                        <Input type="number" min="1" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 0 })} className="h-8 text-center" />
                      </td>
                      <td className="p-1">
                        <Input type="number" min="0" step="0.01" value={it.selling_price} onChange={(e) => updateItem(idx, { selling_price: Number(e.target.value) || 0 })} className="h-8 text-center" />
                      </td>
                      <td className="p-1">
                        <Input type="number" min="0" step="0.01" value={it.line_discount} onChange={(e) => updateItem(idx, { line_discount: Number(e.target.value) || 0 })} className="h-8 text-center" />
                      </td>
                      <td className="p-2 text-left font-bold">{formatEGP(it.selling_price * it.quantity - it.line_discount)}</td>
                      <td className="p-1 text-center">
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeItem(idx)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-surface-2 p-3 rounded-lg space-y-1 text-sm">
            <div className="flex justify-between"><span>الإجمالي قبل الخصم:</span><span className="font-bold">{formatEGP(subtotal)}</span></div>
            <div className="flex justify-between text-destructive"><span>خصم البنود:</span><span>- {formatEGP(lineDiscounts)}</span></div>
            {invDiscount > 0 && <div className="flex justify-between text-destructive"><span>خصم الفاتورة (محفوظ):</span><span>- {formatEGP(invDiscount)}</span></div>}
            <div className="flex justify-between text-lg pt-2 border-t border-border"><span className="font-bold">الإجمالي النهائي:</span><span className="text-primary font-extrabold">{formatEGP(total)}</span></div>
          </div>

          <div className="text-xs text-muted-foreground bg-warning/10 border border-warning/30 rounded p-2">
            ⚠️ التعديل بيرجّع البضاعة القديمة للمخزن ويخصم البضاعة الجديدة تلقائياً. الخزنة هتتحدث على الإجمالي الجديد. المدفوعات والأقساط مش بتتغير — لو الإجمالي قلّ هيظهر فائض، ولو زاد هيبقي فيه متبقي إضافي.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button>
          <Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ التعديلات"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
