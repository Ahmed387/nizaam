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
import { Loader2, Plus, Trash2, Upload, ImageIcon, UserPlus } from "lucide-react";
import { uploadProductImage } from "@/lib/uploadImage";
import { PaymentPlanSelector, defaultPlan, PaymentPlanState } from "@/components/PaymentPlanSelector";
import { createPaymentPlanWithInitial } from "@/lib/paymentPlans";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PartyCombobox } from "@/components/PartyCombobox";
import { ProductPicker } from "@/components/ProductPicker";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

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
  const [plan, setPlan] = useState<PaymentPlanState>(defaultPlan());
  const [supplierDlg, setSupplierDlg] = useState(false);
  const [newSup, setNewSup] = useState({ name: "", contact_person: "", phone: "", address: "" });
  const [savingSup, setSavingSup] = useState(false);

  const createSupplier = async () => {
    if (!newSup.name.trim()) return toast.error("اسم الشركة مطلوب");
    setSavingSup(true);
    const { data, error } = await supabase.from("contacts").insert({
      name: newSup.name.trim(),
      contact_person: newSup.contact_person.trim() || null,
      phone: newSup.phone.trim() || null,
      address: newSup.address.trim() || null,
    }).select().single();
    setSavingSup(false);
    if (error || !data) return toast.error(error?.message ?? "فشل الإضافة");
    setSuppliers([data, ...suppliers]);
    setSupplierId(data.id);
    setSupplierDlg(false);
    setNewSup({ name: "", contact_person: "", phone: "", address: "" });
    toast.success("تمت إضافة المورد");
  };

  const loadProducts = () => {
    if (!branchId) return;
    supabase.from("products").select("*").eq("branch_id", branchId).order("name").then(({ data }) => setProducts(data ?? []));
  };

  useEffect(() => {
    if (!branchId) return;
    supabase.from("contacts").select("*").order("name").then(({ data }) => setSuppliers(data ?? []));
    loadProducts();
    supabase.from("price_list_items_public").select("product_name, display_price").order("product_name").then(({ data }) => setPriceList((data ?? []).map((d: any) => ({ product_name: d.product_name, market_price: d.display_price, new_price: d.display_price }))));
  }, [branchId]);

  // realtime: keep products list fresh while editing the shipment
  useRealtimeRefresh(["products"], loadProducts);

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
    if (p) updateLine(i, { product_id: p.id, product_name: p.name, sku: p.sku, cost_price: Number(p.cost_price), image: p.image ?? "" });
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
      image: pl.image ?? "",
    });
  };

  const onPickLineImage = async (i: number, file: File) => {
    updateLine(i, { uploadingImg: true });
    try {
      const url = await uploadProductImage(file, branchId!);
      updateLine(i, { image: url, uploadingImg: false });
      toast.success("تم رفع الصورة");
    } catch (e: any) {
      updateLine(i, { uploadingImg: false });
      toast.error(e.message ?? "فشل رفع الصورة");
    }
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
          contact_id: supplierId,
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
              image: l.image || null,
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

      // Treasury / payment plan handling
      const supplier = suppliers.find((s) => s.id === supplierId);
      await createPaymentPlanWithInitial({
        branchId: branchId!,
        entityType: "supplier",
        entityId: supplierId,
        entityName: supplier?.name ?? "مورد",
        totalAmount: grandTotal,
        referenceType: "shipment",
        referenceId: ship.id,
        state: plan,
        direction: "out",
        createdBy: user!.id,
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

      {/* 1) Supplier */}
      <div className="card-elevated p-5 mb-4">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
          <h3 className="font-bold text-base flex items-center gap-2">
            <span className="inline-flex w-7 h-7 rounded-full bg-primary/10 text-primary items-center justify-center text-sm">١</span>
            بيانات المورد
          </h3>
          <Button type="button" size="sm" variant="outline" onClick={() => setSupplierDlg(true)} className="gap-1.5">
            <UserPlus className="w-3.5 h-3.5" /> مورد جديد
          </Button>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">المورد *</Label>
            <PartyCombobox type="supplier" value={supplierId} onChange={(id) => setSupplierId(id)} placeholder="— اختر مورد —" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">تاريخ الوصول</Label>
            <Input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">اسم المستلم</Label>
            <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="اكتب اسم المستلم" />
          </div>
        </div>
        {suppliers.length === 0 && (
          <button type="button" onClick={() => setSupplierDlg(true)}
            className="mt-4 w-full p-3 border-2 border-dashed border-primary/40 rounded-lg text-sm text-primary hover:bg-primary/5 flex items-center justify-center gap-2 font-semibold">
            <UserPlus className="w-4 h-4" /> لا يوجد موردين — اضغط لإضافة مورد جديد
          </button>
        )}
      </div>

      {/* 2) Costs & notes */}
      <div className="card-elevated p-5 mb-4">
        <h3 className="font-bold text-base flex items-center gap-2 mb-4 pb-3 border-b border-border">
          <span className="inline-flex w-7 h-7 rounded-full bg-primary/10 text-primary items-center justify-center text-sm">٢</span>
          التكاليف والملاحظات
        </h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">تكلفة الشحن (جنيه)</Label>
            <Input type="number" min={0} value={shipping} onChange={(e) => setShipping(Number(e.target.value))} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">مصاريف إدارية (جنيه)</Label>
            <Input type="number" min={0} value={admin} onChange={(e) => setAdmin(Number(e.target.value))} placeholder="0" />
          </div>
          <div className="space-y-1.5 md:row-span-2">
            <Label className="text-xs font-semibold text-muted-foreground">ملاحظات</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="أي ملاحظات عن الشحنة..." className="resize-none" />
          </div>
        </div>
      </div>



      <div className="card-elevated overflow-hidden mb-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-bold">٣. المنتجات</h3>
          <Button size="sm" onClick={addLine} className="gap-2"><Plus className="w-4 h-4" />إضافة صنف</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="px-3 py-2 text-right">صورة</th>
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
                <tr><td colSpan={7} className="text-center text-muted-foreground py-8">اضغط "إضافة صنف" لبدء تسجيل المنتجات</td></tr>
              )}
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-border align-top">
                  <td className="px-3 py-2 w-24">
                    <div className="flex flex-col items-center gap-1">
                      {l.image
                        ? <img src={l.image} alt="" className="w-14 h-14 rounded object-cover border" />
                        : <div className="w-14 h-14 rounded bg-muted flex items-center justify-center"><ImageIcon className="w-5 h-5 text-muted-foreground" /></div>
                      }
                      {l.product_id === null && (
                        <label className="cursor-pointer inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          {l.uploadingImg ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                          <span>{l.image ? "تغيير" : "رفع"}</span>
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onPickLineImage(i, e.target.files[0])} />
                        </label>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 min-w-[320px]">
                    <ProductPicker
                      branchId={branchId!}
                      value={l.product_id}
                      onPick={(p) => updateLine(i, {
                        product_id: p.id,
                        product_name: p.name,
                        sku: p.sku,
                        cost_price: Number(p.cost_price),
                        image: p.image ?? "",
                      })}
                      triggerLabel="— اختر من مخزون الفرع —"
                    />
                    {l.product_id === null && l.product_name && (
                      <div className="mt-1.5 text-[11px] text-success bg-success/10 rounded px-2 py-1">
                        صنف جديد: {l.product_name}
                      </div>
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

      {/* 4) Payment plan for supplier */}
      <div className="card-elevated p-4 mb-4">
        <h3 className="font-bold mb-3">٤. طريقة الدفع للمورد</h3>
        <PaymentPlanSelector total={grandTotal} value={plan} onChange={setPlan} />
      </div>

      {/* 5) Summary + save */}
      <div className="card-elevated p-4 mb-4">
        <h3 className="font-bold mb-3">٥. الملخص والحفظ</h3>
        <div className="grid md:grid-cols-2 gap-4 items-end">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">إجمالي البضاعة</span><b>{formatEGP(itemsTotal)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">الشحن</span><b>{formatEGP(shipping)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">إدارية</span><b>{formatEGP(admin)}</b></div>
            <div className="border-t border-border pt-2 flex justify-between text-lg">
              <span>الإجمالي</span>
              <b className="text-primary">{formatEGP(grandTotal)}</b>
            </div>
          </div>
          <Button onClick={submit} disabled={busy} size="lg" className="w-full gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            حفظ الشحنة
          </Button>
        </div>
      </div>

      <Dialog open={supplierDlg} onOpenChange={setSupplierDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>إضافة مورد جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>اسم الشركة *</Label>
              <Input value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>اسم المسؤول</Label>
              <Input value={newSup.contact_person} onChange={(e) => setNewSup({ ...newSup, contact_person: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>التليفون</Label>
              <Input dir="ltr" className="text-right mt-1.5" value={newSup.phone} onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })} />
            </div>
            <div>
              <Label>العنوان</Label>
              <Input value={newSup.address} onChange={(e) => setNewSup({ ...newSup, address: e.target.value })} className="mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupplierDlg(false)} disabled={savingSup}>إلغاء</Button>
            <Button onClick={createSupplier} disabled={savingSup}>{savingSup ? "جاري الحفظ..." : "إضافة"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
