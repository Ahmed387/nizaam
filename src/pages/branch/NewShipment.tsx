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
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { logAudit } from "@/lib/roles";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Upload, ImageIcon, UserPlus, ChevronDown, ChevronUp, User as UserIcon, Wallet, Package, CreditCard, FileText } from "lucide-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { uploadProductImage } from "@/lib/uploadImage";
import { PaymentPlanSelector, defaultPlan, PaymentPlanState } from "@/components/PaymentPlanSelector";
import { createPaymentPlanWithInitial } from "@/lib/paymentPlans";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { PartyCombobox } from "@/components/PartyCombobox";
import { ShipmentLineProductCell } from "@/components/ShipmentLineProductCell";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { createApprovalRequest } from "@/lib/approvalRequests";
import { InvoiceDateInput } from "@/components/InvoiceDateInput";

interface Line {
  id?: string | null;
  product_id: string | null;
  product_name: string;
  sku: string;
  quantity: number;
  cost_price: number;
  discount_percent: number;
  discount_amount: number;
  image: string;
  uploadingImg?: boolean;
}

// صافي السطر بعد الخصم (نسبة + مبلغ ثابت معاً)
const lineNet = (l: Line) => {
  const gross = (Number(l.quantity) || 0) * (Number(l.cost_price) || 0);
  const afterPct = gross - (gross * (Number(l.discount_percent) || 0)) / 100;
  return Math.max(0, afterPct - (Number(l.discount_amount) || 0));
};

// توليد كود فريد للمنتج الجديد
const genSku = () =>
  `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

export default function NewShipment() {
  const { id: branchId, shipmentId } = useParams<{ id: string; shipmentId?: string }>();
  const isEdit = !!shipmentId;
  const { user, profile, isAdmin, hasRole, tenantId } = useAuth();
  const isManager = hasRole("branch_manager");
  const nav = useNavigate();

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [priceList, setPriceList] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [arrival, setArrival] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [receivedBy, setReceivedBy] = useState(profile?.name ?? "");
  const [shipping, setShipping] = useState(0);
  const [customs, setCustoms] = useState(0);
  const [otherCost, setOtherCost] = useState(0);
  const [otherDesc, setOtherDesc] = useState("");
  const [admin, setAdmin] = useState(0);
  const [notes, setNotes] = useState("");
  const [confirmEditOpen, setConfirmEditOpen] = useState(false);
  const [affectedBatches, setAffectedBatches] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(lines.length > 0, "لديك فاتورة شراء غير محفوظة. هل تريد المغادرة وفقدان البيانات؟");
  const [plan, setPlan] = useState<PaymentPlanState>(defaultPlan());
  const [supplierDlg, setSupplierDlg] = useState(false);
  const [newSup, setNewSup] = useState({ name: "", contact_person: "", phone: "", address: "" });
  const [savingSup, setSavingSup] = useState(false);
  const [showExtrasBreakdown, setShowExtrasBreakdown] = useState(false);
  const [openSections, setOpenSections] = useState({ supplier: false, extras: false, products: false, payment: false, summary: false });
  const toggleSection = (k: keyof typeof openSections) => setOpenSections((s) => ({ ...s, [k]: !s[k] }));

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
    supabase.from("products").select("*").eq("branch_id", branchId).is("archived_at", null).order("name").then(({ data }) => setProducts(data ?? []));
  };

  useEffect(() => {
    if (!branchId) return;
    supabase.from("contacts").select("*").order("name").then(({ data }) => setSuppliers(data ?? []));
    loadProducts();
    supabase.from("price_list_items_public").select("product_name, display_price").order("product_name").then(({ data }) => setPriceList((data ?? []).map((d: any) => ({ product_name: d.product_name, market_price: d.display_price, new_price: d.display_price }))));
  }, [branchId]);

  // realtime: keep products list fresh while editing the shipment
  useRealtimeRefresh(["products"], loadProducts);

  // Prefill shipping/customs from supplier's last shipment (new mode only)
  const [lastShipping, setLastShipping] = useState<number | null>(null);
  const [lastCustoms, setLastCustoms] = useState<number | null>(null);
  useEffect(() => {
    if (isEdit || !supplierId) { setLastShipping(null); setLastCustoms(null); return; }
    supabase.from("shipments")
      .select("shipping_cost, customs_cost")
      .eq("contact_id", supplierId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const s = Number((data as any).shipping_cost ?? 0);
        const c = Number((data as any).customs_cost ?? 0);
        setLastShipping(s);
        setLastCustoms(c);
        setShipping((cur) => cur === 0 && s > 0 ? s : cur);
        setCustoms((cur) => cur === 0 && c > 0 ? c : cur);
        if (s > 0 || c > 0) setShowExtrasBreakdown(true);
      });
  }, [supplierId, isEdit]);

  useEffect(() => {
    if (profile?.name && !receivedBy) setReceivedBy(profile.name);
  }, [profile]);

  const [editReason, setEditReason] = useState("");
  const [loadedEdit, setLoadedEdit] = useState(false);

  // Load shipment data in edit mode
  useEffect(() => {
    if (!isEdit || !shipmentId || loadedEdit) return;
    (async () => {
      const { data: s } = await supabase.from("shipments").select("*").eq("id", shipmentId).maybeSingle();
      const { data: it } = await supabase.from("shipment_items").select("*").eq("shipment_id", shipmentId);
      if (!s) { toast.error("الشحنة غير موجودة"); return; }
      setSupplierId(s.contact_id ?? "");
      setArrival((s.arrival_date ?? "").slice(0, 10));
      if ((s as any).invoice_date) {
        const d = new Date((s as any).invoice_date as string);
        const pad = (n: number) => String(n).padStart(2, "0");
        setInvoiceDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
      }
      setReceivedBy(s.received_by ?? "");
      setShipping(Number(s.shipping_cost ?? 0));
      setCustoms(Number((s as any).customs_cost ?? 0));
      setOtherCost(Number((s as any).other_cost ?? 0));
      setOtherDesc((s as any).other_cost_description ?? "");
      setAdmin(Number(s.admin_cost ?? 0));
      setNotes(s.notes ?? "");
      setLines((it ?? []).map((r: any) => ({
        id: r.id,
        product_id: r.product_id,
        product_name: r.product_name,
        sku: "",
        quantity: Number(r.quantity),
        cost_price: Number(r.cost_price),
        discount_percent: Number(r.discount_percent ?? 0),
        discount_amount: Number(r.discount_amount ?? 0),
        image: "",
      })));
      setLoadedEdit(true);
      // Count related batches for the edit-confirmation modal
      const { count } = await supabase
        .from("product_batches" as any)
        .select("id", { count: "exact", head: true })
        .eq("shipment_id", shipmentId);
      setAffectedBatches(count ?? 0);
      if (Number(s.customs_cost ?? 0) > 0 || Number(s.other_cost ?? 0) > 0) setShowExtrasBreakdown(true);
    })();
  }, [isEdit, shipmentId, loadedEdit]);

  const addLine = () =>
    setLines([...lines, { product_id: null, product_name: "", sku: genSku(), quantity: 1, cost_price: 0, discount_percent: 0, discount_amount: 0, image: "" }]);

  const itemsGross = lines.reduce((s, l) => s + l.quantity * l.cost_price, 0);
  const itemsDiscount = lines.reduce((s, l) => s + (l.quantity * l.cost_price - lineNet(l)), 0);
  const itemsNet = itemsGross - itemsDiscount;

  const totalExtras = Number(shipping || 0) + Number(customs || 0) + Number(otherCost || 0);

  // Real-time proportional distribution by line value
  const distribution = lines.map((l) => {
    const net = lineNet(l);
    const baseUnit = l.quantity > 0 ? net / l.quantity : Number(l.cost_price) || 0;
    const lineShare = itemsNet > 0 ? (net / itemsNet) * totalExtras : 0;
    const unitExtra = l.quantity > 0 ? lineShare / l.quantity : 0;
    const trueUnit = baseUnit + unitExtra;
    return { line: l, baseUnit, unitExtra, lineShare, trueUnit };
  });

  const updateLine = (i: number, patch: Partial<Line>) => {
    const copy = [...lines];
    copy[i] = { ...copy[i], ...patch };
    setLines(copy);
  };

  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const grandTotal = itemsNet + totalExtras + Number(admin || 0);

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

  const submitEdit = async (skipConfirm = false) => {
    if (!shipmentId) return;
    if (!lines.length) return toast.error("لا يمكن حفظ شحنة بدون أصناف");
    for (const l of lines) {
      if (!l.product_name.trim() || l.quantity <= 0 || l.cost_price < 0)
        return toast.error("تأكد من بيانات كل المنتجات");
    }
    // Admin: confirm impact on future profit before saving
    if (isAdmin && !skipConfirm && affectedBatches > 0) {
      setConfirmEditOpen(true);
      return;
    }
    const header = {
      arrival_date: arrival,
      received_by: receivedBy.trim(),
      shipping_cost: Number(shipping || 0),
      customs_cost: Number(customs || 0),
      other_cost: Number(otherCost || 0),
      other_cost_description: otherDesc.trim() || null,
      admin_cost: Number(admin || 0),
      notes: notes.trim(),
    };
    const items = lines.map((l) => ({
      id: l.id ?? null,
      product_id: l.product_id,
      product_name: l.product_name.trim(),
      sku: l.sku || null,
      image: l.image || null,
      quantity: l.quantity,
      cost_price: l.cost_price,
      discount_percent: l.discount_percent || 0,
      discount_amount: l.discount_amount || 0,
    }));

    setBusy(true);
    try {
      if (isAdmin) {
        const { data, error } = await (supabase as any).rpc("edit_shipment", {
          p_shipment_id: shipmentId,
          p_header: header,
          p_items: items,
        });
        if (error) throw error;
        toast.success("تم حفظ التعديلات");
        if ((data as any)?.plan_overpaid) {
          toast.warning("تنبيه: المبلغ المدفوع أكبر من الإجمالي الجديد — راجع خطة الدفع");
        }
        nav(`/branch/${branchId}/shipments/${shipmentId}`);
      } else if (isManager) {
        if (!editReason.trim()) { setBusy(false); return toast.error("اكتب سبب التعديل"); }
        const ok = await createApprovalRequest({
          tenantId: tenantId!, branchId: branchId ?? null,
          entityType: "shipment", entityId: shipmentId,
          entityLabel: `تعديل شحنة #${shipmentId.slice(0, 8)}`,
          action: "update",
          payload: { header, items },
          reason: editReason,
          requestedBy: user!.id, requestedByName: profile?.name ?? "—",
        });
        if (!ok) return;
        nav(`/branch/${branchId}/shipments/${shipmentId}`);
      } else {
        toast.error("غير مصرح");
      }
    } catch (err: any) {
      toast.error(err.message ?? "خطأ في حفظ التعديلات");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (isEdit) return submitEdit();
    if (!supplierId) return toast.error("اختر المورد");
    if (!receivedBy.trim()) return toast.error("أدخل اسم المستلم");
    if (!lines.length) return toast.error("أضف منتجاً واحداً على الأقل");
    for (const l of lines) {
      if (!l.product_name.trim() || l.quantity <= 0 || l.cost_price < 0)
        return toast.error("تأكد من بيانات كل المنتجات");
    }

    setBusy(true);
    try {
      // Single-RPC gateway: creates shipment + items + product_batches + updates quantities
      // atomically with shipping cost share calculation. Required because the guard
      // (guard_products_quantity) blocks direct client UPDATEs to products.quantity.
      const linesPayload = lines.map((l) => ({
        product_id: l.product_id,
        product_name: l.product_name,
        sku: l.sku || undefined,
        quantity: l.quantity,
        cost_price: l.cost_price,
        discount_percent: Number(l.discount_percent) || 0,
        discount_amount: Number(l.discount_amount) || 0,
        image: l.image || undefined,
      }));
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("record_shipment", {
        p_header: {
          branch_id: branchId!,
          contact_id: supplierId,
          arrival_date: arrival,
          received_by: receivedBy.trim(),
          shipping_cost: Number(shipping || 0),
          customs_cost: Number(customs || 0),
          other_cost: Number(otherCost || 0),
          other_cost_description: otherDesc.trim() || null,
          admin_cost: Number(admin || 0),
          notes: notes.trim() || null,
        },
        p_lines: linesPayload,
      });
      if (rpcErr) throw rpcErr;
      const ship = { id: (rpcRes as any).shipment_id } as { id: string };

      // Persist invoice_date (DB trigger restricts non-today changes to admin/super_admin)
      const today = new Date().toISOString().slice(0, 10);
      if (invoiceDate && invoiceDate !== today) {
        const { error: dErr } = await supabase.from("shipments").update({ invoice_date: invoiceDate } as any).eq("id", ship.id);
        if (dErr) console.warn("invoice_date update blocked:", dErr.message);
      }



      // Treasury / payment plan handling (non-fatal — shipment is already saved)
      const supplier = suppliers.find((s) => s.id === supplierId);
      let appliedCredit = 0;
      try {
        const planId = await createPaymentPlanWithInitial({
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

        // Auto-apply any existing supplier credit (positive contact balance)
        try {
          const { data: creditApplied } = await supabase.rpc("apply_supplier_credit" as any, {
            p_contact_id: supplierId,
            p_payment_plan_id: planId,
            p_branch_id: branchId!,
          });
          appliedCredit = Number(creditApplied || 0);
          if (appliedCredit > 0) {
            // Append a note on the shipment for visibility
            const noteText = `تم خصم ${appliedCredit.toLocaleString()} ج من رصيدك السابق عند المورد`;
            await supabase
              .from("shipments")
              .update({ notes: (notes.trim() ? notes.trim() + " — " : "") + noteText })
              .eq("id", ship.id);
            toast.success(`✓ تم خصم ${appliedCredit.toLocaleString()} ج من رصيدك السابق عند المورد`, { duration: 6000 });
          }
        } catch (creditErr: any) {
          console.warn("apply_supplier_credit failed:", creditErr);
        }
      } catch (planErr: any) {
        console.error("payment plan failed:", planErr);
        toast.warning("تم حفظ الشحنة ولكن فشل إنشاء خطة الدفع — راجعها يدوياً");
      }

      try {
        await logAudit({
          userId: user!.id,
          userName: profile?.name ?? "",
          branchId,
          action: "CREATE",
          entity: "shipment",
          entityId: ship.id,
          details: { total: grandTotal, items: lines.length },
        });
      } catch (e) { console.warn("audit failed", e); }

      toast.success("تم تسجيل الشحنة بنجاح");
      // Reset form for a new shipment
      setSupplierId("");
      setArrival(new Date().toISOString().split("T")[0]);
      setShipping(0);
      setCustoms(0);
      setOtherCost(0);
      setOtherDesc("");
      setAdmin(0);
      setNotes("");
      setLines([]);
      setPlan(defaultPlan());
      loadProducts();
    } catch (err: any) {
      console.error("shipment save failed:", err);
      toast.error(err.message ?? "خطأ في حفظ الشحنة");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BranchLayout>
      <PageHeader
        title={isEdit ? "تعديل الشحنة" : "شحنة جديدة"}
        subtitle={isEdit ? (isAdmin ? "تعديل مباشر" : "سيُرسل التعديل للمدير للموافقة") : "استلام بضاعة من مورد"}
      />

      <div className="space-y-4">
      {/* 1) Supplier */}
      <CollapsibleSection
        title="بيانات المورد والفاتورة"
        icon={<UserIcon className="w-5 h-5" />}
        open={openSections.supplier}
        onToggle={() => toggleSection("supplier")}
      >
        <div className="p-5 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" /> المورد *
              </Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <PartyCombobox type="supplier" value={supplierId} onChange={(id) => setSupplierId(id)} placeholder="— اختر مورد —" />
                </div>
                <Button type="button" size="icon" variant="outline" onClick={() => setSupplierDlg(true)} title="مورد جديد" className="shrink-0 border-primary/40 text-primary hover:bg-primary/10">
                  <UserPlus className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" /> اسم المستلم
              </Label>
              <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="اكتب اسم المستلم" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" /> تاريخ الوصول
              </Label>
              <Input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} />
            </div>
            <div className="space-y-2">
              <InvoiceDateInput value={invoiceDate} onChange={setInvoiceDate} label="تاريخ فاتورة الشراء" />
            </div>
          </div>
          {suppliers.length === 0 && (
            <button type="button" onClick={() => setSupplierDlg(true)}
              className="w-full p-3 border-2 border-dashed border-primary/40 rounded-lg text-sm text-primary hover:bg-primary/5 flex items-center justify-center gap-2 font-semibold">
              <UserPlus className="w-4 h-4" /> لا يوجد موردين — اضغط لإضافة مورد جديد
            </button>
          )}
        </div>
      </CollapsibleSection>


      {/* 2) Extras / admin costs */}
      <CollapsibleSection
        title="المصاريف الإدارية والإضافية"
        icon={<Wallet className="w-5 h-5" />}
        open={openSections.extras}
        onToggle={() => toggleSection("extras")}
      >
        <div className="p-5">
          <div className="flex items-center justify-end mb-4">
            <button
              type="button"
              onClick={() => setShowExtrasBreakdown((v) => !v)}
              className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
            >
              {showExtrasBreakdown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showExtrasBreakdown ? "إخفاء التفصيل" : "تفصيل المصاريف"}
            </button>
          </div>

          {/* Default compact view: total shipping + admin + grand extras */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">إجمالي مصاريف الشحن (ج.م)</Label>
              {showExtrasBreakdown ? (
                <div className="h-10 rounded-md border border-input bg-surface-2 px-3 flex items-center font-bold text-primary">
                  {formatEGP(totalExtras)}
                </div>
              ) : (
                <>
                  <Input
                    type="number"
                    min={0}
                    value={shipping}
                    onChange={(e) => { setShipping(Number(e.target.value)); setCustoms(0); setOtherCost(0); }}
                    placeholder="0"
                  />
                  <p className="text-[10px] text-muted-foreground">شامل الشحن والجمارك والمصاريف الأخرى</p>
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">مصاريف إدارية (ج.م)</Label>
              <Input type="number" min={0} value={admin} onChange={(e) => setAdmin(Number(e.target.value))} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">الإجمالي الإضافي</Label>
              <div className="h-10 rounded-md border border-input bg-surface-2 px-3 flex items-center font-bold text-primary">
                {formatEGP(totalExtras + Number(admin || 0))}
              </div>
            </div>
          </div>

          {/* Breakdown (collapsible) */}
          {showExtrasBreakdown && (
            <div className="mt-4 pt-4 border-t border-dashed border-border grid md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">مصاريف الشحن (ج.م)</Label>
                <Input type="number" min={0} value={shipping} onChange={(e) => setShipping(Number(e.target.value))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">مصاريف الجمارك (ج.م)</Label>
                <Input type="number" min={0} value={customs} onChange={(e) => setCustoms(Number(e.target.value))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">مصاريف أخرى (ج.م)</Label>
                <Input type="number" min={0} value={otherCost} onChange={(e) => setOtherCost(Number(e.target.value))} placeholder="0" />
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <Label className="text-xs font-semibold text-muted-foreground">وصف المصاريف الأخرى</Label>
                <Input value={otherDesc} onChange={(e) => setOtherDesc(e.target.value)} placeholder="مثال: مصاريف نقل داخلي" />
              </div>
            </div>
          )}

          {/* Notes — own row */}
          <div className="mt-4 space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="أي ملاحظات عن الشحنة..." className="resize-none" />
          </div>

          {/* Live distribution preview */}
          {lines.length > 0 && totalExtras > 0 && (
            <div className="mt-5 border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-surface-2 text-xs font-bold flex items-center justify-between">
                <span>توزيع المصاريف على المنتجات (تلقائي بالنسبة لقيمة كل صنف)</span>
                <span className="text-muted-foreground">إجمالي للتوزيع: {formatEGP(totalExtras)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2/60">
                    <tr>
                      <th className="px-3 py-2 text-right">المنتج</th>
                      <th className="px-3 py-2 text-right">الكمية</th>
                      <th className="px-3 py-2 text-right">سعر الشراء/الوحدة</th>
                      <th className="px-3 py-2 text-right">نصيب الشحن/الوحدة</th>
                      <th className="px-3 py-2 text-right">التكلفة الحقيقية/الوحدة</th>
                      <th className="px-3 py-2 text-right">سعر البيع المقترح (+30%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distribution.map((d, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2">{d.line.product_name || "—"}</td>
                        <td className="px-3 py-2">{d.line.quantity}</td>
                        <td className="px-3 py-2">{formatEGP(d.baseUnit)}</td>
                        <td className="px-3 py-2 text-amber-600">+ {formatEGP(d.unitExtra)}</td>
                        <td className="px-3 py-2 font-bold text-primary">{formatEGP(d.trueUnit)}</td>
                        <td className="px-3 py-2 text-emerald-600">{formatEGP(d.trueUnit * 1.3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>




      {/* 3) Products */}
      <CollapsibleSection
        title={`المنتجات${lines.length > 0 ? ` (${lines.length})` : ""}`}
        icon={<Package className="w-5 h-5" />}
        open={openSections.products}
        onToggle={() => toggleSection("products")}
      >
        <div className="flex items-center justify-end p-4 border-b border-border">
          <Button size="sm" onClick={addLine} className="gap-2"><Plus className="w-4 h-4" />إضافة صنف</Button>
        </div>

        {lines.length === 0 ? (
          <div className="text-center text-muted-foreground py-12 px-4">
            <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">اضغط "إضافة صنف" لبدء تسجيل المنتجات</p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {lines.map((l, i) => {
              const net = lineNet(l);
              const gross = l.quantity * l.cost_price;
              return (
                <div key={i} className="rounded-lg border border-border bg-surface-1/30 hover:bg-surface-1/60 transition-colors">
                  {/* Header: image + product picker + delete */}
                  <div className="flex items-start gap-3 p-3 border-b border-border/60">
                    <div className="shrink-0">
                      <div className="relative">
                        {l.image
                          ? <img src={l.image} alt="" className="w-16 h-16 rounded-md object-cover border border-border" />
                          : <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center border border-border"><ImageIcon className="w-5 h-5 text-muted-foreground" /></div>
                        }
                        {l.product_id === null && (
                          <label className="absolute -bottom-1 left-1/2 -translate-x-1/2 cursor-pointer inline-flex items-center gap-0.5 text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full shadow hover:bg-primary/90 whitespace-nowrap">
                            {l.uploadingImg ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Upload className="w-2.5 h-2.5" />}
                            <span>{l.image ? "تغيير" : "رفع"}</span>
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onPickLineImage(i, e.target.files[0])} />
                          </label>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <ShipmentLineProductCell
                        branchId={branchId!}
                        value={{ product_id: l.product_id, product_name: l.product_name, sku: l.sku, image: l.image }}
                        onChange={(p) => updateLine(i, {
                          product_id: p.product_id,
                          product_name: p.product_name,
                          sku: p.sku || l.sku || genSku(),
                          cost_price: p.cost_price || l.cost_price,
                          image: p.image || l.image,
                        })}
                      />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => removeLine(i)} className="text-destructive shrink-0 -mt-1">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Numeric fields row */}
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 p-3">
                    <div className="space-y-1 md:col-span-2">
                      <Label className="text-[10px] font-semibold text-muted-foreground">الكود (SKU)</Label>
                      <Input
                        value={l.sku}
                        onChange={(e) => updateLine(i, { sku: e.target.value })}
                        readOnly={l.product_id !== null}
                        className={l.product_id !== null ? "bg-surface-2 font-mono text-xs h-9" : "font-mono text-xs h-9"}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">الكمية</Label>
                      <Input type="number" min={1} value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">سعر التكلفة</Label>
                      <Input type="number" min={0} step="0.01" value={l.cost_price} onChange={(e) => updateLine(i, { cost_price: Number(e.target.value) })} className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">خصم %</Label>
                      <Input type="number" min={0} max={100} step="0.01" value={l.discount_percent} onChange={(e) => updateLine(i, { discount_percent: Number(e.target.value) })} placeholder="0" className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">خصم مبلغ</Label>
                      <Input type="number" min={0} step="0.01" value={l.discount_amount} onChange={(e) => updateLine(i, { discount_amount: Number(e.target.value) })} placeholder="0" className="h-9" />
                    </div>
                  </div>

                  {/* Net summary footer */}
                  <div className="flex items-center justify-between gap-3 px-3 py-2 bg-surface-2/60 border-t border-border/60 text-xs">
                    <span className="text-muted-foreground font-semibold">الصافي</span>
                    <div className="flex items-center gap-2">
                      {(l.discount_percent > 0 || l.discount_amount > 0) && (
                        <span className="text-[10px] text-muted-foreground line-through">{formatEGP(gross)}</span>
                      )}
                      <span className="font-bold text-primary text-sm">{formatEGP(net)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>


      {/* 4) Payment plan for supplier — only in create mode */}
      {!isEdit && (
        <CollapsibleSection
          title="طريقة الدفع للمورد"
          icon={<CreditCard className="w-5 h-5" />}
          open={openSections.payment}
          onToggle={() => toggleSection("payment")}
        >
          <div className="p-5">
            <PaymentPlanSelector total={grandTotal} value={plan} onChange={setPlan} />
          </div>
        </CollapsibleSection>
      )}

      {/* Edit reason (manager only) */}
      {isEdit && isManager && !isAdmin && (
        <div className="card-elevated p-4">
          <Label className="text-sm font-bold">سبب التعديل *</Label>
          <Textarea
            rows={2}
            className="mt-2"
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            placeholder="اكتب سبب التعديل ليراجعه المدير..."
          />
        </div>
      )}

      {/* 5) Summary + save */}
      <CollapsibleSection
        title="الملخص والحفظ"
        icon={<FileText className="w-5 h-5" />}
        open={openSections.summary}
        onToggle={() => toggleSection("summary")}
      >
        <div className="p-5">
        <div className="grid md:grid-cols-2 gap-4 items-end">
          <div className="space-y-2 text-sm">

            <div className="flex justify-between"><span className="text-muted-foreground">إجمالي البضاعة (قبل الخصم)</span><b>{formatEGP(itemsGross)}</b></div>
            {itemsDiscount > 0 && (
              <div className="flex justify-between text-destructive"><span>إجمالي الخصومات</span><b>− {formatEGP(itemsDiscount)}</b></div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">صافي البضاعة</span><b>{formatEGP(itemsNet)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">الشحن</span><b>{formatEGP(shipping)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">الجمارك</span><b>{formatEGP(customs)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">مصاريف أخرى</span><b>{formatEGP(otherCost)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">إدارية</span><b>{formatEGP(admin)}</b></div>
            <div className="border-t border-border pt-2 flex justify-between text-lg">
              <span>الإجمالي</span>
              <b className="text-primary">{formatEGP(grandTotal)}</b>
            </div>
            {(() => {
              const splitsSum = plan.splits.reduce((s, l) => s + Number(l.amount || 0), 0);
              const paidNow = plan.mode === "credit" ? 0 : Number(plan.paidNow || 0);
              const effectivePaid = plan.mode === "full" ? grandTotal : Math.max(paidNow, splitsSum);
              const remaining = Math.max(0, grandTotal - effectivePaid);
              const over = effectivePaid > grandTotal + 0.01;
              const status = remaining < 0.01 ? "مدفوعة بالكامل" : effectivePaid > 0 ? "دفع جزئي" : "غير مدفوعة";
              const statusColor = remaining < 0.01 ? "text-success" : effectivePaid > 0 ? "text-warning" : "text-muted-foreground";
              return (
                <div className="mt-2 space-y-1 border-t border-dashed border-border pt-2">
                  <div className="flex justify-between"><span className="text-muted-foreground">المدفوع الآن</span><b className="text-success">{formatEGP(effectivePaid)}</b></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">المتبقي</span><b className={remaining > 0 ? "text-warning" : "text-success"}>{formatEGP(remaining)}</b></div>
                  {over && (
                    <div className="flex justify-between text-destructive"><span>زيادة عن الإجمالي</span><b>{formatEGP(effectivePaid - grandTotal)}</b></div>
                  )}
                  <div className="flex justify-between"><span className="text-muted-foreground">الحالة</span><b className={statusColor}>{status}</b></div>
                </div>
              );
            })()}
          </div>
          <Button onClick={submit} disabled={busy} size="lg" className="w-full gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? (isAdmin ? "حفظ التعديلات" : "إرسال طلب التعديل") : "حفظ الشحنة"}
          </Button>
        </div>
        </div>
      </CollapsibleSection>
      </div>


      <Dialog open={confirmEditOpen} onOpenChange={setConfirmEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل مصاريف الشحنة</DialogTitle>
            <DialogDescription>
              تعديل مصاريف الشحن سيؤثر على تكلفة {affectedBatches} دفعة وعلى حسابات الربح للمبيعات المستقبلية فقط.
              <br />
              الفواتير السابقة لن تتأثر. هل تريد المتابعة؟
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEditOpen(false)}>إلغاء</Button>
            <Button onClick={() => { setConfirmEditOpen(false); submitEdit(true); }}>متابعة الحفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
