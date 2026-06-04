import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Link2, Printer, AlertTriangle, Camera, Save } from "lucide-react";
import { loadAllPaymentMethods, PaymentMethodOption, methodRequiresReference, methodAccountLabel } from "@/lib/paymentMethods";
import { BarcodeCameraScanner } from "@/components/BarcodeCameraScanner";

interface Line { product_id: string; product_name: string; quantity: number; unit_cost: number; max_qty: number; }

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
  const { user } = useAuth();
  const nav = useNavigate();

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [supplier, setSupplier] = useState<any>(null);
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [reasonPick, setReasonPick] = useState("منتج تالف / معيب");
  const [reasonOther, setReasonOther] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  // Refund
  const [methodOptions, setMethodOptions] = useState<PaymentMethodOption[]>([]);
  const [refundMode, setRefundMode] = useState<RefundMode>("cash");
  const [transferMethod, setTransferMethod] = useState<string>("vodafone");
  const [refundRef, setRefundRef] = useState("");
  const [refundAccount, setRefundAccount] = useState("");
  const [cashPart, setCashPart] = useState(0);
  const [transferPart, setTransferPart] = useState(0);
  const [balancePart, setBalancePart] = useState(0);

  // Shipment dialog
  const [shipmentOpen, setShipmentOpen] = useState(false);
  const [shipments, setShipments] = useState<any[]>([]);

  // Print dialog
  const [printOpen, setPrintOpen] = useState(false);
  const [savedNumber, setSavedNumber] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      const [s, p, m] = await Promise.all([
        supabase.from("suppliers").select("id, company_name, phone, balance").order("company_name"),
        supabase.from("products").select("id, name, sku, quantity, cost_price").eq("branch_id", branchId).gt("quantity", 0).order("name"),
        loadAllPaymentMethods(),
      ]);
      setSuppliers(s.data ?? []);
      setProducts(p.data ?? []);
      setMethodOptions((m ?? []).filter((x) => x.is_enabled && x.value !== "cash"));
    })();
  }, [branchId]);

  const openShipments = async () => {
    if (!supplier) return toast.error("اختر المورد أولاً");
    setShipmentOpen(true);
    const { data } = await supabase
      .from("shipments")
      .select("id, arrival_date, total_cost, notes, shipment_items(product_id, product_name, quantity, cost_price)")
      .eq("branch_id", branchId!)
      .eq("supplier_id", supplier.id)
      .order("arrival_date", { ascending: false })
      .limit(20);
    setShipments(data ?? []);
  };

  const useShipment = (ship: any) => {
    setShipmentId(ship.id);
    const newLines: Line[] = (ship.shipment_items ?? [])
      .filter((it: any) => it.product_id)
      .map((it: any) => {
        const p = products.find((x) => x.id === it.product_id);
        return {
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: Math.min(it.quantity, p?.quantity ?? 0),
          unit_cost: Number(it.cost_price),
          max_qty: p?.quantity ?? 0,
        };
      });
    setLines(newLines);
    setShipmentOpen(false);
    toast.success(`تم تحميل ${newLines.length} منتج من الفاتورة`);
  };

  const addLine = () => setLines([...lines, { product_id: "", product_name: "", quantity: 1, unit_cost: 0, max_qty: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const onProduct = (i: number, pid: string) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return;
    updateLine(i, { product_id: pid, product_name: p.name, unit_cost: Number(p.cost_price), max_qty: p.quantity });
  };

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q));
  }, [productSearch, products]);

  const total = lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);

  // Auto-adjust mixed parts
  useEffect(() => {
    if (refundMode === "cash") { setCashPart(total); setTransferPart(0); setBalancePart(0); }
    else if (refundMode === "transfer") { setCashPart(0); setTransferPart(total); setBalancePart(0); }
    else if (refundMode === "balance") { setCashPart(0); setTransferPart(0); setBalancePart(total); }
    // mixed: leave manual
  }, [refundMode, total]);

  const mixedSum = cashPart + transferPart + balancePart;
  const mixedValid = refundMode !== "mixed" || Math.abs(mixedSum - total) < 0.01;

  const finalReason = reasonPick === "أخرى" ? reasonOther.trim() : reasonPick;

  const submit = async (asDraft = false) => {
    if (busy) return;
    if (!supplier) return toast.error("اختر المورد");
    if (!finalReason) return toast.error("اكتب السبب");
    if (lines.length === 0) return toast.error("أضف منتج واحد على الأقل");
    for (const l of lines) {
      if (!l.product_id) return toast.error("اختر منتج لكل سطر");
      if (l.quantity <= 0) return toast.error("الكمية لازم تكون أكبر من صفر");
      if (l.quantity > l.max_qty) return toast.error(`الكمية أكبر من المتاح للمنتج ${l.product_name}`);
    }
    if (!asDraft) {
      if (!mixedValid) return toast.error("مجموع التوزيع لازم يساوي إجمالي المرتجع");
      const needsTransferRef = (refundMode === "transfer") || (refundMode === "mixed" && transferPart > 0);
      if (needsTransferRef && methodRequiresReference(transferMethod) && !refundRef.trim())
        return toast.error("أدخل رقم العملية للتحويل");
    }

    setBusy(true);
    try {
      const number = `PR-${Date.now().toString(36).toUpperCase()}`;
      const refundMethodFinal = refundMode === "transfer" ? transferMethod : refundMode;
      const { data: pr, error } = await supabase.from("purchase_returns" as any).insert({
        branch_id: branchId,
        supplier_id: supplier.id,
        shipment_id: shipmentId,
        return_number: number,
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

      const items = lines.map((l) => ({
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
        for (const l of lines) {
          const { data: p } = await supabase.from("products").select("quantity").eq("id", l.product_id).maybeSingle();
          if (p) await supabase.from("products").update({ quantity: Math.max(0, (p.quantity ?? 0) - l.quantity) }).eq("id", l.product_id);
        }
        const cashIn = cashPart + transferPart;
        if (cashIn > 0) {
          await supabase.from("treasury").insert({
            branch_id: branchId!,
            type: "income",
            category: "purchase_return",
            amount: cashIn,
            description: `مرتجع شراء ${number} - ${supplier.company_name}`,
            reference_id: (pr as any).id,
            payment_method: refundMode === "mixed" && cashPart > 0 && transferPart > 0 ? "mixed" : refundMethodFinal,
            reference_number: refundRef.trim() || null,
            transfer_from_account: refundAccount.trim() || null,
            created_by: user!.id,
          } as any);
        }
        if (balancePart > 0) {
          const newBal = Number(supplier.balance ?? 0) - balancePart;
          await supabase.from("suppliers").update({ balance: newBal }).eq("id", supplier.id);
        }
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

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        submit(false);
      } else if (e.key === "Escape" && !busy) {
        nav(`/branch/${branchId}/invoices?tab=purchase_return`);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, lines, supplier, refundMode, cashPart, transferPart, balancePart, refundRef, finalReason]);

  // Barcode → add line by SKU/name match
  const onBarcodeScan = (code: string) => {
    setCameraOpen(false);
    const p = products.find((x) => x.sku === code || x.name === code);
    if (!p) return toast.error(`لم يتم العثور على منتج بالكود: ${code}`);
    const existing = lines.findIndex((l) => l.product_id === p.id);
    if (existing >= 0) {
      updateLine(existing, { quantity: Math.min(lines[existing].quantity + 1, lines[existing].max_qty) });
    } else {
      setLines([...lines, { product_id: p.id, product_name: p.name, quantity: 1, unit_cost: Number(p.cost_price), max_qty: p.quantity }]);
    }
    toast.success(`تم إضافة ${p.name}`);
  };

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
      <div class="meta">المورد: ${supplier?.company_name}</div>
      <div class="meta">التاريخ: ${formatDateTime(new Date().toISOString())}</div>
      <div class="meta">السبب: ${finalReason}</div>
      <table><thead><tr><th>المنتج</th><th>الكمية</th><th>التكلفة</th><th>الإجمالي</th></tr></thead><tbody>
        ${lines.map((l) => `<tr><td>${l.product_name}</td><td>${l.quantity}</td><td>${formatEGP(l.unit_cost)}</td><td>${formatEGP(l.quantity * l.unit_cost)}</td></tr>`).join("")}
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
                <Select value={supplier?.id ?? ""} onValueChange={(v) => { setSupplier(suppliers.find((s) => s.id === v)); setShipmentId(null); }}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر المورد" /></SelectTrigger>
                  <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.company_name}</SelectItem>)}</SelectContent>
                </Select>
                {supplier && (
                  <div className="text-xs text-muted-foreground mt-2 flex gap-3">
                    {supplier.phone && <span dir="ltr">{supplier.phone}</span>}
                    <span>الرصيد: <b className={Number(supplier.balance) > 0 ? "text-warning" : "text-success"}>{formatEGP(supplier.balance ?? 0)}</b></span>
                  </div>
                )}
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={openShipments} disabled={!supplier} className="gap-2 w-full">
                  <Link2 className="w-4 h-4" /> اختيار من فاتورة شراء
                </Button>
              </div>
            </div>
            {shipmentId && (
              <div className="text-xs text-success flex items-center gap-1">
                <Link2 className="w-3 h-3" /> مرتبط بفاتورة شراء — المنتجات والأسعار اتملت تلقائياً
              </div>
            )}
          </div>

          {/* Lines */}
          <div className="card-elevated p-4">
            <div className="flex items-center justify-between mb-3 gap-2">
              <Label>المنتجات المُرتجعة</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="بحث منتج بالاسم/الكود..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="h-9 w-56"
                />
                <Button size="sm" variant="outline" onClick={addLine} className="gap-1"><Plus className="w-3 h-3" /> إضافة سطر</Button>
              </div>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 border rounded">
                  <div className="col-span-5">
                    <Select value={l.product_id} onValueChange={(v) => onProduct(i, v)}>
                      <SelectTrigger><SelectValue placeholder="منتج" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {filteredProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} (متاح: {p.quantity})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Input type="number" min={1} max={l.max_qty} value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} placeholder="كمية" />
                    {l.max_qty > 0 && <div className="text-[10px] text-muted-foreground mt-0.5">متاح: {l.max_qty}</div>}
                  </div>
                  <div className="col-span-3">
                    <Input type="number" step="0.01" value={l.unit_cost} onChange={(e) => updateLine(i, { unit_cost: Number(e.target.value) })} placeholder="التكلفة" />
                  </div>
                  <div className="col-span-1 text-sm text-muted-foreground text-center">{formatEGP(l.quantity * l.unit_cost)}</div>
                  <div className="col-span-1"><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></div>
                </div>
              ))}
              {lines.length === 0 && <div className="text-center text-sm text-muted-foreground py-6">أضف سطر أو استخدم "اختيار من فاتورة شراء"</div>}
            </div>
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
            <div className="flex justify-between text-sm"><span>عدد الأصناف</span><Badge variant="secondary">{lines.length}</Badge></div>
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
            <Button onClick={submit} disabled={busy || total === 0 || !supplier} className="w-full gap-2" size="lg">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              حفظ مرتجع الشراء
            </Button>
          </div>
        </aside>
      </div>

      {/* Shipment picker */}
      <Dialog open={shipmentOpen} onOpenChange={setShipmentOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>اختر فاتورة شراء — {supplier?.company_name}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {shipments.map((sh) => (
              <button key={sh.id} onClick={() => useShipment(sh)} className="w-full text-right border rounded p-3 hover:bg-muted">
                <div className="flex justify-between">
                  <span className="font-medium">{sh.arrival_date}</span>
                  <span className="text-primary font-bold">{formatEGP(sh.total_cost)}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{(sh.shipment_items ?? []).length} منتج {sh.notes ? `— ${sh.notes}` : ""}</div>
              </button>
            ))}
            {shipments.length === 0 && <div className="text-center text-muted-foreground py-6 text-sm">لا توجد فواتير شراء لهذا المورد</div>}
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
