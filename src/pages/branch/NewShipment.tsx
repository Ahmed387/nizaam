import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Upload, ImageIcon } from "lucide-react";
import { uploadProductImage } from "@/lib/uploadImage";

interface Line {
  product_id: string | null;
  product_name: string;
  sku: string;
  quantity: number;
  cost_price: number;
  image: string;
  uploadingImg?: boolean;
}

// توليد كود فريد للمنتج الجديد
const genSku = () =>
  `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

export default function NewShipment() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const nav = useNavigate();

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [priceList, setPriceList] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [arrival, setArrival] = useState(new Date().toISOString().split("T")[0]);
  const [receivedBy, setReceivedBy] = useState(profile?.name ?? "");
  const [shipping, setShipping] = useState(0);
  const [admin, setAdmin] = useState(0);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    supabase.from("suppliers").select("*").order("company_name").then(({ data }) => setSuppliers(data ?? []));
    supabase.from("products").select("*").eq("branch_id", branchId).order("name").then(({ data }) => setProducts(data ?? []));
    supabase.from("price_list").select("*").order("product_name").then(({ data }) => setPriceList(data ?? []));
  }, [branchId]);

  useEffect(() => {
    if (profile?.name && !receivedBy) setReceivedBy(profile.name);
  }, [profile]);

  const addLine = () =>
    setLines([...lines, { product_id: null, product_name: "", sku: genSku(), quantity: 1, cost_price: 0, image: "" }]);

  const updateLine = (i: number, patch: Partial<Line>) => {
    const copy = [...lines];
    copy[i] = { ...copy[i], ...patch };
    setLines(copy);
  };

  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const itemsTotal = lines.reduce((s, l) => s + l.quantity * l.cost_price, 0);
  const grandTotal = itemsTotal + Number(shipping || 0) + Number(admin || 0);

  const handleProductChange = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (p) updateLine(i, { product_id: p.id, product_name: p.name, sku: p.sku, cost_price: Number(p.cost_price) });
    else updateLine(i, { product_id: productId });
  };

  // اختيار منتج من الـ price list (للمنتجات الجديدة على الفرع)
  const handlePriceListPick = (i: number, plId: string) => {
    const pl = priceList.find((x) => x.id === plId);
    if (!pl) return;
    updateLine(i, {
      product_id: null,
      product_name: pl.product_name,
      sku: pl.sku || genSku(),
      cost_price: Number(pl.new_price ?? pl.market_price ?? 0),
    });
  };

  const submit = async () => {
    if (!supplierId) return toast.error("اختر المورد");
    if (!receivedBy.trim()) return toast.error("أدخل اسم المستلم");
    if (!lines.length) return toast.error("أضف منتجاً واحداً على الأقل");
    for (const l of lines) {
      if (!l.product_name.trim() || l.quantity <= 0 || l.cost_price < 0)
        return toast.error("تأكد من بيانات كل المنتجات");
    }

    setBusy(true);
    try {
      // Insert shipment
      const { data: ship, error: e1 } = await supabase
        .from("shipments")
        .insert({
          branch_id: branchId!,
          supplier_id: supplierId,
          arrival_date: arrival,
          received_by: receivedBy.trim(),
          shipping_cost: Number(shipping || 0),
          admin_cost: Number(admin || 0),
          total_cost: grandTotal,
          notes: notes.trim() || null,
        })
        .select()
        .single();
      if (e1) throw e1;

      // Insert items + update stock
      for (const l of lines) {
        let pid = l.product_id;
        // Create product if new
        if (!pid) {
          const sku = (l.sku && l.sku.trim()) || genSku();
          const { data: np, error: ep } = await supabase
            .from("products")
            .insert({
              branch_id: branchId!,
              name: l.product_name.trim(),
              sku,
              cost_price: l.cost_price,
              selling_price: l.cost_price * 1.3,
              market_price: l.cost_price * 1.3,
              quantity: 0,
            })
            .select()
            .single();
          if (ep) throw ep;
          pid = np.id;
        }
        await supabase.from("shipment_items").insert({
          shipment_id: ship.id,
          product_id: pid,
          product_name: l.product_name,
          quantity: l.quantity,
          cost_price: l.cost_price,
          total: l.quantity * l.cost_price,
        });
        // Update product stock + cost
        const cur = products.find((p) => p.id === pid);
        const newQty = (cur?.quantity ?? 0) + l.quantity;
        await supabase
          .from("products")
          .update({ quantity: newQty, cost_price: l.cost_price })
          .eq("id", pid);
      }

      // Treasury expense
      await supabase.from("treasury").insert({
        branch_id: branchId!,
        type: "expense",
        category: "shipment",
        amount: grandTotal,
        description: `شحنة #${ship.id.slice(0, 8)}`,
        reference_id: ship.id,
        created_by: user!.id,
      });

      await logAudit({
        userId: user!.id,
        userName: profile?.name ?? "",
        branchId,
        action: "CREATE",
        entity: "shipment",
        entityId: ship.id,
        details: { total: grandTotal, items: lines.length },
      });

      toast.success("تم تسجيل الشحنة بنجاح");
      nav(`/branch/${branchId}/shipments/${ship.id}`);
    } catch (err: any) {
      toast.error(err.message ?? "خطأ في حفظ الشحنة");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BranchLayout>
      <PageHeader title="شحنة جديدة" subtitle="استلام بضاعة من مورد" />

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <div className="card-elevated p-4 space-y-3">
          <div>
            <Label>المورد *</Label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full mt-1 bg-surface border border-border rounded-md px-3 py-2 text-sm"
            >
              <option value="">— اختر —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.company_name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>تاريخ الوصول</Label>
            <Input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} />
          </div>
          <div>
            <Label>اسم المستلم</Label>
            <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
          </div>
        </div>

        <div className="card-elevated p-4 space-y-3">
          <div>
            <Label>تكلفة الشحن</Label>
            <Input type="number" min={0} value={shipping} onChange={(e) => setShipping(Number(e.target.value))} />
          </div>
          <div>
            <Label>مصاريف إدارية</Label>
            <Input type="number" min={0} value={admin} onChange={(e) => setAdmin(Number(e.target.value))} />
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="card-elevated p-4 flex flex-col justify-between">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">إجمالي البضاعة</span><b>{formatEGP(itemsTotal)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">الشحن</span><b>{formatEGP(shipping)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">إدارية</span><b>{formatEGP(admin)}</b></div>
            <div className="border-t border-border pt-2 flex justify-between text-lg">
              <span>الإجمالي</span>
              <b className="text-primary">{formatEGP(grandTotal)}</b>
            </div>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full mt-4 gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            حفظ الشحنة
          </Button>
        </div>
      </div>

      <div className="card-elevated overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-bold">المنتجات</h3>
          <Button size="sm" onClick={addLine} className="gap-2"><Plus className="w-4 h-4" />إضافة صنف</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="px-3 py-2 text-right">المنتج</th>
                <th className="px-3 py-2 text-right">الكود (SKU)</th>
                <th className="px-3 py-2 text-right">الكمية</th>
                <th className="px-3 py-2 text-right">سعر التكلفة</th>
                <th className="px-3 py-2 text-right">الإجمالي</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-8">اضغط "إضافة صنف" لبدء تسجيل المنتجات</td></tr>
              )}
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-border align-top">
                  <td className="px-3 py-2 min-w-[300px]">
                    <select
                      value={l.product_id ?? ""}
                      onChange={(e) => {
                        if (e.target.value === "__new__") {
                          updateLine(i, { product_id: null, product_name: "", sku: genSku() });
                        } else handleProductChange(i, e.target.value);
                      }}
                      className="w-full bg-surface border border-border rounded-md px-2 py-1.5 text-sm mb-1"
                    >
                      <option value="">— اختر من مخزون الفرع —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} — {p.sku} (متوفر: {p.quantity})</option>
                      ))}
                      <option value="__new__">+ منتج جديد</option>
                    </select>
                    {l.product_id === null && (
                      <>
                        {priceList.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => e.target.value && handlePriceListPick(i, e.target.value)}
                            className="w-full bg-surface border border-border rounded-md px-2 py-1.5 text-sm mb-1"
                          >
                            <option value="">— أو اختر من قائمة الأسعار —</option>
                            {priceList.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.product_name}{p.sku ? ` — ${p.sku}` : ""}
                              </option>
                            ))}
                          </select>
                        )}
                        <Input
                          placeholder="اسم المنتج الجديد"
                          value={l.product_name}
                          onChange={(e) => updateLine(i, { product_name: e.target.value })}
                        />
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 w-40">
                    <Input
                      value={l.sku}
                      onChange={(e) => updateLine(i, { sku: e.target.value })}
                      readOnly={l.product_id !== null}
                      className={l.product_id !== null ? "bg-surface-2 font-mono text-xs" : "font-mono text-xs"}
                    />
                  </td>
                  <td className="px-3 py-2 w-24">
                    <Input type="number" min={1} value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} />
                  </td>
                  <td className="px-3 py-2 w-32">
                    <Input type="number" min={0} step="0.01" value={l.cost_price} onChange={(e) => updateLine(i, { cost_price: Number(e.target.value) })} />
                  </td>
                  <td className="px-3 py-2 w-32 font-bold">{formatEGP(l.quantity * l.cost_price)}</td>
                  <td className="px-3 py-2 w-12">
                    <Button size="sm" variant="ghost" onClick={() => removeLine(i)} className="text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </BranchLayout>
  );
}
