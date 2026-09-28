import { CustomerSelect } from "@/components/CustomerSelect";
import { LockedRecipientInput, useCurrentUserName } from "@/components/LockedRecipient";
import { saveDocAnnotations } from "@/lib/docAnnotations";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { focusSection } from "@/lib/sectionFocus";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { logAudit } from "@/lib/roles";
import { formatEGP, balanceLabel } from "@/lib/format";
import { searchMatch, filterProductsBySearch } from "@/lib/search";
import { toast } from "sonner";
import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftRestoreBar } from "@/components/DraftRestoreBar";
import { docSuccess, docError } from "@/lib/docToast";
import { enqueueSale, syncPendingSales } from "@/lib/offlineQueue";
import { Search, Trash2, Printer, Loader2, ScanLine, BookmarkPlus, Plus, X, AlertTriangle, Camera, UserPlus, CheckCircle2, Clock, ShieldCheck, ShoppingCart, User as UserIcon, Minus, Wallet, Package, ChevronDown, ChevronUp, CreditCard, FileText } from "lucide-react";
import { AddAnotherBar } from "@/components/AddAnotherBar";
import { computeInvoiceTotals } from "@/lib/invoiceCalc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { ColorChip } from "@/components/ColorPicker";
import { ProductCell, VariantLine } from "@/components/VariantChips";
import type { VariantAttrs } from "@/lib/productVariant";
import { useCanViewNetProfit, NET_PROFIT_MASK } from "@/lib/netProfitAccess";



interface Item extends VariantAttrs {
  product_id: string;
  product_name: string;
  quantity: number;
  cost_price: number;
  selling_price: number;
  market_price: number;
  line_discount: number; // EGP — source of truth
  discount_mode: "amount" | "percent"; // UI only
  discount_input: number; // last typed value in current mode
  color?: string | null;
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
  const canViewNetProfit = useCanViewNetProfit();
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile, isAdmin, hasRole, tenantId } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const prefillAppliedRef = useRef(false);

  const showCost = isAdmin || hasRole("branch_manager") || hasRole("accountant");

  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  // الصنف المفتوح حاليًا — اللي قبله بيتطوى تلقائي
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const [products, setProducts] = useState<any[]>([]);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }));
  const [pricesMap, setPricesMap] = useState<Record<string, number>>({});
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [methodOptions, setMethodOptions] = useState<PaymentMethodOption[]>([{ value: "cash", label: "💵 نقدي", is_builtin: true, is_enabled: true }]);


  const [busy, setBusy] = useState(false);
  const [scannerMode, setScannerMode] = useState(false);
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
  const [openSections, setOpenSections] = useState({ customer: true, products: true, payment: true, summary: true });
  const toggleSection = (k: keyof typeof openSections) => setOpenSections((s) => focusSection(s, k));
  // Customer credit balance + ledger balance
  const [customerCredit, setCustomerCredit] = useState(0);
  const [creditToApply, setCreditToApply] = useState(0);
  const [customerBalance, setCustomerBalance] = useState(0); // contacts.balance (>0 له عندنا، <0 علينا له)
  const [customerType, setCustomerType] = useState<string>("customer");
  const [useSettlement, setUseSettlement] = useState(false);
  const [settlementAmount, setSettlementAmount] = useState(0);
  // VAT (editable rate from settings)
  const [vatEnabled, setVatEnabled] = useState(false);
  // لو المستخدم استرجع مسودة، منمسحش اختياره للضريبة بالإعداد الافتراضي
  const restoredDraftRef = useRef(false);
  const [vatRate, setVatRate] = useState<number>(14);
  const [invoiceNotes, setInvoiceNotes] = useState<string>("");
  const [recipientName, setRecipientName] = useState<string>("");
  const __me = useCurrentUserName();
  useEffect(() => { if (true && __me && recipientName !== __me) setRecipientName(__me); }, [__me, recipientName]);
  // Invoice-level discount
  const [invoiceDiscountMode, setInvoiceDiscountMode] = useState<"amount" | "percent">("amount");
  const [invoiceDiscountInput, setInvoiceDiscountInput] = useState<number>(0);

  // ===== Local autosave (crash / accidental reload safety net) =====
  const localSnapshot = { items, customerId, invoiceDate, vatEnabled, vatRate, invoiceNotes, invoiceDiscountMode, invoiceDiscountInput };
  const localDraft = useFormDraft<typeof localSnapshot>(
    "sale",
    [user?.id, branchId],
    localSnapshot,
    items.length > 0 && !busy,
  );
  const [localDraftDismissed, setLocalDraftDismissed] = useState(false);
  const [restoringLocal, setRestoringLocal] = useState(false);
  const restoreLocalDraft = async () => {
    const d = localDraft.draft?.data;
    if (!d || !branchId) return;
    setRestoringLocal(true);
    try {
      const kept: Item[] = [];
      const shortages: string[] = [];
      for (const it of d.items ?? []) {
        const r = await reserveStock({
          productId: it.product_id,
          branchId,
          draftId: draftIdRef.current,
          quantity: it.quantity,
          cashierName: user?.email ?? null,
        });
        if (r.ok) kept.push(it);
        else shortages.push(it.product_name);
      }
      setItems(kept);
      setCustomerId(d.customerId ?? "");
      setInvoiceDate(d.invoiceDate ?? invoiceDate);
      restoredDraftRef.current = true;
      setVatEnabled(!!d.vatEnabled);
      setVatRate(d.vatRate ?? 14);
      setInvoiceNotes(d.invoiceNotes ?? "");
      setInvoiceDiscountMode(d.invoiceDiscountMode ?? "amount");
      setInvoiceDiscountInput(d.invoiceDiscountInput ?? 0);
      if (shortages.length) toast.warning(`تم استبعاد أصناف غير متاحة الآن: ${shortages.join("، ")}`);
      setLocalDraftDismissed(true);
      localDraft.dismiss();
    } finally {
      setRestoringLocal(false);
    }
  };

  // ===== Reservation state =====
  const draftIdRef = useRef<string>(crypto.randomUUID());
  const [availability, setAvailability] = useState<Record<string, number>>({}); // available per product (excludes my own reservation)
  const [reservations, setReservations] = useState<Record<string, { reservation_id: string; expires_at: string }>>({});
  const [nowTick, setNowTick] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Guard: block sales without an open cashier shift (admins are exempt)
  const [shiftReady, setShiftReady] = useState<boolean>(false);
  useEffect(() => {
    if (!branchId || !user?.id) return;
    if (isAdmin) { setShiftReady(true); return; }
    (async () => {
      const { getOpenShift } = await import("@/lib/shifts");
      const { fetchSchedules, hoursOpen } = await import("@/lib/branchSchedule");
      try {
        const s = await getOpenShift(branchId);
        if (!s) {
          toast.error("لازم تفتح وردية قبل البدء في البيع");
          nav(`/branch/${branchId}/shifts/open`, {
            replace: true,
            state: { returnTo: `/branch/${branchId}/sales/new` },
          });
          return;
        }
        // Hard stop: shift exceeded the branch max open hours — must be closed first
        const scheds = await fetchSchedules();
        const maxHrs = scheds[branchId]?.auto_close_hours ?? 16;
        const hrs = hoursOpen(s.opened_at);
        if (hrs >= maxHrs) {
          toast.error(`الوردية مفتوحة من ${Math.floor(hrs)} ساعة — لازم تقفلها قبل ما تكمل بيع`);
          nav(`/branch/${branchId}/shifts/close`, { replace: true });
          return;
        }
        if ((s as any).opening_status && (s as any).opening_status !== "accepted") {
          toast.error("العهدة لسه مش معتمدة من الإدارة — البيع متوقف");
          nav(`/branch/${branchId}/shifts/open`, { replace: true });
          return;
        }
        setShiftReady(true);

      } catch (e: any) {
        toast.error(e.message ?? "خطأ في التحقق من الوردية");
      }
    })();
  }, [branchId, user?.id, isAdmin, nav]);

  useEffect(() => {
    setCreditToApply(0);
    setUseSettlement(false);
    setSettlementAmount(0);
    if (!customerId) { setCustomerCredit(0); setCustomerBalance(0); setCustomerType("customer"); return; }
    const load = async () => {
      // TODO Phase 2.2B: Remove after contacts.balance column is dropped
      const { data } = await supabase.from("v_contact_balances" as any).select("credit_balance, total_balance, type").eq("contact_id", customerId).maybeSingle();
      setCustomerCredit(Number((data as any)?.credit_balance ?? 0));
      setCustomerBalance(Number((data as any)?.total_balance ?? 0));
      setCustomerType(String((data as any)?.type ?? "customer"));
    };
    load();
    const ch = supabase.channel(`contact-credit-${customerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts", filter: `id=eq.${customerId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices", filter: `contact_id=eq.${customerId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_payments" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [customerId]);

  const addNewCustomer = async () => {
    if (!newCust.name.trim()) return toast.error("الاسم مطلوب");
    if (!tenantId) return toast.error("مفيش حساب مرتبط — جرّب تعمل تسجيل خروج ودخول تاني");
    setSavingCust(true);
    const { data, error } = await supabase.from("contacts").insert({
      tenant_id: tenantId,
      type: "customer",
      name: newCust.name.trim(),
      phone: newCust.phone || null,
      address: newCust.address || null,
      branch_id: branchId!,
    }).select("id, name, phone").single();
    setSavingCust(false);
    if (error) return toast.error(error.message);
    setCustomers((prev) => [...prev, data]);
    window.dispatchEvent(new Event("party:refresh"));

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
      if (!v) return;
      if (typeof v.rate === "number") setVatRate(Number(v.rate));
      // الضريبة بتتفعّل افتراضيًا حسب الإعدادات (قبل كده كانت مقفولة دايمًا)
      if (typeof v.enabled === "boolean" && !restoredDraftRef.current) setVatEnabled(v.enabled);
    });
  }, []);


  const [defaultBankAccount, setDefaultBankAccount] = useState<string>("");
  const loadCatalog = useCallback(() => {
    supabase.from("price_list_items_public").select("id, product_name, model_code, category, supplier_name, display_price").eq("is_active", true).then(({ data }) => {
      const list = data ?? [];
      setCatalog(list);
      const m: Record<string, number> = {};
      list.forEach((p: any) => { if (p.product_name) m[p.product_name] = Number(p.display_price); });
      setPricesMap(m);
    });
  }, []);
  // Price list edits (rename / bulk price changes) reflect live without refreshing the page
  useRealtimeRefresh(["price_list_items", "price_list_sources"], loadCatalog);
  useEffect(() => {
    if (!branchId) return;
    supabase.from("products").select("*").eq("branch_id", branchId).is("archived_at", null).order("name").then(({ data }) => setProducts(data ?? []));
    supabase.from("contacts").select("id, name, phone").eq("is_archived", false).eq("branch_id", branchId).order("name").then(({ data }) => setCustomers(data ?? []));
    loadCatalog();
    // Load branch default bank account (settings key scoped by branch)
    supabase.from("settings" as any).select("value").eq("key", `branch_default_bank:${branchId}`).maybeSingle()
      .then(({ data }) => setDefaultBankAccount(String((data as any)?.value?.account ?? "")));
  }, [branchId]);

  // Load last transfer-from account used by the selected customer
  const [customerLastFromAccount, setCustomerLastFromAccount] = useState<string>("");
  useEffect(() => {
    if (!customerId) { setCustomerLastFromAccount(""); return; }
    supabase.from("payment_transactions" as any)
      .select("transfer_from_account, created_at")
      .eq("contact_id", customerId)
      .not("transfer_from_account", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setCustomerLastFromAccount(String((data as any)?.transfer_from_account ?? "")));
  }, [customerId]);

  // Auto-prefill transfer_to_account for non-cash methods when empty
  useEffect(() => {
    if (!defaultBankAccount && !customerLastFromAccount) return;
    setPayments((curr) => {
      let dirty = false;
      const next = curr.map((p) => {
        if (p.payment_method === "cash") return p;
        const patch: Partial<PaymentSplit> = {};
        if (!p.transfer_to_account && defaultBankAccount) patch.transfer_to_account = defaultBankAccount;
        if (!p.transfer_from_account && customerLastFromAccount) patch.transfer_from_account = customerLastFromAccount;
        if (Object.keys(patch).length) { dirty = true; return { ...p, ...patch }; }
        return p;
      });
      return dirty ? next : curr;
    });
  }, [defaultBankAccount, customerLastFromAccount, payments.length]);

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
        const { data } = await supabase.from("products").select("*").eq("branch_id", branchId).is("archived_at", null).order("name");
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

  const [restoringDraft, setRestoringDraft] = useState(false);
  const loadDraftIntoForm = async () => {
    if (!resumeDraft || !branchId) return;
    const p = resumeDraft.payload;
    const draftItems: Item[] = p.items ?? [];
    if (draftItems.length === 0) return;
    setRestoringDraft(true);
    try {
      // Re-check availability by attempting to (re)reserve every line under the SAME draft id.
      // reserveStock is atomic on the DB side and renews expires_at when successful.
      draftIdRef.current = resumeDraft.draftId;
      const shortages: { name: string; requested: number; available: number }[] = [];
      for (const it of draftItems) {
        const r = await reserveStock({
          productId: it.product_id,
          branchId,
          draftId: resumeDraft.draftId,
          quantity: it.quantity,
          cashierName: user?.email ?? null,
        });
        if (!r.ok) {
          shortages.push({
            name: it.product_name,
            requested: it.quantity,
            available: Number(r.available_for_me ?? r.available ?? 0),
          });
        }
      }
      if (shortages.length > 0) {
        const lines = shortages
          .map((s) => `• ${s.name}: المخزون المتاح ${s.available} بدل ${s.requested}`)
          .join("\n");
        toast.error(`الكميات تغيرت منذ إنشاء الطلب — عدّل الفاتورة قبل الاستكمال:\n${lines}`, {
          duration: 12000,
        });
        // Load items but flag shortages by clamping — cashier must review before saving
        const clamped = draftItems.map((it) => {
          const sh = shortages.find((s) => s.name === it.product_name);
          if (!sh) return it;
          return { ...it, quantity: Math.max(0, sh.available) };
        });
        setItems(clamped);
      } else {
        setItems(draftItems);
        toast.success("تم استرجاع الفاتورة وتجديد الحجز لـ 24 ساعة");
      }
      setCustomerId(p.customerId ?? "");
      setPayments(p.payments ?? []);
      setCreditMode(!!p.creditMode);
      setScheduleType(p.scheduleType ?? "open");
      setInstallments(p.installments ?? []);
    } finally {
      setRestoringDraft(false);
    }
  };


  const filtered = useMemo(
    () => filterProductsBySearch(products as any[], search).slice(0, 50),
    [products, search]
  );

  // Unified totals via shared helper — see src/lib/invoiceCalc.ts
  const totals = useMemo(
    () =>
      computeInvoiceTotals(
        items,
        Number(invoiceDiscountInput) || 0,
        invoiceDiscountMode,
        vatEnabled ? Number(vatRate) || 0 : 0
      ),
    [items, invoiceDiscountInput, invoiceDiscountMode, vatEnabled, vatRate]
  );
  const subtotal = totals.subtotal;
  const invoiceDiscount = totals.invoiceDiscount;
  const subtotalAfterInvoiceDiscount = totals.netAfterDiscount;
  const vatAmount = totals.taxAmount;
  const total = totals.total;
  const totalCost = useMemo(
    () => items.reduce((s, i) => s + i.quantity * i.cost_price, 0),
    [items]
  );
  const totalProfit = subtotalAfterInvoiceDiscount - totalCost;
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
    () => items.reduce((s, i) => s + Math.min(i.line_discount, i.quantity * i.selling_price), 0) + invoiceDiscount,
    [items, invoiceDiscount]
  );
  const effectiveDiscountPct = totalBeforeDiscount > 0
    ? (totalDiscountAmount / totalBeforeDiscount) * 100
    : 0;
  const overLimit = items.length > 0 && effectiveDiscountPct > allowedPct + 0.001;

  // Re-show banner whenever discount or allowed limit changes
  useEffect(() => { setBannerDismissed(false); }, [totalDiscountAmount, allowedPct]);




  const filteredCatalog = useMemo(
    () => catalogSearch
      ? filterProductsBySearch(catalog as any[], catalogSearch).slice(0, 50)
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
        color: (p as any).color ?? null,
        brand: (p as any).brand ?? null,
        model: (p as any).model ?? null,
        product_type: (p as any).product_type ?? null,
        capacity: (p as any).capacity ?? null,
        size: (p as any).size ?? null,
      }]);
    }
    setSearch("");
    // افتح الصنف الجديد واطوِ اللي قبله + رجّع الفوكس للبحث
    setExpandedKey(p.id);
    if (!scannerMode) setTimeout(() => searchInputRef.current?.focus(), 60);
  };

  // فوكس تلقائي على البحث أول ما يفتح قسم المنتجات
  useEffect(() => {
    if (!openSections.products || scannerMode) return;
    const t = setTimeout(() => searchInputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [openSections.products, scannerMode]);


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

    // بوابة الوردية: مفيش فواتير جديدة أثناء الإقفال الناعم أو قبل اعتماد العهدة
    if (!isAdmin) {
      try {
        const { fetchSaleGate } = await import("@/lib/shifts");
        const gate = await fetchSaleGate(branchId);
        if (!gate.allowed) {
          if (gate.reason === "handover_pending")
            return toast.error("العهدة لسه مش معتمدة من الإدارة — مش هينفع تصدر فاتورة");
          if (gate.reason === "soft_close")
            return toast.error("الوردية قربت تخلص — البيع اتوقف، صفّي الدرج واقفل الوردية");
          if (gate.reason === "no_shift")
            return toast.error("لازم تفتح وردية قبل البدء في البيع");
        }
      } catch { /* لو البوابة فشلت مانوقفش البيع */ }
    }


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
      // المفتاح الصح هو discount_policy_global (اللي شاشة الإعدادات بتكتب فيه)
      const { data: s } = await supabase.from("settings").select("value").eq("key", "discount_policy_global").maybeSingle();
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
      // المقاصة/الرصيد السابق لا يحرّكان الخزينة: لو مفيش دفعات فعلية نبعت قائمة فاضية
      // (مش null) عشان process_sale ما يفترضش إن الفاتورة كلها اتدفعت كاش.
      const hasNonCashSettlement = effectiveSettlement > 0 || creditToApply > 0;
      const primaryMethod =
        payments.length > 0
          ? payments[0].payment_method
          : creditRemaining > 0
            ? "credit"
            : hasNonCashSettlement
              ? (effectiveSettlement > 0 ? "settlement" : "credit_balance")
              : "cash";

      const payload = {
        p_branch_id: branchId!,
        p_customer_id: custId,
        p_subtotal: subtotal,
        p_discount_amount: invoiceDiscount,
        p_discount_percent: subtotal > 0 ? +((invoiceDiscount / subtotal) * 100).toFixed(2) : 0,
        p_discount_reason: invoiceDiscount > 0 ? `خصم إجمالي الفاتورة (${invoiceDiscountMode === "amount" ? "مبلغ" : "%"})` : null,
        p_total: total,
        p_payment_method: primaryMethod,
        p_items: items as any,
        p_payments: payments.length > 0 ? payments : (hasNonCashSettlement ? [] : null),
        p_vat_rate: vatEnabled ? Number(vatRate) || 0 : 0,
        p_vat_amount: vatAmount,
        p_invoice_date: invoiceDate || null,
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

      // === Profit/pricing columns only ===
      // ملاحظة: خصم المخزون + طبقات FIFO (consume_product_batches_json) بيتنفذوا داخل process_sale
      // على السيرفر. أي استدعاء تاني من المتصفح كان بيسبب خصم مزدوج للمخزون — لذلك اتشال.
      try {
        for (const it of items) {
          if (!it.product_id) continue;
          const lineTotal = Math.max(0, it.quantity * it.selling_price - it.line_discount);
          const finalUnit = lineTotal / Math.max(1, it.quantity);
          const orig = Math.max(it.market_price, it.selling_price);
          const pct = orig > 0 ? +(((orig - finalUnit) / orig) * 100).toFixed(2) : 0;
          await supabase.from("invoice_items").update({
            original_price: orig,
            final_price: finalUnit,
            discount_percent: pct,
          } as any).eq("invoice_id", invId as string).eq("product_id", it.product_id);
        }
      } catch (e: any) {
        console.warn("profit update failed:", e);
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

      if (recipientName.trim()) {
        try { await saveDocAnnotations("invoice", invId as string, recipientName, invoiceNotes); }
        catch (e) { console.warn("save recipient failed", e); }
      }
      // Save cashier notes on the invoice (printed on the receipt)
      if (invoiceNotes.trim()) {
        try {
          await supabase.rpc("set_invoice_meta" as any, { p_invoice_id: invId as string, p_invoice_date: null, p_notes: invoiceNotes.trim() });
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
      // بيتوجّه من خلال record_contact_payment عشان يظهر في تقرير المعاملات (payment_transactions)
      // ومش بيحرّك الخزنة — الـ RPC بيتخطى treasury لما payment_method='settlement'
      if (effectiveSettlement > 0 && custId) {
        try {
          const { error: rpcErr } = await supabase.rpc("record_contact_payment" as any, {
            p_contact_id: custId,
            p_branch_id: branchId!,
            p_direction: "in",
            p_amount: effectiveSettlement,
            p_payment_method: "settlement",
            p_reference_number: null,
            p_transfer_to_account: null,
            p_received_by_name: profile?.name ?? "مقاصة",
            p_fee_amount: 0,
            p_fee_type: null,
            p_fee_on_customer: false,
            p_notes: "مقاصة على فاتورة " + (invId as string),
            p_transfer_from_account: null,
            p_invoice_id: invId as string,
          });
          if (rpcErr) throw rpcErr;
        } catch (e: any) {
          toast.error("الفاتورة اتسجلت لكن المقاصة فشلت: " + e.message);
        }
      }

      syncPendingSales(true);

      // Release all reservations as completed (stock decrement happens server-side via process_sale)
      try { await releaseDraftReservations(draftIdRef.current, "completed"); } catch {}


      localDraft.clear();
      docSuccess({
        title: "تم إنشاء فاتورة البيع بنجاح",
        description: isCredit && creditRemaining > 0 ? `متبقي ${formatEGP(creditRemaining)} كآجل` : "تم تحصيل المبلغ بالكامل",
        amount: total,
        action: { label: "فتح الفاتورة", onClick: () => nav(`/branch/${branchId}/sales/${invId}`) },
      });
      nav(`/branch/${branchId}/sales/${invId}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BranchLayout>
      <PageHeader title="فاتورة بيع جديدة" subtitle="نقطة البيع" />

      {localDraft.draft && !localDraftDismissed && items.length === 0 && (
        <DraftRestoreBar
          savedAt={localDraft.draft.savedAt}
          summary={restoringLocal ? "جاري الاسترجاع..." : `${localDraft.draft.data.items?.length ?? 0} صنف`}
          onRestore={restoreLocalDraft}
          onDismiss={() => { setLocalDraftDismissed(true); localDraft.clear(); }}
        />
      )}

      {resumeDraft && (
        <div className="card-elevated p-4 mb-4 border-2 border-success bg-success/5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-success" />
            <div>
              <div className="font-bold text-success">تمت الموافقة على طلب الخصم</div>
              <div className="text-xs text-muted-foreground">فاتورتك السابقة جاهزة للاستكمال — اضغط لاسترجاع الأصناف</div>
            </div>
          </div>
          <Button onClick={loadDraftIntoForm} disabled={restoringDraft} className="bg-success hover:bg-success/90 text-success-foreground">
            {restoringDraft ? <><Loader2 className="w-4 h-4 ml-1 animate-spin" /> جاري التحقق من المخزون…</> : "استرجاع الفاتورة وإتمامها"}
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {/* ============ SECTION 1: بيانات العميل ============ */}
        <div className="card-elevated overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection("customer")}
            className="w-full flex items-center gap-3 px-6 py-4 bg-gradient-to-l from-sky-500/10 via-sky-400/5 to-transparent border-b border-border hover:brightness-105 transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center border border-sky-500/30 shrink-0">
              <UserIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 text-center text-xl font-extrabold text-sky-700 dark:text-sky-300 tracking-tight">
              بيانات العميل والفاتورة
            </div>
            <div className="w-10 h-10 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
              {openSections.customer ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </div>
          </button>
          {openSections.customer && (
          <div>

            <div className="p-3 space-y-2">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1 block">العميل</Label>
                  <div className="flex gap-2">
                    <CustomerSelect className="flex-1" customers={customers} value={customerId} onChange={setCustomerId} />
                    <Button type="button" variant="outline" size="icon" onClick={() => setNewCustOpen(true)} title="إضافة عميل جديد">
                      <UserPlus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <InvoiceDateInput value={invoiceDate} onChange={setInvoiceDate} />
                </div>
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
                <div className={`mt-2 p-2.5 rounded-lg border text-sm flex items-center justify-between flex-wrap gap-2 ${tone}`}>
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
              <div className="mt-2 p-2.5 rounded-lg border border-primary/40 bg-primary/10 space-y-2">
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
              <div className="mt-2 p-2.5 rounded-lg border border-primary/40 bg-primary/10 flex flex-wrap items-center justify-between gap-2">
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
          </div>
          )}
        </div>


        {/* ============ SECTION 2: اختيار المنتجات ============ */}
        <div className="card-elevated overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection("products")}
            className="w-full flex items-center gap-3 px-6 py-4 bg-gradient-to-l from-emerald-500/10 via-emerald-400/5 to-transparent border-b border-border hover:brightness-105 transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div className="flex-1 text-center text-xl font-extrabold text-emerald-700 dark:text-emerald-300 tracking-tight">
              اختيار المنتجات وعناصر الفاتورة
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
              {openSections.products ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </div>
          </button>
          {openSections.products && (
          <div className="p-4 space-y-4">

          <div className="card-elevated p-4">

            <Tabs defaultValue="stock" className="w-full">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mb-3">
                <div />
                <TabsList className="h-12 p-1.5 bg-muted/80 rounded-lg">
                  <TabsTrigger
                    value="stock"
                    className="gap-2 px-5 py-2 text-base font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground"
                  >
                    <Search className="w-5 h-5" /> منتجات المخزن
                  </TabsTrigger>
                  <TabsTrigger
                    value="catalog"
                    className="gap-2 px-5 py-2 text-base font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground"
                  >
                    <BookmarkPlus className="w-5 h-5" /> قائمة الأسعار (حجز)
                  </TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2 justify-start">
                  <Button type="button" size="sm" variant="outline" onClick={() => setCameraOpen(true)} className="gap-2">
                    <Camera className="w-4 h-4" /> كاميرا
                  </Button>
                  <Button type="button" size="sm" variant={scannerMode ? "default" : "outline"} onClick={() => setScannerMode((s) => !s)} className="gap-2">
                    <ScanLine className="w-4 h-4" />
                    {scannerMode ? "الباركود مُفعّل" : "تفعيل الباركود"}
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

              <TabsContent value="stock" className="m-0">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="ابحث بالاسم أو الكود..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pr-10 h-12 text-base"
                    autoFocus
                    ref={searchInputRef}

                  />
                </div>
              </TabsContent>

              <TabsContent value="catalog" className="m-0 space-y-2">
                <div className="text-xs text-muted-foreground">
                  لو الصنف مش موجود في المخزن، ابحث في كتالوج الموردين واعمل حجز للعميل لحد ما البضاعة توصل.
                </div>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="ابحث بالاسم / الموديل / المورد"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    className="pr-10 h-12 text-base"
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Search results panel — hero when searching */}
          {search && (
            <div className="card-elevated overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-bold flex items-center gap-2"><Search className="w-4 h-4 text-primary" /> نتائج البحث</div>
                  <div className="text-xs text-muted-foreground mt-0.5">"{search}" — {filtered.length} منتج</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSearch("")}>مسح البحث</Button>
              </div>
              {filtered.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground text-sm">لا توجد منتجات مطابقة</div>
              ) : (
                <div className="p-4 grid grid-cols-1 gap-3">
                  {filtered.map((p) => {
                    const avail = availability[p.id] ?? Number(p.quantity || 0);
                    const stock = Number(p.quantity || 0);
                    const reserved = Math.max(0, stock - avail);
                    const minLevel = Number((p as any).min_stock_level ?? p.low_stock_alert ?? 5);
                    const stockTone = avail <= 0 ? "bg-destructive/10 text-destructive border-destructive/30" : avail <= minLevel ? "bg-warning/10 text-warning border-warning/30" : "bg-success/10 text-success border-success/30";
                    const stockLabel = avail <= 0 ? "غير متاح" : avail < 3 ? "كمية محدودة" : avail <= minLevel ? "منخفض" : "متاح";
                    const profit = Number(p.selling_price) - Number(p.cost_price);
                    return (
                      <button
                        key={p.id}
                        onClick={() => addItem(p)}
                        disabled={avail <= 0}
                        className="group text-right rounded-xl border-2 border-border bg-surface-1 hover:border-primary hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:border-border disabled:hover:shadow-none flex items-center gap-3 p-3 overflow-hidden"
                      >
                        <div className="w-12 h-12 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-extrabold text-lg border border-primary/20">
                          {(p.name || "?").trim().charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-base leading-snug line-clamp-3 group-hover:text-primary transition-colors">{p.name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate flex items-center gap-1.5">
                            <span className="truncate">{p.sku}</span>
                            {p.color && <ColorChip name={p.color} />}
                          </div>
                          <VariantLine attrs={p as any} className="block mt-0.5" />
                          {showCost && Number(p.cost_price) > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-1">
                              شراء: {formatEGP(p.cost_price)} · ربح: <span className="text-primary font-bold">{formatEGP(profit)}</span>
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-left flex flex-col items-end gap-1">
                          {Number(p.old_price) > 0 && Number(p.old_price) !== Number(p.selling_price) && (
                            <div className="text-[11px] text-muted-foreground line-through">{formatEGP(p.old_price)}</div>
                          )}
                          <div className="text-xl font-extrabold text-success leading-tight">{formatEGP(p.selling_price)}</div>
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${stockTone}`}>{stockLabel}</span>
                            <span className="text-[11px] text-muted-foreground">متوفر: <b className="text-foreground">{avail}</b></span>
                          </div>
                          {reserved > 0 && <div className="text-[9px] text-muted-foreground">محجوز: {reserved}</div>}
                        </div>
                        <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border border-primary/20">
                          <Plus className="w-4 h-4" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Catalog / pre-order results panel */}
          {catalogSearch && (
            <div className="card-elevated overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-bold flex items-center gap-2"><BookmarkPlus className="w-4 h-4 text-primary" /> نتائج قائمة الأسعار (للحجز)</div>
                  <div className="text-xs text-muted-foreground mt-0.5">"{catalogSearch}" — {filteredCatalog.length} صنف</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setCatalogSearch("")}>مسح البحث</Button>
              </div>
              {filteredCatalog.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground text-sm">لا توجد نتائج في القائمة</div>
              ) : (
                <div className="p-4 grid grid-cols-1 gap-3">
                  {filteredCatalog.map((c: any) => (
                    <div key={c.id} className="rounded-xl border-2 border-border bg-surface-1 hover:border-primary/50 hover:shadow-lg transition-all flex items-center gap-3 p-3 overflow-hidden">
                      <div className="w-12 h-12 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-extrabold text-lg border border-primary/20">
                        {(c.product_name || "?").trim().charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-base leading-snug line-clamp-3">{c.product_name}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {c.supplier_name}{c.model_code ? ` · ${c.model_code}` : ""}{c.category ? ` · ${c.category}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-left flex flex-col items-end gap-1">
                        {Number(c.old_price) > 0 && Number(c.old_price) !== Number(c.display_price) && (
                          <div className="text-[11px] text-muted-foreground line-through">{formatEGP(c.old_price)}</div>
                        )}
                        <div className="text-xl font-extrabold text-primary leading-tight">{formatEGP(c.display_price)}</div>
                      </div>
                      <Button size="sm" className="gap-1 btn-gradient shrink-0" onClick={() => setPreOrderItem(c)}>
                        <BookmarkPlus className="w-3 h-3" /> حجز
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Items */}
          <div className="card-elevated overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-gradient-to-l from-primary/5 to-transparent">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
                  <ShoppingCart className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-sm">عناصر الفاتورة</div>
                  <div className="text-[11px] text-muted-foreground">{items.length} صنف{items.length > 0 && ` — إجمالي الكمية: ${items.reduce((s,i)=>s+Number(i.quantity||0),0)}`}</div>
                </div>
              </div>
            </div>
            {items.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <div className="text-sm">ابحث عن منتج لإضافته للفاتورة</div>
              </div>
            ) : (
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm min-w-[950px] table-fixed border-collapse">
                <colgroup>
                  <col className="w-[35%]" />
                  <col className="w-[13%]" />
                  <col className="w-[14%]" />
                  <col className="w-[15%]" />
                  {showCost && <col className="w-[11%]" />}
                  <col className="w-[12%]" />
                  <col className="w-[45px]" />
                </colgroup>
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
                    const collapsed = expandedKey !== null && k !== expandedKey;
                    if (collapsed) {
                      return (
                        <tr key={k} className="border-t border-border hover:bg-surface-2/60 cursor-pointer" onClick={() => setExpandedKey(k)}>
                          <td className="p-2" colSpan={showCost ? 7 : 6}>
                            <div className="flex items-center gap-3">
                              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                              <div className="font-medium flex-1 truncate">{i.product_name}</div>
                              <div className="text-xs text-muted-foreground shrink-0">×{i.quantity}</div>
                              <div className="font-bold shrink-0">{formatEGP(lineTotal)}</div>
                              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); updateQty(k, 0); }}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={k} className={`border-t border-border ${isLoss ? "bg-destructive/5" : ""}`}>

                        <td className="p-2 align-top font-medium">
                          <div className="flex items-start gap-3 w-full p-2">
                            <div className="w-9 h-9 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-extrabold border border-primary/20">
                              {(i.product_name || "?").trim().charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col gap-1">
                              <ProductCell
                                className="min-w-0"
                                name={
                                  <div className="flex items-start gap-2 min-w-0">
                                    {isLoss && <span title="بيع بخسارة" className="inline-block w-2.5 h-2.5 rounded-full bg-destructive shrink-0 mt-1.5" />}
                                    {isProfit && <span title="بيع بمكسب" className="inline-block w-2.5 h-2.5 rounded-full bg-success shrink-0 mt-1.5" />}
                                    <span className="min-w-0 text-sm font-semibold text-foreground leading-snug line-clamp-2 [overflow-wrap:anywhere]">
                                      {i.product_name}
                                    </span>
                                  </div>
                                }
                                attrs={{ ...i, color: null }}
                                sub={i.color ? (
                                  <span className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                    <ColorChip name={i.color} />
                                  </span>
                                ) : undefined}
                              />
                              {showCost && <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">شراء: {formatEGP(i.cost_price)}</div>}
                              {(() => {
                                const r = reservations[i.product_id];
                                if (!r) return null;
                                const msLeft = new Date(r.expires_at).getTime() - nowTick;
                                if (msLeft <= 0) {
                                  return <div className="text-[10px] text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> ❌ انتهى وقت الحجز — أعد إضافة المنتج</div>;
                                }
                                const totalSec = Math.floor(msLeft / 1000);
                                const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
                                const ss = String(totalSec % 60).padStart(2, "0");
                                const warn = totalSec <= 5 * 60;
                                return (
                                  <div className={`text-[10px] flex items-center gap-1 ${warn ? "text-warning font-bold" : "text-success"}`}>
                                    {warn ? <AlertTriangle className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                                    {warn ? "⚠️ سيتم إلغاء الحجز خلال" : "محجوز — ينتهي خلال"} {mm}:{ss}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        </td>
                        <td className="p-2 text-center">
                          <div className="inline-flex items-center rounded-lg border border-border overflow-hidden bg-background">
                            <button type="button" onClick={() => updateQty(k, Math.max(1, Number(i.quantity || 0) - 1))} className="px-2 py-1.5 hover:bg-muted transition-colors" title="نقصان">
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <Input type="number" min="1" value={i.quantity} onChange={(e) => updateQty(k, parseInt(e.target.value) || 0)} className="w-14 h-8 text-center border-0 rounded-none focus-visible:ring-0" />
                            <button type="button" onClick={() => updateQty(k, Number(i.quantity || 0) + 1)} className="px-2 py-1.5 hover:bg-muted transition-colors" title="زيادة">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="p-2 text-center">
                          <Input type="number" min="0" step="0.01" value={i.selling_price} onChange={(e) => updatePrice(k, parseFloat(e.target.value) || 0)} className="w-28 mx-auto text-center" />
                        </td>
                        <td className="p-2 text-center">
                          <div className="inline-flex items-stretch rounded-lg border border-border overflow-hidden bg-background">
                            <Input
                              type="number" min="0" step="0.01"
                              value={i.discount_input || ""}
                              onChange={(e) => setDiscountInput(k, parseFloat(e.target.value) || 0)}
                              className="w-24 h-9 text-center border-0 rounded-none focus-visible:ring-0"
                              placeholder={i.discount_mode === "amount" ? "مبلغ" : "%"}
                            />
                            <div className="flex flex-col border-r border-border">
                              <button
                                type="button"
                                onClick={() => setDiscountMode(k, "amount")}
                                className={`px-2 text-[11px] font-bold flex-1 ${i.discount_mode === "amount" ? "bg-primary text-primary-foreground" : "bg-surface-2 hover:bg-muted"}`}
                                title="مبلغ بالجنيه"
                              >ج.م</button>
                              <button
                                type="button"
                                onClick={() => setDiscountMode(k, "percent")}
                                className={`px-2 text-[11px] font-bold flex-1 border-t border-border ${i.discount_mode === "percent" ? "bg-primary text-primary-foreground" : "bg-surface-2 hover:bg-muted"}`}
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

            {/* Mobile card list — نفس البيانات بشكل مناسب للموبايل */}
            {items.length > 0 && (
              <div className="md:hidden divide-y divide-border">
                {items.map((i) => {
                  const k = itemKey(i);
                  const lineTotal = Math.max(0, i.quantity * i.selling_price - i.line_discount);
                  const effUnit = lineTotal / Math.max(1, i.quantity);
                  const isLoss = i.cost_price > 0 && effUnit < i.cost_price;
                  const lineProfit = (i.selling_price - i.cost_price) * i.quantity - i.line_discount;
                  const collapsed = expandedKey !== null && k !== expandedKey;
                  if (collapsed) {
                    return (
                      <div key={`m-${k}`} className="p-3 flex items-center gap-2 cursor-pointer" onClick={() => setExpandedKey(k)}>
                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="font-medium text-sm flex-1 truncate">{i.product_name}</div>
                        <div className="text-xs text-muted-foreground shrink-0">×{i.quantity}</div>
                        <div className="font-bold text-sm shrink-0">{formatEGP(lineTotal)}</div>
                        <Button variant="ghost" size="sm" className="shrink-0" onClick={(e) => { e.stopPropagation(); updateQty(k, 0); }}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <div key={`m-${k}`} className={`p-3 space-y-3 ${isLoss ? "bg-destructive/5" : ""}`}>

                      <div className="flex items-start gap-2">
                        <div className="w-9 h-9 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-extrabold border border-primary/20">
                          {(i.product_name || "?").trim().charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-sm leading-snug break-words">{i.product_name}</div>
                          <div className="flex items-center gap-2 mt-1">
                            {i.color && <ColorChip name={i.color} />}
                            {showCost && <span className="text-[11px] text-muted-foreground">شراء: {formatEGP(i.cost_price)}</span>}
                          </div>
                          <VariantLine attrs={i} className="block mt-0.5" />
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => updateQty(k, 0)} className="shrink-0">
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[11px] text-muted-foreground mb-1">الكمية</div>
                          <div className="flex items-center rounded-lg border border-border overflow-hidden bg-background">
                            <button type="button" onClick={() => updateQty(k, Math.max(1, Number(i.quantity || 0) - 1))} className="px-3 py-2 hover:bg-muted">
                              <Minus className="w-4 h-4" />
                            </button>
                            <Input type="number" min="1" value={i.quantity} onChange={(e) => updateQty(k, parseInt(e.target.value) || 0)} className="flex-1 h-10 text-center border-0 rounded-none focus-visible:ring-0" />
                            <button type="button" onClick={() => updateQty(k, Number(i.quantity || 0) + 1)} className="px-3 py-2 hover:bg-muted">
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-muted-foreground mb-1">سعر البيع</div>
                          <Input type="number" min="0" step="0.01" value={i.selling_price} onChange={(e) => updatePrice(k, parseFloat(e.target.value) || 0)} className="h-10 text-center" />
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-muted-foreground mb-1">خصم السطر</div>
                        <div className="flex items-stretch rounded-lg border border-border overflow-hidden bg-background">
                          <Input
                            type="number" min="0" step="0.01"
                            value={i.discount_input || ""}
                            onChange={(e) => setDiscountInput(k, parseFloat(e.target.value) || 0)}
                            className="flex-1 h-10 text-center border-0 rounded-none focus-visible:ring-0"
                            placeholder={i.discount_mode === "amount" ? "مبلغ" : "%"}
                          />
                          <button type="button" onClick={() => setDiscountMode(k, "amount")}
                            className={`px-4 text-xs font-bold ${i.discount_mode === "amount" ? "bg-primary text-primary-foreground" : "bg-surface-2"}`}>ج.م</button>
                          <button type="button" onClick={() => setDiscountMode(k, "percent")}
                            className={`px-4 text-xs font-bold border-r border-border ${i.discount_mode === "percent" ? "bg-primary text-primary-foreground" : "bg-surface-2"}`}>%</button>
                        </div>
                        {i.line_discount > 0 && <div className="text-[10px] text-muted-foreground mt-1">= {formatEGP(i.line_discount)}</div>}
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-border">
                        {showCost ? (
                          <div className={`text-xs font-bold ${lineProfit >= 0 ? "text-success" : "text-destructive"}`}>الربح: {formatEGP(lineProfit)}</div>
                        ) : <span />}
                        <div className="text-base font-extrabold">{formatEGP(lineTotal)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* شريط «منتج آخر» — بالنقر الصريح يجهّزلك بحث صنف جديد */}
            {items.length > 0 && (
              <div className="p-4 pt-0">
                <AddAnotherBar
                  onActivate={() => {
                    setExpandedKey(null);
                    setSearch("");
                    searchInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                    setTimeout(() => searchInputRef.current?.focus(), 120);
                  }}
                  hint="— اضغط هنا لإضافة صنف جديد"
                />
              </div>
            )}

          </div>


          </div>
          )}
        </div>


        {/* ============ SECTION 3: طرق الدفع ============ */}
        <div className="card-elevated overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection("payment")}
            className="w-full flex items-center gap-3 px-6 py-4 bg-gradient-to-l from-violet-500/10 via-violet-400/5 to-transparent border-b border-border hover:brightness-105 transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center border border-violet-500/30 shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
            <div className="flex-1 text-center text-xl font-extrabold text-violet-700 dark:text-violet-300 tracking-tight">
              طرق الدفع
            </div>
            <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              {openSections.payment ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </div>
          </button>
          {openSections.payment && (
          <div className="p-4 space-y-4">

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
                            placeholder={customerLastFromAccount || "حساب العميل المُرسِل"}
                            value={p.transfer_from_account}
                            onChange={(e) => updatePayment(idx, { transfer_from_account: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs mb-1 block">رقم الحساب / التليفون المُحوَّل <b>إليه</b> *</Label>
                          <Input
                            dir="ltr" className="text-right"
                            placeholder={defaultBankAccount || "حسابنا اللي وصل عليه"}
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
            <div className="flex items-center gap-3">
              <Checkbox
                id="credit-mode"
                checked={creditMode}
                onCheckedChange={(v) => setCreditMode(!!v)}
                className="w-5 h-5"
              />
              <Label htmlFor="credit-mode" className="font-bold text-base cursor-pointer">
                بيع بالآجل (تسجيل المتبقي كمديونية)
              </Label>
              {creditRemaining > 0 && !creditMode && (
                <span className="text-xs text-warning mr-2">— مُفعّل تلقائياً (يوجد متبقي)</span>
              )}
            </div>
            {isCredit && (
              <div className="mt-4 space-y-4">
                <div className="text-sm flex justify-between items-center p-3 rounded-lg bg-warning/10 border border-warning/30">
                  <span className="font-medium">المتبقي كآجل:</span>
                  <b className="text-warning text-base">{formatEGP(creditRemaining)}</b>
                </div>
                {creditRemaining > 0 && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        type="button"
                        variant={scheduleType === "open" ? "default" : "outline"}
                        onClick={() => setScheduleType("open")}
                        className="w-full h-11 text-base font-semibold"
                      >
                        مفتوح
                      </Button>
                      <Button
                        type="button"
                        variant={scheduleType === "scheduled" ? "default" : "outline"}
                        onClick={() => setScheduleType("scheduled")}
                        className="w-full h-11 text-base font-semibold"
                      >
                        أقساط محددة
                      </Button>
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

          </div>
          )}
        </div>

        {/* ============ SECTION 4: الفاتورة ============ */}
        <div className="card-elevated overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection("summary")}
            className="w-full flex items-center gap-3 px-6 py-4 bg-gradient-to-l from-indigo-500/10 via-indigo-400/5 to-transparent border-b border-border hover:brightness-105 transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-500/30 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1 text-center text-xl font-extrabold text-indigo-700 dark:text-indigo-300 tracking-tight">
              الفاتورة والإجمالي
            </div>
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
              {openSections.summary ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </div>
          </button>
          {openSections.summary && (
          <div className="p-4">

          <div className="card-elevated p-5">

            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">إجمالي الأصناف</span><span className="font-bold">{formatEGP(subtotal)}</span></div>

              {/* Invoice-level discount */}
              <div className="mt-2 p-2.5 rounded-lg bg-surface-2 border border-dashed border-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-xs">خصم إجمالي الفاتورة</span>
                  <div className="inline-flex rounded-md border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setInvoiceDiscountMode("amount")}
                      className={`px-2 py-0.5 text-[10px] ${invoiceDiscountMode === "amount" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                    >ج.م</button>
                    <button
                      type="button"
                      onClick={() => setInvoiceDiscountMode("percent")}
                      className={`px-2 py-0.5 text-[10px] border-r border-border ${invoiceDiscountMode === "percent" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                    >%</button>
                  </div>
                </div>
                <Input
                  type="number" min={0} step="0.01"
                  value={invoiceDiscountInput || ""}
                  onChange={(e) => setInvoiceDiscountInput(Math.max(0, Number(e.target.value) || 0))}
                  placeholder={invoiceDiscountMode === "amount" ? "قيمة الخصم بالجنيه" : "نسبة الخصم %"}
                  className="h-8 text-sm"
                  disabled={items.length === 0}
                />
                {invoiceDiscount > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">قيمة الخصم</span>
                    <span className="font-bold text-destructive">- {formatEGP(invoiceDiscount)}</span>
                  </div>
                )}
              </div>

              {invoiceDiscount > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">بعد الخصم</span><span className="font-bold">{formatEGP(subtotalAfterInvoiceDiscount)}</span></div>
              )}


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

<div className="mt-3 space-y-1"><Label className="text-xs font-bold">المستلم</Label><LockedRecipientInput value={recipientName} className="" /></div>
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
                  <div className="flex justify-between"><span className="font-bold">💰 صافي الربح</span><span className={!canViewNetProfit ? "text-muted-foreground font-extrabold" : totalProfit >= 0 ? "text-success font-extrabold" : "text-destructive font-extrabold"}>{canViewNetProfit ? formatEGP(totalProfit) : NET_PROFIT_MASK}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">نسبة الربح</span><span className={!canViewNetProfit ? "text-muted-foreground font-bold" : totalProfit >= 0 ? "text-success font-bold" : "text-destructive font-bold"}>{canViewNetProfit ? `${profitPct.toFixed(2)}%` : "---"}</span></div>
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
              className="w-full mt-4 h-14 btn-gradient text-base font-extrabold shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-[0.98] transition-transform"
              disabled={busy || !items.length || hasLoss || !paymentsValid || (overLimit && isCashierOnly)}
              onClick={submit}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Printer className="w-4 h-4 ml-2" /> إنشاء وطباعة</>}
            </Button>
          </div>

          </div>
          )}
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
