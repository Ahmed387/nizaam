import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { focusSection } from "@/lib/sectionFocus";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftRestoreBar } from "@/components/DraftRestoreBar";
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
import { docSuccess, docError, docWarning } from "@/lib/docToast";
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
import { ProductImage } from "@/components/ProductImage";
import { ImageField } from "@/components/ImageField";
import { AttributePicker } from "@/components/AttributePicker";
import { VariantAttributesFields } from "@/components/VariantAttributesFields";
import { ColorPicker } from "@/components/ColorPicker";
import { ShipmentPaymentsPanel } from "@/components/ShipmentPaymentsPanel";

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
  brand?: string;
  model?: string;
  color?: string;
  product_type?: string;
  capacity?: string;
  size?: string;
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
  const { user, profile, isAdmin, isOwner, hasRole, tenantId } = useAuth();
  const isManager = hasRole("branch_manager");
  const canEditPayments = isAdmin || isOwner || isManager;
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
  const [invDiscType, setInvDiscType] = useState<"amount" | "percent">("amount");
  const [invDiscValue, setInvDiscValue] = useState(0);
  const [vatType, setVatType] = useState<"amount" | "percent">("percent");
  const [vatValue, setVatValue] = useState(0);

  const [notes, setNotes] = useState("");
  const [confirmEditOpen, setConfirmEditOpen] = useState(false);
  const [affectedBatches, setAffectedBatches] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [activeLine, setActiveLine] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  useUnsavedChanges(lines.length > 0, "لديك فاتورة شراء غير محفوظة. هل تريد المغادرة وفقدان البيانات؟");
  const [plan, setPlan] = useState<PaymentPlanState>(defaultPlan());
  const [supplierDlg, setSupplierDlg] = useState(false);
  const [newSup, setNewSup] = useState({ name: "", contact_person: "", phone: "", address: "" });
  const [savingSup, setSavingSup] = useState(false);
  const [showExtrasBreakdown, setShowExtrasBreakdown] = useState(false);
  const [openSections, setOpenSections] = useState({ supplier: true, extras: true, products: true, payment: true, summary: true });
  const toggleSection = (k: keyof typeof openSections) => setOpenSections((s) => focusSection(s, k));

  // ===== Local autosave (crash / accidental reload safety net) =====
  const draftSnapshot = { supplierId, arrival, invoiceDate, receivedBy, shipping, customs, otherCost, otherDesc, admin, invDiscType, invDiscValue, vatType, vatValue, notes, lines, plan };
  const formDraft = useFormDraft<typeof draftSnapshot>(
    "purchase",
    [user?.id, branchId],
    draftSnapshot,
    !isEdit && lines.length > 0 && !busy,
  );
  const restoreDraft = () => {
    const d = formDraft.draft?.data;
    if (!d) return;
    setSupplierId(d.supplierId ?? "");
    setArrival(d.arrival ?? arrival);
    setInvoiceDate(d.invoiceDate ?? invoiceDate);
    setReceivedBy(d.receivedBy ?? receivedBy);
    setShipping(d.shipping ?? 0);
    setCustoms(d.customs ?? 0);
    setOtherCost(d.otherCost ?? 0);
    setOtherDesc(d.otherDesc ?? "");
    setAdmin(d.admin ?? 0);
    setInvDiscType(d.invDiscType ?? "amount");
    setInvDiscValue(d.invDiscValue ?? 0);
    setVatType(d.vatType ?? "percent");
    setVatValue(d.vatValue ?? 0);
    setNotes(d.notes ?? "");
    setLines(d.lines ?? []);
    if (d.plan) setPlan(d.plan);
    formDraft.dismiss();
  };

  const createSupplier = async () => {
    if (!newSup.name.trim()) return toast.error("اسم الشركة مطلوب");
    if (!tenantId) return toast.error("مفيش حساب مرتبط — جرّب تعمل تسجيل خروج ودخول تاني");
    setSavingSup(true);
    const { data, error } = await supabase.from("contacts").insert({
      tenant_id: tenantId,
      type: "supplier",
      name: newSup.name.trim(),
      contact_person: newSup.contact_person.trim() || null,
      phone: newSup.phone.trim() || null,
      address: newSup.address.trim() || null,
    }).select().single();
    setSavingSup(false);
    if (error || !data) return toast.error(error?.message ?? "فشل الإضافة");
    setSuppliers([data, ...suppliers]);
    window.dispatchEvent(new Event("party:refresh"));

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
      if (!s) { toast.error("فاتورة الشراء غير موجودة"); return; }
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
      setInvDiscType(((s as any).discount_type === "percent" ? "percent" : "amount"));
      setInvDiscValue(Number((s as any).discount_value ?? 0));
      setVatType(((s as any).vat_type === "amount" ? "amount" : "percent"));
      setVatValue(Number((s as any).vat_value ?? 0));
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
        brand: r.brand ?? "",
        model: r.model ?? "",
        color: r.color ?? "",
        product_type: r.product_type ?? "",
        capacity: r.capacity ?? "",
        size: r.size ?? "",
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

  const addLine = () => {
    setLines((prev) => {
      const next = [...prev, { product_id: null, product_name: "", sku: genSku(), quantity: 1, cost_price: 0, discount_percent: 0, discount_amount: 0, image: "", brand: "", model: "", color: "", product_type: "", capacity: "", size: "" }];
      setActiveLine(next.length - 1);
      return next;
    });
  };

  // ===== تنظيف الأصناف الفاضية =====
  const isLineBlank = (l: Line) =>
    !l.product_name.trim() && !l.product_id && !(Number(l.cost_price) > 0) && !l.brand?.trim() && !l.model?.trim();

  const isLineComplete = (l: Line) =>
    !!l.product_name.trim() &&
    Number(l.quantity) > 0 &&
    Number(l.cost_price) > 0 &&
    (!!l.product_id || (!!l.brand?.trim() && !!l.model?.trim()));

  /** آخر صنف اتملى بالكامل؟ يبقى نعرض شريط «منتج آخر» */
  const canAddAnother = lines.length === 0 || lines.every(isLineComplete);

  /** طي الصنف الحالي وفتح صنف جديد فاضي */
  const addAnother = () => {
    setActiveLine(null);
    addLine();
  };


  // لما نسيب قسم المنتجات: نتخلص من الأصناف الفاضية
  useEffect(() => {
    if (isEdit || openSections.products) return;
    setLines((prev) => {
      const clean = prev.filter((l) => !isLineBlank(l));
      return clean.length === prev.length ? prev : clean;
    });
  }, [isEdit, openSections.products]);





  const itemsGross = lines.reduce((s, l) => s + l.quantity * l.cost_price, 0);
  const itemsDiscount = lines.reduce((s, l) => s + (l.quantity * l.cost_price - lineNet(l)), 0);
  const itemsNet = itemsGross - itemsDiscount;

  const totalExtras = Number(shipping || 0) + Number(customs || 0) + Number(otherCost || 0);

  // خصم على إجمالي الفاتورة (بالجنيه أو بالنسبة) — يطبق على صافي البضاعة قبل المصاريف
  const invoiceDiscountAmount = Math.min(
    itemsNet,
    Math.max(
      0,
      invDiscType === "percent"
        ? (itemsNet * Math.min(100, Math.max(0, Number(invDiscValue) || 0))) / 100
        : Number(invDiscValue) || 0,
    ),
  );
  const netAfterInvoiceDiscount = Math.max(0, itemsNet - invoiceDiscountAmount);
  const discFactor = itemsNet > 0 ? netAfterInvoiceDiscount / itemsNet : 1;

  // Real-time proportional distribution by line value
  const distribution = lines.map((l) => {
    const net = lineNet(l);
    const unitBefore = l.quantity > 0 ? net / l.quantity : Number(l.cost_price) || 0;
    const baseUnit = unitBefore * discFactor;
    // نصيب الصنف من خصم الفاتورة (بالتناسب مع قيمة الصنف وكميته)
    const invDiscShare = itemsNet > 0 ? (net / itemsNet) * invoiceDiscountAmount : 0;
    const invDiscUnit = l.quantity > 0 ? invDiscShare / l.quantity : 0;
    const invDiscPct = net > 0 ? (invDiscShare / net) * 100 : 0;
    const lineShare = itemsNet > 0 ? (net / itemsNet) * totalExtras : 0;
    const unitExtra = l.quantity > 0 ? lineShare / l.quantity : 0;
    const trueUnit = baseUnit + unitExtra;
    return { line: l, net, unitBefore, baseUnit, invDiscShare, invDiscUnit, invDiscPct, unitExtra, lineShare, trueUnit };
  });


  const updateLine = (i: number, patch: Partial<Line>) => {
    const copy = [...lines];
    copy[i] = { ...copy[i], ...patch };
    setLines(copy);
  };

  const removeLine = (i: number) => {
    setLines(lines.filter((_, idx) => idx !== i));
    setActiveLine((cur) => (cur === null ? null : cur === i ? null : cur > i ? cur - 1 : cur));
  };


  // ضريبة القيمة المضافة — بتتحسب على صافي البضاعة بعد خصم الفاتورة (نسبة أو مبلغ ثابت)
  const vatAmount = Math.max(
    0,
    vatType === "percent"
      ? (netAfterInvoiceDiscount * Math.min(100, Math.max(0, Number(vatValue) || 0))) / 100
      : Number(vatValue) || 0,
  );

  const grandTotal = netAfterInvoiceDiscount + totalExtras + Number(admin || 0) + vatAmount;

  // ===== رصيد خزنة الفرع — الدفع النقدي مش مسموح لو الخزنة فاضية =====
  const [treasuryBalance, setTreasuryBalance] = useState<number | null>(null);
  const fetchTreasuryBalance = async (): Promise<number | null> => {
    if (!branchId) return null;
    const { data, error } = await (supabase as any)
      .from("v_treasury_balances")
      .select("current_balance")
      .eq("branch_id", branchId)
      .maybeSingle();
    if (error) return null;
    const bal = Number(data?.current_balance ?? 0);
    setTreasuryBalance(bal);
    return bal;
  };
  useEffect(() => { fetchTreasuryBalance(); }, [branchId]);

  const plannedPaidNow = (() => {
    if (plan.mode === "credit") return 0;
    if (plan.mode === "full") return grandTotal;
    const splitsSum = (plan.splits ?? []).reduce((s: number, l: any) => s + Number(l.amount || 0), 0);
    return Math.max(Number(plan.paidNow || 0), splitsSum);
  })();
  const overTreasury = treasuryBalance !== null && plannedPaidNow > treasuryBalance + 0.01;


  const handleProductChange = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (p) updateLine(i, { product_id: p.id, product_name: p.name, sku: p.sku, cost_price: Number(p.cost_price), image: p.image ?? "", brand: p.brand ?? "", model: p.model ?? "", color: p.color ?? "", product_type: p.product_type ?? "", capacity: p.capacity ?? "", size: p.size ?? "" });
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
    if (!lines.length) return toast.error("لا يمكن حفظ فاتورة شراء بدون أصناف");
    for (const l of lines) {
      if (!l.product_name.trim() || l.quantity <= 0 || l.cost_price < 0)
        return toast.error("تأكد من بيانات كل المنتجات");
      if (l.product_id === null && (!l.brand?.trim() || !l.model?.trim()))
        return toast.error(`أدخل الماركة والموديل للصنف الجديد: ${l.product_name}`);
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
      discount_type: invDiscType,
      discount_value: Number(invDiscValue || 0),
      vat_type: vatType,
      vat_value: Number(vatValue || 0),
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
          entityLabel: `تعديل فاتورة شراء #${shipmentId.slice(0, 8)}`,
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
    // تجاهُل الأصناف الفاضية (اللي اتضافت تلقائي ومحدش ملّاها) — بنكمّل حفظ عادي من غير ما نوقف اليوزر
    const effLines = lines.filter((l) => !isLineBlank(l));
    if (!effLines.length) return toast.error("املأ بيانات منتج واحد على الأقل");

    for (const l of effLines) {
      if (!l.product_name.trim() || l.quantity <= 0 || l.cost_price < 0)
        return toast.error("تأكد من بيانات كل المنتجات");
      if (l.product_id === null && (!l.brand?.trim() || !l.model?.trim()))
        return toast.error(`أدخل الماركة والموديل للصنف الجديد: ${l.product_name}`);
    }

    // 🚫 امنع الدفع لو الخزنة مفيهاش رصيد كافي — متاح الآجل فقط
    if (plannedPaidNow > 0) {
      const bal = await fetchTreasuryBalance();
      if (bal !== null && plannedPaidNow > bal + 0.01) {
        toast.error("رصيد الخزنة مش كفاية 🚫", {
          description: `الخزنة فيها ${formatEGP(bal)} بس، وانت بتحاول تدفع ${formatEGP(plannedPaidNow)}. غيّر طريقة الدفع لـ "آجل" أو قلّل المبلغ المدفوع لحد ${formatEGP(bal)}.`,
          duration: 9000,
        });
        setOpenSections((s) => ({ ...s, payment: true }));
        return;
      }
    }

    setBusy(true);

    try {
      // Single-RPC gateway: creates shipment + items + product_batches + updates quantities
      // atomically with shipping cost share calculation. Required because the guard
      // (guard_products_quantity) blocks direct client UPDATEs to products.quantity.
      const linesPayload = effLines.map((l) => ({
        product_id: l.product_id,
        product_name: l.product_name,
        sku: l.sku || undefined,
        quantity: l.quantity,
        cost_price: l.cost_price,
        discount_percent: Number(l.discount_percent) || 0,
        discount_amount: Number(l.discount_amount) || 0,
        image: l.image || undefined,
        brand: l.brand?.trim() || undefined,
        model: l.model?.trim() || undefined,
        color: l.color?.trim() || undefined,
        product_type: l.product_type?.trim() || undefined,
        capacity: l.capacity?.trim() || undefined,
        size: l.size?.trim() || undefined,
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
          discount_type: invDiscType,
          discount_value: Number(invDiscValue || 0),
          vat_type: vatType,
          vat_value: Number(vatValue || 0),
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
        docWarning({
          title: "فاتورة الشراء اتسجلت ✅ بس الدفع لسه",
          description: `ماقدرناش نسجّل خطة الدفع دلوقتي (${planErr?.message ?? "خطأ غير معروف"}). افتح "تعديل فاتورة الشراء" → قسم "طريقة الدفع للمورد" وسجّل المدفوع من هناك.`,
        });
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

      formDraft.clear();
      docSuccess({
        title: "تم تسجيل فاتورة الشراء بنجاح",
        description: `عدد الأصناف: ${lines.length}`,
        amount: grandTotal,
        action: { label: "فتح فاتورة الشراء", onClick: () => nav(`/branch/${branchId}/shipments/${ship.id}`) },
      });
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
      docError({ title: "فشل حفظ فاتورة الشراء", description: err.message ?? "خطأ غير متوقع" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <BranchLayout>
      <PageHeader
        title={isEdit ? "تعديل فاتورة الشراء" : "فاتورة شراء جديدة"}
        subtitle={isEdit ? (isAdmin ? "تعديل مباشر" : "سيُرسل التعديل للمدير للموافقة") : "استلام بضاعة من مورد"}
      />

      {!isEdit && formDraft.draft && lines.length === 0 && (
        <DraftRestoreBar
          savedAt={formDraft.draft.savedAt}
          summary={`${formDraft.draft.data.lines?.length ?? 0} صنف`}
          onRestore={restoreDraft}
          onDismiss={formDraft.clear}
        />
      )}

      <div className="space-y-4">
      {/* 1) Supplier */}
      <CollapsibleSection
        title="بيانات المورد والفاتورة"
        icon={<UserIcon className="w-5 h-5" />}
        open={openSections.supplier}
        onToggle={() => toggleSection("supplier")}
        accent="blue"
      >
        <div className="p-5 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-sky-500 shadow-sm shadow-sky-500/30" /> المورد *
              </Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <PartyCombobox type="supplier" value={supplierId} onChange={(id) => setSupplierId(id)} placeholder="— اختر مورد —" />
                </div>
                <Button type="button" size="icon" variant="outline" onClick={() => setSupplierDlg(true)} title="مورد جديد" className="shrink-0 border-sky-500/40 text-sky-600 hover:bg-sky-500/10 hover:text-sky-700">
                  <UserPlus className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-sky-500 shadow-sm shadow-sky-500/30" /> اسم المستلم
              </Label>
              <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="اكتب اسم المستلم" className="border-sky-500/20 focus-visible:ring-sky-500/30" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-sky-500 shadow-sm shadow-sky-500/30" /> تاريخ الوصول
              </Label>
              <Input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} className="border-sky-500/20 focus-visible:ring-sky-500/30" />
            </div>
            <div className="space-y-2">
              <InvoiceDateInput value={invoiceDate} onChange={setInvoiceDate} label="تاريخ فاتورة الشراء" />
            </div>
          </div>
          {suppliers.length === 0 && (
            <button type="button" onClick={() => setSupplierDlg(true)}
              className="w-full p-3 border-2 border-dashed border-sky-500/40 rounded-xl text-sm text-sky-700 dark:text-sky-300 hover:bg-sky-500/10 flex items-center justify-center gap-2 font-bold bg-gradient-to-l from-sky-500/5 to-transparent">
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
        accent="amber"
      >
        <div className="p-5">
          <div className="flex items-center justify-end mb-4">
            <button
              type="button"
              onClick={() => setShowExtrasBreakdown((v) => !v)}
              className="text-xs font-bold text-amber-700 dark:text-amber-300 hover:underline inline-flex items-center gap-1 bg-amber-500/10 px-3 py-1.5 rounded-full border border-amber-500/20"
            >
              {showExtrasBreakdown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showExtrasBreakdown ? "إخفاء التفصيل" : "تفصيل المصاريف"}
            </button>
          </div>

          {/* Default compact view: total shipping + admin + grand extras */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-amber-700 dark:text-amber-300">إجمالي مصاريف الشحن (ج.م)</Label>
              {showExtrasBreakdown ? (
                <div className="h-10 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 flex items-center font-bold text-amber-700 dark:text-amber-300">
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
                    className="border-amber-500/20 focus-visible:ring-amber-500/30"
                  />
                  <p className="text-[10px] text-muted-foreground">شامل الشحن والجمارك والمصاريف الأخرى</p>
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-amber-700 dark:text-amber-300">مصاريف إدارية (ج.م)</Label>
              <Input type="number" min={0} value={admin} onChange={(e) => setAdmin(Number(e.target.value))} placeholder="0" className="border-amber-500/20 focus-visible:ring-amber-500/30" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-amber-700 dark:text-amber-300">الإجمالي الإضافي</Label>
              <div className="h-10 rounded-md border border-amber-500/20 bg-gradient-to-l from-amber-500/10 to-transparent px-3 flex items-center font-bold text-amber-700 dark:text-amber-300">
                {formatEGP(totalExtras + Number(admin || 0))}
              </div>
            </div>
          </div>

          {/* Breakdown (collapsible) */}
          {showExtrasBreakdown && (
            <div className="mt-4 pt-4 border-t border-dashed border-amber-500/20 grid md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-amber-700 dark:text-amber-300">مصاريف الشحن (ج.م){lastShipping !== null && lastShipping > 0 && !isEdit ? ` — آخر مرة: ${lastShipping}` : ""}</Label>
                <Input type="number" min={0} value={shipping} onChange={(e) => setShipping(Number(e.target.value))} placeholder={lastShipping ? String(lastShipping) : "0"} className="border-amber-500/20 focus-visible:ring-amber-500/30" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-amber-700 dark:text-amber-300">مصاريف الجمارك (ج.م){lastCustoms !== null && lastCustoms > 0 && !isEdit ? ` — آخر مرة: ${lastCustoms}` : ""}</Label>
                <Input type="number" min={0} value={customs} onChange={(e) => setCustoms(Number(e.target.value))} placeholder={lastCustoms ? String(lastCustoms) : "0"} className="border-amber-500/20 focus-visible:ring-amber-500/30" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-amber-700 dark:text-amber-300">مصاريف أخرى (ج.م)</Label>
                <Input type="number" min={0} value={otherCost} onChange={(e) => setOtherCost(Number(e.target.value))} placeholder="0" className="border-amber-500/20 focus-visible:ring-amber-500/30" />
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <Label className="text-xs font-bold text-amber-700 dark:text-amber-300">وصف المصاريف الأخرى</Label>
                <Input value={otherDesc} onChange={(e) => setOtherDesc(e.target.value)} placeholder="مثال: مصاريف نقل داخلي" className="border-amber-500/20 focus-visible:ring-amber-500/30" />
              </div>
            </div>
          )}

          {/* Notes — own row */}
          <div className="mt-4 space-y-1.5">
            <Label className="text-xs font-bold text-amber-700 dark:text-amber-300">ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="أي ملاحظات عن فاتورة الشراء..." className="resize-none border-amber-500/20 focus-visible:ring-amber-500/30" />
          </div>

          {/* Live distribution preview */}
          {lines.length > 0 && (totalExtras > 0 || invoiceDiscountAmount > 0) && (
            <div className="mt-5 rounded-xl border border-amber-500/20 overflow-hidden bg-gradient-to-b from-amber-500/[0.03] to-transparent">
              <div className="px-4 py-3 bg-amber-500/5 border-b border-amber-500/15 flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-bold text-amber-800 dark:text-amber-200">توزيع الخصم والمصاريف على الأصناف</span>
                <div className="flex items-center gap-2 flex-wrap">
                  {invoiceDiscountAmount > 0 && (
                    <span className="px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px] font-bold whitespace-nowrap border border-rose-500/15">
                      خصم الفاتورة − {formatEGP(invoiceDiscountAmount)}
                    </span>
                  )}
                  {totalExtras > 0 && (
                    <span className="px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-bold whitespace-nowrap border border-amber-500/15">
                      مصاريف {formatEGP(totalExtras)}
                    </span>
                  )}
                </div>
              </div>

              <div className="divide-y divide-amber-500/10">
                {distribution.map((d, i) => (
                  <div key={i} className="p-3 space-y-2.5">
                    {/* Header: product + qty */}
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-semibold leading-snug">{d.line.product_name || "— صنف بدون اسم —"}</span>
                      <span className="shrink-0 px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/15 text-[11px] font-bold whitespace-nowrap">
                        الكمية: {d.line.quantity}
                      </span>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
                      <Metric label="سعر الوحدة قبل الخصم" value={formatEGP(d.unitBefore)} className="text-muted-foreground line-through" />
                      <Metric
                        label={`نصيبه من الخصم (${d.invDiscPct.toFixed(1)}%)`}
                        value={`− ${formatEGP(d.invDiscUnit)} / وحدة`}
                        hint={`إجمالي − ${formatEGP(d.invDiscShare)}`}
                        className="text-rose-600"
                      />
                      <Metric label="سعر الوحدة بعد الخصم" value={formatEGP(d.baseUnit)} className="text-foreground font-bold" />
                      <Metric label="نصيب الشحن/الوحدة" value={`+ ${formatEGP(d.unitExtra)}`} className="text-amber-600" />
                      <Metric label="التكلفة الحقيقية/الوحدة" value={formatEGP(d.trueUnit)} className="text-emerald-600 font-bold" highlight />
                    </div>

                    <div className="text-[11px] text-emerald-600 font-semibold">
                      سعر البيع المقترح (+30%): {formatEGP(d.trueUnit * 1.3)}
                    </div>
                  </div>
                ))}
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
        accent="emerald"
      >
        {lines.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-emerald-500/25 to-sky-500/20 flex items-center justify-center shadow-inner">
              <Package className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm text-muted-foreground mb-3">مفيش أصناف لسه — ابدأ بإضافة أول منتج</p>
            <Button onClick={addAnother} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="w-4 h-4" />إضافة منتج</Button>
          </div>




        ) : (
          <div className="p-4 space-y-3">
            {lines.map((l, i) => {
              const net = lineNet(l);
              const gross = l.quantity * l.cost_price;
              const expanded = activeLine === i;

              if (!expanded) {
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveLine(i)}
                    className="group w-full text-right rounded-2xl border border-emerald-500/25 bg-gradient-to-l from-emerald-500/[0.12] via-sky-500/[0.05] to-transparent hover:border-emerald-500/60 hover:shadow-md hover:shadow-emerald-500/10 transition-all flex items-center gap-3 p-3"
                  >
                    <span className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-sky-500 text-white text-[11px] font-bold flex items-center justify-center shadow-sm">{i + 1}</span>
                    {l.image
                      ? <ProductImage src={l.image} alt="" className="w-10 h-10 rounded-xl object-cover border-2 border-emerald-500/20 shrink-0 shadow-sm" />
                      : <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-100 to-sky-100 dark:from-emerald-950 dark:to-sky-950 flex items-center justify-center border border-emerald-500/20 shrink-0"><ImageIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-sm truncate text-foreground">{l.product_name || "صنف بدون اسم"}</span>
                      <span className="block text-[11px] text-muted-foreground truncate">
                        {[l.brand, l.model, l.color].filter(Boolean).join(" · ") || l.sku}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/15">× {l.quantity}</span>
                    <span className="shrink-0 font-bold text-emerald-600 dark:text-emerald-400 text-sm bg-emerald-500/10 px-2 py-1 rounded-lg">{formatEGP(net)}</span>
                    <ChevronDown className="w-4 h-4 text-emerald-500/70 group-hover:text-emerald-600 shrink-0" />

                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => { e.stopPropagation(); removeLine(i); }}
                      className="shrink-0 text-rose-500 hover:bg-rose-500/10 rounded-lg p-1.5 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </span>
                  </button>
                );
              }

              return (
                <div key={i} className="rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-b from-emerald-500/[0.04] to-sky-500/[0.02] shadow-md shadow-emerald-500/5 transition-colors overflow-hidden">
                  {/* Header: image + product picker + delete */}
                  <div className="flex items-start gap-3 p-4 border-b border-emerald-500/15 bg-gradient-to-l from-emerald-500/5 to-transparent">
                    <button
                      type="button"
                      onClick={() => setActiveLine(null)}
                      className="shrink-0 mt-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                      title="طي الصنف"
                    >
                      <ChevronUp className="w-5 h-5" />
                    </button>
                    <div className="shrink-0 w-40">
                      <ImageField
                        value={l.image || null}
                        onChange={(v) => updateLine(i, { image: v ?? "" })}
                        folder={branchId!}
                        label=""
                        size="sm"
                        readOnly={l.product_id !== null}
                      />
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
                          brand: p.brand ?? l.brand ?? "",
                          model: p.model ?? l.model ?? "",
                          color: p.color ?? l.color ?? "",
                          product_type: p.product_type ?? l.product_type ?? "",
                          capacity: p.capacity ?? l.capacity ?? "",
                          size: p.size ?? l.size ?? "",
                        })}
                      />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => removeLine(i)} className="text-rose-500 hover:bg-rose-500/10 hover:text-rose-600 shrink-0 -mt-1">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Numeric fields row */}
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-4">
                    <div className="space-y-1 md:col-span-2">
                      <Label className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">الكود (SKU)</Label>
                      <Input
                        value={l.sku}
                        onChange={(e) => updateLine(i, { sku: e.target.value })}
                        readOnly={l.product_id !== null}
                        className={l.product_id !== null ? "bg-surface-2 font-mono text-xs h-9 border-emerald-500/20" : "font-mono text-xs h-9 border-emerald-500/20 focus-visible:ring-emerald-500/30"}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">الكمية</Label>
                      <Input type="number" min={1} value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} className="h-9 border-emerald-500/20 focus-visible:ring-emerald-500/30" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">سعر التكلفة</Label>
                      <Input type="number" min={0} step="0.01" value={l.cost_price} onChange={(e) => updateLine(i, { cost_price: Number(e.target.value) })} className="h-9 border-emerald-500/20 focus-visible:ring-emerald-500/30" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">خصم %</Label>
                      <Input type="number" min={0} max={100} step="0.01" value={l.discount_percent} onChange={(e) => updateLine(i, { discount_percent: Number(e.target.value) })} placeholder="0" className="h-9 border-emerald-500/20 focus-visible:ring-emerald-500/30" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">خصم مبلغ</Label>
                      <Input type="number" min={0} step="0.01" value={l.discount_amount} onChange={(e) => updateLine(i, { discount_amount: Number(e.target.value) })} placeholder="0" className="h-9 border-emerald-500/20 focus-visible:ring-emerald-500/30" />
                    </div>
                  </div>

                  {/* Variant attributes row */}
                  <div className="px-4 pb-4">
                    <VariantAttributesFields
                      compact
                      subtitle="سجّل خصائص الصنف عشان يتميز في المخزن والفواتير"
                      value={{
                        brand: l.brand ?? "",
                        model: l.model ?? "",
                        color: l.color ?? "",
                        product_type: l.product_type ?? "",
                        capacity: l.capacity ?? "",
                        size: l.size ?? "",
                      }}
                      required={["brand", "model"]}
                      onChange={(patch) => updateLine(i, patch as any)}
                    />
                  </div>

                  {/* Net summary footer */}
                  <div className="px-4 py-3 bg-gradient-to-l from-emerald-500/5 via-sky-500/[0.02] to-transparent border-t border-emerald-500/10 text-xs space-y-2">
                    {invoiceDiscountAmount > 0 && distribution[i] && (
                      <div className="flex items-center justify-between gap-2 flex-wrap rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2">
                        <span className="font-bold text-rose-600 dark:text-rose-400">
                          نصيب الصنف من خصم الفاتورة: − {formatEGP(distribution[i].invDiscShare)} ({distribution[i].invDiscPct.toFixed(1)}%)
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">سعر الوحدة: <b className="line-through">{formatEGP(distribution[i].unitBefore)}</b></span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">→ {formatEGP(distribution[i].baseUnit)}</span>
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-emerald-800 dark:text-emerald-200 font-bold">الصافي</span>
                      <div className="flex items-center gap-2">
                        {(l.discount_percent > 0 || l.discount_amount > 0) && (
                          <span className="text-[10px] text-muted-foreground line-through">{formatEGP(gross)}</span>
                        )}
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm bg-emerald-500/10 px-2 py-1 rounded-lg">{formatEGP(net)}</span>
                        <Button size="sm" variant="outline" className="h-8 text-[11px] gap-1 border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10" onClick={() => setActiveLine(null)}>
                          <ChevronUp className="w-3 h-3" />تم — اطوِ الصنف
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {/* شريط «منتج آخر» — يظهر لما كل الأصناف تكون مكتملة ويفتح تلقائيًا بالـ hover */}
            {canAddAnother ? (
              <button
                type="button"
                onMouseEnter={addAnother}
                className="group w-full rounded-2xl border-2 border-dashed border-emerald-500/40 bg-gradient-to-l from-emerald-500/15 via-sky-500/10 to-amber-500/5 hover:from-emerald-500/25 hover:via-sky-500/20 hover:to-amber-500/10 hover:border-emerald-500 transition-all p-4 flex items-center justify-center gap-3 text-emerald-700 dark:text-emerald-300 font-bold text-base shadow-sm hover:shadow-md hover:shadow-emerald-500/10"
              >
                <span className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-sky-500 text-white flex items-center justify-center shadow group-hover:scale-110 transition-transform">
                  <Plus className="w-5 h-5" />
                </span>
                <span>منتج آخر</span>
                <span className="text-[11px] font-normal text-muted-foreground hidden sm:inline">— وقف هنا بالماوس يفتح صنف جديد</span>
              </button>
            ) : (
              <div className="w-full rounded-2xl border border-dashed border-amber-500/40 bg-gradient-to-l from-amber-500/10 to-transparent p-4 text-center text-[12px] text-amber-700 dark:text-amber-300 font-semibold">
                كمّل بيانات الصنف الحالي (الاسم + الكمية + السعر + الماركة والموديل) وهيظهرلك «منتج آخر»
              </div>
            )}


          </div>
        )}

      </CollapsibleSection>


      {/* 4) Payment plan for supplier */}
      {!isEdit ? (
        <CollapsibleSection
          title="طريقة الدفع للمورد"
          icon={<CreditCard className="w-5 h-5" />}
          open={openSections.payment}
          onToggle={() => toggleSection("payment")}
          accent="violet"
        >
          <div className="p-5">
            {treasuryBalance !== null && (
              <div className={`mb-4 rounded-xl border px-4 py-3 flex items-center justify-between gap-3 ${overTreasury ? "border-rose-500 bg-rose-500/10" : "border-violet-500/20 bg-gradient-to-l from-violet-500/10 to-transparent"}`}>
                <div className="text-sm">
                  <div className={`font-bold ${overTreasury ? "text-rose-700 dark:text-rose-300" : "text-violet-700 dark:text-violet-300"}`}>رصيد خزنة الفرع دلوقتي</div>
                  <div className={`text-xs ${overTreasury ? "text-rose-600 font-semibold" : "text-muted-foreground"}`}>
                    {overTreasury
                      ? `مش هينفع تدفع ${formatEGP(plannedPaidNow)} — المتاح ${formatEGP(treasuryBalance)} بس. اختار "آجل" أو قلّل المبلغ.`
                      : "أقصى مبلغ تقدر تدفعه نقدي دلوقتي هو الرصيد ده."}
                  </div>
                </div>
                <b className={`text-lg whitespace-nowrap ${overTreasury ? "text-rose-600" : "text-violet-600 dark:text-violet-400"}`}>{formatEGP(treasuryBalance)}</b>
              </div>
            )}
            <PaymentPlanSelector total={grandTotal} value={plan} onChange={setPlan} />
          </div>
        </CollapsibleSection>
      ) : shipmentId ? (
        <CollapsibleSection
          title="طريقة الدفع والمبلغ المدفوع"
          icon={<CreditCard className="w-5 h-5" />}
          open={openSections.payment}
          onToggle={() => toggleSection("payment")}
          accent="violet"
        >
          <div className="p-5 space-y-3">
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-3 text-xs leading-relaxed text-violet-800 dark:text-violet-200">
              <b>خد بالك:</b> الدفعات دي بتتسجل فورًا في الخزنة وحساب المورد — يعني مش مربوطة بزرار «حفظ التعديلات» تحت.
              أي دفعة تضيفها أو تعدلها هنا بتتحفظ لوحدها على طول.
            </div>
            <ShipmentPaymentsPanel shipmentId={shipmentId} canEdit={canEditPayments} />
          </div>

        </CollapsibleSection>
      ) : null}

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
        accent="indigo"
      >
        <div className="p-5">
          {/* Grand total hero */}
          <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-l from-indigo-600/15 via-violet-500/10 to-emerald-500/5 p-5 mb-5 shadow-lg shadow-indigo-500/10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-indigo-800/80 dark:text-indigo-200/80 mb-1">الإجمالي المستحق للمورد</div>
                <div className="text-3xl md:text-4xl font-black text-indigo-700 dark:text-indigo-300 tracking-tight">{formatEGP(grandTotal)}</div>
                <div className="text-xs text-muted-foreground mt-1">{lines.length} صنف · {lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)} قطعة</div>
                {vatAmount > 0 && (
                  <div className="text-xs mt-1 text-teal-700 dark:text-teal-300 font-semibold">
                    شامل ضريبة قيمة مضافة {formatEGP(vatAmount)}{vatType === "percent" ? ` (${Number(vatValue) || 0}%)` : ""}
                  </div>
                )}
              </div>
              {(() => {
                const splitsSum = plan.splits.reduce((s, l) => s + Number(l.amount || 0), 0);
                const paidNow = plan.mode === "credit" ? 0 : Number(plan.paidNow || 0);
                const effectivePaid = plan.mode === "full" ? grandTotal : Math.max(paidNow, splitsSum);
                const remaining = Math.max(0, grandTotal - effectivePaid);
                const over = effectivePaid > grandTotal + 0.01;
                const status = remaining < 0.01 ? "مدفوعة بالكامل" : effectivePaid > 0 ? "دفع جزئي" : "غير مدفوعة";
                const statusClass = remaining < 0.01
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                  : effectivePaid > 0
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                    : "bg-slate-500/10 text-muted-foreground border-slate-500/20";
                return (
                  <div className="flex flex-col gap-2 min-w-[180px]">
                    <div className={`px-3 py-1.5 rounded-lg border text-xs font-bold text-center ${statusClass}`}>{status}</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-background/60 border border-border px-2 py-1.5 text-center">
                        <div className="text-muted-foreground">مدفوع</div>
                        <b className="text-emerald-600">{formatEGP(effectivePaid)}</b>
                      </div>
                      <div className="rounded-lg bg-background/60 border border-border px-2 py-1.5 text-center">
                        <div className="text-muted-foreground">متبقي</div>
                        <b className={remaining > 0 ? "text-amber-600" : "text-emerald-600"}>{formatEGP(remaining)}</b>
                      </div>
                    </div>
                    {over && (
                      <div className="text-[11px] text-rose-600 font-semibold text-center">
                        زيادة {formatEGP(effectivePaid - grandTotal)}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Detail grid */}
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
            {/* Goods */}
            <div className="rounded-xl border border-indigo-500/20 bg-gradient-to-l from-indigo-500/[0.05] to-transparent p-3 space-y-2">
              <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 text-xs font-bold">
                <span className="w-5 h-5 rounded-md bg-indigo-500/15 flex items-center justify-center text-[10px]">١</span>
                قيمة البضاعة
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground text-xs">إجمالي الأصناف</span><b>{formatEGP(itemsGross)}</b></div>
                {itemsDiscount > 0 && (
                  <div className="flex justify-between text-rose-600 text-xs"><span>خصومات الأصناف</span><b>− {formatEGP(itemsDiscount)}</b></div>
                )}
                <div className="flex justify-between border-t border-dashed border-indigo-500/20 pt-1"><span className="text-muted-foreground text-xs">صافي البضاعة</span><b className="text-indigo-700 dark:text-indigo-300">{formatEGP(itemsNet)}</b></div>
              </div>
            </div>

            {/* Invoice discount */}
            <div className="rounded-xl border border-dashed border-rose-400/40 bg-rose-500/[0.04] p-3 space-y-2">
              <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 text-xs font-bold">
                <span className="w-5 h-5 rounded-md bg-rose-500/15 flex items-center justify-center text-[10px]">٢</span>
                خصم على الفاتورة
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex rounded-md overflow-hidden border border-rose-500/30 shrink-0">
                  <button
                    type="button"
                    onClick={() => setInvDiscType("amount")}
                    className={`px-3 h-8 text-xs font-bold ${invDiscType === "amount" ? "bg-rose-600 text-white" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}
                  >ج.م</button>
                  <button
                    type="button"
                    onClick={() => setInvDiscType("percent")}
                    className={`px-3 h-8 text-xs font-bold ${invDiscType === "percent" ? "bg-rose-600 text-white" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}
                  >%</button>
                </div>
                {invoiceDiscountAmount > 0 && (
                  <span className="text-xs font-bold text-rose-600">− {formatEGP(invoiceDiscountAmount)}</span>
                )}
              </div>
              <Input
                type="number"
                min={0}
                max={invDiscType === "percent" ? 100 : undefined}
                step="0.01"
                value={invDiscValue}
                onChange={(e) => setInvDiscValue(Number(e.target.value))}
                placeholder="0"
                className="h-9 border-rose-500/20 focus-visible:ring-rose-500/30"
              />
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                بيتوزّع على الأصناف بالتناسب وينزّل تكلفة الوحدة.
              </p>
            </div>

            {/* Expenses */}
            <div className="rounded-xl border border-amber-500/20 bg-gradient-to-l from-amber-500/[0.05] to-transparent p-3 space-y-2">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-xs font-bold">
                <span className="w-5 h-5 rounded-md bg-amber-500/15 flex items-center justify-center text-[10px]">٣</span>
                المصاريف الإضافية
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground text-xs">الشحن</span><b>{formatEGP(shipping)}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground text-xs">الجمارك</span><b>{formatEGP(customs)}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground text-xs">مصاريف أخرى</span><b>{formatEGP(otherCost)}</b></div>
                <div className="flex justify-between border-t border-dashed border-amber-500/20 pt-1"><span className="text-muted-foreground text-xs">إدارية</span><b>{formatEGP(admin)}</b></div>
              </div>
            </div>

            {/* VAT */}
            <div className="rounded-xl border border-teal-500/25 bg-gradient-to-l from-teal-500/[0.06] to-transparent p-3 space-y-2">
              <div className="flex items-center gap-2 text-teal-700 dark:text-teal-300 text-xs font-bold">
                <span className="w-5 h-5 rounded-md bg-teal-500/15 flex items-center justify-center text-[10px]">٤</span>
                ضريبة القيمة المضافة
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex rounded-md overflow-hidden border border-teal-500/30 shrink-0">
                  <button
                    type="button"
                    onClick={() => setVatType("amount")}
                    className={`px-3 h-8 text-xs font-bold ${vatType === "amount" ? "bg-teal-600 text-white" : "bg-teal-500/10 text-teal-700 dark:text-teal-300"}`}
                  >ج.م</button>
                  <button
                    type="button"
                    onClick={() => setVatType("percent")}
                    className={`px-3 h-8 text-xs font-bold ${vatType === "percent" ? "bg-teal-600 text-white" : "bg-teal-500/10 text-teal-700 dark:text-teal-300"}`}
                  >%</button>
                </div>
                {vatAmount > 0 && (
                  <span className="text-xs font-bold text-teal-700 dark:text-teal-300">+ {formatEGP(vatAmount)}</span>
                )}
              </div>
              <Input
                type="number"
                min={0}
                max={vatType === "percent" ? 100 : undefined}
                step="0.01"
                value={vatValue}
                onChange={(e) => setVatValue(Number(e.target.value))}
                placeholder="0"
                className="h-9 border-teal-500/20 focus-visible:ring-teal-500/30"
              />
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                بتتحسب على صافي البضاعة بعد الخصم، وبتتضاف على المستحق للمورد — ومش بتدخل في تكلفة الوحدة (بتتسجل في حساب «ضريبة القيمة المضافة على المشتريات»).
              </p>
            </div>
          </div>


          {/* Save button */}
          <Button onClick={submit} disabled={busy} size="lg" className="w-full gap-2 bg-gradient-to-l from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-xl shadow-indigo-500/20 h-14 text-lg font-bold rounded-xl">
            {busy && <Loader2 className="w-5 h-5 animate-spin" />}
            {isEdit ? (isAdmin ? "حفظ التعديلات" : "إرسال طلب التعديل") : "حفظ فاتورة الشراء"}
          </Button>
        </div>
      </CollapsibleSection>
      </div>


      <Dialog open={confirmEditOpen} onOpenChange={setConfirmEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل مصاريف فاتورة الشراء</DialogTitle>
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

function Metric({ label, value, hint, className, highlight }: { label: string; value: string; hint?: string; className?: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-lg border px-2.5 py-1.5 min-w-0", highlight ? "border-primary/40 bg-primary/5" : "border-border bg-surface-2/50")}>
      <div className="text-[10px] text-muted-foreground leading-tight mb-0.5">{label}</div>
      <div className={cn("text-xs whitespace-nowrap overflow-hidden text-ellipsis font-semibold", className)}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground whitespace-nowrap">{hint}</div>}
    </div>
  );
}
