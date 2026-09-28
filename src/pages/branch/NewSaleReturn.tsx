import { LockedRecipientInput, useCurrentUserName } from "@/components/LockedRecipient";
import { saveDocAnnotations } from "@/lib/docAnnotations";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PickerItemsToggle } from "@/components/PickerItemsPreview";
import { focusSection } from "@/lib/sectionFocus";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftRestoreBar } from "@/components/DraftRestoreBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ReturnDocPicker } from "@/components/ReturnDocPicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { VariantLine } from "@/components/VariantChips";
import type { VariantAttrs } from "@/lib/productVariant";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { docSuccess, docError } from "@/lib/docToast";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { Loader2, Link2, Printer, AlertTriangle, FileText, User as UserIcon, Package, CreditCard, ShieldAlert } from "lucide-react";
import { AddAnotherBar } from "@/components/AddAnotherBar";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { loadAllPaymentMethods, PaymentMethodOption, methodRequiresReference, methodAccountLabel } from "@/lib/paymentMethods";
import { InvoiceDateInput } from "@/components/InvoiceDateInput";
import { evaluateReturnPolicy } from "@/lib/returnPolicy";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";

interface Line extends VariantAttrs {
  invoice_item_id: string;
  product_id: string;
  product_name: string;
  unit_refund: number;
  sold_qty: number;
  already_returned: number;
  max_qty: number;
  quantity: number;
}

const COMMON_REASONS = [
  "منتج تالف / معيب",
  "خطأ في الطلب",
  "عدم مطابقة المواصفات",
  "غير راضي عن المنتج",
  "أخرى",
];

type RefundMode = "cash" | "transfer" | "balance" | "mixed";

export default function NewSaleReturn() {
  const { id: branchId } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const presetInvoiceId = params.get("invoice");
  const nav = useNavigate();

  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoice, setInvoice] = useState<any>(null);
  const [customer, setCustomer] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const [reasonPick, setReasonPick] = useState(COMMON_REASONS[0]);
  const [reasonOther, setReasonOther] = useState("");
  const [notes, setNotes] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const __me = useCurrentUserName();
  useEffect(() => { if (true && __me && recipientName !== __me) setRecipientName(__me); }, [__me, recipientName]);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(lines.some((l) => (l.quantity ?? 0) > 0), "لديك مرتجع بيع غير محفوظ. هل تريد المغادرة وفقدان البيانات؟");
  const [openSections, setOpenSections] = useState({ customer: true, products: true, payment: true, summary: true });
  const toggleSection = (k: keyof typeof openSections) => setOpenSections((s) => focusSection(s, k));


  // Refund
  const [methodOptions, setMethodOptions] = useState<PaymentMethodOption[]>([]);
  const [refundMode, setRefundMode] = useState<RefundMode>("cash");
  const [transferMethod, setTransferMethod] = useState<string>("vodafone");
  const [refundRef, setRefundRef] = useState("");
  const [refundAccount, setRefundAccount] = useState("");
  const [cashPart, setCashPart] = useState(0);
  const [transferPart, setTransferPart] = useState(0);
  const [balancePart, setBalancePart] = useState(0);

  // Invoice picker
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState("");

  // Print dialog
  const [printOpen, setPrintOpen] = useState(false);
  const [savedNumber, setSavedNumber] = useState("");

  // Return-window override
  const { user, profile, isOwner } = useAuth();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideMeta, setOverrideMeta] = useState<{ daysSince: number; windowDays: number } | null>(null);
  const [overrideApproved, setOverrideApproved] = useState<{ reason: string; daysSince: number; windowDays: number } | null>(null);
  const [pendingDraft, setPendingDraft] = useState<boolean>(false);

  const loadInvoices = useCallback(async () => {
    if (!branchId) return;
    const { data } = await supabase
      .from("invoices")
      .select("id, invoice_number, total, created_at, contact_id, contacts:contact_id(name, phone)")
      .eq("branch_id", branchId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(300);
    // TODO Phase 2.2B: Remove after contacts.balance column is dropped — merge live balances
    const list = (data ?? []) as any[];
    const { fetchContactBalanceMap } = await import("@/lib/contactBalances");
    const balMap = await fetchContactBalanceMap(list.map((r) => r.contact_id));
    list.forEach((r) => { if (r.contacts && r.contact_id) r.contacts.balance = balMap[r.contact_id] ?? 0; });
    setInvoices(list);
  }, [branchId]);

  useEffect(() => {
    loadInvoices();
    loadAllPaymentMethods().then((m) => setMethodOptions((m ?? []).filter((x) => x.is_enabled && x.value !== "cash")));
  }, [loadInvoices]);
  useRealtimeRefresh(["invoices", "returns"], loadInvoices);

  const pickInvoice = useCallback(async (invId: string) => {
    setPickOpen(false);
    const { data: inv } = await supabase
      .from("invoices")
      .select("id, invoice_number, total, created_at, contact_id, contacts:contact_id(id, name, phone)")
      .eq("id", invId).maybeSingle();
    if (!inv) return toast.error("الفاتورة غير موجودة");
    // TODO Phase 2.2B: Remove after contacts.balance column is dropped
    if ((inv as any).contact_id && (inv as any).contacts) {
      const { fetchContactBalance } = await import("@/lib/contactBalances");
      (inv as any).contacts.balance = await fetchContactBalance((inv as any).contact_id);
    }
    const { data: items } = await supabase
      .from("invoice_items").select("id, product_id, product_name, brand, model, color, product_type, capacity, size, quantity, selling_price, line_discount, total")
      .eq("invoice_id", invId);

    // Already-returned per product on this invoice
    const { data: prevReturns } = await supabase
      .from("returns").select("id, status").eq("invoice_id", invId).eq("status", "active");
    const prevReturnIds = (prevReturns ?? []).map((r: any) => r.id);
    let prevByProduct: Record<string, number> = {};
    if (prevReturnIds.length) {
      const { data: prevItems } = await supabase
        .from("return_items").select("product_id, quantity").in("return_id", prevReturnIds);
      (prevItems ?? []).forEach((it: any) => {
        if (!it.product_id) return;
        prevByProduct[it.product_id] = (prevByProduct[it.product_id] ?? 0) + Number(it.quantity);
      });
    }

    const newLines: Line[] = (items ?? [])
      .filter((it: any) => it.product_id)
      .map((it: any) => {
        const qty = Number(it.quantity);
        const unit_refund = qty > 0 ? Number(it.total) / qty : Number(it.selling_price);
        const ret = prevByProduct[it.product_id] ?? 0;
        const max = Math.max(0, qty - ret);
        return {
          invoice_item_id: it.id,
          product_id: it.product_id,
          product_name: it.product_name,
          brand: it.brand ?? null,
          model: it.model ?? null,
          color: it.color ?? null,
          product_type: it.product_type ?? null,
          capacity: it.capacity ?? null,
          size: it.size ?? null,
          unit_refund,
          sold_qty: qty,
          already_returned: ret,
          max_qty: max,
          quantity: max, // pre-fill with max
        };
      });

    setInvoice(inv);
    setCustomer((inv as any).contacts ?? null);
    setLines(newLines);
    toast.success(`تم تحميل ${newLines.length} منتج من الفاتورة`);
  }, []);

  // Preload from URL ?invoice=
  useEffect(() => {
    if (presetInvoiceId && !invoice) pickInvoice(presetInvoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetInvoiceId]);

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  // ===== تسهيل إدخال الكميات: فوكس تلقائي + انتقال للصنف اللي بعده =====
  const qtyRefs = useRef<Array<HTMLInputElement | null>>([]);

  const focusNextQty = (from: number) => {
    for (let j = from + 1; j < lines.length; j++) {
      const el = qtyRefs.current[j];
      if (el && !el.disabled) { el.focus(); el.select?.(); return; }
    }
  };

  useEffect(() => {
    if (!openSections.products || lines.length === 0) return;
    const t = setTimeout(() => {
      const el = qtyRefs.current.find((x) => x && !x.disabled);
      el?.focus();
      el?.select?.();
    }, 120);
    return () => clearTimeout(t);
  }, [openSections.products, lines.length]);


  // ===== Local autosave (crash / accidental reload safety net) =====
  const draftSnapshot = {
    invoiceId: invoice?.id ?? null,
    lines,
    reasonPick, reasonOther, notes, invoiceDate,
    refundMode, transferMethod, refundRef, refundAccount,
    cashPart, transferPart, balancePart,
  };
  const formDraft = useFormDraft<typeof draftSnapshot>(
    "sale-return",
    [user?.id, branchId],
    draftSnapshot,
    !!invoice && lines.length > 0 && !busy,
  );
  const restoreDraft = async () => {
    const d = formDraft.draft?.data;
    if (!d?.invoiceId) return;
    await pickInvoice(d.invoiceId);
    setLines((cur) =>
      cur.map((l) => {
        const saved = (d.lines ?? []).find((x: Line) => x.product_id === l.product_id);
        return saved ? { ...l, quantity: Math.min(saved.quantity, l.max_qty) } : l;
      }),
    );
    setReasonPick(d.reasonPick ?? reasonPick);
    setReasonOther(d.reasonOther ?? "");
    setNotes(d.notes ?? "");
    setInvoiceDate(d.invoiceDate ?? invoiceDate);
    setRefundMode(d.refundMode ?? "cash");
    setTransferMethod(d.transferMethod ?? "vodafone");
    setRefundRef(d.refundRef ?? "");
    setRefundAccount(d.refundAccount ?? "");
    formDraft.dismiss();
  };

  const total = lines.reduce((s, l) => s + l.quantity * l.unit_refund, 0);

  useEffect(() => {
    if (refundMode === "cash") { setCashPart(total); setTransferPart(0); setBalancePart(0); }
    else if (refundMode === "transfer") { setCashPart(0); setTransferPart(total); setBalancePart(0); }
    else if (refundMode === "balance") { setCashPart(0); setTransferPart(0); setBalancePart(total); }
  }, [refundMode, total]);

  const mixedSum = cashPart + transferPart + balancePart;
  const mixedValid = refundMode !== "mixed" || Math.abs(mixedSum - total) < 0.01;
  const finalReason = reasonPick === "أخرى" ? reasonOther.trim() : reasonPick;

  const submit = async (asDraft = false) => {
    if (busy) return;
    if (!invoice) return toast.error("اختر فاتورة أولاً");
    if (!finalReason) return toast.error("اكتب السبب");
    const activeLines = lines.filter((l) => l.quantity > 0);
    if (activeLines.length === 0) return toast.error("اختر منتج واحد على الأقل لإرجاعه");
    for (const l of activeLines) {
      if (l.quantity > l.max_qty) return toast.error(`الكمية أكبر من المتاح للمنتج ${l.product_name} (متاح: ${l.max_qty})`);
    }
    if (!asDraft) {
      if (!mixedValid) return toast.error("مجموع التوزيع لازم يساوي إجمالي المرتجع");
      const needsRef = refundMode === "transfer" || (refundMode === "mixed" && transferPart > 0);
      if (needsRef && methodRequiresReference(transferMethod) && !refundRef.trim())
        return toast.error("أدخل رقم العملية للتحويل");
      if (refundMode === "balance" && !customer) return toast.error("لا يمكن الإضافة لحساب العميل (الفاتورة نقدي)");
      if (refundMode === "mixed" && balancePart > 0 && !customer) return toast.error("لا يمكن الإضافة لحساب العميل (الفاتورة نقدي)");

      // Return-window policy (skipped when this call is already an approved owner override)
      if (!overrideApproved) {
        const policy = await evaluateReturnPolicy({
          invoiceId: invoice.id,
          invoiceDate: (invoice as any).invoice_date ?? invoice.created_at,
          isOwner,
        });
        if (policy.status === "blocked") {
          toast.error(`انتهت فترة الإرجاع (${policy.windowDays} يوم — الفاتورة من ${policy.daysSince} يوم). تواصل مع المالك للموافقة.`);
          return;
        }
        if (policy.status === "override_required") {
          setOverrideMeta({ daysSince: policy.daysSince, windowDays: policy.windowDays });
          setOverrideReason("");
          setPendingDraft(asDraft);
          setOverrideOpen(true);
          return;
        }
      }
    }

    setBusy(true);
    try {
      const refundMethodFinal = refundMode === "transfer" ? transferMethod : refundMode;
      const { data: rr, error } = await supabase.rpc("register_sale_return_full" as any, {
        _invoice_id: invoice.id,
        _reason: finalReason,
        _notes: notes.trim() || null,
        _status: "active",
        _refund_method: refundMethodFinal,
        _refund_reference: refundRef.trim() || null,
        _refund_account: refundAccount.trim() || null,
        _refund_cash_amount: cashPart,
        _refund_transfer_amount: transferPart,
        _refund_balance_amount: balancePart,
        _items: activeLines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          refund: l.quantity * l.unit_refund,
        })) as any,
      });
      if (error || !rr) throw error ?? new Error("فشل الحفظ");
      const number = (rr as any).return_number as string;
      if (recipientName.trim() && (rr as any).id) {
        try { await saveDocAnnotations("sale_return", (rr as any).id, recipientName, notes); } catch (e) { console.warn(e); }
      }
      const appliedToDebt = Number((rr as any).applied_to_debt ?? 0);
      const cashBack = Number((rr as any).cash_refund ?? 0) + Number((rr as any).transfer_refund ?? 0);

      // Persist invoice_date if backdated (DB trigger enforces admin-only)
      const today = new Date().toISOString().slice(0, 10);
      if (invoiceDate && invoiceDate !== today && number) {
        const { error: dErr } = await supabase
          .from("returns")
          .update({ invoice_date: invoiceDate } as any)
          .eq("return_number", number);
        if (dErr) console.warn("invoice_date update blocked:", dErr.message);
      }

      // Stock, treasury, invoice returned quantities and customer balance are updated atomically in the database.
      // Redistribute installments if this invoice has a payment plan
      try {
        const { data: rd } = await supabase.rpc("redistribute_installments_after_return" as any, { _invoice_id: invoice.id });
        const r = rd as any;
        if (r?.cancelled_all) {
          toast.message(`المرتجع تجاوز قيمة المتبقي — تم إلغاء كل الأقساط (فائض ${r.overpayment} ج.م)`);
        } else if (r?.updated_installments > 0) {
          toast.message(`تم إعادة توزيع ${r.updated_installments} قسط بعد المرتجع`);
        }
      } catch (e) { /* ignore if no plan */ }

      formDraft.clear();
      docSuccess({
        title: "تم تسجيل مرتجع البيع بنجاح",
        docNumber: number,
        amount: total,
        description:
          `عدد الأصناف: ${activeLines.length}` +
          (appliedToDebt > 0 ? ` • اتخصم من الدين: ${formatEGP(appliedToDebt)}` : "") +
          (cashBack > 0 ? ` • اترد كاش من الخزنة: ${formatEGP(cashBack)}` : ""),
      });
      setSavedNumber(number);
      setPrintOpen(true);

    } catch (err: any) {
      docError({ title: "فشل حفظ مرتجع البيع", description: err.message ?? "خطأ غير متوقع" });
    } finally {
      setBusy(false);
    }
  };

  const confirmOwnerOverride = async () => {
    const reason = overrideReason.trim();
    if (!reason) return toast.error("اكتب سبب التجاوز");
    if (!overrideMeta || !invoice) return;
    const meta = { reason, daysSince: overrideMeta.daysSince, windowDays: overrideMeta.windowDays };
    setOverrideApproved(meta);
    setOverrideOpen(false);
    try {
      await logAudit({
        userId: user!.id,
        userName: profile?.name ?? "",
        action: "UPDATE",
        entity: "return_owner_override",
        entityId: invoice.id,
        details: {
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          days_since: meta.daysSince,
          window_days: meta.windowDays,
          reason,
          owner_id: user!.id,
        },
      });
    } catch {}
    await submit(pendingDraft);
    setOverrideApproved(null);
  };

  // Shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        submit(false);
      } else if (e.key === "Escape" && !busy && !pickOpen) {
        nav(`/branch/${branchId}/invoices?tab=sale_return`);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, lines, invoice, refundMode, cashPart, transferPart, balancePart, refundRef, finalReason, pickOpen]);

  const filteredInvoices = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((r: any) =>
      [r.invoice_number, r.contacts?.name, r.contacts?.phone].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [pickQuery, invoices]);

  const printReceipt = (size: "thermal" | "a4") => {
    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${savedNumber}</title>
      <style>
        body{font-family:system-ui,Arial;padding:${size === "thermal" ? "8px" : "24px"};max-width:${size === "thermal" ? "80mm" : "210mm"};margin:auto}
        h2{margin:4px 0;text-align:center}
        table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
        td,th{border-bottom:1px dashed #999;padding:4px;text-align:right}
        .tot{font-weight:bold;font-size:16px;margin-top:8px;display:flex;justify-content:space-between}
        .meta{font-size:12px;color:#444;margin:4px 0}
      </style></head><body>
      <h2>إيصال مرتجع بيع</h2>
      <div class="meta">رقم: ${savedNumber}</div>
      <div class="meta">فاتورة: ${invoice?.invoice_number}</div>
      <div class="meta">العميل: ${customer?.name ?? "نقدي"}</div>
      <div class="meta">التاريخ: ${formatDateTime(new Date().toISOString())}</div>
      <div class="meta">السبب: ${finalReason}</div>
      <table><thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>
        ${lines.filter((l) => l.quantity > 0).map((l) => `<tr><td>${l.product_name}</td><td>${l.quantity}</td><td>${formatEGP(l.unit_refund)}</td><td>${formatEGP(l.quantity * l.unit_refund)}</td></tr>`).join("")}
      </tbody></table>
      <div class="tot"><span>إجمالي المسترد</span><span>${formatEGP(total)}</span></div>
      ${cashPart > 0 ? `<div class="meta">نقدي: ${formatEGP(cashPart)}</div>` : ""}
      ${transferPart > 0 ? `<div class="meta">تحويل: ${formatEGP(transferPart)} (${transferMethod})${refundRef ? " - " + refundRef : ""}</div>` : ""}
      ${balancePart > 0 ? `<div class="meta">على حساب العميل: ${formatEGP(balancePart)}</div>` : ""}
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(html); w.document.close();
  };

  return (
    <BranchLayout>
      <PageHeader title="مرتجع بيع جديد" subtitle="إرجاع بضاعة من العميل" />

      {formDraft.draft && !invoice && (
        <DraftRestoreBar
          savedAt={formDraft.draft.savedAt}
          summary={`${formDraft.draft.data.lines?.length ?? 0} صنف`}
          onRestore={restoreDraft}
          onDismiss={formDraft.clear}
        />
      )}

      <div className="space-y-4">
        {/* 1) Customer + invoice link */}
        <CollapsibleSection
          title="بيانات العميل والفاتورة"
          icon={<UserIcon className="w-5 h-5" />}
          open={openSections.customer}
          accent="blue"
          onToggle={() => toggleSection("customer")}
        >
          <div className="p-5 space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" /> العميل *
                </Label>
                <div className="h-10 px-3 rounded-md border border-border bg-muted/40 flex items-center text-sm font-semibold">
                  {customer?.name ?? (invoice ? "نقدي" : "اختر الفاتورة لعرض العميل")}
                </div>
              </div>
              <div className="space-y-2">
                <InvoiceDateInput value={invoiceDate} onChange={setInvoiceDate} label="تاريخ المرتجع" />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" /> الفاتورة الأصلية
                </Label>
                <Button variant="outline" onClick={() => setPickOpen(true)} className="gap-2 w-full h-10 border-primary/40 text-primary hover:bg-primary/10">
                  <FileText className="w-4 h-4" /> {invoice ? "تغيير الفاتورة" : "اختيار من فاتورة بيع"}
                </Button>
              </div>
            </div>
            {invoice && (
              <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                {customer?.phone && <span dir="ltr" className="font-mono">{customer.phone}</span>}
                {customer && (
                  <span>الرصيد: <b className={Number(customer.balance) > 0 ? "text-warning" : "text-success"}>{formatEGP(customer.balance ?? 0)}</b></span>
                )}
                <span>فاتورة: <b className="font-mono text-primary">{invoice.invoice_number}</b></span>
                <span>الإجمالي: <b className="text-primary">{formatEGP(invoice.total)}</b></span>
              </div>
            )}
            {invoice && (
              <div className="text-xs text-success flex items-center gap-1">
                <Link2 className="w-3 h-3" /> مرتبط بفاتورة بيع — المنتجات والأسعار اتملت تلقائياً
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* 2) Products (locked to invoice) */}
        <CollapsibleSection
          title="المنتجات المُرتجعة"
          icon={<Package className="w-5 h-5" />}
          open={openSections.products}
          accent="rose"
          onToggle={() => toggleSection("products")}
        >
          <div className="p-5">
            {!invoice ? (
              <div className="text-center text-sm text-muted-foreground py-8">اختر فاتورة لعرض المنتجات</div>
            ) : lines.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">لا توجد منتجات قابلة للإرجاع في هذه الفاتورة</div>
            ) : (
              <div className="space-y-2">
                {(() => {
                  // بنعرض كل الأصناف دايماً عشان اليوزر يقدر يدخل كميات لأكتر من صنف
                  const visible = lines.map((l, i) => ({ l, i }));
                  return (
                    <>
                      {visible.map(({ l, i }) => (
                  <div key={l.invoice_item_id} className="grid grid-cols-12 gap-2 items-center p-2 border rounded">
                    <div className="col-span-5 text-sm">
                      <div className="font-medium">{l.product_name}</div>
                      <VariantLine attrs={l as any} className="block" />
                      <div className="text-[11px] text-muted-foreground">
                        مباع: {l.sold_qty}
                        {l.already_returned > 0 && <> • مرتجع سابق: {l.already_returned}</>}
                        {" • "}<b>متاح للإرجاع: {l.max_qty}</b>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <Input
                        ref={(el) => { qtyRefs.current[i] = el; }}
                        type="number"
                        min={0}
                        max={l.max_qty}
                        value={l.quantity}
                        disabled={l.max_qty === 0}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusNextQty(i); } }}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(l.max_qty, Number(e.target.value)));
                          updateLine(i, { quantity: v });
                        }}
                      />
                    </div>
                    <div className="col-span-3 text-sm text-muted-foreground text-center">
                      سعر الوحدة: <b>{formatEGP(l.unit_refund)}</b>
                    </div>
                    <div className="col-span-2 text-sm text-center font-bold text-primary">
                      {formatEGP(l.quantity * l.unit_refund)}
                    </div>
                  </div>
                      ))}
                      {/* شريط «صنف آخر» — بالنقر الصريح ينقلك لأول صنف لسه فاضي */}
                      {lines.some((x) => x.max_qty > 0 && (x.quantity ?? 0) === 0) && (
                        <AddAnotherBar
                          label="صنف آخر"
                          hint="— اضغط هنا للانتقال للصنف اللي بعده"
                          onActivate={() => {
                            const idx = lines.findIndex((x) => x.max_qty > 0 && (x.quantity ?? 0) === 0);
                            if (idx >= 0) { qtyRefs.current[idx]?.focus(); qtyRefs.current[idx]?.select?.(); }
                          }}
                        />
                      )}
                    </>
                  );
                })()}

              </div>
            )}
          </div>

        </CollapsibleSection>

        {/* 3) Refund mode + reason + notes */}
        <CollapsibleSection
          title="طريقة الاسترداد والسبب"
          icon={<CreditCard className="w-5 h-5" />}
          open={openSections.payment}
          accent="violet"
          onToggle={() => toggleSection("payment")}
        >
          <div className="p-5 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>السبب *</Label>
                <Select value={reasonPick} onValueChange={setReasonPick}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>{COMMON_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
                {reasonPick === "أخرى" && (
                  <Input value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} placeholder="اكتب السبب" className="mt-2" />
                )}
              </div>
              <div>
                <Label>المستلم</Label>
                <LockedRecipientInput value={recipientName} className="mt-1.5" />
              </div>
              <div>
                <Label>ملاحظات</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
              </div>
            </div>

            <div className="space-y-3">
              <Label>طريقة الاسترداد *</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {([
                  { v: "cash" as RefundMode, lbl: "💵 صرف نقدي" },
                  { v: "transfer" as RefundMode, lbl: "📱 تحويل" },
                  { v: "balance" as RefundMode, lbl: "📒 على حساب العميل", disabled: !customer },
                  { v: "mixed" as RefundMode, lbl: "⚖️ مختلط" },
                ]).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    disabled={(o as any).disabled}
                    onClick={() => setRefundMode(o.v)}
                    className={`text-sm px-3 py-2 rounded-md border disabled:opacity-50 disabled:cursor-not-allowed ${refundMode === o.v ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
                  >
                    {o.lbl}
                  </button>
                ))}
              </div>

              {(refundMode === "transfer" || (refundMode === "mixed" && transferPart > 0)) && (
                <div className="grid md:grid-cols-3 gap-3 p-3 rounded-lg bg-muted/30 border">
                  <div>
                    <Label className="text-xs">طريقة التحويل</Label>
                    <Select value={transferMethod} onValueChange={setTransferMethod}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>{methodOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">رقم العملية *</Label>
                    <Input value={refundRef} onChange={(e) => setRefundRef(e.target.value)} className="mt-1.5" placeholder="رقم التحويل" />
                  </div>
                  <div>
                    <Label className="text-xs">{methodAccountLabel(transferMethod)}</Label>
                    <Input dir="ltr" className="text-right mt-1.5" value={refundAccount} onChange={(e) => setRefundAccount(e.target.value)} />
                  </div>
                </div>
              )}

              {refundMode === "mixed" && (
                <div className="grid md:grid-cols-3 gap-3 p-3 rounded-lg bg-muted/30 border">
                  <div>
                    <Label className="text-xs">المبلغ النقدي</Label>
                    <Input type="number" step="0.01" value={cashPart} onChange={(e) => setCashPart(Number(e.target.value))} className="mt-1.5" />
                  </div>
                  <div>
                    <Label className="text-xs">المبلغ المُحوَّل</Label>
                    <Input type="number" step="0.01" value={transferPart} onChange={(e) => setTransferPart(Number(e.target.value))} className="mt-1.5" />
                  </div>
                  <div>
                    <Label className="text-xs">على حساب العميل</Label>
                    <Input type="number" step="0.01" value={balancePart} disabled={!customer} onChange={(e) => setBalancePart(Number(e.target.value))} className="mt-1.5" />
                  </div>
                  <div className={`md:col-span-3 text-xs ${mixedValid ? "text-success" : "text-destructive"} flex items-center gap-1`}>
                    {!mixedValid && <AlertTriangle className="w-3 h-3" />}
                    المجموع: {formatEGP(mixedSum)} / المطلوب: {formatEGP(total)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CollapsibleSection>

        {/* 4) Summary + save */}
        <CollapsibleSection
          title="الملخص والحفظ"
          icon={<FileText className="w-5 h-5" />}
          open={openSections.summary}
          accent="indigo"
          onToggle={() => toggleSection("summary")}
        >
          <div className="p-5 space-y-3">
            <div className="font-bold text-lg">ملخص المرتجع</div>
            <div className="flex justify-between text-sm"><span>عدد الأصناف</span><Badge variant="secondary">{lines.filter((l) => l.quantity > 0).length}</Badge></div>
            <div className="flex justify-between text-sm"><span>إجمالي الكمية</span><Badge variant="secondary">{lines.reduce((s, l) => s + l.quantity, 0)}</Badge></div>
            <div className="border-t pt-3 flex justify-between text-xl">
              <span>الإجمالي</span>
              <b className="text-primary">{formatEGP(total)}</b>
            </div>
            {refundMode === "balance" && customer && total > 0 && (
              <div className="text-xs bg-warning/10 border border-warning/30 rounded p-2 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-warning" />
                <span>رصيد العميل هيتعدل من {formatEGP(customer.balance ?? 0)} إلى {formatEGP(Number(customer.balance ?? 0) - total)}</span>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2">
              <Button onClick={() => submit(false)} disabled={busy || total === 0 || !invoice} className="w-full gap-2" size="lg">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                حفظ مرتجع البيع
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground text-center">Ctrl+S للحفظ — Esc للإلغاء</p>
          </div>
        </CollapsibleSection>
      </div>


      {/* Invoice picker */}
      <ReturnDocPicker kind="sale" branchId={branchId!} open={pickOpen} onOpenChange={setPickOpen} onPick={pickInvoice} />

      {/* Owner override — return window exceeded */}
      <Dialog open={overrideOpen} onOpenChange={(o) => { setOverrideOpen(o); if (!o) setPendingDraft(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-warning">
              <ShieldAlert className="w-5 h-5" /> تجاوز فترة الإرجاع
            </DialogTitle>
            <DialogDescription>
              {overrideMeta && (
                <>فترة الإرجاع المسموح بها: <b>{overrideMeta.windowDays} يوم</b>. هذه الفاتورة مرّ عليها <b>{overrideMeta.daysSince} يوم</b>. بصفتك المالك يمكنك التجاوز مع تسجيل السبب.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>سبب التجاوز (مطلوب)</Label>
            <Textarea rows={3} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="اكتب سبب واضح للسماح بالمرتجع بعد انتهاء الفترة" />
          </div>
          <DialogFooter className="gap-2 flex-row">
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>إلغاء</Button>
            <Button onClick={confirmOwnerOverride} className="bg-warning text-warning-foreground hover:bg-warning/90 gap-2">
              <ShieldAlert className="w-4 h-4" /> متابعة بصفتي المالك
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print dialog */}
      <Dialog open={printOpen} onOpenChange={(o) => { setPrintOpen(o); if (!o) nav(`/branch/${branchId}/invoices?tab=sale_return`); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>طباعة إيصال المرتجع</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">تم حفظ مرتجع البيع رقم {savedNumber}.</p>
          <DialogFooter className="gap-2 flex-row">
            <Button variant="outline" onClick={() => { setPrintOpen(false); nav(`/branch/${branchId}/invoices?tab=sale_return`); }}>تخطي</Button>
            <Button variant="outline" onClick={() => printReceipt("thermal")} className="gap-2"><Printer className="w-4 h-4" />حرارية</Button>
            <Button onClick={() => printReceipt("a4")} className="gap-2"><Printer className="w-4 h-4" />A4</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
