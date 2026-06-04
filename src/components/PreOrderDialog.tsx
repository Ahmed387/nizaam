import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format";
import { Loader2, BookmarkPlus } from "lucide-react";

interface CatalogItem {
  id: string;
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
    supabase.from("contacts").select("id, name, phone").eq("branch_id", branchId).order("name").then(({ data }) => setCustomers(data ?? []));
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
        p_price_list_item_id: catalogItem.id,
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
      toast.success("تم تسجيل طلب الحجز");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BookmarkPlus className="w-5 h-5 text-primary" /> تسجيل طلب حجز</DialogTitle>
        </DialogHeader>

        {catalogItem && (
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <div className="font-bold">{catalogItem.product_name}</div>
            {catalogItem.model_code && <div className="text-xs text-muted-foreground">موديل: {catalogItem.model_code}</div>}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <Label className="text-xs">العميل (اختياري)</Label>
            <select className="w-full bg-input border border-border rounded-lg p-2 text-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— عميل جديد —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
            </select>
          </div>
          {!customerId && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">اسم العميل *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">تليفون</Label>
                <Input value={phone} dir="ltr" className="text-right" onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">الكمية</Label>
              <Input type="number" min="1" value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)} />
            </div>
            <div>
              <Label className="text-xs">السعر المتوقع للوحدة</Label>
              <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">العربون (اختياري)</Label>
              <Input type="number" min="0" step="0.01" value={deposit} onChange={(e) => setDeposit(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">طريقة الدفع</Label>
              <select className="w-full bg-input border border-border rounded-lg p-2 text-sm h-10" value={payment} onChange={(e) => setPayment(e.target.value)}>
                <option value="cash">كاش</option>
                <option value="visa">فيزا</option>
                <option value="vodafone_cash">فودافون كاش</option>
                <option value="instapay">انستاباي</option>
                <option value="bank_transfer">تحويل بنكي</option>
              </select>
            </div>
          </div>

          {deposit > 0 && payment !== "cash" && (
            <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-surface-2 border border-border">
              <div className="col-span-2 text-xs text-muted-foreground">بيانات التحويل / الدفع الإلكتروني</div>
              <div>
                <Label className="text-xs">رقم المرجع *</Label>
                <Input value={refNum} dir="ltr" className="text-right" onChange={(e) => setRefNum(e.target.value)} placeholder="رقم العملية" />
              </div>
              <div>
                <Label className="text-xs">حُوّل إلى حساب</Label>
                <Input value={transferAccount} dir="ltr" className="text-right" onChange={(e) => setTransferAccount(e.target.value)} placeholder="رقم/اسم الحساب" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">المستلم في الفرع</Label>
                <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="اسم المستلم" />
              </div>
            </div>
          )}

          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">الإجمالي</span><span className="font-bold">{formatEGP(total)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">العربون</span><span className="text-success font-bold">{formatEGP(deposit)}</span></div>
            <div className="flex justify-between"><span className="font-bold">المتبقي عند الاستلام</span><span className="text-primary font-extrabold">{formatEGP(remaining)}</span></div>
            {deposit === 0 && (
              <div className="text-[11px] px-2 py-1 rounded bg-warning/10 text-warning border border-warning/30 text-center font-bold">حجز بدون عربون</div>
            )}
          </div>

          <div>
            <Label className="text-xs">ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>إلغاء</Button>
          <Button className="btn-gradient" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد الحجز"}
          </Button>
        </DialogFooter>
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
