import { VariantLine } from "@/components/VariantChips";
import { focusSection } from "@/lib/sectionFocus";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftRestoreBar } from "@/components/DraftRestoreBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";
import { Trash2, Plus, ArrowRight, Loader2, AlertTriangle, CreditCard, CalendarClock, User, Package, Calculator } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StagedPaymentsPanel } from "@/components/StagedPaymentsPanel";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { InvoiceDateInput } from "@/components/InvoiceDateInput";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/format";
import { StagedOp, applyStagedPayments, stagedOpLabel, stagedPaidDelta } from "@/lib/stagedPayments";
import { computeInvoiceTotals } from "@/lib/invoiceCalc";

type Item = {
  id?: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  cost_price: number;
  selling_price: number;
  market_price: number;
  line_discount: number;
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  product_type?: string | null;
  capacity?: string | null;
  size?: string | null;
};

type Snapshot = {
  customerId: string | null;
  customerName: string;
  vatRate: number;
  discountAmount: number;
  invoiceDate: string | null;
  items: Array<{ product_id: string | null; product_name: string; quantity: number; selling_price: number; line_discount: number }>;
};

export default function EditSaleInvoice() {
  const { id: branchId, invoiceId } = useParams<{ id: string; invoiceId: string }>();
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invoice, setInvoice] = useState<any>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [openSuggestIdx, setOpenSuggestIdx] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentPlan, setPaymentPlan] = useState<any>(null);
  const [installments, setInstallments] = useState<any[]>([]);
  const [planTxs, setPlanTxs] = useState<any[]>([]);
  const [stagedOps, setStagedOps] = useState<StagedOp[]>([]);
  
  const [vatRate, setVatRate] = useState<number>(0);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [openSections, setOpenSections] = useState({ customer: true, items: true, payments: true, summary: true });
  const [invoiceDate, setInvoiceDate] = useState<string>("");

  // ===== Local autosave (crash / accidental reload safety net) =====
  const draftSnapshot = { items, customerId, vatRate, discountAmount, discountType, discountPercent, invoiceDate };
  const formDraft = useFormDraft<typeof draftSnapshot>(
    "edit-invoice",
    [invoiceId],
    draftSnapshot,
    !loading && !!invoice && !saving,
  );
  const [draftDismissed, setDraftDismissed] = useState(false);
  const restoreDraft = () => {
    const d = formDraft.draft?.data;
    if (!d) return;
    setItems(d.items ?? []);
    setCustomerId(d.customerId ?? null);
    setVatRate(d.vatRate ?? 0);
    setDiscountAmount(d.discountAmount ?? 0);
    setDiscountType(d.discountType ?? "amount");
    setDiscountPercent(d.discountPercent ?? 0);
    if (d.invoiceDate) setInvoiceDate(d.invoiceDate);
    setDraftDismissed(true);
    formDraft.dismiss();
  };
  const { isAdmin } = useAuth();
  const toggleSection = (k: keyof typeof openSections) => setOpenSections((s) => focusSection(s, k));

  const initialSnapshotRef = useRef<Snapshot | null>(null);
  const initialTotalRef = useRef<number>(0);
  const initialPaidRef = useRef<number>(0);
  type PaySnap = { id: string; amount: number; method: string; kind: "initial" | "plan"; voided: boolean };
  const initialPaymentsRef = useRef<PaySnap[] | null>(null);
  const snapshotPayments = (pays: any[], txs: any[]): PaySnap[] => [
    ...pays.map((p: any) => ({ id: p.id, amount: Number(p.amount || 0), method: p.method || p.payment_method || "", kind: "initial" as const, voided: !!p.voided_at || !!p.reverses_payment_id })),
    ...txs.map((t: any) => ({ id: t.id, amount: Number(t.amount || 0), method: t.method || t.payment_method || "", kind: "plan" as const, voided: !!t.voided_at || !!t.reverses_tx_id })),
  ];

  useEffect(() => {
    if (!invoiceId || !branchId) return;
    (async () => {
      setLoading(true);
      const [{ data: inv }, { data: its }, { data: c }, { data: p }, { data: pays }, { data: plan }] = await Promise.all([
        supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle(),
        supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId),
        supabase.from("contacts").select("id, name").eq("branch_id", branchId).order("name"),
        supabase
          .from("products")
          .select("id, name, sku, quantity, cost_price, selling_price, market_price")
          .eq("branch_id", branchId)
          .order("name"),
        supabase.from("invoice_payments").select("*").eq("invoice_id", invoiceId).order("created_at"),
        supabase
          .from("payment_plans")
          .select("*")
          .eq("reference_type", "invoice")
          .eq("reference_id", invoiceId)
          .maybeSingle(),
      ]);

      setInvoice(inv);
      setCustomerId(inv?.contact_id ?? null);
      setCustomers(c ?? []);
      setProducts(p ?? []);
      setPayments(pays ?? []);
      setPaymentPlan(plan ?? null);
      setVatRate(Number(inv?.vat_rate ?? 0));
      setDiscountAmount(Number(inv?.discount_amount ?? 0));
      setInvoiceDate(inv?.invoice_date ?? inv?.created_at ?? "");

      let loadedTx: any[] = [];
      let loadedIns: any[] = [];
      if (plan?.id) {
        const [{ data: ins }, { data: tx }] = await Promise.all([
          supabase.from("payment_installments").select("*").eq("payment_plan_id", plan.id).order("installment_number"),
          supabase.from("payment_transactions").select("*").eq("payment_plan_id", plan.id).order("created_at"),
        ]);
        loadedIns = ins ?? [];
        loadedTx = tx ?? [];
        setInstallments(loadedIns);
        setPlanTxs(loadedTx);
      }
      initialPaymentsRef.current = snapshotPayments(pays ?? [], loadedTx);
      const initialPaidFromInv = (pays ?? [])
        .filter((p: any) => !p.voided_at && !p.reverses_payment_id)
        .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
      const initialPaidFromPlan = plan ? Number(plan.paid_amount ?? 0) : 0;
      initialPaidRef.current = Math.max(initialPaidFromInv, initialPaidFromPlan);
      initialTotalRef.current = Number(inv?.total ?? 0);

      const loadedItems: Item[] = (its ?? []).map((it: any) => ({
        id: it.id,
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: Number(it.quantity ?? 0),
        cost_price: Number(it.cost_price ?? 0),
        selling_price: Number(it.selling_price ?? 0),
        market_price: Number(it.market_price ?? 0),
        line_discount: Number(it.line_discount ?? 0),
      }));
      setItems(loadedItems);

      const custName = (c ?? []).find((x) => x.id === inv?.contact_id)?.name ?? "عميل نقدي";
      initialSnapshotRef.current = {
        customerId: inv?.contact_id ?? null,
        customerName: custName,
        vatRate: Number(inv?.vat_rate ?? 0),
        discountAmount: Number(inv?.discount_amount ?? 0),
        invoiceDate: inv?.invoice_date ?? inv?.created_at ?? null,
        items: loadedItems.map((it) => ({
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: it.quantity,
          selling_price: it.selling_price,
          line_discount: it.line_discount,
        })),
      };
      setLoading(false);
    })();
  }, [invoiceId, branchId]);

  const reloadPayments = async () => {
    if (!invoiceId) return;
    const [{ data: pays }, { data: plan }] = await Promise.all([
      supabase.from("invoice_payments").select("*").eq("invoice_id", invoiceId).order("created_at"),
      supabase
        .from("payment_plans")
        .select("*")
        .eq("reference_type", "invoice")
        .eq("reference_id", invoiceId)
        .maybeSingle(),
    ]);
    setPayments(pays ?? []);
    setPaymentPlan(plan ?? null);
    if (plan?.id) {
      const [{ data: ins }, { data: tx }] = await Promise.all([
        supabase.from("payment_installments").select("*").eq("payment_plan_id", plan.id).order("installment_number"),
        supabase.from("payment_transactions").select("*").eq("payment_plan_id", plan.id).order("created_at"),
      ]);
      setInstallments(ins ?? []);
      setPlanTxs(tx ?? []);
    } else {
      setInstallments([]);
      setPlanTxs([]);
    }
  };

  // Realtime: keep summary paid/remaining in sync with any payment edits
  useEffect(() => {
    if (!invoiceId) return;
    const ch = supabase
      .channel(`edit-inv-sum-${invoiceId}-${Date.now()}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "invoice_payments", filter: `invoice_id=eq.${invoiceId}` }, () => reloadPayments());
    if (paymentPlan?.id) {
      ch.on("postgres_changes" as any, { event: "*", schema: "public", table: "payment_transactions", filter: `payment_plan_id=eq.${paymentPlan.id}` }, () => reloadPayments());
      ch.on("postgres_changes" as any, { event: "*", schema: "public", table: "payment_plans", filter: `id=eq.${paymentPlan.id}` }, () => reloadPayments());
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [invoiceId, paymentPlan?.id]);

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
    const existingIdx = items.findIndex((it, i) => i !== idx && it.product_id === p.id);
    if (existingIdx >= 0) {
      const addQty = Math.max(1, Number(items[idx]?.quantity || 1));
      setItems((arr) => {
        const next = arr
          .map((it, i) => (i === existingIdx ? { ...it, quantity: Number(it.quantity || 0) + addQty } : it))
          .filter((_, i) => i !== idx);
        return next;
      });
      setOpenSuggestIdx(null);
      toast.success(`تم دمج الكمية مع البند الموجود (${p.name})`);
      return;
    }
    updateItem(idx, {
      product_id: p.id,
      product_name: p.name,
      cost_price: Number(p.cost_price ?? 0),
      selling_price: Number(p.selling_price ?? 0),
      market_price: Number(p.market_price ?? 0),
      brand: p.brand ?? null,
      model: p.model ?? null,
      color: p.color ?? null,
      product_type: p.product_type ?? null,
      capacity: p.capacity ?? null,
      size: p.size ?? null,
    });
    setOpenSuggestIdx(null);
  };

  const suggestionsFor = (q: string) => {
    const s = q.trim().toLowerCase();
    if (!s) return products.slice(0, 8);
    return products.filter((p) => `${p.name} ${p.sku ?? ""}`.toLowerCase().includes(s)).slice(0, 8);
  };

  // Unified totals via shared helper — see src/lib/invoiceCalc.ts
  const _totals = computeInvoiceTotals(
    items,
    discountType === "percent" ? (Number(discountPercent) || 0) : (Number(discountAmount) || 0),
    discountType,
    Number(vatRate) || 0
  );
  const subtotal = _totals.grossSubtotal;
  const lineDiscounts = _totals.lineDiscounts;
  const afterLineDiscounts = _totals.subtotal;
  const invDiscount = _totals.invoiceDiscount;
  const netAfterDiscount = _totals.netAfterDiscount;
  const vatAmount = _totals.taxAmount;
  const total = _totals.total;


  // Live paid & remaining (based on active payments/tx)
  const activeInitial = payments.filter((p: any) => !p.voided_at && !p.reverses_payment_id);
  const activeTx = planTxs.filter((t: any) => !t.voided_at && !t.reverses_tx_id);
  const paidTotal =
    activeInitial.reduce((s, p) => s + Number(p.amount || 0), 0) +
    activeTx.reduce((s, t) => s + Number(t.amount || 0), 0);
  // Preview values include not-yet-committed staged payment ops
  const paidPreview = paidTotal + stagedPaidDelta(stagedOps);
  const remaining = total - paidPreview;

  const buildDiff = (): string[] => {
    const snap = initialSnapshotRef.current;
    if (!snap) return [];
    const changes: string[] = [];

    // Customer
    const newCustName = customers.find((x) => x.id === customerId)?.name ?? "عميل نقدي";
    if ((snap.customerId ?? null) !== (customerId ?? null)) {
      changes.push(`العميل: من «${snap.customerName}» إلى «${newCustName}»`);
    }

    // Items diff — match by product_id when possible, else by index/name
    const oldByKey = new Map<string, typeof snap.items[number]>();
    snap.items.forEach((it, i) => {
      const key = it.product_id ?? `__idx_${i}_${it.product_name}`;
      oldByKey.set(key, it);
    });
    const newByKey = new Map<string, Item>();
    items.forEach((it, i) => {
      const key = it.product_id ?? `__new_${i}_${it.product_name}`;
      newByKey.set(key, it);
    });

    // Removed
    oldByKey.forEach((oldIt, key) => {
      if (!newByKey.has(key)) {
        changes.push(`❌ تم حذف البند: ${oldIt.product_name} (كان بكمية ${oldIt.quantity})`);
      }
    });
    // Added
    newByKey.forEach((newIt, key) => {
      if (!oldByKey.has(key)) {
        changes.push(`➕ تمت إضافة بند جديد: ${newIt.product_name} (كمية ${newIt.quantity} بسعر ${formatEGP(newIt.selling_price)})`);
      }
    });
    // Modified
    newByKey.forEach((newIt, key) => {
      const oldIt = oldByKey.get(key);
      if (!oldIt) return;
      const parts: string[] = [];
      if (Number(oldIt.quantity) !== Number(newIt.quantity)) {
        parts.push(`الكمية: من ${oldIt.quantity} إلى ${newIt.quantity}`);
      }
      if (Number(oldIt.selling_price) !== Number(newIt.selling_price)) {
        parts.push(`سعر البيع: من ${formatEGP(oldIt.selling_price)} إلى ${formatEGP(newIt.selling_price)}`);
      }
      if (Number(oldIt.line_discount) !== Number(newIt.line_discount)) {
        parts.push(`خصم البند: من ${formatEGP(oldIt.line_discount)} إلى ${formatEGP(newIt.line_discount)}`);
      }
      if (oldIt.product_name !== newIt.product_name && !newIt.product_id) {
        parts.push(`الاسم: من «${oldIt.product_name}» إلى «${newIt.product_name}»`);
      }
      if (parts.length) changes.push(`✏️ تعديل بند «${newIt.product_name}» — ${parts.join(" • ")}`);
    });

    // VAT diff
    if (Number(snap.vatRate || 0) !== Number(vatRate || 0)) {
      changes.push(`🧾 نسبة الضريبة: من ${snap.vatRate || 0}% إلى ${vatRate || 0}%`);
    }

    // Invoice discount diff
    if (Math.abs(Number(snap.discountAmount || 0) - invDiscount) > 0.01) {
      changes.push(`🏷️ خصم الفاتورة: من ${formatEGP(snap.discountAmount || 0)} إلى ${formatEGP(invDiscount)}`);
    }

    // Invoice date/time diff
    const oldDateIso = snap.invoiceDate ? new Date(snap.invoiceDate).toISOString() : null;
    const newDateIso = invoiceDate ? new Date(invoiceDate).toISOString() : null;
    if (oldDateIso !== newDateIso) {
      changes.push(`🗓️ تاريخ ووقت الفاتورة: من ${formatDateTime(snap.invoiceDate)} إلى ${formatDateTime(invoiceDate)}`);
    }

    // Totals diff — use unified helper so snapshot math matches live math exactly
    const oldTotals = computeInvoiceTotals(
      snap.items,
      Number(snap.discountAmount || 0),
      "amount",
      Number(snap.vatRate) || 0
    );
    const oldTotal = oldTotals.total;

    if (Math.abs(oldTotal - total) > 0.01) {
      const delta = total - oldTotal;
      const deltaLabel = delta > 0 ? `بزيادة ${formatEGP(Math.abs(delta))}` : `بنقص ${formatEGP(Math.abs(delta))}`;
      changes.push(`💰 إجمالي الفاتورة: من ${formatEGP(oldTotal)} إلى ${formatEGP(total)} (${deltaLabel})`);
    }

    // Payments diff (against initial snapshot at load)
    const oldPays = initialPaymentsRef.current ?? [];
    const curPays = snapshotPayments(payments, planTxs);
    const oldMap = new Map(oldPays.map((p) => [p.id, p]));
    const curMap = new Map(curPays.map((p) => [p.id, p]));
    const methodLabel = (m: string) => ({ cash: "نقدي", credit: "آجل", bank: "تحويل بنكي", instapay: "إنستاباي" } as any)[m] || m || "-";
    curMap.forEach((cp, id) => {
      const op = oldMap.get(id);
      if (!op) {
        if (!cp.voided) changes.push(`💳 تمت إضافة دفعة جديدة بمبلغ ${formatEGP(cp.amount)} (${methodLabel(cp.method)})`);
        return;
      }
      if (op.voided !== cp.voided) {
        changes.push(cp.voided
          ? `🚫 تم إلغاء دفعة بمبلغ ${formatEGP(op.amount)} (${methodLabel(op.method)})`
          : `♻️ تم إعادة تفعيل دفعة بمبلغ ${formatEGP(cp.amount)}`);
      } else if (!cp.voided) {
        if (Math.abs(op.amount - cp.amount) > 0.01) changes.push(`💳 تعديل مبلغ الدفعة: من ${formatEGP(op.amount)} إلى ${formatEGP(cp.amount)}`);
        if (op.method !== cp.method) changes.push(`💳 تعديل طريقة الدفع: من ${methodLabel(op.method)} إلى ${methodLabel(cp.method)}`);
      }
    });
    oldMap.forEach((op, id) => {
      if (!curMap.has(id)) {
        changes.push(`🗑️ تم حذف دفعة بمبلغ ${formatEGP(op.amount)} (${methodLabel(op.method)})`);
      }
    });

    return changes;
  };

  const hasInvoiceLevelChanges = (): boolean => {
    const snap = initialSnapshotRef.current;
    if (!snap) return false;
    if ((snap.customerId ?? null) !== (customerId ?? null)) return true;
    if (Number(snap.vatRate || 0) !== Number(vatRate || 0)) return true;
    if (Math.abs(Number(snap.discountAmount || 0) - invDiscount) > 0.01) return true;
    if (snap.items.length !== items.length) return true;
    for (let i = 0; i < items.length; i++) {
      const a = snap.items[i], b = items[i];
      if (!a) return true;
      if ((a.product_id ?? null) !== (b.product_id ?? null)) return true;
      if (Number(a.quantity) !== Number(b.quantity)) return true;
      if (Number(a.selling_price) !== Number(b.selling_price)) return true;
      if (Number(a.line_discount) !== Number(b.line_discount)) return true;
      if (a.product_name !== b.product_name) return true;
    }
    return false;
  };

  const save = async () => {
    const clean = items.filter((it) => it.product_name.trim() && it.quantity > 0);
    if (clean.length === 0) {
      toast.error("لازم يكون فيه منتج واحد على الأقل");
      return;
    }
    const diff = buildDiff();
    // Include staged payment ops as changes
    const stagedLabels = stagedOps.map((op) => stagedOpLabel(op));
    const fullDiff = [...diff, ...stagedLabels];
    if (fullDiff.length === 0) {
      toast.info("لم يتم تعديل أي بيانات");
      return;
    }

    setSaving(true);
    // 1) Apply staged payment ops FIRST (each RPC is transactional + logged)
    if (stagedOps.length > 0) {
      const res = await applyStagedPayments(stagedOps, invoiceId!);
      if (res.ok !== true) {
        setSaving(false);
        toast.error(`فشل حفظ الدفعات: ${(res as { message: string }).message}`);
        return;
      }
      setStagedOps([]);
    }

    // 2) Apply invoice-level edit only if needed
    if (hasInvoiceLevelChanges()) {
      const { error } = await supabase.rpc("edit_invoice" as any, {
        _invoice_id: invoiceId,
        _customer_id: customerId,
        _items: clean as any,
        _vat_rate: Number(vatRate) || 0,
        _discount_amount: invDiscount,
      });
      if (error) {
        setSaving(false);
        toast.error(error.message);
        return;
      }
    }

    // 3) Persist invoice date/time change (admin only, guarded by RLS/trigger on server)
    const snap = initialSnapshotRef.current;
    const oldIso = snap?.invoiceDate ? new Date(snap.invoiceDate).toISOString() : null;
    const newIso = invoiceDate ? new Date(invoiceDate).toISOString() : null;
    if (oldIso !== newIso && newIso) {
      const { error } = await supabase.from("invoices").update({ invoice_date: newIso }).eq("id", invoiceId!);
      if (error) {
        setSaving(false);
        const msg = /owner|admin or super_admin|super_admin/i.test(error.message)
          ? "تعديل تاريخ الفاتورة متاح لصاحب الشركة فقط"
          : error.message;
        toast.error(msg);
        return;
      }
    }
    setSaving(false);
    formDraft.clear();

    const willBeFullyPaid = isFullyPaidTransition();
    showDiffToast(fullDiff, willBeFullyPaid);
    setTimeout(() => nav(`/branch/${branchId}/sales/${invoiceId}`), 400);
  };


  const isFullyPaidTransition = () => {
    const wasFullyPaid = initialPaidRef.current >= initialTotalRef.current - 0.01 && initialTotalRef.current > 0;
    const isFullyPaidNow = paidPreview >= total - 0.01 && total > 0;
    return !wasFullyPaid && isFullyPaidNow;
  };


  const showDiffToast = (diff: string[], fullyPaid: boolean) => {
    const accent = fullyPaid ? "success" : "primary";
    toast.custom(
      (t) => (
        <div
          dir="rtl"
          className={`w-[380px] max-w-[92vw] rounded-xl border-2 bg-background shadow-2xl overflow-hidden ${
            fullyPaid ? "border-success/50" : "border-primary/40"
          }`}
        >
          <div
            className={`flex items-center justify-between gap-2 px-4 py-3 ${
              fullyPaid ? "bg-success text-success-foreground" : "bg-primary text-primary-foreground"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={`inline-flex w-8 h-8 items-center justify-center rounded-full text-base font-extrabold shrink-0 ${
                fullyPaid ? "bg-success-foreground/20" : "bg-primary-foreground/20"
              }`}>
                {fullyPaid ? "🎉" : "✓"}
              </span>
              <div className="min-w-0">
                <div className="font-extrabold text-sm truncate">
                  {fullyPaid
                    ? `تم سداد الفاتورة ${invoice?.invoice_number ?? ""} بالكامل`
                    : `تم تعديل الفاتورة ${invoice?.invoice_number ?? ""}`}
                </div>
                <div className="text-[11px] opacity-90 font-semibold">
                  {fullyPaid
                    ? `إجمالي ${formatEGP(total)} — ${diff.length} تغيير محفوظ`
                    : `${diff.length} تغيير محفوظ`}
                </div>
              </div>
            </div>
            <button
              onClick={() => toast.dismiss(t)}
              className={`text-lg font-bold px-1 ${
                fullyPaid ? "text-success-foreground/80 hover:text-success-foreground" : "text-primary-foreground/80 hover:text-primary-foreground"
              }`}
              aria-label="إغلاق"
            >
              ×
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto p-3 space-y-1.5 text-xs">
            {diff.map((line, i) => (
              <div
                key={i}
                className={`border-r-4 rounded pr-2 pl-2 py-1.5 font-semibold leading-relaxed bg-muted/40 ${
                  fullyPaid ? "border-success/60" : "border-primary/50"
                }`}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      ),
      { duration: fullyPaid ? 12000 : 12000 }
    );
  };


  if (loading) {
    return (
      <BranchLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </BranchLayout>
    );
  }

  if (!invoice) {
    return (
      <BranchLayout>
        <div className="text-center py-20 text-muted-foreground">الفاتورة غير موجودة</div>
      </BranchLayout>
    );
  }

  return (
    <BranchLayout>
      <div dir="rtl" className="text-right space-y-4">
        <PageHeader
          title={`تعديل الفاتورة ${invoice.invoice_number ?? ""}`}
          subtitle="عدّل البيانات كأنك بتنشئ الفاتورة من جديد — البيانات المحفوظة معبّاة سلفاً"
          actions={
            <Button variant="outline" onClick={() => nav(`/branch/${branchId}/sales/${invoiceId}`)} className="gap-1">
              <ArrowRight className="w-4 h-4" /> رجوع
            </Button>
          }
        />

        {formDraft.draft && !draftDismissed && (
          <DraftRestoreBar
            savedAt={formDraft.draft.savedAt}
            summary={`${formDraft.draft.data.items?.length ?? 0} بند`}
            onRestore={restoreDraft}
            onDismiss={() => { setDraftDismissed(true); formDraft.clear(); }}
          />
        )}

        {/* Customer section */}
        <CollapsibleSection
          title="1. العميل"
          icon={<User className="w-5 h-5" />}
          open={openSections.customer}
          onToggle={() => toggleSection("customer")}
        >
          <div className="p-4 space-y-3">
            <select
              className="w-full h-11 rounded-md border-2 border-input bg-background px-3 text-sm font-semibold focus:border-primary focus:outline-none"
              value={customerId ?? ""}
              onChange={(e) => setCustomerId(e.target.value || null)}
            >
              <option value="">عميل نقدي</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <InvoiceDateInput value={invoiceDate} onChange={setInvoiceDate} />
            {!isAdmin && (
              <p className="text-[11px] text-muted-foreground">تعديل تاريخ ووقت الفاتورة متاح لصاحب الشركة فقط.</p>
            )}
          </div>
        </CollapsibleSection>

        {/* Items section */}
        <CollapsibleSection
          title="2. بنود الفاتورة"
          icon={<Package className="w-5 h-5" />}
          open={openSections.items}
          onToggle={() => toggleSection("items")}
        >
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-muted-foreground">{items.length} بند</div>
            <Button size="sm" variant="outline" onClick={addBlankItem} className="gap-1 border-primary/40 text-primary hover:bg-primary/10 font-bold">
              <Plus className="w-4 h-4" /> إضافة بند
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr className="text-foreground font-bold">
                  <th className="p-2 text-right">المنتج</th>
                  <th className="p-2 text-center w-24">الكمية</th>
                  <th className="p-2 text-center w-32">سعر البيع</th>
                  <th className="p-2 text-center w-28">خصم البند</th>
                  <th className="p-2 text-left w-32">الإجمالي</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t border-border">
                    <td className="p-1.5 relative">
                      <Input
                        value={it.product_name}
                        onChange={(e) => {
                          updateItem(idx, { product_name: e.target.value, product_id: null });
                          setOpenSuggestIdx(idx);
                        }}
                        onFocus={() => setOpenSuggestIdx(idx)}
                        onBlur={() => setTimeout(() => setOpenSuggestIdx((cur) => (cur === idx ? null : cur)), 150)}
                        placeholder="ابحث باسم المنتج أو SKU..."
                        className={`h-9 font-semibold ${!it.product_id ? "border-warning" : ""}`}
                      />
                      {openSuggestIdx === idx && (
                        <div className="absolute z-50 mt-1 w-80 max-h-64 overflow-y-auto bg-popover border border-border rounded-md shadow-lg right-0">
                          {suggestionsFor(it.product_name).length === 0 ? (
                            <div className="p-2 text-xs text-muted-foreground text-center">لا توجد منتجات مطابقة</div>
                          ) : (
                            suggestionsFor(it.product_name).map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  pickProduct(idx, p);
                                }}
                                className="w-full text-right p-2 hover:bg-muted text-xs border-b border-border last:border-0"
                              >
                                <div className="font-bold">{p.name}</div>
                                <VariantLine attrs={p} className="block" />
                                <div className="text-[11px] text-muted-foreground flex justify-between">
                                  <span>SKU: {p.sku ?? "—"}</span>
                                  <span>
                                    متاح: {p.quantity} | {formatEGP(p.selling_price)}
                                  </span>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                      <VariantLine attrs={it as any} className="block mt-1 px-1" />
                      {!it.product_id && it.product_name && (
                        <div className="text-[11px] text-warning mt-0.5 font-semibold">⚠️ منتج غير مربوط بالمخزون</div>
                      )}
                    </td>
                    <td className="p-1.5">
                      <Input
                        type="number"
                        min="1"
                        value={it.quantity}
                        onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 0 })}
                        className="h-9 text-center font-bold"
                      />
                    </td>
                    <td className="p-1.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.selling_price}
                        onChange={(e) => updateItem(idx, { selling_price: Number(e.target.value) || 0 })}
                        className="h-9 text-center font-bold"
                      />
                    </td>
                    <td className="p-1.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.line_discount}
                        onChange={(e) => updateItem(idx, { line_discount: Number(e.target.value) || 0 })}
                        className="h-9 text-center"
                      />
                    </td>
                    <td className="p-2 text-left font-extrabold text-primary">
                      {formatEGP(it.selling_price * it.quantity - it.line_discount)}
                    </td>
                    <td className="p-1.5 text-center">
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => removeItem(idx)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">
                      لا توجد بنود — اضغط "إضافة بند"
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </CollapsibleSection>

        {/* Payment methods — READ ONLY */}
        <CollapsibleSection
          title="3. طرق الدفع والأقساط"
          icon={<CreditCard className="w-5 h-5" />}
          open={openSections.payments}
          onToggle={() => toggleSection("payments")}
        >
        <div className="p-4 space-y-4">
          <StagedPaymentsPanel
            invoiceId={invoiceId!}
            invoiceNumber={invoice?.invoice_number}
            invoiceTotal={total}
            paymentPlanId={paymentPlan?.id ?? null}
            stagedOps={stagedOps}
            setStagedOps={setStagedOps}
          />

          {paymentPlan && installments.length > 0 && (
            <div className="pt-3 border-t-2 border-dashed border-border">
              <div className="text-sm font-bold mb-2 text-muted-foreground flex items-center gap-2">
                <CalendarClock className="w-4 h-4" />
                جدول الأقساط ({installments.length} قسط)
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2">
                    <tr className="font-bold">
                      <th className="p-2 text-center w-12">#</th>
                      <th className="p-2 text-right">تاريخ الاستحقاق</th>
                      <th className="p-2 text-center">المبلغ</th>
                      <th className="p-2 text-center">المدفوع</th>
                      <th className="p-2 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {installments.map((ins) => (
                      <tr key={ins.id} className="border-t border-border">
                        <td className="p-2 text-center font-bold">{ins.installment_number}</td>
                        <td className="p-2 tabular-nums" dir="ltr">
                          {ins.due_date ? new Date(ins.due_date).toLocaleDateString("ar-EG") : "—"}
                        </td>
                        <td className="p-2 text-center tabular-nums" dir="ltr">{formatEGP(Number(ins.amount ?? 0))}</td>
                        <td className="p-2 text-center tabular-nums text-success" dir="ltr">{formatEGP(Number(ins.paid_amount ?? 0))}</td>
                        <td className="p-2 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            ins.status === "paid" ? "bg-success/20 text-success" :
                            ins.status === "overdue" ? "bg-destructive/20 text-destructive" :
                            ins.status === "partial" ? "bg-warning/20 text-warning" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {ins.status === "paid" ? "مدفوع" :
                             ins.status === "overdue" ? "متأخر" :
                             ins.status === "partial" ? "جزئي" : "معلق"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        </CollapsibleSection>

        {/* Summary section */}
        <CollapsibleSection
          title="4. الملخص والإجمالي"
          icon={<Calculator className="w-5 h-5" />}
          open={openSections.summary}
          onToggle={() => toggleSection("summary")}
        >
        <div className="p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-semibold">الإجمالي قبل الخصم:</span>
            <span className="font-bold tabular-nums" dir="ltr">
              {formatEGP(subtotal)}
            </span>
          </div>
          <div className="flex justify-between text-sm text-destructive">
            <span className="font-semibold">خصم البنود:</span>
            <span className="font-bold tabular-nums" dir="ltr">
              - {formatEGP(lineDiscounts)}
            </span>
          </div>

          {/* Invoice-level discount editor */}
          <div className="pt-2 mt-2 border-t border-primary/20 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-semibold text-sm">خصم الفاتورة:</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={discountType === "amount" ? "default" : "outline"}
                  onClick={() => setDiscountType("amount")}
                  className="h-8 text-xs font-bold"
                >
                  ج.م
                </Button>
                <Button
                  size="sm"
                  variant={discountType === "percent" ? "default" : "outline"}
                  onClick={() => setDiscountType("percent")}
                  className="h-8 text-xs font-bold"
                >
                  %
                </Button>
                {discountType === "amount" ? (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(Math.max(0, Number(e.target.value) || 0))}
                    className="h-8 w-28 text-center font-bold"
                    placeholder="0.00"
                  />
                ) : (
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                      className="h-8 w-20 text-center font-bold"
                      placeholder="0"
                    />
                    <span className="text-xs font-bold">%</span>
                  </div>
                )}
              </div>
            </div>
            {invDiscount > 0 && (
              <div className="flex justify-between text-sm text-destructive">
                <span className="font-semibold">قيمة الخصم:</span>
                <span className="font-bold tabular-nums" dir="ltr">
                  - {formatEGP(invDiscount)}
                </span>
              </div>
            )}
          </div>

          {/* VAT / Tax editor */}
          <div className="pt-2 mt-2 border-t border-primary/20 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-semibold text-sm">ضريبة القيمة المضافة (VAT):</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={Number(vatRate) === 0 ? "default" : "outline"}
                  onClick={() => setVatRate(0)}
                  className="h-8 text-xs font-bold"
                >
                  بدون
                </Button>
                <Button
                  size="sm"
                  variant={Number(vatRate) === 14 ? "default" : "outline"}
                  onClick={() => setVatRate(14)}
                  className="h-8 text-xs font-bold"
                >
                  14%
                </Button>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={vatRate}
                    onChange={(e) => setVatRate(Math.max(0, Number(e.target.value) || 0))}
                    className="h-8 w-20 text-center font-bold"
                  />
                  <span className="text-xs font-bold">%</span>
                </div>
              </div>
            </div>
            {vatAmount > 0 && (
              <div className="flex justify-between text-sm text-primary">
                <span className="font-semibold">قيمة الضريبة ({vatRate}%):</span>
                <span className="font-bold tabular-nums" dir="ltr">
                  + {formatEGP(vatAmount)}
                </span>
              </div>
            )}
          </div>

          {(() => {
            const originalTotal = Number(invoice?.total ?? 0);
            const diff = total - originalTotal;
            const changed = Math.abs(diff) > 0.01;
            return (
              <div className="pt-2 mt-2 border-t-2 border-primary/30 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-muted-foreground">الإجمالي المحفوظ حالياً:</span>
                  <span className="font-bold tabular-nums text-muted-foreground" dir="ltr">
                    {formatEGP(originalTotal)}
                  </span>
                </div>
                <div className="flex justify-between text-xl items-center">
                  <span className="font-extrabold">الإجمالي بعد التعديل:</span>
                  <span className="text-primary font-extrabold tabular-nums" dir="ltr">
                    {formatEGP(total)}
                  </span>
                </div>
                {changed && (
                  <div className={`flex justify-between text-sm rounded-md px-2 py-1.5 ${diff > 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                    <span className="font-bold">{diff > 0 ? "زيادة" : "نقص"} عن المحفوظ:</span>
                    <span className="font-extrabold tabular-nums" dir="ltr">
                      {diff > 0 ? "+ " : "- "}{formatEGP(Math.abs(diff))}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Live paid & remaining — يتحدثوا real-time مع أي تعديل في الدفعات */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div className="bg-success/10 border border-success/30 rounded-lg p-2.5 text-center">
              <div className="text-[11px] text-muted-foreground mb-1">
                المدفوع {stagedOps.length > 0 && <span className="text-warning">(بعد التعديلات المعلقة)</span>}
              </div>
              <div className="font-extrabold text-success tabular-nums text-base" dir="ltr">{formatEGP(paidPreview)}</div>
            </div>
            <div className={`rounded-lg p-2.5 text-center border ${remaining < -0.01 ? "bg-destructive/10 border-destructive/40" : remaining > 0.01 ? "bg-warning/10 border-warning/30" : "bg-muted/40 border-border"}`}>
              <div className="text-[11px] text-muted-foreground mb-1">
                {remaining < -0.01 ? "فائض" : remaining > 0.01 ? "المتبقي" : "مُسدَّد بالكامل"}
              </div>
              <div className={`font-extrabold tabular-nums text-base ${remaining < -0.01 ? "text-destructive" : remaining > 0.01 ? "text-warning" : "text-success"}`} dir="ltr">
                {formatEGP(Math.abs(remaining))}
              </div>
            </div>
          </div>
          {total > 0 && (
            <div className="h-2 bg-muted rounded-full overflow-hidden mt-1">
              <div
                className={`h-full transition-all duration-500 ${paidPreview > total + 0.01 ? "bg-destructive" : "bg-success"}`}
                style={{ width: `${Math.min(100, (paidPreview / total) * 100)}%` }}
              />
            </div>
          )}
        </div>
        </CollapsibleSection>

        <div className="text-xs text-foreground bg-warning/10 border-2 border-warning/40 rounded-lg p-3 flex gap-2 font-semibold leading-relaxed">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div>
            التعديل بيرجّع البضاعة القديمة للمخزن ويخصم البضاعة الجديدة تلقائياً. الخزنة هتتحدث على الإجمالي الجديد. المدفوعات
            والأقساط مش بتتغير — لو الإجمالي قلّ هيظهر فائض، ولو زاد هيبقى فيه متبقي إضافي.
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => {
              if (
                stagedOps.length > 0 &&
                !window.confirm(
                  `عندك ${stagedOps.length} تعديل معلّق على الدفعات لسه ما اتحفظش. لو خرجت هيتم إلغاؤهم بالكامل. تأكيد الخروج؟`
                )
              )
                return;
              nav(`/branch/${branchId}/sales/${invoiceId}`);
            }}
            disabled={saving}
          >
            إلغاء
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={saving} className="font-bold min-w-[160px]">
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin ml-1" /> جاري الحفظ...
              </>
            ) : (
              "حفظ التعديلات"
            )}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد التعديل</AlertDialogTitle>
            <AlertDialogDescription>
              تعديل الفاتورة سيؤثر على تكلفة المنتجات وأرباح هذه الفاتورة. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmOpen(false);
                await save();
              }}
              disabled={saving}
            >
              متابعة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </BranchLayout>
  );
}
