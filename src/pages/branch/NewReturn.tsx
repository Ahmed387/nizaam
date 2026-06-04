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
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Loader2, Search, Plus, Minus, CheckSquare, Square, Printer, History, AlertTriangle, Camera, Save } from "lucide-react";
import { loadAllPaymentMethods, PaymentMethodOption, methodRequiresReference, methodAccountLabel } from "@/lib/paymentMethods";
import { BarcodeCameraScanner } from "@/components/BarcodeCameraScanner";

const COMMON_REASONS = [
  "منتج معيب / تالف",
  "لم يعجب العميل",
  "حجم / مقاس خطأ",
  "خطأ في الطلب",
  "تأخر التسليم",
  "أخرى",
];

export default function NewReturn() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const nav = useNavigate();

  const [invSearch, setInvSearch] = useState("");
  const [invoice, setInvoice] = useState<any>(null);
  const [customer, setCustomer] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [alreadyReturned, setAlreadyReturned] = useState<Record<string, number>>({});
  const [prevReturnsCount, setPrevReturnsCount] = useState(0);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reasonPick, setReasonPick] = useState("منتج معيب / تالف");
  const [reasonOther, setReasonOther] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  const [methodOptions, setMethodOptions] = useState<PaymentMethodOption[]>([]);
  const [refundMethod, setRefundMethod] = useState<string>("cash");
  const [refundRef, setRefundRef] = useState("");
  const [refundAccount, setRefundAccount] = useState("");

  const [recentOpen, setRecentOpen] = useState(false);
  const [recentInvoices, setRecentInvoices] = useState<any[]>([]);
  const [printOpen, setPrintOpen] = useState(false);
  const [lastReturnId, setLastReturnId] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [creditToBalance, setCreditToBalance] = useState(false);

  useEffect(() => {
    loadAllPaymentMethods().then((m) => setMethodOptions(m.filter((x) => x.is_enabled)));
  }, []);

  const loadInvoiceData = async (inv: any) => {
    if (inv.status !== "active") {
      toast.error("لا يمكن إرجاع فاتورة ملغاة");
      return;
    }
    setInvoice(inv);
    const [itRes, retRes, custRes] = await Promise.all([
      supabase.from("invoice_items").select("*").eq("invoice_id", inv.id),
      supabase.from("returns").select("id, return_items(product_id, quantity)").eq("invoice_id", inv.id),
      inv.customer_id
        ? supabase.from("customers").select("id, name, phone").eq("id", inv.customer_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);
    setItems(itRes.data ?? []);
    setCustomer(custRes.data ?? null);
    const ret: Record<string, number> = {};
    let count = 0;
    for (const r of (retRes.data as any[]) ?? []) {
      count++;
      for (const ri of r.return_items ?? []) {
        if (ri.product_id) ret[ri.product_id] = (ret[ri.product_id] ?? 0) + ri.quantity;
      }
    }
    setAlreadyReturned(ret);
    setPrevReturnsCount(count);
    setQty({});
  };

  const findInvoice = async () => {
    if (!invSearch.trim()) return;
    setSearching(true);
    const { data } = await supabase
      .from("invoices")
      .select("*")
      .eq("branch_id", branchId!)
      .eq("invoice_number", invSearch.trim())
      .maybeSingle();
    if (!data) {
      toast.error("لم يتم العثور على الفاتورة");
      setInvoice(null);
      setItems([]);
      setCustomer(null);
    } else {
      await loadInvoiceData(data);
    }
    setSearching(false);
  };

  const openRecent = async () => {
    setRecentOpen(true);
    const { data } = await supabase
      .from("invoices")
      .select("id, invoice_number, total, created_at, status, customers(name)")
      .eq("branch_id", branchId!)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(20);
    setRecentInvoices(data ?? []);
  };

  const remainingFor = (it: any) => {
    const sold = it.quantity;
    const ret = alreadyReturned[it.product_id ?? ""] ?? 0;
    return Math.max(0, sold - ret);
  };

  const displayedItems = useMemo(() => items.filter((it) => remainingFor(it) > 0), [items, alreadyReturned]);

  const totalRefund = items.reduce((s, it) => s + (qty[it.id] ?? 0) * Number(it.selling_price), 0);
  const totalQty = items.reduce((s, it) => s + (qty[it.id] ?? 0), 0);

  const allSelected = displayedItems.length > 0 && displayedItems.every((it) => (qty[it.id] ?? 0) === remainingFor(it));
  const toggleAll = () => {
    if (allSelected) setQty({});
    else {
      const next: Record<string, number> = {};
      displayedItems.forEach((it) => (next[it.id] = remainingFor(it)));
      setQty(next);
    }
  };

  const setLineQty = (it: any, v: number) => {
    const max = remainingFor(it);
    setQty({ ...qty, [it.id]: Math.max(0, Math.min(v, max)) });
  };

  const finalReason = reasonPick === "أخرى" ? reasonOther.trim() : reasonPick;

  const submit = async (asDraft = false) => {
    if (!invoice || busy) return;
    if (!finalReason) return toast.error("اذكر سبب الإرجاع");
    const selected = items.filter((it) => (qty[it.id] ?? 0) > 0);
    if (!selected.length) return toast.error("حدد كمية لمنتج واحد على الأقل");
    if (!asDraft && methodRequiresReference(refundMethod) && !creditToBalance && !refundRef.trim())
      return toast.error("أدخل رقم العملية");
    if (creditToBalance && !customer?.id)
      return toast.error("لا يمكن إضافة الرصيد لعميل نقدي");

    setBusy(true);
    try {
      const effectiveMethod = creditToBalance ? "balance" : refundMethod;
      const { data: ret, error } = await supabase
        .from("returns")
        .insert({
          branch_id: branchId!,
          invoice_id: invoice.id,
          reason: finalReason,
          notes: notes.trim() || null,
          total_refund: totalRefund,
          status: asDraft ? "draft" : "active",
          refund_method: effectiveMethod,
          refund_reference: refundRef.trim() || null,
          refund_account: refundAccount.trim() || null,
          refund_cash_amount: creditToBalance ? 0 : (refundMethod === "cash" ? totalRefund : 0),
          refund_transfer_amount: creditToBalance ? 0 : (refundMethod !== "cash" ? totalRefund : 0),
          refund_balance_amount: creditToBalance ? totalRefund : 0,
          created_by: user!.id,
        } as any)
        .select()
        .single();
      if (error) throw error;

      for (const it of selected) {
        const q = qty[it.id];
        await supabase.from("return_items").insert({
          return_id: ret.id,
          product_id: it.product_id,
          quantity: q,
          refund: q * Number(it.selling_price),
        });
        if (!asDraft && it.product_id) {
          const { data: p } = await supabase.from("products").select("quantity").eq("id", it.product_id).maybeSingle();
          if (p) await supabase.from("products").update({ quantity: (p.quantity ?? 0) + q }).eq("id", it.product_id);
        }
      }

      if (!asDraft) {
        if (creditToBalance && customer?.id) {
          const { data: c } = await supabase.from("customers").select("balance").eq("id", customer.id).maybeSingle();
          if (c) await supabase.from("customers").update({ balance: Number((c as any).balance ?? 0) + totalRefund } as any).eq("id", customer.id);
        } else {
          await supabase.from("treasury").insert({
            branch_id: branchId!,
            type: "expense",
            category: "return",
            amount: totalRefund,
            description: `مرتجع فاتورة ${invoice.invoice_number} - ${finalReason}`,
            reference_id: ret.id,
            payment_method: refundMethod,
            reference_number: refundRef.trim() || null,
            transfer_to_account: refundAccount.trim() || null,
            created_by: user!.id,
          } as any);
        }
      }

      await logAudit({
        userId: user!.id,
        userName: profile?.name ?? "",
        branchId,
        action: "CREATE",
        entity: "return",
        entityId: ret.id,
        details: { invoice: invoice.invoice_number, total: totalRefund, method: effectiveMethod, draft: asDraft },
      });

      if (asDraft) {
        toast.success("تم حفظ المرتجع كمسودة");
        nav(`/branch/${branchId}/invoices?tab=return`);
      } else {
        toast.success("تم تسجيل المرتجع");
        setLastReturnId(ret.id);
        setPrintOpen(true);
      }
    } catch (err: any) {
      toast.error(err.message ?? "فشل حفظ المرتجع");
    } finally {
      setBusy(false);
    }
  };

  // Keyboard shortcuts: Ctrl+S = save, Esc = cancel
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        submit(false);
      } else if (e.key === "Escape" && !busy) {
        if (invoice) {
          setInvoice(null); setItems([]); setCustomer(null); setQty({});
        } else {
          nav(`/branch/${branchId}/invoices?tab=return`);
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice, busy, qty, refundMethod, refundRef, creditToBalance, finalReason]);

  const printReceipt = (size: "thermal" | "a4") => {
    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>مرتجع ${invoice?.invoice_number}</title>
      <style>
        body{font-family:system-ui,Arial;padding:${size === "thermal" ? "8px" : "24px"};max-width:${size === "thermal" ? "80mm" : "210mm"};margin:auto}
        h2{margin:4px 0;text-align:center}
        table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
        td,th{border-bottom:1px dashed #999;padding:4px;text-align:right}
        .tot{font-weight:bold;font-size:16px;margin-top:8px;display:flex;justify-content:space-between}
        .meta{font-size:12px;color:#444;margin:4px 0}
      </style></head><body>
      <h2>إيصال مرتجع بيع</h2>
      <div class="meta">فاتورة: ${invoice?.invoice_number}</div>
      <div class="meta">العميل: ${customer?.name ?? "نقدي"}</div>
      <div class="meta">التاريخ: ${formatDateTime(new Date().toISOString())}</div>
      <div class="meta">السبب: ${finalReason}</div>
      <table><thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>
        ${items.filter((it) => (qty[it.id] ?? 0) > 0).map((it) => `<tr><td>${it.product_name}</td><td>${qty[it.id]}</td><td>${formatEGP(it.selling_price)}</td><td>${formatEGP(qty[it.id] * Number(it.selling_price))}</td></tr>`).join("")}
      </tbody></table>
      <div class="tot"><span>إجمالي المرتجع</span><span>${formatEGP(totalRefund)}</span></div>
      <div class="meta">طريقة الاسترداد: ${methodOptions.find((m) => m.value === refundMethod)?.label ?? refundMethod}</div>
      ${refundRef ? `<div class="meta">مرجع: ${refundRef}</div>` : ""}
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(html);
    w.document.close();
  };

  return (
    <BranchLayout>
      <PageHeader title="مرتجع جديد" subtitle="إرجاع منتجات من فاتورة بيع" />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Invoice search */}
          <div className="card-elevated p-4">
            <Label>رقم الفاتورة</Label>
            <div className="flex gap-2 mt-1.5">
              <Input
                placeholder="مثال: INV-2026-00001 — أو امسح الباركود/QR"
                value={invSearch}
                onChange={(e) => setInvSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && findInvoice()}
                autoFocus
              />
              <Button onClick={findInvoice} disabled={searching} className="gap-2">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                بحث
              </Button>
              <Button variant="outline" onClick={() => setCameraOpen(true)} className="gap-2" title="مسح QR">
                <Camera className="w-4 h-4" />
              </Button>
              <Button variant="outline" onClick={openRecent} className="gap-2">
                <History className="w-4 h-4" /> آخر الفواتير
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">اختصارات: Ctrl+S للحفظ — Esc للإلغاء</p>
          </div>

          {invoice && (
            <>
              {/* Invoice & customer card */}
              <div className="card-elevated p-4 grid md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-muted-foreground">رقم الفاتورة</div><b>{invoice.invoice_number}</b></div>
                <div><div className="text-muted-foreground">التاريخ</div><b>{formatDateTime(invoice.created_at)}</b></div>
                <div>
                  <div className="text-muted-foreground">العميل</div>
                  <b>{customer?.name ?? "نقدي"}</b>
                  {customer?.phone && <div className="text-xs text-muted-foreground" dir="ltr">{customer.phone}</div>}
                </div>
                <div>
                  <div className="text-muted-foreground">إجمالي الفاتورة</div>
                  <b className="text-primary">{formatEGP(invoice.total)}</b>
                </div>
                {prevReturnsCount > 0 && (
                  <div className="md:col-span-4 flex items-center gap-2 text-warning text-xs">
                    <AlertTriangle className="w-4 h-4" />
                    هذه الفاتورة عليها {prevReturnsCount} مرتجع سابق — المنتجات المُرتجعة كلها مخفية أو محسومة من المتاح
                  </div>
                )}
              </div>

              {/* Items table */}
              <div className="card-elevated overflow-hidden">
                <div className="flex items-center justify-between p-3 border-b border-border">
                  <div className="font-medium text-sm">المنتجات المتاحة للإرجاع</div>
                  <Button size="sm" variant="outline" onClick={toggleAll} className="gap-1.5">
                    {allSelected ? <Square className="w-4 h-4" /> : <CheckSquare className="w-4 h-4" />}
                    {allSelected ? "إلغاء تحديد الكل" : "إرجاع الكل"}
                  </Button>
                </div>
                {displayedItems.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">لا توجد منتجات متاحة للإرجاع</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead><tr className="bg-surface-2 border-b border-border">
                        <th className="px-4 py-2 text-right">المنتج</th>
                        <th className="px-4 py-2 text-right">المتاح</th>
                        <th className="px-4 py-2 text-right">سعر الوحدة</th>
                        <th className="px-4 py-2 text-right">كمية الإرجاع</th>
                        <th className="px-4 py-2 text-right">قيمة الإرجاع</th>
                      </tr></thead>
                      <tbody>
                        {displayedItems.map((it) => {
                          const max = remainingFor(it);
                          const v = qty[it.id] ?? 0;
                          return (
                            <tr key={it.id} className="border-b border-border">
                              <td className="px-4 py-2">{it.product_name}</td>
                              <td className="px-4 py-2">{max}{alreadyReturned[it.product_id ?? ""] > 0 && <span className="text-xs text-muted-foreground"> (مُرتجع: {alreadyReturned[it.product_id ?? ""]})</span>}</td>
                              <td className="px-4 py-2">{formatEGP(it.selling_price)}</td>
                              <td className="px-4 py-2 w-44">
                                <div className="flex items-center gap-1">
                                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setLineQty(it, v - 1)}><Minus className="w-3 h-3" /></Button>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={max}
                                    value={v}
                                    onChange={(e) => setLineQty(it, Number(e.target.value))}
                                    className="h-8 w-16 text-center"
                                  />
                                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setLineQty(it, v + 1)}><Plus className="w-3 h-3" /></Button>
                                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setLineQty(it, max)}>الكل</Button>
                                </div>
                              </td>
                              <td className="px-4 py-2 font-bold text-destructive">{formatEGP(v * Number(it.selling_price))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Reason + notes + refund */}
              <div className="card-elevated p-4 space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>سبب الإرجاع *</Label>
                    <Select value={reasonPick} onValueChange={setReasonPick}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>{COMMON_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                    </Select>
                    {reasonPick === "أخرى" && (
                      <Input value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} placeholder="اكتب السبب" className="mt-2" />
                    )}
                  </div>
                  <div>
                    <Label>طريقة الاسترداد *</Label>
                    <Select value={refundMethod} onValueChange={setRefundMethod}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>{methodOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                {methodRequiresReference(refundMethod) && (
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label>رقم العملية *</Label>
                      <Input value={refundRef} onChange={(e) => setRefundRef(e.target.value)} className="mt-1.5" placeholder="رقم التحويل المرجعي" />
                    </div>
                    <div>
                      <Label>{methodAccountLabel(refundMethod)}</Label>
                      <Input dir="ltr" className="text-right mt-1.5" value={refundAccount} onChange={(e) => setRefundAccount(e.target.value)} placeholder="حساب التحويل" />
                    </div>
                  </div>
                )}
                <div>
                  <Label>ملاحظات</Label>
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات إضافية..." className="mt-1.5" />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Sticky summary */}
        <aside className="lg:sticky lg:top-4 self-start">
          <div className="card-elevated p-4 space-y-3">
            <div className="font-bold text-lg">ملخص المرتجع</div>
            <div className="flex justify-between text-sm"><span>عدد الأصناف</span><Badge variant="secondary">{Object.values(qty).filter((v) => v > 0).length}</Badge></div>
            <div className="flex justify-between text-sm"><span>إجمالي الكمية</span><Badge variant="secondary">{totalQty}</Badge></div>
            <div className="flex justify-between text-sm"><span>طريقة الاسترداد</span><span className="text-xs">{methodOptions.find((m) => m.value === refundMethod)?.label ?? refundMethod}</span></div>
            <div className="border-t pt-3 flex justify-between text-xl">
              <span>المُسترد</span>
              <b className="text-destructive">{formatEGP(totalRefund)}</b>
            </div>
            <Button onClick={submit} disabled={!invoice || busy || totalRefund === 0} className="w-full gap-2" size="lg">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              تأكيد المرتجع
            </Button>
            {invoice && totalRefund === 0 && <p className="text-xs text-muted-foreground text-center">حدد كمية لمنتج واحد على الأقل</p>}
          </div>
        </aside>
      </div>

      {/* Recent invoices dialog */}
      <Dialog open={recentOpen} onOpenChange={setRecentOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>آخر 20 فاتورة</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-right p-2">الرقم</th><th className="text-right p-2">العميل</th><th className="text-right p-2">التاريخ</th><th className="text-right p-2">الإجمالي</th><th></th></tr></thead>
              <tbody>
                {recentInvoices.map((inv) => (
                  <tr key={inv.id} className="border-b">
                    <td className="p-2 font-mono">{inv.invoice_number}</td>
                    <td className="p-2">{inv.customers?.name ?? "نقدي"}</td>
                    <td className="p-2 text-xs">{formatDateTime(inv.created_at)}</td>
                    <td className="p-2">{formatEGP(inv.total)}</td>
                    <td className="p-2"><Button size="sm" onClick={() => { setRecentOpen(false); setInvSearch(inv.invoice_number); loadInvoiceData(inv); }}>اختيار</Button></td>
                  </tr>
                ))}
                {recentInvoices.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">لا توجد فواتير</td></tr>}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Print dialog after save */}
      <Dialog open={printOpen} onOpenChange={(o) => { setPrintOpen(o); if (!o) nav(`/branch/${branchId}/invoices?tab=return`); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>طباعة إيصال المرتجع</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">تم حفظ المرتجع. اختر شكل الطباعة:</p>
          <DialogFooter className="gap-2 flex-row">
            <Button variant="outline" onClick={() => { setPrintOpen(false); nav(`/branch/${branchId}/invoices?tab=return`); }}>تخطي</Button>
            <Button variant="outline" onClick={() => printReceipt("thermal")} className="gap-2"><Printer className="w-4 h-4" />فاتورة حرارية</Button>
            <Button onClick={() => printReceipt("a4")} className="gap-2"><Printer className="w-4 h-4" />A4</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
