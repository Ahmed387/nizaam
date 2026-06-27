import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
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
import { formatEGP, balanceLabel } from "@/lib/format";
import { searchMatch } from "@/lib/search";
import { toast } from "sonner";
import { enqueueSale, syncPendingSales } from "@/lib/offlineQueue";
import { Search, Trash2, Printer, Loader2, ScanLine, BookmarkPlus, Plus, X, AlertTriangle, Camera, UserPlus, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PreOrderDialog } from "@/components/PreOrderDialog";
import { BarcodeCameraScanner } from "@/components/BarcodeCameraScanner";
import { InstallmentScheduler, InstallmentRow } from "@/components/InstallmentScheduler";
import { InvoiceDateInput } from "@/components/InvoiceDateInput";
import { createPaymentPlanWithInitial } from "@/lib/paymentPlans";
import { defaultPlan } from "@/components/PaymentPlanSelector";
import { loadTransferFees, calculateFee, loadAllPaymentMethods, TransferFee, PaymentMethodOption } from "@/lib/paymentMethods";
import { notifyMany, notify, getTenantAdmins } from "@/lib/notifications";
import { getMaxDiscountForBranch } from "@/lib/discountPolicy";
import { reserveStock, releaseDraftReservations, releaseReservation, releaseDraftBeacon } from "@/lib/reservations";



interface Item {
  product_id: string;
  product_name: string;
  quantity: number;
  cost_price: number;
  selling_price: number;
  market_price: number;
  line_discount: number; // EGP — source of truth
  discount_mode: "amount" | "percent"; // UI only
  discount_input: number; // last typed value in current mode
}
// Payment methods are loaded dynamically from the database (built-ins + admin custom).
const feeKeyFor = (m: string) => (m === "cash" ? null : m);


interface PaymentSplit {
  payment_method: string;
  amount: number;
  reference_number: string;
  received_by_name: string;
  transfer_to_account: string;
  transfer_from_account: string;
  fee_amount: number;
  fee_on_customer: boolean;
}

export default function NewSale() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile, isAdmin, hasRole } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const prefillAppliedRef = useRef(false);

  const showCost = isAdmin || hasRole("branch_manager") || hasRole("accountant");

  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<any[]>([]);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [pricesMap, setPricesMap] = useState<Record<string, number>>({});
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [methodOptions, setMethodOptions] = useState<PaymentMethodOption[]>([{ value: "cash", label: "💵 نقدي", is_builtin: true, is_enabled: true }]);


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
  useUnsavedChanges(items.length > 0, "لديك فاتورة بيع غير محفوظة. هل تريد المغادرة وفقدان البيانات؟");
  const [newCustOpen, setNewCustOpen] = useState(false);
  const [newCust, setNewCust] = useState({ name: "", phone: "", address: "" });
  const [savingCust, setSavingCust] = useState(false);
  // Customer credit balance + ledger balance
  const [customerCredit, setCustomerCredit] = useState(0);
  const [creditToApply, setCreditToApply] = useState(0);
  const [customerBalance, setCustomerBalance] = useState(0); // contacts.balance (>0 له عندنا، <0 علينا له)
  const [customerType, setCustomerType] = useState<string>("customer");
  const [useSettlement, setUseSettlement] = useState(false);
  const [settlementAmount, setSettlementAmount] = useState(0);
  // VAT (editable rate from settings)
  const [vatEnabled, setVatEnabled] = useState(false);
  const [vatRate, setVatRate] = useState<number>(14);
  const [invoiceNotes, setInvoiceNotes] = useState<string>("");

  // ===== Reservation state =====
  const draftIdRef = useRef<string>(crypto.randomUUID());
  const [availability, setAvailability] = useState<Record<string, number>>({}); // available per product (excludes my own reservation)
  const [reservations, setReservations] = useState<Record<string, { reservation_id: string; expires_at: string }>>({});
  const [nowTick, setNowTick] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setCreditToApply(0);
    setUseSettlement(false);
    setSettlementAmount(0);
    if (!customerId) { setCustomerCredit(0); setCustomerBalance(0); setCustomerType("customer"); return; }
    const load = async () => {
      const { data } = await supabase.from("contacts").select("credit_balance, balance, type").eq("id", customerId).maybeSingle();
      setCustomerCredit(Number((data as any)?.credit_balance ?? 0));
      setCustomerBalance(Number((data as any)?.balance ?? 0));
      setCustomerType(String((data as any)?.type ?? "customer"));
    };
    load();
    const ch = supabase.channel(`contact-credit-${customerId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "contacts", filter: `id=eq.${customerId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [customerId]);

  const addNewCustomer = async () => {
    if (!newCust.name.trim()) return toast.error("الاسم مطلوب");
    setSavingCust(true);
    const { data, error } = await supabase.from("contacts").insert({
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

  useEffect(() => {
    loadTransferFees().then(setTransferFees);
    loadAllPaymentMethods().then((opts) => setMethodOptions(opts.filter((o) => o.is_enabled)));
    // Load VAT default rate from settings
    supabase.from("settings").select("value").eq("key", "vat").maybeSingle().then(({ data }) => {
      const v: any = (data as any)?.value;
      if (v && typeof v.rate === "number") setVatRate(Number(v.rate));
    });
  }, []);


  useEffect(() => {
    if (!branchId) return;
    supabase.from("products").select("*").eq("branch_id", branchId).order("name").then(({ data }) => setProducts(data ?? []));
    supabase.from("contacts").select("id, name, phone").eq("branch_id", branchId).order("name").then(({ data }) => setCustomers(data ?? []));
    supabase.from("price_list_items_public").select("id, product_name, model_code, category, supplier_name, display_price").eq("is_active", true).then(({ data }) => {
      const list = data ?? [];
      setCatalog(list);
      const m: Record<string, number> = {};
      list.forEach((p: any) => { if (p.product_name) m[p.product_name] = Number(p.display_price); });
      setPricesMap(m);
    });
  }, [branchId]);

  // ===== Prefill from quote conversion =====
  useEffect(() => {
    const pf = (location.state as any)?.prefillFromQuote;
    if (!pf || prefillAppliedRef.current) return;
    if (products.length === 0) return;
    prefillAppliedRef.current = true;
    const built: Item[] = (pf.items ?? []).map((q: any) => {
      const p = products.find((pp: any) => pp.id === q.product_id);
      if (!p) return null;
      return {
        product_id: q.product_id,
        product_name: q.product_name,
        quantity: Number(q.quantity || 1),
        cost_price: Number(p.cost_price ?? 0),
        selling_price: Number(q.unit_price ?? p.selling_price ?? 0),
        market_price: Number(p.market_price ?? 0),
        line_discount: 0,
        discount_mode: "amount" as const,
        discount_input: 0,
      };
    }).filter(Boolean) as Item[];
    if (built.length) setItems(built);
    if (pf.customerId) setCustomerId(pf.customerId);
    if (pf.notes) setInvoiceNotes(pf.notes);
    toast.success(`تم تحميل بيانات عرض السعر ${pf.quoteNumber ?? ""}`);
  }, [products, location.state]);



  // ===== Reservation availability + realtime sync =====
  const refreshAvailability = useCallback(async () => {
    if (!branchId) return;
    const { data: res } = await supabase
      .from("inventory_reservations" as any)
      .select("product_id, reserved_quantity, invoice_draft_id, expires_at, status")
      .eq("branch_id", branchId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString());
    const reservedByOthers: Record<string, number> = {};
    (res ?? []).forEach((r: any) => {
      if (r.invoice_draft_id === draftIdRef.current) return;
      reservedByOthers[r.product_id] = (reservedByOthers[r.product_id] ?? 0) + Number(r.reserved_quantity || 0);
    });
    setProducts((prods) => {
      const map: Record<string, number> = {};
      prods.forEach((p: any) => {
        map[p.id] = Math.max(0, Number(p.quantity || 0) - (reservedByOthers[p.id] ?? 0));
      });
      setAvailability(map);
      return prods;
    });
  }, [branchId]);

  useEffect(() => { refreshAvailability(); }, [refreshAvailability, products.length]);

  useEffect(() => {
    if (!branchId) return;
    const ch = supabase.channel(`inv-res-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_reservations", filter: `branch_id=eq.${branchId}` }, () => refreshAvailability())
      .on("postgres_changes", { event: "*", schema: "public", table: "products", filter: `branch_id=eq.${branchId}` }, async () => {
        const { data } = await supabase.from("products").select("*").eq("branch_id", branchId).order("name");
        setProducts(data ?? []);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [branchId, refreshAvailability]);

  // Release reservations when leaving the page (close tab or navigate away)
  useEffect(() => {
    const onUnload = () => releaseDraftBeacon(draftIdRef.current);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      releaseDraftReservations(draftIdRef.current, "cancelled").catch(() => {});
    };
  }, []);


  // ===== Resume after discount approval =====
  const [resumeDraft, setResumeDraft] = useState<{ draftId: string; payload: any; requestIds: string[] } | null>(null);

  const checkForApprovedDraft = async () => {
    if (!user || !branchId) return;
    const { data } = await supabase
      .from("discount_approval_requests" as any)
      .select("id, status, draft_payload")
      .eq("cashier_id", user.id)
      .eq("branch_id", branchId)
      .is("invoice_id", null)
      .order("created_at", { ascending: false })
      .limit(50);
    const rows: any[] = data ?? [];
    // Group by draft_id
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      const did = r.draft_payload?.draft_id;
      if (!did) continue;
      const arr = groups.get(did) ?? [];
      arr.push(r);
      groups.set(did, arr);
    }
    // Find a draft where ALL items are approved (none pending/rejected)
    for (const [did, arr] of groups) {
      if (arr.every((r) => r.status === "approved")) {
        setResumeDraft({ draftId: did, payload: arr[0].draft_payload, requestIds: arr.map((r) => r.id) });
        return;
      }
    }
    setResumeDraft(null);
  };

  useEffect(() => { checkForApprovedDraft(); /* eslint-disable-next-line */ }, [user?.id, branchId]);

  // realtime: when manager decides on my requests, update the banner immediately
  useEffect(() => {
    if (!user || !branchId) return;
    const ch = supabase
      .channel(`my-disc-${user.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "discount_approval_requests", filter: `cashier_id=eq.${user.id}` }, async (payload: any) => {
        const r = payload.new;
        if (r.status === "approved") toast.success("تمت الموافقة على الخصم — أتمم الفاتورة");
        if (r.status === "rejected") {
          let maxPct = 10;
          try { maxPct = await getMaxDiscountForBranch(branchId); } catch {}
          toast.error(`تم رفض الخصم — أقصى خصم مسموح به ${maxPct}%${r.admin_note ? ` — ${r.admin_note}` : ""}`);
        }
        checkForApprovedDraft();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [user?.id, branchId]);

  const loadDraftIntoForm = () => {
    if (!resumeDraft) return;
    const p = resumeDraft.payload;
    setItems(p.items ?? []);
    setCustomerId(p.customerId ?? "");
    setPayments(p.payments ?? []);
    setCreditMode(!!p.creditMode);
    setScheduleType(p.scheduleType ?? "open");
    setInstallments(p.installments ?? []);
    toast.success("تم استرجاع الفاتورة — اضغط حفظ لإتمامها");
  };


  const filtered = useMemo(
    () => products.filter((p) => !search || searchMatch(search, p.name, p.sku)).slice(0, 8),
    [products, search]
  );

  // Subtotal = sum of (qty*price - line_discount)
  const subtotal = useMemo(
    () => items.reduce((s, i) => s + Math.max(0, i.quantity * i.selling_price - i.line_discount), 0),
    [items]
  );
  const vatAmount = useMemo(
    () => (vatEnabled ? +(subtotal * (Number(vatRate) || 0) / 100).toFixed(2) : 0),
    [subtotal, vatEnabled, vatRate]
  );
  const total = subtotal + vatAmount;
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

  // ===== Total invoice discount % vs branch limit (real-time) =====
  const [allowedPct, setAllowedPct] = useState<number>(10);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [requestingApproval, setRequestingApproval] = useState(false);

  const reloadAllowed = async () => {
    if (!branchId) return;
    try { setAllowedPct(await getMaxDiscountForBranch(branchId)); } catch {}
  };

  useEffect(() => { reloadAllowed(); /* eslint-disable-next-line */ }, [branchId]);

  useEffect(() => {
    if (!branchId) return;
    const ch = supabase
      .channel(`settings-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, () => reloadAllowed())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [branchId]);

  const totalBeforeDiscount = useMemo(
    () => items.reduce((s, i) => s + i.quantity * i.selling_price, 0),
    [items]
  );
  const totalDiscountAmount = useMemo(
    () => items.reduce((s, i) => s + Math.min(i.line_discount, i.quantity * i.selling_price), 0),
    [items]
  );
  const effectiveDiscountPct = totalBeforeDiscount > 0
    ? (totalDiscountAmount / totalBeforeDiscount) * 100
    : 0;
  const overLimit = items.length > 0 && effectiveDiscountPct > allowedPct + 0.001;

  // Re-show banner whenever discount or allowed limit changes
  useEffect(() => { setBannerDismissed(false); }, [totalDiscountAmount, allowedPct]);




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

  const addItem = async (p: any) => {
    const existing = items.find((i) => i.product_id === p.id);
    const newQty = existing ? existing.quantity + 1 : 1;
    if (Number(p.quantity || 0) < 1 && !existing) return toast.error("المنتج غير متوفر");
    const res = await reserveStock({
      productId: p.id, branchId: branchId!,
      draftId: draftIdRef.current, quantity: newQty,
      cashierName: profile?.name ?? null,
    });
    if (!res.ok) {
      if (res.error === "insufficient") {
        toast.error(
          `الكمية المتاحة ${res.available} فقط — ${res.reserved_by_others} محجوزة لفواتير أخرى`,
          { description: `في المخزون: ${res.stock} | محجوز: ${res.reserved_by_others} | متاح: ${res.available}`, duration: 5000 },
        );
      } else {
        toast.error(res.error ?? "تعذر حجز الكمية");
      }
      return;
    }
    setReservations((prev) => ({ ...prev, [p.id]: { reservation_id: res.reservation_id!, expires_at: res.expires_at! } }));
    if (existing) {
      setItems(items.map((i) => i.product_id === p.id ? { ...i, quantity: newQty } : i));
    } else {
      setItems([...items, {
        product_id: p.id,
        product_name: p.name,
        quantity: 1,
        cost_price: Number(p.cost_price),
        selling_price: Number(p.selling_price),
        market_price: pricesMap[p.name] ?? Number(p.market_price),
        line_discount: 0,
        discount_mode: "amount",
        discount_input: 0,
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

  const updateQty = async (key: string, q: number) => {
    const it = items.find((i) => itemKey(i) === key);
    if (!it) return;
    if (q <= 0) {
      const r = reservations[it.product_id];
      if (r) {
        await releaseReservation(r.reservation_id, "cancelled");
        setReservations((prev) => { const n = { ...prev }; delete n[it.product_id]; return n; });
      }
      return setItems(items.filter((i) => itemKey(i) !== key));
    }
    if (it.product_id) {
      const res = await reserveStock({
        productId: it.product_id, branchId: branchId!,
        draftId: draftIdRef.current, quantity: q,
        cashierName: profile?.name ?? null,
      });
      if (!res.ok) {
        if (res.error === "insufficient") {
          toast.error(
            `الكمية المتاحة ${res.available} فقط — ${res.reserved_by_others} محجوزة لفواتير أخرى`,
            { duration: 5000 },
          );
        } else {
          toast.error(res.error ?? "تعذر تعديل الحجز");
        }
        return;
      }
      setReservations((prev) => ({ ...prev, [it.product_id]: { reservation_id: res.reservation_id!, expires_at: res.expires_at! } }));
    }
    setItems(items.map((i) => itemKey(i) === key ? { ...i, quantity: q } : i));
  };

  const updatePrice = (key: string, price: number) => {
    setItems(items.map((i) => itemKey(i) === key ? { ...i, selling_price: Math.max(0, price) } : i));
  };

  const updateLineDiscount = (key: string, d: number) => {
    setItems(items.map((i) => itemKey(i) === key ? { ...i, line_discount: Math.max(0, d) } : i));
  };

  const setDiscountMode = (key: string, mode: "amount" | "percent") => {
    setItems(items.map((i) => {
      if (itemKey(i) !== key) return i;
      // recompute input value based on current line_discount
      const base = i.quantity * i.selling_price;
      const input = mode === "amount"
        ? +(i.line_discount).toFixed(2)
        : (base > 0 ? +((i.line_discount / base) * 100).toFixed(2) : 0);
      return { ...i, discount_mode: mode, discount_input: input };
    }));
  };

  const setDiscountInput = (key: string, v: number) => {
    setItems(items.map((i) => {
      if (itemKey(i) !== key) return i;
      const base = i.quantity * i.selling_price;
      const val = Math.max(0, v);
      const amt = i.discount_mode === "amount"
        ? val
        : +(base * val / 100).toFixed(2);
      return { ...i, discount_input: val, line_discount: Math.min(amt, base) };
    }));
  };

  const addPayment = () => {
    const used = payments.reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(0, total - used);
    setPayments([...payments, { payment_method: "cash", amount: remaining, reference_number: "", received_by_name: profile?.name ?? "", transfer_to_account: "", transfer_from_account: "", fee_amount: 0, fee_on_customer: false }]);
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
  // Clamp credit to apply when total changes
  useEffect(() => {
    if (creditToApply > total) setCreditToApply(Math.max(0, total));
    if (creditToApply > customerCredit) setCreditToApply(Math.max(0, customerCredit));
  }, [total, customerCredit, creditToApply]);
  const effectiveSettlement = useSettlement ? Math.max(0, Math.min(settlementAmount, total - paymentsSum - creditToApply, Math.abs(Math.min(0, customerBalance)))) : 0;
  const creditRemaining = Math.max(0, total - paymentsSum - creditToApply - effectiveSettlement);
  // Any shortfall is automatically treated as credit (آجل). Only block over-payment.
  const isCredit = creditMode || creditRemaining > 0.01;
  const paymentsValid = (paymentsSum + creditToApply + effectiveSettlement) <= total + 0.01;

  // Auto-rescale scheduled installments whenever the credit remainder changes,
  // so partial payments by any method update the installment plan automatically.
  useEffect(() => {
    if (!isCredit || scheduleType !== "scheduled" || installments.length === 0) return;
    const sum = installments.reduce((s, r) => s + Number(r.amount || 0), 0);
    if (Math.abs(sum - creditRemaining) < 0.01) return;
    if (sum <= 0) {
      const each = Math.round((creditRemaining / installments.length) * 100) / 100;
      const next = installments.map((r, i) => ({
        ...r,
        amount: i === installments.length - 1
          ? Math.round((creditRemaining - each * (installments.length - 1)) * 100) / 100
          : each,
      }));
      setInstallments(next);
    } else {
      const ratio = creditRemaining / sum;
      let acc = 0;
      const next = installments.map((r, i) => {
        if (i === installments.length - 1) {
          return { ...r, amount: Math.max(0, Math.round((creditRemaining - acc) * 100) / 100) };
        }
        const v = Math.max(0, Math.round(Number(r.amount || 0) * ratio * 100) / 100);
        acc += v;
        return { ...r, amount: v };
      });
      setInstallments(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditRemaining, isCredit, scheduleType]);

  const isCashierOnly = !isAdmin && !hasRole("branch_manager") && !hasRole("accountant");

  // Create discount approval requests for the current invoice draft (total-% based)
  const sendDiscountApprovalRequest = async () => {
    if (!branchId || !user) return;
    setRequestingApproval(true);
    setBusy(true);
    try {
      const draftId = crypto.randomUUID();
      const draftPayload = {
        draft_id: draftId,
        items, customerId, payments,
        creditMode, scheduleType, installments,
      };
      const tenantId = (profile as any)?.tenant_id ?? null;
      // One row per line (carries full per-line context for admin display)
      const rows = items.filter((it) => it.line_discount > 0 || true).map((it) => {
        const base = it.quantity * it.selling_price;
        const lineTotal = Math.max(0, base - it.line_discount);
        const eff = lineTotal / Math.max(1, it.quantity);
        const orig = Math.max(it.market_price, it.selling_price, it.selling_price);
        const linePct = orig > 0 ? ((orig - eff) / orig) * 100 : 0;
        return {
          tenant_id: tenantId,
          branch_id: branchId,
          cashier_id: user.id,
          cashier_name: profile?.name ?? "كاشير",
          product_id: it.product_id,
          product_name: it.product_name,
          original_price: orig,
          requested_price: eff,
          discount_percent: +linePct.toFixed(2),
          quantity: it.quantity,
          status: "pending",
          draft_payload: { ...draftPayload, effective_pct: +effectiveDiscountPct.toFixed(2), allowed_pct: allowedPct, total_before: totalBeforeDiscount, total_discount: totalDiscountAmount },
        };
      });
      const { error } = await supabase.from("discount_approval_requests" as any).insert(rows);
      if (error) throw error;

      // Notify admins ONLY
      try {
        if (tenantId) {
          const adminIds = await getTenantAdmins(tenantId);
          const { data: br } = await supabase.from("branches").select("name").eq("id", branchId).maybeSingle();
          const branchName = (br as any)?.name ?? "—";
          await notifyMany(adminIds, {
            title: "طلب خصم جديد",
            body: `فرع ${branchName} — ${profile?.name ?? "كاشير"} طلب خصم ${effectiveDiscountPct.toFixed(1)}% على فاتورة بقيمة ${totalBeforeDiscount.toFixed(2)} جنيه (الحد ${allowedPct}%)`,
            type: "general",
            link: `/admin/discount-approvals`,
          });
        }
      } catch (e) { console.warn("notify admins failed", e); }
      toast.warning("تم إرسال طلب الموافقة للأدمن. الفاتورة محفوظة كمسودة وستُستكمل بعد الموافقة.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRequestingApproval(false);
      setBusy(false);
    }
  };



  const submit = async () => {
    if (!items.length) return toast.error("أضف منتجات أولاً");
    if (!paymentsValid) return toast.error(`مجموع طرق الدفع (${formatEGP(paymentsSum)}) أكبر من الإجمالي (${formatEGP(total)})`);
    if (isCredit && creditRemaining > 0 && !customerId) return toast.error("اختر العميل لتسجيل المتبقي كآجل");

    // Validate electronic payments require ref + from + to account
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      if (p.payment_method === "cash" || p.payment_method === "credit_balance") continue;
      if (!p.reference_number?.trim())
        return toast.error(`دفعة #${i + 1}: أدخل رقم العملية / المرجع للتحويل`);
      if (!p.transfer_from_account?.trim())
        return toast.error(`دفعة #${i + 1}: أدخل رقم الحساب المحوَّل منه`);
      if (!p.transfer_to_account?.trim())
        return toast.error(`دفعة #${i + 1}: أدخل رقم الحساب المحوَّل إليه`);
    }


    if (isCredit && scheduleType === "scheduled" && creditRemaining > 0) {
      const sum = installments.reduce((s, i) => s + Number(i.amount || 0), 0);
      if (Math.abs(sum - creditRemaining) > 0.5) return toast.error("مجموع الأقساط لا يطابق المتبقي");
    }

    // === Discount Approval Flow ===
    // Load price floor; allowed % is already tracked in state (allowedPct)
    let priceFloor: "cost" | "market" | "none" = "cost";
    try {
      const { data: s } = await supabase.from("settings").select("value").eq("key", "discount_policy").maybeSingle();
      const v: any = s?.value ?? {};
      if (v.min_price_floor) priceFloor = v.min_price_floor;
    } catch {}


    if (isCashierOnly) {
      // Block hard floor
      if (priceFloor !== "none") {
        for (const it of items) {
          const lineTotal = Math.max(0, it.quantity * it.selling_price - it.line_discount);
          const eff = lineTotal / Math.max(1, it.quantity);
          const floor = priceFloor === "cost" ? it.cost_price : it.market_price;
          if (floor > 0 && eff < floor) {
            return toast.error(`«${it.product_name}» — السعر أقل من ${priceFloor === "cost" ? "التكلفة" : "سعر السوق"} (${formatEGP(floor)})`);
          }
        }
      }
      // Detect TOTAL invoice discount % over limit → create approval requests, block save
      if (overLimit) {
        if (!resumeDraft) {
          await sendDiscountApprovalRequest();
          return;
        }
        // resumeDraft exists but still over threshold (rare) — block
        return toast.error(`أقصى خصم مسموح به ${allowedPct}%. عدّل الخصم أو اطلب موافقة جديدة.`);
      }
    }


    if (hasLoss && isCashierOnly) return toast.error(`لا يمكن إصدار الفاتورة — بيع بخسارة: ${lossItems.map(i => i.product_name).join("، ")}`);

    setBusy(true);
    try {
      const custId = customerId || null;
      // إذا لم يُدخل الكاشير أي دفعة فالفاتورة فعلياً آجل — لا نسمّيها "نقدي"
      const primaryMethod =
        payments.length > 0
          ? payments[0].payment_method
          : (creditRemaining > 0 ? "credit" : "cash");

      const payload = {
        p_branch_id: branchId!,
        p_customer_id: custId,
        p_subtotal: subtotal,
        p_discount_amount: 0,
        p_discount_percent: 0,
        p_discount_reason: null,
        p_total: total,
        p_payment_method: primaryMethod,
        p_items: items as any,
        p_payments: payments.length > 0 ? payments : null,
        p_vat_rate: vatEnabled ? Number(vatRate) || 0 : 0,
        p_vat_amount: vatAmount,
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

      // Persist backdated invoice_date if changed (DB trigger restricts to admin/super_admin)
      const _today = new Date().toISOString().slice(0, 10);
      if (invoiceDate && invoiceDate !== _today && invId) {
        const { error: dErr } = await supabase
          .from("invoices")
          .update({ invoice_date: invoiceDate } as any)
          .eq("id", invId as any);
        if (dErr) console.warn("invoice_date update blocked:", dErr.message);
      }


      // === FIFO consume (with batch tracking) + profit columns ===
      try {
        for (const it of items) {
          if (!it.product_id) continue;
          const { data: consumeRes } = await supabase.rpc("consume_product_batches_json" as any, {
            _product_id: it.product_id,
            _branch_id: branchId!,
            _quantity: it.quantity,
          });
          const batches: any[] = (consumeRes as any)?.batches ?? [];
          const weightedCost = Number((consumeRes as any)?.weighted_unit_cost ?? it.cost_price);
          const singleBatchId = batches.length === 1 ? batches[0]?.batch_id ?? null : null;
          const lineTotal = Math.max(0, it.quantity * it.selling_price - it.line_discount);
          const finalUnit = lineTotal / Math.max(1, it.quantity);
          const orig = Math.max(it.market_price, it.selling_price);
          const pct = orig > 0 ? +(((orig - finalUnit) / orig) * 100).toFixed(2) : 0;
          await supabase.from("invoice_items").update({
            unit_cost_at_sale: weightedCost,
            original_unit_cost: weightedCost,
            batch_id: singleBatchId,
            batches_consumed: batches.length > 0 ? batches : null,
            original_price: orig,
            final_price: finalUnit,
            discount_percent: pct,
          } as any).eq("invoice_id", invId as string).eq("product_id", it.product_id);
        }
      } catch (e: any) {
        console.warn("FIFO/profit update failed:", e);
      }


      // === Link approved discount requests to invoice + copy approval data ===
      if (resumeDraft) {
        try {
          await supabase.from("discount_approval_requests" as any)
            .update({ invoice_id: invId as string })
            .in("id", resumeDraft.requestIds);
          const { data: reqs } = await supabase.from("discount_approval_requests" as any)
            .select("product_id, decided_by, admin_note, requested_price")
            .in("id", resumeDraft.requestIds);
          for (const r of (reqs ?? []) as any[]) {
            if (!r.product_id) continue;
            await supabase.from("invoice_items").update({
              discount_approved_by: r.decided_by,
              discount_approval_note: r.admin_note,
              final_price: r.requested_price,
            } as any).eq("invoice_id", invId as string).eq("product_id", r.product_id);
          }
          setResumeDraft(null);
        } catch (e) { console.warn("link discount requests failed", e); }
      }

      // Save cashier notes on the invoice (printed on the receipt)
      if (invoiceNotes.trim()) {
        try {
          await supabase.from("invoices").update({ notes: invoiceNotes.trim() } as any).eq("id", invId as string);
        } catch (e) { console.warn("save invoice notes failed", e); }
      }

      await logAudit({
        userId: user!.id, userName: profile!.name, branchId, action: "CREATE",
        entity: "Invoice", entityId: invId as string, details: { total },
      });

      // Create payment plan for credit remainder (auto-triggered on any shortfall)
      if (isCredit && creditRemaining > 0 && custId) {
        try {
          const cust = customers.find((c) => c.id === custId);
          await createPaymentPlanWithInitial({
            branchId: branchId!,
            entityType: "customer",
            entityId: custId,
            entityName: cust?.name ?? "عميل",
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

      // Apply customer credit balance, if any was used
      if (creditToApply > 0 && custId) {
        try {
          const { error: ipErr } = await supabase.from("invoice_payments").insert({
            invoice_id: invId as string,
            tenant_id: (profile as any)?.tenant_id ?? null,
            branch_id: branchId!,
            payment_method: "credit_balance",
            amount: creditToApply,
            received_by_name: profile?.name ?? "رصيد سابق",
          } as any);
          if (ipErr) throw ipErr;
          const newBal = Math.max(0, customerCredit - creditToApply);
          await supabase.from("contacts").update({ credit_balance: newBal, refund_status: newBal === 0 ? "credit_used" : "credit_added" } as any).eq("id", custId);
          await supabase.from("customer_credit_log" as any).insert({
            contact_id: custId, invoice_id: invId as string,
            amount: creditToApply, type: "credit_used",
            notes: "استخدام رصيد سابق في فاتورة جديدة",
            created_by: user!.id,
          });
        } catch (e: any) {
          toast.error("الفاتورة اتسجلت لكن استخدام الرصيد فشل: " + e.message);
        }
      }

      // Apply settlement against what we owe this contact (مقاصة)
      // ملاحظة: payment_method='settlement' بيتحسب تلقائياً في recalc_contact_balance
      // عبر trigger trg_balance_invoice_payments — ومش بنكتب في payment_transactions
      // عشان CHECK constraint بيمنع طرق دفع غير cash/bank/instapay/vodafone.
      if (effectiveSettlement > 0 && custId) {
        try {
          const { error: ipErr } = await supabase.from("invoice_payments").insert({
            invoice_id: invId as string,
            tenant_id: (profile as any)?.tenant_id ?? null,
            branch_id: branchId!,
            payment_method: "settlement",
            amount: effectiveSettlement,
            received_by_name: profile?.name ?? "مقاصة",
          } as any);
          if (ipErr) throw ipErr;
          try { await supabase.rpc("recalc_contact_balance" as any, { _contact_id: custId }); } catch {}
        } catch (e: any) {
          toast.error("الفاتورة اتسجلت لكن المقاصة فشلت: " + e.message);
        }
      }

      syncPendingSales(true);

      // Release all reservations as completed (stock decrement happens server-side via process_sale)
      try { await releaseDraftReservations(draftIdRef.current, "completed"); } catch {}


      toast.success(isCredit && creditRemaining > 0 ? `تم إنشاء الفاتورة — متبقي ${formatEGP(creditRemaining)} كآجل` : "تم إنشاء الفاتورة");
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

      {resumeDraft && (
        <div className="card-elevated p-4 mb-4 border-2 border-success bg-success/5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-success" />
            <div>
              <div className="font-bold text-success">تمت الموافقة على طلب الخصم</div>
              <div className="text-xs text-muted-foreground">فاتورتك السابقة جاهزة للاستكمال — اضغط لاسترجاع الأصناف</div>
            </div>
          </div>
          <Button onClick={loadDraftIntoForm} className="bg-success hover:bg-success/90 text-success-foreground">
            استرجاع الفاتورة وإتمامها
          </Button>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* Customer */}
          <div className="card-elevated p-4">
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <div className="md:col-span-2">
                <Label className="mb-1.5 block">العميل</Label>
                <div className="flex gap-2">
                  <select className="flex-1 bg-input border border-border rounded-lg p-2" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">— اختر عميل (اختياري) —</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
                  </select>
                  <Button type="button" variant="outline" size="icon" onClick={() => setNewCustOpen(true)} title="إضافة عميل جديد">
                    <UserPlus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <InvoiceDateInput value={invoiceDate} onChange={setInvoiceDate} />
            </div>
            {customerId && (() => {
              const b = balanceLabel(customerBalance);
              const isCustomer = customerType === "customer" || customerType === "both";
              const partyWord = customerType === "supplier" ? "المورد" : isCustomer ? "العميل" : "الطرف";
              const friendlyLabel =
                customerBalance > 0
                  ? `ليك رصيد عند ${partyWord}`
                  : customerBalance < 0
                  ? `مستحق ${partyWord === "المورد" ? "للمورد" : "على " + partyWord}`
                  : "لا توجد مديونية سابقة";
              const tone =
                b.tone === "good"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : b.tone === "bad"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-border bg-muted/40 text-muted-foreground";
              const icon = b.tone === "good" ? "💰" : b.tone === "bad" ? "⚠️" : "ℹ️";
              return (
                <div className={`mt-3 p-3 rounded-lg border text-sm flex items-center justify-between flex-wrap gap-2 ${tone}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-base leading-none">{icon}</span>
                    <span>
                      {friendlyLabel}
                      {customerBalance !== 0 && <>: <b className="font-bold">{formatEGP(b.amount)}</b></>}
                    </span>
                    {customerType === "both" && <span className="ms-2 text-xs opacity-70">(عميل ومورد)</span>}
                  </div>
                </div>
              );
            })()}
            {customerId && customerBalance < 0 && total > 0 && (
              <div className="mt-3 p-3 rounded-lg border border-primary/40 bg-primary/10 space-y-2">
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={useSettlement}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setUseSettlement(v);
                      if (v) {
                        const maxSettle = Math.min(total - paymentsSum - creditToApply, Math.abs(customerBalance));
                        setSettlementAmount(Math.max(0, maxSettle));
                      } else {
                        setSettlementAmount(0);
                      }
                    }}
                  />
                  <span>
                    <b>مقاصة</b> — خصم قيمة الفاتورة من المستحق له ({formatEGP(Math.abs(customerBalance))})
                    <div className="text-xs text-muted-foreground mt-0.5">بدل ما يدفع، نقلل اللي إحنا مدينين له بنفس القيمة.</div>
                  </span>
                </label>
                {useSettlement && (
                  <div className="flex items-center gap-2 text-sm">
                    <Label className="text-xs">قيمة المقاصة:</Label>
                    <Input
                      type="number"
                      step="0.01"
                      className="w-32 h-8"
                      value={settlementAmount}
                      onChange={(e) => setSettlementAmount(Math.max(0, Number(e.target.value) || 0))}
                    />
                    <span className="text-xs text-muted-foreground">
                      الحد الأقصى: {formatEGP(Math.min(total - paymentsSum - creditToApply, Math.abs(customerBalance)))}
                    </span>
                  </div>
                )}
              </div>
            )}
            {customerCredit > 0 && (
              <div className="mt-3 p-3 rounded-lg border border-primary/40 bg-primary/10 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  هذا العميل لديه رصيد دائن: <b className="text-primary">{formatEGP(customerCredit)}</b>
                  {creditToApply > 0 && <span className="text-success ms-2">— سيتم استخدام {formatEGP(creditToApply)}</span>}
                </div>
                <div className="flex gap-2">
                  {creditToApply === 0 ? (
                    <Button type="button" size="sm" onClick={() => setCreditToApply(Math.min(customerCredit, total))} disabled={total <= 0}>
                      استخدام الرصيد
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => setCreditToApply(0)}>
                      تجاهل
                    </Button>
                  )}
                </div>
              </div>
            )}
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
                        {(() => {
                          const avail = availability[p.id] ?? Number(p.quantity || 0);
                          const stock = Number(p.quantity || 0);
                          const reserved = Math.max(0, stock - avail);
                          const minLevel = Number((p as any).min_stock_level ?? p.low_stock_alert ?? 5);
                          const cls = avail <= 0 ? "text-destructive" : avail < 3 ? "text-warning" : avail <= minLevel ? "text-warning" : "text-foreground";
                          const badge = avail <= 0 ? "غير متاح حالياً" : avail < 3 ? "كمية محدودة" : avail <= minLevel ? "مخزون منخفض" : null;
                          return (
                            <>
                              <div>📊 المتاح: <span className={`${cls} font-bold`}>{avail}</span> {badge && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ml-1 ${avail <= 0 ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>{badge}</span>}</div>
                              {reserved > 0 && <div className="text-[10px] text-muted-foreground">في المخزون {stock} | محجوز {reserved}</div>}
                            </>
                          );
                        })()}
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
                          {(() => {
                            const r = reservations[i.product_id];
                            if (!r) return null;
                            const msLeft = new Date(r.expires_at).getTime() - nowTick;
                            if (msLeft <= 0) {
                              return <div className="text-[10px] text-destructive mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> ❌ انتهى وقت الحجز — أعد إضافة المنتج</div>;
                            }
                            const totalSec = Math.floor(msLeft / 1000);
                            const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
                            const ss = String(totalSec % 60).padStart(2, "0");
                            const warn = totalSec <= 5 * 60;
                            return (
                              <div className={`text-[10px] mt-1 flex items-center gap-1 ${warn ? "text-warning font-bold" : "text-success"}`}>
                                {warn ? <AlertTriangle className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                                {warn ? "⚠️ سيتم إلغاء الحجز خلال" : "محجوز — ينتهي خلال"} {mm}:{ss}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="p-2 text-center">
                          <Input type="number" min="1" value={i.quantity} onChange={(e) => updateQty(k, parseInt(e.target.value) || 0)} className="w-20 mx-auto text-center" />
                        </td>
                        <td className="p-2 text-center">
                          <Input type="number" min="0" step="0.01" value={i.selling_price} onChange={(e) => updatePrice(k, parseFloat(e.target.value) || 0)} className="w-28 mx-auto text-center" />
                        </td>
                        <td className="p-2 text-center">
                          <div className="flex items-center gap-1 justify-center">
                            <Input
                              type="number" min="0" step="0.01"
                              value={i.discount_input || ""}
                              onChange={(e) => setDiscountInput(k, parseFloat(e.target.value) || 0)}
                              className="w-24 text-center"
                              placeholder={i.discount_mode === "amount" ? "مبلغ" : "%"}
                            />
                            <div className="flex flex-col">
                              <button
                                type="button"
                                onClick={() => setDiscountMode(k, "amount")}
                                className={`px-1.5 py-0.5 text-[10px] rounded-t border ${i.discount_mode === "amount" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}
                                title="مبلغ بالجنيه"
                              >ج.م</button>
                              <button
                                type="button"
                                onClick={() => setDiscountMode(k, "percent")}
                                className={`px-1.5 py-0.5 text-[10px] rounded-b border-t-0 border ${i.discount_mode === "percent" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}
                                title="نسبة مئوية"
                              >%</button>
                            </div>
                          </div>
                          {i.line_discount > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-1">= {formatEGP(i.line_discount)}</div>
                          )}
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

          {/* Multi-payment methods */}
          <div className="card-elevated p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold">طرق الدفع</h3>
                <p className="text-xs text-muted-foreground mt-0.5">اختر طريقة واحدة أو قسّم المبلغ على أكثر من طريقة</p>
              </div>
              <Button size="sm" variant="outline" onClick={addPayment} className="gap-1" disabled={total <= 0}>
                <Plus className="w-3 h-3" /> إضافة دفعة
              </Button>
            </div>

            {payments.length === 0 ? (
              <div className="text-xs text-muted-foreground p-4 rounded-lg bg-surface-2 text-center border border-dashed border-border">
                💵 الافتراضي: المبلغ كله كاش.<br/>
                اضغط <b>«إضافة دفعة»</b> لاختيار طريقة أخرى أو لتقسيم المبلغ.
              </div>
            ) : (
              <div className="space-y-3">
                {payments.map((p, idx) => (
                  <div key={idx} className="p-3 rounded-lg border border-border bg-surface-1 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-muted-foreground">دفعة #{idx + 1}</span>
                      <Button variant="ghost" size="sm" onClick={() => removePayment(idx)} title="حذف الدفعة">
                        <X className="w-3 h-3" />
                      </Button>
                    </div>

                    {/* Method chips — clearer than dropdown */}
                    <div>
                      <Label className="text-xs mb-1.5 block">طريقة الدفع</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {methodOptions.map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => updatePayment(idx, { payment_method: m.value })}
                            className={`px-2.5 py-1.5 rounded-md text-xs border transition-all ${
                              p.payment_method === m.value
                                ? "bg-primary text-primary-foreground border-primary font-bold shadow-sm"
                                : "bg-background hover:bg-muted border-border"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs mb-1.5 block">المبلغ</Label>
                      <Input
                        type="number" min="0" step="0.01" placeholder="0.00"
                        value={p.amount || ""}
                        onChange={(e) => updatePayment(idx, { amount: parseFloat(e.target.value) || 0 })}
                      />
                    </div>

                    {p.payment_method !== "cash" && (
                      <div className="space-y-2 p-2.5 rounded-md bg-muted/40 border border-border/60">
                        <div>
                          <Label className="text-xs mb-1 block">رقم العملية / المرجع</Label>
                          <Input
                            placeholder="رقم التحويل أو الإيصال"
                            value={p.reference_number}
                            onChange={(e) => updatePayment(idx, { reference_number: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs mb-1 block">رقم الحساب / التليفون المُحوَّل <b>منه</b> *</Label>
                          <Input
                            dir="ltr" className="text-right"
                            placeholder="حساب العميل المُرسِل"
                            value={p.transfer_from_account}
                            onChange={(e) => updatePayment(idx, { transfer_from_account: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs mb-1 block">رقم الحساب / التليفون المُحوَّل <b>إليه</b> *</Label>
                          <Input
                            dir="ltr" className="text-right"
                            placeholder="حسابنا اللي وصل عليه"
                            value={p.transfer_to_account}
                            onChange={(e) => updatePayment(idx, { transfer_to_account: e.target.value })}
                          />
                        </div>
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
                      </div>
                    )}

                    <div>
                      <Label className="text-xs mb-1 block">
                        الموظف اللي استلم الفلوس
                        <span className="text-muted-foreground font-normal mr-1">(اسم الكاشير أو المسؤول)</span>
                      </Label>
                      <Input
                        placeholder="اسم المستلم"
                        value={p.received_by_name}
                        onChange={(e) => updatePayment(idx, { received_by_name: e.target.value })}
                      />
                    </div>
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


          {/* Credit / installments — auto-active when payments < total */}
          <div className="card-elevated p-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={creditMode} onChange={(e) => setCreditMode(e.target.checked)} className="w-4 h-4" />
              <span className="font-bold">بيع بالآجل (تسجيل المتبقي كمديونية)</span>
              {creditRemaining > 0 && !creditMode && (
                <span className="text-xs text-warning mr-2">— مُفعّل تلقائياً (يوجد متبقي)</span>
              )}
            </label>
            {isCredit && (
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


          {/* Live discount bar */}
          {items.length > 0 && (
            <div className={`card-elevated p-4 border-2 ${overLimit ? "border-destructive bg-destructive/5" : "border-success/40 bg-success/5"}`}>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">إجمالي قبل الخصم</span><span className="font-bold">{formatEGP(totalBeforeDiscount)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">إجمالي الخصم</span><span className="font-bold">{formatEGP(totalDiscountAmount)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">نسبة الخصم الفعلية</span><span className={`font-bold ${overLimit ? "text-destructive" : "text-success"}`}>{effectiveDiscountPct.toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">الحد المسموح للفرع</span><span className="font-bold">{Number(allowedPct).toFixed(2)}%</span></div>
                <div className={`flex justify-between pt-1.5 border-t ${overLimit ? "border-destructive/30 text-destructive" : "border-success/30 text-success"}`}>
                  <span className="font-bold">الحالة</span>
                  <span className="font-bold">
                    {overLimit
                      ? `⚠️ تجاوزت الحد المسموح بـ ${(effectiveDiscountPct - allowedPct).toFixed(2)}%`
                      : "✅ ضمن الحد المسموح"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {overLimit && isCashierOnly && !bannerDismissed && !resumeDraft && (
            <div className="card-elevated p-4 border-2 border-destructive bg-destructive/5 space-y-3">
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-sm font-bold">
                  نسبة الخصم الكلية {effectiveDiscountPct.toFixed(1)}% تتجاوز الحد المسموح {Number(allowedPct).toFixed(1)}%
                  <div className="font-normal text-xs mt-1">يرجى تعديل الخصم أو طلب موافقة المدير</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setBannerDismissed(true)}>تعديل الخصم</Button>
                <Button variant="destructive" className="flex-1" disabled={requestingApproval} onClick={sendDiscountApprovalRequest}>
                  {requestingApproval ? <Loader2 className="w-4 h-4 animate-spin" /> : "طلب موافقة"}
                </Button>
              </div>
            </div>
          )}

          <div className="card-elevated p-5">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">الإجمالي</span><span className="font-bold">{formatEGP(subtotal)}</span></div>

              {/* VAT toggle (optional, editable rate) */}
              <div className="mt-2 p-2.5 rounded-lg bg-surface-2 border border-dashed border-border space-y-2">
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="font-bold text-xs">إضافة ضريبة القيمة المضافة</span>
                  <input type="checkbox" checked={vatEnabled} onChange={(e) => setVatEnabled(e.target.checked)} className="w-4 h-4" />
                </label>
                {vatEnabled && (
                  <>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs whitespace-nowrap">النسبة %</Label>
                      <Input
                        type="number" min={0} max={100} step="0.01"
                        value={vatRate}
                        onChange={(e) => setVatRate(Number(e.target.value) || 0)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">قيمة الضريبة</span>
                      <span className="font-bold">{formatEGP(vatAmount)}</span>
                    </div>
                  </>
                )}
            </div>

            <div className="mt-3 space-y-1">
              <Label className="text-xs font-bold">ملاحظات (تظهر في الفاتورة المطبوعة)</Label>
              <Textarea
                value={invoiceNotes}
                onChange={(e) => setInvoiceNotes(e.target.value)}
                placeholder="مثال: تسليم يوم الأحد — يشمل ضمان شهر"
                rows={2}
                maxLength={300}
                className="text-sm resize-none"
              />
            </div>


              <div className="border-t border-border pt-3 flex justify-between text-base"><span className="font-bold">الإجمالي النهائي</span><span className={`${overLimit && isCashierOnly ? "text-destructive" : "text-primary"} font-extrabold text-xl`}>{formatEGP(total)}</span></div>
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

            <Button
              className="w-full mt-4 h-12 btn-gradient text-base"
              disabled={busy || !items.length || hasLoss || !paymentsValid || (overLimit && isCashierOnly)}
              onClick={submit}
            >
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
