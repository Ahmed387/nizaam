import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import { enqueueSale, syncPendingSales } from "@/lib/offlineQueue";
import { Search, Trash2, Printer, Loader2, ScanLine, BookmarkPlus, Plus, X, AlertTriangle, Camera, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PreOrderDialog } from "@/components/PreOrderDialog";
import { BarcodeCameraScanner } from "@/components/BarcodeCameraScanner";
import { InstallmentScheduler, InstallmentRow } from "@/components/InstallmentScheduler";
import { createPaymentPlanWithInitial } from "@/lib/paymentPlans";
import { defaultPlan } from "@/components/PaymentPlanSelector";
import { loadTransferFees, calculateFee, loadEnabledPaymentMethods, TransferFee, PaymentMethod } from "@/lib/paymentMethods";


interface Item {
  product_id: string;
  product_name: string;
  quantity: number;
  cost_price: number;
  selling_price: number;
  market_price: number;
  line_discount: number;
}
const ALL_PAYMENT_METHODS = [
  { v: "cash", label: "كاش", feeKey: null, methodKey: "cash" as PaymentMethod },
  { v: "vodafone_cash", label: "محفظة إلكترونية", feeKey: "vodafone", methodKey: "vodafone" as PaymentMethod },
  { v: "instapay", label: "انستاباي", feeKey: "instapay", methodKey: "instapay" as PaymentMethod },
  { v: "bank_transfer", label: "تحويل بنكي", feeKey: "bank", methodKey: "bank" as PaymentMethod },
] as const;

const feeKeyFor = (m: string) => ALL_PAYMENT_METHODS.find((x) => x.v === m)?.feeKey ?? null;


interface PaymentSplit {
  payment_method: string;
  amount: number;
  reference_number: string;
  received_by_name: string;
  transfer_to_account: string;
  fee_amount: number;
  fee_on_customer: boolean;
}

export default function NewSale() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile, isAdmin, hasRole } = useAuth();
  const nav = useNavigate();

  const showCost = isAdmin || hasRole("branch_manager") || hasRole("accountant");

  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<any[]>([]);
  const [pricesMap, setPricesMap] = useState<Record<string, number>>({});
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [discountAmt, setDiscountAmt] = useState(0);
  const [discountPct, setDiscountPct] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [scannerMode, setScannerMode] = useState(true);
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const [scanBuffer, setScanBuffer] = useState("");
  const [preOrderItem, setPreOrderItem] = useState<any | null>(null);
  const [payments, setPayments] = useState<PaymentSplit[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Credit / installments
  const [creditMode, setCreditMode] = useState(false);
  const [scheduleType, setScheduleType] = useState<"open" | "scheduled">("open");
  const [installments, setInstallments] = useState<InstallmentRow[]>([]);
  const [transferFees, setTransferFees] = useState<TransferFee[]>([]);
  const [newCustOpen, setNewCustOpen] = useState(false);
  const [newCust, setNewCust] = useState({ name: "", phone: "", address: "" });
  const [savingCust, setSavingCust] = useState(false);

  const addNewCustomer = async () => {
    if (!newCust.name.trim()) return toast.error("الاسم مطلوب");
    setSavingCust(true);
    const { data, error } = await supabase.from("customers").insert({
      name: newCust.name.trim(),
      phone: newCust.phone || null,
      address: newCust.address || null,
      branch_id: branchId!,
    }).select("id, name, phone").single();
    setSavingCust(false);
    if (error) return toast.error(error.message);
    setCustomers((prev) => [...prev, data]);
    setCustomerId(data.id);
    setNewCustOpen(false);
    setNewCust({ name: "", phone: "", address: "" });
    toast.success("تمت إضافة العميل");
  };
  useEffect(() => { loadTransferFees().then(setTransferFees); }, []);

  useEffect(() => {
    if (!branchId) return;
    supabase.from("products").select("*").eq("branch_id", branchId).order("name").then(({ data }) => setProducts(data ?? []));
    supabase.from("customers").select("id, name, phone").eq("branch_id", branchId).order("name").then(({ data }) => setCustomers(data ?? []));
    supabase.from("price_list_items_public").select("id, product_name, model_code, category, supplier_name, display_price").eq("is_active", true).then(({ data }) => {
      const list = data ?? [];
      setCatalog(list);
      const m: Record<string, number> = {};
      list.forEach((p: any) => { if (p.product_name) m[p.product_name] = Number(p.display_price); });
      setPricesMap(m);
    });
  }, [branchId]);

  const filtered = useMemo(
    () => products.filter((p) => !search || p.name.includes(search) || p.sku.includes(search)).slice(0, 8),
    [products, search]
  );

  // Subtotal = sum of (qty*price - line_discount)
  const subtotal = useMemo(
    () => items.reduce((s, i) => s + Math.max(0, i.quantity * i.selling_price - i.line_discount), 0),
    [items]
  );
  const total = Math.max(0, subtotal - discountAmt);
  const totalCost = useMemo(() => items.reduce((s, i) => s + i.quantity * i.cost_price, 0), [items]);
  const totalProfit = (subtotal - totalCost);
  const profitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  // Loss detection per line — effective unit price after discount vs cost
  const lossItems = useMemo(() => items.filter((i) => {
    if (i.cost_price <= 0) return false;
    const lineTotal = i.quantity * i.selling_price - i.line_discount;
    const effUnit = lineTotal / Math.max(1, i.quantity);
    return effUnit < i.cost_price;
  }), [items]);
  const hasLoss = lossItems.length > 0;

  const setDiscByAmt = (v: number) => {
    setDiscountAmt(v);
    setDiscountPct(subtotal > 0 ? +(v / subtotal * 100).toFixed(2) : 0);
  };
  const setDiscByPct = (v: number) => {
    setDiscountPct(v);
    setDiscountAmt(+(subtotal * v / 100).toFixed(2));
  };

  const filteredCatalog = useMemo(
    () => catalogSearch
      ? catalog.filter((p: any) =>
          p.product_name?.includes(catalogSearch) ||
          p.model_code?.toLowerCase().includes(catalogSearch.toLowerCase()) ||
          p.supplier_name?.toLowerCase().includes(catalogSearch.toLowerCase())
        ).slice(0, 10)
      : [],
    [catalog, catalogSearch]
  );

  const itemKey = (i: Item) => i.product_id;

  const addItem = (p: any) => {
    const existing = items.find((i) => i.product_id === p.id);
    if (existing) {
      if (existing.quantity + 1 > p.quantity) return toast.error("الكمية المتاحة غير كافية");
      setItems(items.map((i) => i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      if (p.quantity < 1) return toast.error("المنتج غير متوفر");
      setItems([...items, {
        product_id: p.id,
        product_name: p.name,
        quantity: 1,
        cost_price: Number(p.cost_price),
        selling_price: Number(p.selling_price),
        market_price: pricesMap[p.name] ?? Number(p.market_price),
        line_discount: 0,
      }]);
    }
    setSearch("");
  };

  const handleScan = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const found = products.find((p) => p.sku === trimmed || p.sku?.toLowerCase() === trimmed.toLowerCase());
    if (!found) {
      toast.error(`الكود ${trimmed} غير موجود`);
      return;
    }
    addItem(found);
    toast.success(`تم إضافة ${found.name}`, { duration: 1500 });
  };

  useEffect(() => {
    if (!scannerMode) return;
    const focus = () => {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      scannerInputRef.current?.focus();
    };
    focus();
    const interval = setInterval(focus, 500);
    return () => clearInterval(interval);
  }, [scannerMode]);

  const updateQty = (key: string, q: number) => {
    const it = items.find((i) => itemKey(i) === key);
    if (!it) return;
    if (it.product_id) {
      const prod = products.find((x) => x.id === it.product_id);
      if (q > (prod?.quantity ?? 0)) return toast.error("الكمية غير متاحة");
    }
    if (q <= 0) return setItems(items.filter((i) => itemKey(i) !== key));
    setItems(items.map((i) => itemKey(i) === key ? { ...i, quantity: q } : i));
  };

  const updatePrice = (key: string, price: number) => {
    setItems(items.map((i) => itemKey(i) === key ? { ...i, selling_price: Math.max(0, price) } : i));
  };

  const updateLineDiscount = (key: string, d: number) => {
    setItems(items.map((i) => itemKey(i) === key ? { ...i, line_discount: Math.max(0, d) } : i));
  };

  // Payments management
  const addPayment = () => {
    const used = payments.reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(0, total - used);
    setPayments([...payments, { payment_method: "cash", amount: remaining, reference_number: "", received_by_name: profile?.name ?? "", transfer_to_account: "", fee_amount: 0, fee_on_customer: false }]);
  };
  const removePayment = (idx: number) => setPayments(payments.filter((_, i) => i !== idx));
  const updatePayment = (idx: number, patch: Partial<PaymentSplit>) =>
    setPayments(payments.map((p, i) => i === idx ? { ...p, ...patch } : p));

  // Recompute fee for each payment when amount/method/fees change
  useEffect(() => {
    setPayments((curr) => {
      let dirty = false;
      const next = curr.map((p) => {
        const fk = feeKeyFor(p.payment_method);
        const fee = fk ? calculateFee(fk as any, Number(p.amount) || 0, transferFees) : 0;
        if (fee !== p.fee_amount) { dirty = true; return { ...p, fee_amount: fee }; }
        return p;
      });
      return dirty ? next : curr;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferFees, JSON.stringify(payments.map((p) => [p.payment_method, p.amount]))]);

  const paymentsSum = useMemo(() => payments.reduce((s, p) => s + (Number(p.amount) || 0), 0), [payments]);
  const companyFeeTotal = useMemo(
    () => payments.reduce((s, p) => s + (p.fee_on_customer ? 0 : (Number(p.fee_amount) || 0)), 0),
    [payments]
  );
  const creditRemaining = Math.max(0, total - paymentsSum);
  const paymentsValid = creditMode
    ? paymentsSum <= total + 0.01
    : (payments.length === 0 || Math.abs(paymentsSum - total) < 0.01);

  const submit = async () => {
    if (!items.length) return toast.error("أضف منتجات أولاً");
    if (hasLoss) return toast.error(`لا يمكن إصدار الفاتورة — بيع بخسارة: ${lossItems.map(i => i.product_name).join("، ")}`);
    if (!paymentsValid) return toast.error(creditMode ? `المدفوع أكبر من الإجمالي` : `مجموع طرق الدفع (${formatEGP(paymentsSum)}) لا يساوي الإجمالي (${formatEGP(total)})`);
    if (creditMode && creditRemaining > 0 && !customerId && !quickName.trim()) return toast.error("اختر العميل لتسجيل بيع بالآجل");
    if (creditMode && scheduleType === "scheduled" && creditRemaining > 0) {
      const sum = installments.reduce((s, i) => s + Number(i.amount || 0), 0);
      if (Math.abs(sum - creditRemaining) > 0.5) return toast.error("مجموع الأقساط لا يطابق المتبقي");
    }

    setBusy(true);
    try {
      let custId = customerId || null;
      if (!custId && quickName.trim()) {
        const { data: c } = await supabase.from("customers").insert({
          name: quickName, phone: quickPhone || null, branch_id: branchId!,
        }).select().single();
        custId = c?.id ?? null;
      }

      const primaryMethod = payments.length > 0 ? payments[0].payment_method : "cash";

      const payload = {
        p_branch_id: branchId!,
        p_customer_id: custId,
        p_subtotal: subtotal,
        p_discount_amount: discountAmt,
        p_discount_percent: discountPct,
        p_discount_reason: discountReason || null,
        p_total: total,
        p_payment_method: primaryMethod,
        p_items: items as any,
        p_payments: payments.length > 0 ? payments : null,
      };

      if (!navigator.onLine) {
        await enqueueSale(payload);
        toast.success("لا يوجد اتصال — تم حفظ الفاتورة محلياً وستُرفع تلقائياً");
        nav(`/branch/${branchId}/sales`);
        return;
      }

      const { data: invId, error: rpcErr } = await supabase.rpc("process_sale", payload as any);
      if (rpcErr) {
        if (rpcErr.message?.includes("Failed to fetch") || rpcErr.message?.includes("NetworkError")) {
          await enqueueSale(payload);
          toast.success("انقطع الاتصال — تم حفظ الفاتورة محلياً");
          nav(`/branch/${branchId}/sales`);
          return;
        }
        throw rpcErr;
      }

      await logAudit({
        userId: user!.id, userName: profile!.name, branchId, action: "CREATE",
        entity: "Invoice", entityId: invId as string, details: { total },
      });

      // Create payment plan for credit remainder
      if (creditMode && creditRemaining > 0 && custId) {
        try {
          const cust = customers.find((c) => c.id === custId);
          await createPaymentPlanWithInitial({
            branchId: branchId!,
            entityType: "customer",
            entityId: custId,
            entityName: cust?.name ?? quickName ?? "عميل",
            totalAmount: creditRemaining,
            referenceType: "invoice",
            referenceId: invId as string,
            state: { ...defaultPlan(), mode: "credit", scheduleType, installments },
            direction: "in",
            createdBy: user!.id,
          });
        } catch (e: any) {
          toast.error("الفاتورة اتسجلت لكن خطة الأقساط فشلت: " + e.message);
        }
      }

      syncPendingSales(true);

      toast.success(creditMode && creditRemaining > 0 ? `تم إنشاء الفاتورة — متبقي ${formatEGP(creditRemaining)} كآجل` : "تم إنشاء الفاتورة");
      nav(`/branch/${branchId}/sales/${invId}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BranchLayout>
      <PageHeader title="فاتورة جديدة" subtitle="نقطة البيع" />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* Customer + Quick payment */}
          <div className="card-elevated p-4 grid md:grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block">العميل</Label>
              <div className="flex gap-2">
                <select className="flex-1 bg-input border border-border rounded-lg p-2" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">— اختر عميل —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
                </select>
                <Button type="button" variant="outline" size="icon" onClick={() => setNewCustOpen(true)} title="إضافة عميل جديد">
                  <UserPlus className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block">طريقة الدفع الأساسية</Label>
              <select
                className="w-full bg-input border border-border rounded-lg p-2"
                value={payments[0]?.payment_method ?? "cash"}
                onChange={(e) => {
                  const m = e.target.value;
                  if (payments.length === 0) {
                    setPayments([{ payment_method: m, amount: total, reference_number: "", received_by_name: profile?.name ?? "", transfer_to_account: "", fee_amount: 0, fee_on_customer: false }]);
                  } else {
                    updatePayment(0, { payment_method: m });
                  }
                }}
              >
                {PAYMENT_METHODS.map((mm) => <option key={mm.v} value={mm.v}>{mm.label}</option>)}
              </select>
              <div className="text-[11px] text-muted-foreground mt-1">للتقسيم على أكثر من طريقة استخدم لوحة "طرق الدفع" يمين</div>
            </div>
          </div>

          {/* Search & Scanner */}
          <div className="card-elevated p-4">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <Label>إضافة منتج</Label>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setCameraOpen(true)} className="gap-2">
                  <Camera className="w-4 h-4" /> كاميرا
                </Button>
                <Button type="button" size="sm" variant={scannerMode ? "default" : "outline"} onClick={() => setScannerMode((s) => !s)} className="gap-2">
                  <ScanLine className="w-4 h-4" />
                  {scannerMode ? "وضع الباركود مُفعّل" : "تفعيل الباركود"}
                </Button>
              </div>
            </div>

            {scannerMode && (
              <div className="mb-3 p-3 rounded-lg bg-primary/5 border border-primary/20 flex items-center gap-3">
                <ScanLine className="w-5 h-5 text-primary animate-pulse" />
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground">امسح الباركود الآن — التركيز نشط تلقائياً</div>
                  <Input
                    ref={scannerInputRef}
                    value={scanBuffer}
                    onChange={(e) => setScanBuffer(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScan(scanBuffer); setScanBuffer(""); } }}
                    placeholder="انتظار المسح..." className="mt-1 h-8 font-mono text-sm" dir="ltr"
                  />
                </div>
              </div>
            )}

            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="أو ابحث بالاسم أو الكود يدوياً" value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" />
            </div>
            {search && (
              <div className="mt-3 space-y-1 max-h-72 overflow-y-auto">
                {filtered.map((p) => (
                  <button key={p.id} onClick={() => addItem(p)} className="w-full text-right p-3 rounded-lg border border-border hover:bg-surface-2 hover:border-primary/50 transition">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{p.sku}</div>
                      </div>
                      <div className="text-left text-xs space-y-0.5">
                        {Number(p.old_price) > 0 && Number(p.old_price) !== Number(p.selling_price) && (
                          <div>📉 السعر القديم: <span className="text-muted-foreground line-through">{formatEGP(p.old_price)}</span></div>
                        )}
                        <div>🏷️ سعر البيع: <span className="text-success font-bold">{formatEGP(p.selling_price)}</span></div>
                        {showCost && <div>📦 شراء: <span className="text-muted-foreground">{formatEGP(p.cost_price)}</span></div>}
                        {showCost && Number(p.cost_price) > 0 && (
                          <div>💵 الربح: <span className="text-primary font-bold">{formatEGP(Number(p.selling_price) - Number(p.cost_price))}</span></div>
                        )}
                        <div>💰 سوق: <span className="text-primary">{formatEGP(pricesMap[p.name] ?? p.market_price)}</span></div>
                        <div>📊 متاح: <span className={p.quantity > 0 ? "text-foreground" : "text-destructive"}>{p.quantity}</span></div>
                      </div>
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && <div className="text-center py-4 text-muted-foreground text-sm">لا توجد نتائج</div>}
              </div>
            )}
          </div>

          {/* Price-list catalog — pre-order only */}
          <div className="card-elevated p-4">
            <Label className="mb-2 flex items-center gap-2">
              <BookmarkPlus className="w-4 h-4 text-primary" />
              حجز منتج من قائمة الأسعار
            </Label>
            <div className="text-xs text-muted-foreground mb-2">
              لو الصنف مش موجود في المخزن، ابحث في كتالوج الموردين واعمل حجز للعميل لحد ما البضاعة توصل.
            </div>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="ابحث بالاسم / الموديل / المورد" value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)} className="pr-10" />
            </div>
            {catalogSearch && (
              <div className="mt-3 space-y-1 max-h-72 overflow-y-auto">
                {filteredCatalog.map((c: any) => (
                  <div key={c.id} className="p-3 rounded-lg border border-border hover:bg-surface-2 transition">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 text-right">
                        <div className="font-semibold">{c.product_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.supplier_name}{c.model_code ? ` · ${c.model_code}` : ""}{c.category ? ` · ${c.category}` : ""}
                        </div>
                      </div>
                      <div className="text-left text-sm shrink-0">
                        <div>💰 <span className="text-primary font-bold">{formatEGP(c.display_price)}</span></div>
                      </div>
                      <Button size="sm" variant="outline" className="shrink-0 gap-1" onClick={() => setPreOrderItem(c)}>
                        <BookmarkPlus className="w-3 h-3" /> حجز
                      </Button>
                    </div>
                  </div>
                ))}
                {filteredCatalog.length === 0 && <div className="text-center py-4 text-muted-foreground text-sm">لا توجد نتائج في القائمة</div>}
              </div>
            )}
          </div>

          {/* Items */}
          <div className="card-elevated overflow-hidden">
            <div className="p-4 border-b border-border font-bold">عناصر الفاتورة ({items.length})</div>
            {items.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">ابحث عن منتج لإضافته</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead><tr className="bg-surface-2 text-xs">
                  <th className="p-2 text-right">المنتج</th>
                  <th className="p-2">الكمية</th>
                  <th className="p-2">سعر البيع</th>
                  <th className="p-2">خصم السطر</th>
                  {showCost && <th className="p-2">الربح</th>}
                  <th className="p-2">الإجمالي</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {items.map((i) => {
                    const k = itemKey(i);
                    const lineTotal = Math.max(0, i.quantity * i.selling_price - i.line_discount);
                    const effUnit = lineTotal / Math.max(1, i.quantity);
                    const isLoss = i.cost_price > 0 && effUnit < i.cost_price;
                    const isProfit = i.cost_price > 0 && effUnit >= i.cost_price;
                    const lineProfit = (i.selling_price - i.cost_price) * i.quantity - i.line_discount;
                    const linePct = i.cost_price > 0 ? ((effUnit - i.cost_price) / i.cost_price) * 100 : 0;
                    return (
                      <tr key={k} className={`border-t border-border ${isLoss ? "bg-destructive/5" : ""}`}>
                        <td className="p-2 font-medium">
                          <div className="flex items-center gap-2">
                            {isLoss && <span title="بيع بخسارة" className="inline-block w-3 h-3 rounded-full bg-destructive shrink-0" />}
                            {isProfit && <span title="بيع بمكسب" className="inline-block w-3 h-3 rounded-full bg-success shrink-0" />}
                            <span>{i.product_name}</span>
                          </div>
                          {showCost && <div className="text-xs text-muted-foreground mt-1">شراء: {formatEGP(i.cost_price)}</div>}
                        </td>
                        <td className="p-2 text-center">
                          <Input type="number" min="1" value={i.quantity} onChange={(e) => updateQty(k, parseInt(e.target.value) || 0)} className="w-20 mx-auto text-center" />
                        </td>
                        <td className="p-2 text-center">
                          <Input type="number" min="0" step="0.01" value={i.selling_price} onChange={(e) => updatePrice(k, parseFloat(e.target.value) || 0)} className="w-28 mx-auto text-center" />
                        </td>
                        <td className="p-2 text-center">
                          <Input type="number" min="0" step="0.01" value={i.line_discount || ""} onChange={(e) => updateLineDiscount(k, parseFloat(e.target.value) || 0)} className="w-24 mx-auto text-center" placeholder="0" />
                        </td>
                        {showCost && (
                          <td className="p-2 text-center">
                            <div className={lineProfit >= 0 ? "text-success font-bold" : "text-destructive font-bold"}>{formatEGP(lineProfit)}</div>
                            <div className="text-xs text-muted-foreground">{linePct.toFixed(1)}%</div>
                          </td>
                        )}
                        <td className="p-2 text-center font-bold">{formatEGP(lineTotal)}</td>
                        <td className="p-2"><Button variant="ghost" size="sm" onClick={() => updateQty(k, 0)}><Trash2 className="w-4 h-4 text-destructive" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}

          </div>
        </div>

        {/* Summary */}
        <div className="space-y-4">
          <div className="card-elevated p-5">
            <h3 className="font-bold mb-4">خصم على إجمالي الفاتورة</h3>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">خصم بالمبلغ</Label>
                <Input type="number" min="0" value={discountAmt || ""} onChange={(e) => setDiscByAmt(parseFloat(e.target.value) || 0)} className="mt-1" />
              </div>
              <div className="text-center text-muted-foreground text-xs">↕ مرتبطين تلقائياً</div>
              <div>
                <Label className="text-xs">نسبة %</Label>
                <Input type="number" min="0" max="100" step="0.1" value={discountPct || ""} onChange={(e) => setDiscByPct(parseFloat(e.target.value) || 0)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">السبب</Label>
                <Textarea rows={2} value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} className="mt-1 text-sm" />
              </div>
            </div>
          </div>

          {/* Multi-payment methods */}
          <div className="card-elevated p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold">طرق الدفع</h3>
              <Button size="sm" variant="outline" onClick={addPayment} className="gap-1" disabled={total <= 0}>
                <Plus className="w-3 h-3" /> إضافة طريقة
              </Button>
            </div>
            {payments.length === 0 ? (
              <div className="text-xs text-muted-foreground p-3 rounded bg-surface-2 text-center">
                لو سايبها فاضية = الدفع كله كاش<br/>اضغط "إضافة طريقة" لتقسيم الدفع
              </div>
            ) : (
              <div className="space-y-3">
                {payments.map((p, idx) => (
                  <div key={idx} className="p-3 rounded-lg border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-muted-foreground">دفعة #{idx + 1}</span>
                      <Button variant="ghost" size="sm" onClick={() => removePayment(idx)}><X className="w-3 h-3" /></Button>
                    </div>
                    <select className="w-full bg-input border border-border rounded p-1.5 text-sm" value={p.payment_method} onChange={(e) => updatePayment(idx, { payment_method: e.target.value })}>
                      {PAYMENT_METHODS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
                    </select>
                    <Input type="number" min="0" step="0.01" placeholder="المبلغ" value={p.amount || ""} onChange={(e) => updatePayment(idx, { amount: parseFloat(e.target.value) || 0 })} />
                    {p.payment_method !== "cash" && (
                      <>
                        <Input placeholder="رقم العملية / المرجع" value={p.reference_number} onChange={(e) => updatePayment(idx, { reference_number: e.target.value })} />
                        <Input placeholder="رقم الحساب / التليفون" dir="ltr" className="text-right" value={p.transfer_to_account} onChange={(e) => updatePayment(idx, { transfer_to_account: e.target.value })} />
                        {p.fee_amount > 0 && (
                          <div className="bg-warning/10 border border-warning/30 rounded p-2 text-xs space-y-1.5">
                            <div className="flex justify-between">
                              <span>عمولة التحويل:</span>
                              <span className="font-bold">{formatEGP(p.fee_amount)}</span>
                            </div>
                            <div>
                              <div className="mb-1 text-muted-foreground">من يتحمل العمولة؟</div>
                              <div className="flex gap-1.5">
                                <button type="button" onClick={() => updatePayment(idx, { fee_on_customer: true })}
                                  className={`flex-1 px-2 py-1 rounded border ${p.fee_on_customer ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                                  العميل
                                </button>
                                <button type="button" onClick={() => updatePayment(idx, { fee_on_customer: false })}
                                  className={`flex-1 px-2 py-1 rounded border ${!p.fee_on_customer ? "bg-destructive text-destructive-foreground border-destructive" : "bg-background"}`}>
                                  الشركة (مصروف)
                                </button>
                              </div>
                              {p.fee_on_customer ? (
                                <div className="mt-1 text-success">العميل يحول {formatEGP(p.amount + p.fee_amount)} (المبلغ + العمولة)</div>
                              ) : (
                                <div className="mt-1 text-destructive">الشركة تتحمل {formatEGP(p.fee_amount)} كمصروف</div>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    <Input placeholder="اسم المستلم" value={p.received_by_name} onChange={(e) => updatePayment(idx, { received_by_name: e.target.value })} />
                  </div>
                ))}
                <div className={`text-xs flex justify-between p-2 rounded ${paymentsValid ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  <span>مجموع الدفعات</span>
                  <span className="font-bold">{formatEGP(paymentsSum)} / {formatEGP(total)}</span>
                </div>
                {companyFeeTotal > 0 && (
                  <div className="text-xs flex justify-between p-2 rounded bg-destructive/10 text-destructive">
                    <span>عمولات تتحملها الشركة</span>
                    <span className="font-bold">- {formatEGP(companyFeeTotal)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Credit / installments */}
          <div className="card-elevated p-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={creditMode} onChange={(e) => setCreditMode(e.target.checked)} className="w-4 h-4" />
              <span className="font-bold">بيع بالآجل (تسجيل المتبقي كمديونية)</span>
            </label>
            {creditMode && (
              <div className="mt-3 space-y-3">
                <div className="text-sm flex justify-between p-2 rounded bg-warning/10 border border-warning/30">
                  <span>المتبقي كآجل:</span>
                  <b className="text-warning">{formatEGP(creditRemaining)}</b>
                </div>
                {creditRemaining > 0 && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setScheduleType("open")} className={`px-2 py-1.5 text-sm rounded border ${scheduleType === "open" ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>مفتوح</button>
                      <button type="button" onClick={() => setScheduleType("scheduled")} className={`px-2 py-1.5 text-sm rounded border ${scheduleType === "scheduled" ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>أقساط محددة</button>
                    </div>
                    {scheduleType === "scheduled" && (
                      <InstallmentScheduler remaining={creditRemaining} value={installments} onChange={setInstallments} />
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="card-elevated p-5">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">الإجمالي قبل الخصم</span><span className="font-bold">{formatEGP(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">الخصم ({discountPct}%)</span><span className="text-destructive font-bold">- {formatEGP(discountAmt)}</span></div>
              <div className="border-t border-border pt-3 flex justify-between text-base"><span className="font-bold">الإجمالي النهائي</span><span className="text-primary font-extrabold text-xl">{formatEGP(total)}</span></div>
              {showCost && items.length > 0 && (
                <div className="mt-3 pt-3 border-t border-dashed border-border space-y-1">
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">إجمالي التكلفة</span><span>{formatEGP(totalCost)}</span></div>
                  <div className="flex justify-between"><span className="font-bold">💰 صافي الربح</span><span className={totalProfit >= 0 ? "text-success font-extrabold" : "text-destructive font-extrabold"}>{formatEGP(totalProfit)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">نسبة الربح</span><span className={totalProfit >= 0 ? "text-success font-bold" : "text-destructive font-bold"}>{profitPct.toFixed(2)}%</span></div>
                </div>
              )}
            </div>

            {hasLoss && (
              <div className="mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                <div className="flex items-center gap-2 font-bold mb-1">
                  <AlertTriangle className="w-4 h-4" /> مش ممكن إصدار الفاتورة
                </div>
                <div>المنتجات التالية بتتباع بأقل من سعر التكلفة:</div>
                <ul className="mt-1 list-disc list-inside">
                  {lossItems.map((i) => <li key={i.product_id}>{i.product_name}</li>)}
                </ul>
                <div className="mt-1">عدّل السعر أو خفّض الخصم أو تواصل مع المدير.</div>
              </div>
            )}

            <Button className="w-full mt-4 h-12 btn-gradient text-base" disabled={busy || !items.length || hasLoss || !paymentsValid} onClick={submit}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Printer className="w-4 h-4 ml-2" /> إنشاء وطباعة</>}
            </Button>
          </div>
        </div>
      </div>

      <PreOrderDialog
        open={!!preOrderItem}
        onOpenChange={(v) => { if (!v) setPreOrderItem(null); }}
        branchId={branchId!}
        catalogItem={preOrderItem}
      />

      <BarcodeCameraScanner
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onScan={(code) => handleScan(code)}
        continuous
      />
      <Dialog open={newCustOpen} onOpenChange={setNewCustOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>عميل جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>الاسم *</Label><Input className="mt-1.5" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} /></div>
            <div><Label>التليفون</Label><Input dir="ltr" className="text-right mt-1.5" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></div>
            <div><Label>العنوان</Label><Input className="mt-1.5" value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCustOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={addNewCustomer} disabled={savingCust}>{savingCust ? "جاري الحفظ..." : "إضافة"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
