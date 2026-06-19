import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Loader2, Link2, Printer, AlertTriangle, Save, FileText } from "lucide-react";
import { loadAllPaymentMethods, PaymentMethodOption, methodRequiresReference, methodAccountLabel } from "@/lib/paymentMethods";

interface Line {
  shipment_item_id?: string;
  product_id: string;
  product_name: string;
  unit_cost: number;
  received_qty: number;
  already_returned: number;
  max_qty: number;
  quantity: number;
}

const COMMON_REASONS = [
  "منتج تالف / معيب",
  "خطأ في الطلب",
  "عدم مطابقة المواصفات",
  "زيادة في الكمية",
  "اتفاق مع المورد",
  "أخرى",
];

type RefundMode = "cash" | "transfer" | "balance" | "mixed";

export default function NewPurchaseReturn() {
  const { id: branchId } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const presetShipmentId = params.get("shipment");
  const { user } = useAuth();
  const nav = useNavigate();

  const [shipments, setShipments] = useState<any[]>([]);
  const [shipment, setShipment] = useState<any>(null);
  const [supplier, setSupplier] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const [reasonPick, setReasonPick] = useState(COMMON_REASONS[0]);
  const [reasonOther, setReasonOther] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  // Refund
  const [methodOptions, setMethodOptions] = useState<PaymentMethodOption[]>([]);
  const [refundMode, setRefundMode] = useState<RefundMode>("cash");
  const [transferMethod, setTransferMethod] = useState<string>("vodafone");
  const [refundRef, setRefundRef] = useState("");
  const [refundAccount, setRefundAccount] = useState("");
  const [cashPart, setCashPart] = useState(0);
  const [transferPart, setTransferPart] = useState(0);
  const [balancePart, setBalancePart] = useState(0);

  // Shipment picker
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState("");

  // Print dialog
  const [printOpen, setPrintOpen] = useState(false);
  const [savedNumber, setSavedNumber] = useState("");

  const loadShipments = useCallback(async () => {
    if (!branchId) return;
    const { data } = await supabase
      .from("shipments")
      .select("id, arrival_date, total_cost, notes, contact_id, contacts:contact_id(id, name, phone, balance)")
      .eq("branch_id", branchId)
      .order("arrival_date", { ascending: false })
      .limit(300);
    setShipments(data ?? []);
  }, [branchId]);

  useEffect(() => {
    loadShipments();
    loadAllPaymentMethods().then((m) => setMethodOptions((m ?? []).filter((x) => x.is_enabled && x.value !== "cash")));
  }, [loadShipments]);
  useRealtimeRefresh(["shipments", "purchase_returns"], loadShipments);

  const pickShipment = useCallback(async (shipId: string) => {
    setPickOpen(false);
    const { data: sh } = await supabase
      .from("shipments")
      .select("id, arrival_date, total_cost, notes, contact_id, contacts:contact_id(id, name, phone, balance), shipment_items(id, product_id, product_name, quantity, cost_price)")
      .eq("id", shipId).maybeSingle();
    if (!sh) return toast.error("الفاتورة غير موجودة");

    // Already-returned per product on this shipment
    const { data: prevReturns } = await supabase
      .from("purchase_returns" as any).select("id, status").eq("shipment_id", shipId).eq("status", "active");
    const prevIds = (prevReturns ?? []).map((r: any) => r.id);
    let prevByProduct: Record<string, number> = {};
    if (prevIds.length) {
      const { data: prevItems } = await supabase
        .from("purchase_return_items" as any)
        .select("product_id, quantity").in("purchase_return_id", prevIds);
      (prevItems ?? []).forEach((it: any) => {
        if (!it.product_id) return;
        prevByProduct[it.product_id] = (prevByProduct[it.product_id] ?? 0) + Number(it.quantity);
      });
    }

    // Stock for cap
    const productIds = ((sh as any).shipment_items ?? []).map((it: any) => it.product_id).filter(Boolean);
    let stockById: Record<string, number> = {};
    if (productIds.length) {
      const { data: prods } = await supabase.from("products").select("id, quantity").in("id", productIds);
      (prods ?? []).forEach((p: any) => { stockById[p.id] = Number(p.quantity ?? 0); });
    }

    const newLines: Line[] = ((sh as any).shipment_items ?? [])
      .filter((it: any) => it.product_id)
      .map((it: any) => {
        const recv = Number(it.quantity);
        const ret = prevByProduct[it.product_id] ?? 0;
        const inStock = stockById[it.product_id] ?? 0;
        const max = Math.max(0, Math.min(recv - ret, inStock));
        return {
          shipment_item_id: it.id,
          product_id: it.product_id,
          product_name: it.product_name,
          unit_cost: Number(it.cost_price),
          received_qty: recv,
          already_returned: ret,
          max_qty: max,
          quantity: max,
        };
      });

    setShipment(sh);
    setSupplier((sh as any).contacts ?? null);
    setLines(newLines);
    toast.success(`تم تحميل ${newLines.length} منتج من الفاتورة`);
  }, []);

  // Preload from URL ?shipment=
  useEffect(() => {
    if (presetShipmentId && !shipment) pickShipment(presetShipmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetShipmentId]);

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  const total = lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);

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
    if (!shipment) return toast.error("اختر فاتورة شراء أولاً");
    if (!supplier) return toast.error("الفاتورة بدون مورد");
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
    }

    setBusy(true);
    try {
      const refundMethodFinal = refundMode === "transfer" ? transferMethod : refundMode;
      const { data: pr, error } = await supabase.from("purchase_returns" as any).insert({
        branch_id: branchId,
        contact_id: supplier.id,
        shipment_id: shipment.id,
        reason: finalReason,
        notes: notes.trim() || null,
        created_by: user!.id,
        total_amount: total,
        status: asDraft ? "draft" : "active",
        refund_method: refundMethodFinal,
        refund_reference: refundRef.trim() || null,
        refund_account: refundAccount.trim() || null,
        refund_cash_amount: cashPart,
        refund_transfer_amount: transferPart,
        refund_balance_amount: balancePart,
      }).select().single();
      if (error || !pr) throw error ?? new Error("فشل الحفظ");
      const number = (pr as any).return_number as string;

      const items = activeLines.map((l) => ({
        purchase_return_id: (pr as any).id,
        product_id: l.product_id,
        product_name: l.product_name,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
        total: l.quantity * l.unit_cost,
      }));
      const { error: e2 } = await supabase.from("purchase_return_items" as any).insert(items);
      if (e2) throw e2;

      if (!asDraft) {
        // Inventory deduction (products + product_batches FIFO) is handled
        // by DB trigger `apply_purchase_return_item` on purchase_return_items insert.
        // No client-side quantity write — blocked by guard_products_quantity anyway.
        const cashIn = cashPart + transferPart;
        if (cashIn > 0) {
          await supabase.from("treasury").insert({
            branch_id: branchId!,
            type: "income",
            category: "purchase_return",
            amount: cashIn,
            description: `مرتجع شراء ${number} - ${supplier.name}`,
            reference_id: (pr as any).id,
            payment_method: refundMode === "mixed" && cashPart > 0 && transferPart > 0 ? "mixed" : refundMethodFinal,
            reference_number: refundRef.trim() || null,
            transfer_from_account: refundAccount.trim() || null,
            created_by: user!.id,
          } as any);
        }
        // Balance update is handled automatically by the DB trigger
        // trg_balance_purchase_returns → recalc_contact_balance.
        // No client-side write needed.
      }

      if (asDraft) {
        toast.success("تم حفظ المرتجع كمسودة");
        nav(`/branch/${branchId}/invoices?tab=purchase_return`);
      } else {
        toast.success("تم تسجيل مرتجع الشراء");
        setSavedNumber(number);
        setPrintOpen(true);
      }
    } catch (err: any) {
      toast.error(err.message ?? "فشل الحفظ");
    } finally {
      setBusy(false);
    }
  };

  // Shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        submit(false);
      } else if (e.key === "Escape" && !busy && !pickOpen) {
        nav(`/branch/${branchId}/invoices?tab=purchase_return`);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, lines, shipment, refundMode, cashPart, transferPart, balancePart, refundRef, finalReason, pickOpen]);

  const filteredShipments = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return shipments;
    return shipments.filter((r: any) =>
      [r.arrival_date, r.contacts?.name, r.contacts?.phone, r.notes].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [pickQuery, shipments]);

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
      <h2>إيصال مرتجع شراء</h2>
      <div class="meta">رقم: ${savedNumber}</div>
      <div class="meta">المورد: ${supplier?.name}</div>
      <div class="meta">التاريخ: ${formatDateTime(new Date().toISOString())}</div>
      <div class="meta">السبب: ${finalReason}</div>
      <table><thead><tr><th>المنتج</th><th>الكمية</th><th>التكلفة</th><th>الإجمالي</th></tr></thead><tbody>
        ${lines.filter((l) => l.quantity > 0).map((l) => `<tr><td>${l.product_name}</td><td>${l.quantity}</td><td>${formatEGP(l.unit_cost)}</td><td>${formatEGP(l.quantity * l.unit_cost)}</td></tr>`).join("")}
      </tbody></table>
      <div class="tot"><span>الإجمالي</span><span>${formatEGP(total)}</span></div>
      ${cashPart > 0 ? `<div class="meta">نقدي: ${formatEGP(cashPart)}</div>` : ""}
      ${transferPart > 0 ? `<div class="meta">تحويل: ${formatEGP(transferPart)} (${transferMethod})${refundRef ? " - " + refundRef : ""}</div>` : ""}
      ${balancePart > 0 ? `<div class="meta">على حساب المورد: ${formatEGP(balancePart)}</div>` : ""}
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(html); w.document.close();
  };

  return (
    <BranchLayout>
      <PageHeader title="مرتجع شراء جديد" subtitle="إرجاع بضاعة إلى المورد" />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Supplier + shipment link */}
          <div className="card-elevated p-4 space-y-3">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>المورد *</Label>
                <div className="mt-1.5 h-10 px-3 rounded-md border bg-muted/30 flex items-center text-sm">
                  {supplier?.name ?? "اختر الفاتورة لعرض المورد"}
                </div>
                {shipment && (
                  <div className="text-xs text-muted-foreground mt-2 flex gap-3 flex-wrap">
                    {supplier?.phone && <span dir="ltr">{supplier.phone}</span>}
                    {supplier && (
                      <span>الرصيد: <b className={Number(supplier.balance) > 0 ? "text-warning" : "text-success"}>{formatEGP(supplier.balance ?? 0)}</b></span>
                    )}
                    <span>فاتورة: <b>{shipment.arrival_date}</b></span>
                    <span>الإجمالي: <b className="text-primary">{formatEGP(shipment.total_cost)}</b></span>
                  </div>
                )}
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={() => setPickOpen(true)} className="gap-2 w-full">
                  <FileText className="w-4 h-4" /> {shipment ? "تغيير الفاتورة" : "اختيار من فاتورة شراء"}
                </Button>
              </div>
            </div>
            {shipment && (
              <div className="text-xs text-success flex items-center gap-1">
                <Link2 className="w-3 h-3" /> مرتبط بفاتورة شراء — المنتجات والأسعار اتملت تلقائياً
              </div>
            )}
          </div>

          {/* Lines (locked to shipment) */}
          <div className="card-elevated p-4">
            <Label className="mb-3 block">المنتجات المُرتجعة</Label>
            {!shipment ? (
              <div className="text-center text-sm text-muted-foreground py-8">اختر فاتورة لعرض المنتجات</div>
            ) : lines.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">لا توجد منتجات قابلة للإرجاع في هذه الفاتورة</div>
            ) : (
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={l.shipment_item_id ?? i} className="grid grid-cols-12 gap-2 items-center p-2 border rounded">
                    <div className="col-span-5 text-sm">
                      <div className="font-medium">{l.product_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        مستلم: {l.received_qty}
                        {l.already_returned > 0 && <> • مرتجع سابق: {l.already_returned}</>}
                        {" • "}<b>متاح للإرجاع: {l.max_qty}</b>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number"
                        min={0}
                        max={l.max_qty}
                        value={l.quantity}
                        disabled={l.max_qty === 0}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(l.max_qty, Number(e.target.value)));
                          updateLine(i, { quantity: v });
                        }}
                      />
                    </div>
                    <div className="col-span-3 text-sm text-muted-foreground text-center">
                      التكلفة: <b>{formatEGP(l.unit_cost)}</b>
                    </div>
                    <div className="col-span-2 text-sm text-center font-bold text-primary">
                      {formatEGP(l.quantity * l.unit_cost)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reason + notes */}
          <div className="card-elevated p-4 space-y-3">
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
                <Label>ملاحظات</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
              </div>
            </div>
          </div>

          {/* Refund mode */}
          <div className="card-elevated p-4 space-y-3">
            <Label>طريقة الاسترداد *</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {([
                { v: "cash" as RefundMode, lbl: "💵 استلام نقدي" },
                { v: "transfer" as RefundMode, lbl: "📱 تحويل" },
                { v: "balance" as RefundMode, lbl: "📒 على حساب المورد" },
                { v: "mixed" as RefundMode, lbl: "⚖️ مختلط" },
              ]).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setRefundMode(o.v)}
                  className={`text-sm px-3 py-2 rounded-md border ${refundMode === o.v ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
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
                  <Label className="text-xs">على حساب المورد</Label>
                  <Input type="number" step="0.01" value={balancePart} onChange={(e) => setBalancePart(Number(e.target.value))} className="mt-1.5" />
                </div>
                <div className={`md:col-span-3 text-xs ${mixedValid ? "text-success" : "text-destructive"} flex items-center gap-1`}>
                  {!mixedValid && <AlertTriangle className="w-3 h-3" />}
                  المجموع: {formatEGP(mixedSum)} / المطلوب: {formatEGP(total)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sticky summary */}
        <aside className="lg:sticky lg:top-4 self-start">
          <div className="card-elevated p-4 space-y-3">
            <div className="font-bold text-lg">ملخص المرتجع</div>
            <div className="flex justify-between text-sm"><span>عدد الأصناف</span><Badge variant="secondary">{lines.filter((l) => l.quantity > 0).length}</Badge></div>
            <div className="flex justify-between text-sm"><span>إجمالي الكمية</span><Badge variant="secondary">{lines.reduce((s, l) => s + l.quantity, 0)}</Badge></div>
            <div className="border-t pt-3 flex justify-between text-xl">
              <span>الإجمالي</span>
              <b className="text-primary">{formatEGP(total)}</b>
            </div>
            {refundMode === "balance" && supplier && total > 0 && (
              <div className="text-xs bg-warning/10 border border-warning/30 rounded p-2 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-warning" />
                <span>رصيد المورد هيتعدل من {formatEGP(supplier.balance ?? 0)} إلى {formatEGP(Number(supplier.balance ?? 0) - total)}</span>
              </div>
            )}
            <Button onClick={() => submit(false)} disabled={busy || total === 0 || !shipment} className="w-full gap-2" size="lg">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              حفظ مرتجع الشراء
            </Button>
            <Button onClick={() => submit(true)} disabled={busy || total === 0 || !shipment} variant="outline" className="w-full gap-2">
              <Save className="w-4 h-4" /> حفظ كمسودة
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">Ctrl+S للحفظ — Esc للإلغاء</p>
          </div>
        </aside>
      </div>

      {/* Shipment picker */}
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>اختر فاتورة شراء لإنشاء مرتجع</DialogTitle>
            <DialogDescription>كل مرتجع شراء لازم يكون مربوط بفاتورة موجودة.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="ابحث بالتاريخ أو اسم المورد أو رقم التليفون..."
            value={pickQuery}
            onChange={(e) => setPickQuery(e.target.value)}
            autoFocus
          />
          <div className="max-h-[420px] overflow-y-auto border border-border rounded-lg">
            {filteredShipments.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">مفيش فواتير مطابقة</div>
            ) : (
              filteredShipments.map((r: any) => (
                <button
                  key={r.id}
                  onClick={() => pickShipment(r.id)}
                  className="w-full flex items-center justify-between gap-3 p-3 border-b border-border last:border-b-0 hover:bg-accent text-right transition-colors"
                >
                  <div className="flex flex-col items-start gap-0.5">
                    <span className="font-mono font-bold text-primary">{r.arrival_date}</span>
                    <span className="text-xs text-muted-foreground">{r.contacts?.name ?? "—"}{r.contacts?.phone ? ` • ${r.contacts.phone}` : ""}</span>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-bold">{formatEGP(r.total_cost)}</span>
                    {r.notes && <span className="text-xs text-muted-foreground">{r.notes}</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Print dialog */}
      <Dialog open={printOpen} onOpenChange={(o) => { setPrintOpen(o); if (!o) nav(`/branch/${branchId}/invoices?tab=purchase_return`); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>طباعة إيصال المرتجع</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">تم حفظ مرتجع الشراء رقم {savedNumber}.</p>
          <DialogFooter className="gap-2 flex-row">
            <Button variant="outline" onClick={() => { setPrintOpen(false); nav(`/branch/${branchId}/invoices?tab=purchase_return`); }}>تخطي</Button>
            <Button variant="outline" onClick={() => printReceipt("thermal")} className="gap-2"><Printer className="w-4 h-4" />حرارية</Button>
            <Button onClick={() => printReceipt("a4")} className="gap-2"><Printer className="w-4 h-4" />A4</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
