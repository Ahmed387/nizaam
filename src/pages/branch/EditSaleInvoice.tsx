import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";
import { Trash2, Plus, ArrowRight, Loader2, AlertTriangle, CreditCard, Receipt, CalendarClock, Lock, ExternalLink } from "lucide-react";
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
import { InvoicePaymentsDialog } from "@/components/InvoicePaymentsDialog";

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

type Snapshot = {
  customerId: string | null;
  customerName: string;
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
  const [paymentsDialogOpen, setPaymentsDialogOpen] = useState(false);

  const initialSnapshotRef = useRef<Snapshot | null>(null);

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

      if (plan?.id) {
        const { data: ins } = await supabase
          .from("payment_installments")
          .select("*")
          .eq("payment_plan_id", plan.id)
          .order("installment_number");
        setInstallments(ins ?? []);
      }

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
        changes.push(`❌ حذف البند: ${oldIt.product_name} (كمية ${oldIt.quantity})`);
      }
    });
    // Added
    newByKey.forEach((newIt, key) => {
      if (!oldByKey.has(key)) {
        changes.push(`➕ إضافة بند: ${newIt.product_name} (كمية ${newIt.quantity} @ ${formatEGP(newIt.selling_price)})`);
      }
    });
    // Modified
    newByKey.forEach((newIt, key) => {
      const oldIt = oldByKey.get(key);
      if (!oldIt) return;
      const parts: string[] = [];
      if (Number(oldIt.quantity) !== Number(newIt.quantity)) {
        parts.push(`الكمية: ${oldIt.quantity} → ${newIt.quantity}`);
      }
      if (Number(oldIt.selling_price) !== Number(newIt.selling_price)) {
        parts.push(`سعر البيع: ${formatEGP(oldIt.selling_price)} → ${formatEGP(newIt.selling_price)}`);
      }
      if (Number(oldIt.line_discount) !== Number(newIt.line_discount)) {
        parts.push(`خصم البند: ${formatEGP(oldIt.line_discount)} → ${formatEGP(newIt.line_discount)}`);
      }
      if (oldIt.product_name !== newIt.product_name && !newIt.product_id) {
        parts.push(`الاسم: «${oldIt.product_name}» → «${newIt.product_name}»`);
      }
      if (parts.length) changes.push(`✏️ ${newIt.product_name}: ${parts.join(" • ")}`);
    });

    // Totals diff
    const oldSubtotal = snap.items.reduce((s, it) => s + it.selling_price * it.quantity, 0);
    const oldLineDisc = snap.items.reduce((s, it) => s + Number(it.line_discount || 0), 0);
    const oldTotal = Math.max(oldSubtotal - oldLineDisc - invDiscount, 0);
    if (Math.abs(oldTotal - total) > 0.01) {
      changes.push(`💰 الإجمالي: ${formatEGP(oldTotal)} → ${formatEGP(total)}`);
    }

    return changes;
  };

  const save = async () => {
    const clean = items.filter((it) => it.product_name.trim() && it.quantity > 0);
    if (clean.length === 0) {
      toast.error("لازم يكون فيه منتج واحد على الأقل");
      return;
    }
    const diff = buildDiff();
    if (diff.length === 0) {
      toast.info("لم يتم تعديل أي بيانات");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("edit_invoice" as any, {
      _invoice_id: invoiceId,
      _customer_id: customerId,
      _items: clean as any,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(`تم تعديل الفاتورة ${invoice?.invoice_number ?? ""} — ${diff.length} تغيير`, {
      description: (
        <div className="text-xs space-y-1 mt-1 max-h-64 overflow-y-auto" dir="rtl">
          {diff.map((line, i) => (
            <div key={i} className="border-r-2 border-primary/40 pr-2">
              {line}
            </div>
          ))}
        </div>
      ) as any,
      duration: 12000,
    });

    // Navigate back to invoice view
    setTimeout(() => nav(`/branch/${branchId}/sales/${invoiceId}`), 400);
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

        {/* Customer section */}
        <div className="rounded-xl border-2 border-primary/20 bg-surface-1 p-4 space-y-3">
          <Label className="text-base font-bold text-primary flex items-center gap-2">
            <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
              1
            </span>
            العميل
          </Label>
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
        </div>

        {/* Items section */}
        <div className="rounded-xl border-2 border-primary/20 bg-surface-1 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-bold text-primary flex items-center gap-2">
              <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                2
              </span>
              بنود الفاتورة
            </Label>
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

        {/* Payment methods — READ ONLY */}
        <div className="rounded-xl border-2 border-muted-foreground/20 bg-surface-1 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label className="text-base font-bold text-primary flex items-center gap-2">
              <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                3
              </span>
              <CreditCard className="w-4 h-4" />
              طرق الدفع والأقساط
              <span className="text-[11px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full flex items-center gap-1">
                <Lock className="w-3 h-3" /> عرض فقط
              </span>
            </Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-xs"
                onClick={() => setPaymentsDialogOpen(true)}
              >
                <Receipt className="w-3.5 h-3.5" /> تعديل الدفعات
              </Button>
              {paymentPlan && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs"
                  onClick={() => nav(`/branch/${branchId}/sales/${invoiceId}`)}
                >
                  <CalendarClock className="w-3.5 h-3.5" /> إدارة الأقساط
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </Button>
              )}
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2 leading-relaxed">
            💡 اضغط "تعديل الدفعات" لفتح شاشة إدارة دفعات الفاتورة (إضافة/إلغاء) من غير ما تخرج من صفحة التعديل.
          </div>

          {payments.length === 0 && !paymentPlan ? (
            <div className="text-center text-sm text-muted-foreground py-3 border border-dashed border-border rounded-lg">
              لا توجد دفعات مسجلة على هذه الفاتورة
            </div>
          ) : (
            <>
              {payments.length > 0 && (
                <div>
                  <div className="text-xs font-bold mb-1.5 text-muted-foreground">الدفعات المسجلة ({payments.length})</div>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-surface-2">
                        <tr className="font-bold">
                          <th className="p-2 text-right">التاريخ</th>
                          <th className="p-2 text-right">الطريقة</th>
                          <th className="p-2 text-center">المبلغ</th>
                          <th className="p-2 text-right">مرجع</th>
                          <th className="p-2 text-right">استلم</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((pay) => (
                          <tr key={pay.id} className="border-t border-border">
                            <td className="p-2 tabular-nums" dir="ltr">
                              {new Date(pay.created_at).toLocaleDateString("ar-EG")}
                            </td>
                            <td className="p-2 font-semibold">{pay.payment_method ?? "—"}</td>
                            <td className="p-2 text-center font-bold tabular-nums text-success" dir="ltr">
                              {formatEGP(Number(pay.amount ?? 0))}
                            </td>
                            <td className="p-2 text-muted-foreground">{pay.reference_number ?? "—"}</td>
                            <td className="p-2">{pay.received_by_name ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {paymentPlan && (
                <div>
                  <div className="text-xs font-bold mb-1.5 text-muted-foreground flex items-center gap-2">
                    <CalendarClock className="w-3.5 h-3.5" />
                    خطة الأقساط ({installments.length} قسط)
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
                    <div className="bg-muted/40 rounded p-2">
                      <div className="text-muted-foreground">الإجمالي</div>
                      <div className="font-bold tabular-nums" dir="ltr">{formatEGP(Number(paymentPlan.total_amount ?? 0))}</div>
                    </div>
                    <div className="bg-success/10 rounded p-2">
                      <div className="text-muted-foreground">المدفوع</div>
                      <div className="font-bold text-success tabular-nums" dir="ltr">{formatEGP(Number(paymentPlan.paid_amount ?? 0))}</div>
                    </div>
                    <div className="bg-warning/10 rounded p-2">
                      <div className="text-muted-foreground">المتبقي</div>
                      <div className="font-bold text-warning tabular-nums" dir="ltr">{formatEGP(Number(paymentPlan.remaining_amount ?? 0))}</div>
                    </div>
                  </div>
                  {installments.length > 0 && (
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
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Summary section */}
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-2">
          <Label className="text-base font-bold text-primary flex items-center gap-2 mb-2">
            <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
              4
            </span>
            الملخص
          </Label>
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
          {invDiscount > 0 && (
            <div className="flex justify-between text-sm text-destructive">
              <span className="font-semibold">خصم الفاتورة (محفوظ):</span>
              <span className="font-bold tabular-nums" dir="ltr">
                - {formatEGP(invDiscount)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-xl pt-2 mt-2 border-t-2 border-primary/30">
            <span className="font-extrabold">الإجمالي النهائي:</span>
            <span className="text-primary font-extrabold tabular-nums" dir="ltr">
              {formatEGP(total)}
            </span>
          </div>
        </div>

        <div className="text-xs text-foreground bg-warning/10 border-2 border-warning/40 rounded-lg p-3 flex gap-2 font-semibold leading-relaxed">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div>
            التعديل بيرجّع البضاعة القديمة للمخزن ويخصم البضاعة الجديدة تلقائياً. الخزنة هتتحدث على الإجمالي الجديد. المدفوعات
            والأقساط مش بتتغير — لو الإجمالي قلّ هيظهر فائض، ولو زاد هيبقى فيه متبقي إضافي.
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => nav(`/branch/${branchId}/sales/${invoiceId}`)} disabled={saving}>
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
