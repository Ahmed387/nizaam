import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";
import { Loader2, BookmarkPlus, ChevronDown } from "lucide-react";
import { FinancialAmount } from "@/components/FinancialAmount";

interface CatalogItem {
  id?: string | null;
  product_name: string;
  model_code?: string | null;
  display_price: number;
}

export function PreOrderDialog({
  open,
  onOpenChange,
  branchId,
  catalogItem,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string;
  catalogItem: CatalogItem | null;
  onCreated?: (preOrderId: string) => void;
}) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [deposit, setDeposit] = useState(0);
  const [payment, setPayment] = useState("cash");
  const [refNum, setRefNum] = useState("");
  const [transferAccount, setTransferAccount] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCustomerId(""); setName(""); setPhone("");
    setQty(1); setDeposit(0); setNotes(""); setPayment("cash");
    setRefNum(""); setTransferAccount(""); setReceivedBy("");
    setPrice(Number(catalogItem?.display_price ?? 0));
    supabase.from("contacts").select("id, name, phone").eq("is_archived", false).eq("branch_id", branchId).order("name").then(({ data }) => setCustomers(data ?? []));
  }, [open, catalogItem, branchId]);

  const total = qty * price;
  const remaining = Math.max(0, total - deposit);

  const submit = async () => {
    if (!catalogItem) return;
    let custName = name.trim();
    let custPhone = phone.trim();
    if (customerId) {
      const c = customers.find((x) => x.id === customerId);
      if (c) { custName = c.name; custPhone = c.phone ?? ""; }
    }
    if (!custName) return toast.error("اكتب اسم العميل");
    if (qty < 1) return toast.error("كمية غير صحيحة");
    if (deposit < 0 || deposit > total) return toast.error("مبلغ العربون غير صحيح");
    if (deposit > 0 && payment !== "cash" && !refNum.trim()) return toast.error("أدخل رقم المرجع/التحويل لطريقة الدفع الإلكترونية");

    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_pre_order", {
        p_branch_id: branchId,
        p_customer_id: customerId || null,
        p_customer_name: custName,
        p_customer_phone: custPhone || null,
        p_price_list_item_id: catalogItem.id ?? null,
        p_product_name: catalogItem.product_name,
        p_model_code: catalogItem.model_code ?? null,
        p_quantity: qty,
        p_expected_price: price,
        p_deposit_amount: deposit,
        p_payment_method: payment,
        p_notes: notes || null,
        p_reference_number: refNum.trim() || null,
        p_transfer_to_account: transferAccount.trim() || null,
        p_received_by_name: receivedBy.trim() || null,
      });
      if (error) throw error;
      toast.success("تم الحجز بنجاح");
      onCreated?.(data as string);
      printReceipt({
        product: catalogItem.product_name + (catalogItem.model_code ? ` (${catalogItem.model_code})` : ""),
        customer: custName, phone: custPhone, qty, price, deposit, remaining, notes,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const selectCls =
    "w-full appearance-none bg-background border border-border rounded-xl px-4 py-3 pr-10 text-sm text-foreground outline-none transition-all focus:ring-2 focus:ring-primary/20 focus:border-primary";
  const inputCls =
    "w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground outline-none transition-all focus:ring-2 focus:ring-primary/20 focus:border-primary";
  const softInputCls =
    "w-full bg-muted/50 border-none rounded-lg px-3 py-2.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-w-lg p-0 gap-0 overflow-hidden rounded-3xl max-h-[92vh] flex flex-col"
      >
        <DialogHeader className="px-6 py-5 border-b border-border shrink-0">
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <BookmarkPlus className="w-5 h-5 text-primary" />
            تسجيل طلب حجز
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Product header */}
          {catalogItem && (
            <div className="bg-muted/40 rounded-2xl p-4 border border-border flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-bold text-foreground text-base leading-tight truncate">{catalogItem.product_name}</h3>
                {catalogItem.model_code && (
                  <p className="text-[11px] text-muted-foreground mt-1 font-mono uppercase tracking-wider truncate">
                    موديل: {catalogItem.model_code}
                  </p>
                )}
              </div>
              <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-semibold rounded-full shrink-0">طلب حجز</span>
            </div>
          )}

          {/* Customer */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">
              العميل <span className="text-muted-foreground/70 text-xs font-normal">(اختياري)</span>
            </Label>
            <div className="relative">
              <select
                className={selectCls}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">— عميل جديد —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {!customerId && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">اسم العميل *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">تليفون</Label>
                <Input value={phone} dir="ltr" className={`${inputCls} text-right`} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
          )}

          {/* Qty & Price */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">الكمية</Label>
              <Input
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(parseInt(e.target.value) || 1)}
                className={`${inputCls} font-medium`}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">السعر المتوقع للوحدة</Label>
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                  className={`${inputCls} pl-12 font-medium`}
                />
                <span className="absolute inset-y-0 left-4 flex items-center text-muted-foreground text-xs pointer-events-none">جنيه</span>
              </div>
            </div>
          </div>

          {/* Payment card */}
          <div className="p-5 border border-border rounded-2xl bg-card space-y-4 shadow-sm">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">بيانات الدفع والتحويل</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">طريقة الدفع</Label>
                <div className="relative">
                  <select className={`${softInputCls} pr-9 h-10 appearance-none`} value={payment} onChange={(e) => setPayment(e.target.value)}>
                    <option value="cash">كاش</option>
                    <option value="visa">فيزا</option>
                    <option value="vodafone_cash">فودافون كاش</option>
                    <option value="instapay">انستاباي</option>
                    <option value="bank_transfer">تحويل بنكي</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  العربون <span className="text-muted-foreground/70">(اختياري)</span>
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={deposit}
                  onChange={(e) => setDeposit(parseFloat(e.target.value) || 0)}
                  className={softInputCls}
                />
              </div>

              {deposit > 0 && payment !== "cash" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">رقم المرجع *</Label>
                    <Input value={refNum} dir="ltr" className={`${softInputCls} text-right`} onChange={(e) => setRefNum(e.target.value)} placeholder="رقم العملية" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">حُوّل إلى حساب</Label>
                    <Input value={transferAccount} dir="ltr" className={`${softInputCls} text-right`} onChange={(e) => setTransferAccount(e.target.value)} placeholder="رقم/اسم الحساب" />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs font-medium text-muted-foreground">المستلم في الفرع</Label>
                    <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className={softInputCls} placeholder="اسم المستلم" />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Totals */}
          <div className="bg-primary rounded-2xl p-6 text-primary-foreground shadow-lg">
            <div className="space-y-3">
              <div className="flex justify-between items-center text-primary-foreground/80">
                <span className="text-sm">الإجمالي</span>
                <span className="font-bold text-lg">{formatEGP(total)}</span>
              </div>
              <div className="flex justify-between items-center text-emerald-300">
                <span className="text-sm">العربون</span>
                <span className="font-bold">- {formatEGP(deposit)}</span>
              </div>
              <div className="pt-3 mt-1 border-t border-primary-foreground/20 flex justify-between items-center">
                <span className="text-sm font-medium">المتبقي عند الاستلام</span>
                <FinancialAmount value={remaining} size="md" className="justify-end font-black text-primary-foreground" currencyClassName="text-primary-foreground/80" />
              </div>
              {deposit === 0 && (
                <div className="text-[11px] px-2 py-1.5 rounded-lg bg-warning/20 text-warning-foreground border border-warning/30 text-center font-bold">
                  حجز بدون عربون
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">ملاحظات إضافية</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أضف أي تفاصيل أخرى هنا..."
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-muted/40 border-t border-border flex items-center gap-3 shrink-0">
          <Button
            className="flex-1 h-12 rounded-xl font-bold btn-gradient shadow-lg"
            onClick={submit}
            disabled={busy}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد طلب الحجز"}
          </Button>
          <Button
            variant="ghost"
            className="h-12 px-6 rounded-xl font-medium"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            إلغاء
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function printReceipt(d: { product: string; customer: string; phone?: string; qty: number; price: number; deposit: number; remaining: number; notes?: string }) {
  const w = window.open("", "_blank", "width=380,height=600");
  if (!w) return;
  w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>إيصال حجز</title>
  <style>body{font-family:system-ui,sans-serif;padding:16px;font-size:13px}h2{margin:0 0 8px;text-align:center}hr{border:0;border-top:1px dashed #999;margin:8px 0}.row{display:flex;justify-content:space-between;margin:4px 0}strong{font-size:15px}</style>
  </head><body>
  <h2>إيصال طلب حجز</h2><hr>
  <div class="row"><span>العميل</span><strong>${d.customer}</strong></div>
  ${d.phone ? `<div class="row"><span>تليفون</span><span dir="ltr">${d.phone}</span></div>` : ""}
  <div class="row"><span>المنتج</span><strong>${d.product}</strong></div>
  <div class="row"><span>الكمية</span><span>${d.qty}</span></div>
  <div class="row"><span>السعر المتوقع</span><span>${d.price.toFixed(2)} ج</span></div>
  <hr>
  <div class="row"><span>العربون المدفوع</span><strong>${d.deposit.toFixed(2)} ج</strong></div>
  <div class="row"><span>المتبقي</span><strong>${d.remaining.toFixed(2)} ج</strong></div>
  ${d.notes ? `<hr><div>ملاحظات: ${d.notes}</div>` : ""}
  <hr>
  <div style="text-align:center;font-size:11px;color:#666">${new Date().toLocaleString("ar-EG")}</div>
  <script>window.print();setTimeout(()=>window.close(),300)</script>
  </body></html>`);
  w.document.close();
}
