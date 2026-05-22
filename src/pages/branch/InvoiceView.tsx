import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Printer, X, FileDown, Receipt, Bluetooth } from "lucide-react";
import { printThermalReceipt, buildESCPOSReceipt, printRawESCPOS, isWebBluetoothSupported, getBluetoothConnection } from "@/lib/thermalPrinter";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export default function InvoiceView() {
  const { id, invoiceId } = useParams<{ id: string; invoiceId: string }>();
  const { user, profile, hasRole, isAdmin, tenant } = useAuth();
  const [inv, setInv] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [branch, setBranch] = useState<any>(null);
  const [cashierName, setCashierName] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: i, error: e1 } = await supabase
          .from("invoices")
          .select("*, customers(name, phone, address)")
          .eq("id", invoiceId)
          .maybeSingle();
        if (e1) throw e1;
        if (!i) {
          setError("الفاتورة غير موجودة");
          return;
        }
        setInv(i);
        if (i.cashier_id) {
          const { data: cashier } = await supabase
            .from("profiles")
            .select("name")
            .eq("id", i.cashier_id)
            .maybeSingle();
          setCashierName(cashier?.name ?? null);
        }
        const { data: its } = await supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId);
        setItems(its ?? []);
        const { data: pays } = await supabase.from("invoice_payments").select("*").eq("invoice_id", invoiceId).order("created_at");
        setPayments(pays ?? []);
        const { data: b } = await supabase.from("branches").select("*").eq("id", id).maybeSingle();
        setBranch(b);
      } catch (err: any) {
        console.error("Invoice load error:", err);
        setError(err.message ?? "تعذر تحميل الفاتورة");
      }
    })();
  }, [invoiceId, id]);

  const cancel = async () => {
    if (!reason.trim()) return toast.error("سبب الإلغاء مطلوب");
    await supabase.from("invoices").update({ status: "cancelled", cancel_reason: reason }).eq("id", invoiceId);
    for (const it of items) {
      const { data: p } = await supabase.from("products").select("quantity").eq("id", it.product_id).single();
      if (p) await supabase.from("products").update({ quantity: p.quantity + it.quantity }).eq("id", it.product_id);
    }
    await supabase.from("treasury").insert({
      branch_id: id!, type: "expense", category: "sales", amount: inv.total,
      description: `إلغاء فاتورة ${inv.invoice_number}`, reference_id: invoiceId, created_by: user!.id,
    });
    await logAudit({ userId: user!.id, userName: profile!.name, branchId: id, action: "CANCEL", entity: "Invoice", entityId: invoiceId, details: { reason } });
    toast.success("تم إلغاء الفاتورة");
    setCancelOpen(false);
    location.reload();
  };

  if (error) return <BranchLayout><div className="p-8 text-center text-destructive">⚠️ {error}</div></BranchLayout>;
  if (!inv) return <BranchLayout><div className="p-8 text-center">جاري التحميل...</div></BranchLayout>;

  const canCancel = (isAdmin || hasRole("branch_manager")) && inv.status === "active";

  const thermalData = () => ({
    storeName: tenant?.name ?? branch?.name ?? "",
    storePhone: branch?.phone ?? undefined,
    storeAddress: branch?.address ?? undefined,
    invoiceNumber: inv.invoice_number,
    dateTime: formatDateTime(inv.created_at),
    cashier: cashierName ?? undefined,
    customer: inv.customers?.name ?? undefined,
    customerPhone: inv.customers?.phone ?? undefined,
    items: items.map((it: any) => ({
      name: it.product_name,
      qty: Number(it.quantity),
      price: Number(it.selling_price ?? it.price ?? 0),
      discount: Number(it.line_discount ?? 0) || undefined,
    })),
    subtotal: Number(inv.subtotal ?? 0),
    discount: Number(inv.discount_amount ?? 0) || undefined,
    total: Number(inv.total ?? 0),
    payments: payments.map((p: any) => ({ method: String(p.payment_method), amount: Number(p.amount), ref: p.reference_number ?? undefined })),
  });

  const printBluetooth = async () => {
    try {
      const bytes = buildESCPOSReceipt(thermalData());
      await printRawESCPOS(bytes);
      toast.success("تم إرسال الإيصال للطابعة");
    } catch (e: any) {
      toast.error(e.message ?? "فشل الاتصال بالطابعة");
    }
  };

  return (
    <BranchLayout>
      <PageHeader title={`فاتورة ${inv.invoice_number}`}
        actions={
          <div className="flex gap-2 no-print">
            {canCancel && <Button variant="outline" onClick={() => setCancelOpen(true)}><X className="w-4 h-4 ml-1" /> إلغاء</Button>}
            <Button variant="outline" onClick={() => window.print()}><FileDown className="w-4 h-4 ml-1" /> تحميل PDF</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="btn-gradient"><Printer className="w-4 h-4 ml-1" /> طباعة</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs">اختر نوع الطباعة</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => window.print()} className="gap-2">
                  <Printer className="w-4 h-4" /> طباعة عادية (A4)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => printThermalReceipt(thermalData(), 80)} className="gap-2">
                  <Receipt className="w-4 h-4" /> حرارية 80mm (USB/شبكة)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => printThermalReceipt(thermalData(), 58)} className="gap-2">
                  <Receipt className="w-4 h-4" /> حرارية 58mm (USB/شبكة)
                </DropdownMenuItem>
                {isWebBluetoothSupported() && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={printBluetooth} className="gap-2">
                      <Bluetooth className="w-4 h-4" />
                      {getBluetoothConnection() ? "إعادة طباعة بلوتوث" : "طابعة بلوتوث ESC/POS"}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
            <div className="text-xs text-muted-foreground mb-1">الجهة البائعة</div>
            <h2 className="text-2xl font-extrabold gradient-text">🏢 {tenant?.name ?? branch?.name}</h2>
            <p className="text-sm font-semibold mt-1">📍 فرع: {branch?.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{branch?.address ?? ""} {branch?.phone && `| ☎ ${branch.phone}`}</p>
          </div>
          <div className="text-left bg-primary/10 border border-primary/30 rounded-lg p-3">
            <div className="text-xs text-muted-foreground">رقم الفاتورة</div>
            <div className="font-mono font-extrabold text-primary text-lg">{inv.invoice_number}</div>
            <div className="text-xs text-muted-foreground mt-2">التاريخ</div>
            <div className="text-sm font-bold">{formatDateTime(inv.created_at)}</div>
          </div>
        </div>

        {/* Buyer + Cashier */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-surface-2 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">👤 الجهة المشترية (العميل)</div>
            {inv.customer_id ? (
              <a href={`/branch/${id}/customers/${inv.customer_id}`} className="font-bold text-primary hover:underline">
                {inv.customers?.name ?? "عميل"}
              </a>
            ) : (
              <div className="font-bold">عميل نقدي</div>
            )}
            {inv.customers?.phone && <div className="text-xs text-muted-foreground">☎ {inv.customers.phone}</div>}
            {inv.customers?.address && <div className="text-xs text-muted-foreground">📍 {inv.customers.address}</div>}
          </div>
          <div className="bg-surface-2 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">🧾 الكاشير المسؤول</div>
            <div className="font-bold">{cashierName ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">طريقة الدفع: {inv.payment_method === "cash" ? "نقدي" : inv.payment_method}</div>
          </div>
        </div>

        {/* Items */}
        <table className="w-full text-sm mb-6 border border-border">
          <thead>
            <tr className="bg-surface-2 border-b-2 border-border">
              <th className="text-right p-2">#</th>
              <th className="text-right p-2">المنتج</th>
              <th className="text-center p-2">الكمية</th>
              <th className="text-center p-2">سعر الوحدة</th>
              <th className="text-center p-2">خصم</th>
              <th className="text-left p-2">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id} className="border-b border-border">
                <td className="p-2 text-muted-foreground">{idx + 1}</td>
                <td className="p-2 font-medium">{it.product_name}</td>
                <td className="text-center p-2">{it.quantity}</td>
                <td className="text-center p-2">{formatEGP(it.selling_price)}</td>
                <td className="text-center p-2 text-destructive">{Number(it.line_discount) > 0 ? `- ${formatEGP(it.line_discount)}` : "—"}</td>
                <td className="text-left p-2 font-bold">{formatEGP(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="space-y-2 text-sm border-t-2 border-border pt-3">
          <div className="flex justify-between"><span>الإجمالي قبل الخصم:</span><span className="font-bold">{formatEGP(inv.subtotal)}</span></div>
          {Number(inv.discount_amount) > 0 && (
            <>
              <div className="flex justify-between text-destructive">
                <span>خصم ({inv.discount_percent}%):</span>
                <span className="font-bold">- {formatEGP(inv.discount_amount)}</span>
              </div>
              {inv.discount_reason && (
                <div className="text-xs text-muted-foreground">سبب الخصم: {inv.discount_reason}</div>
              )}
            </>
          )}
          <div className="flex justify-between text-lg pt-2 border-t border-border">
            <span className="font-bold">الإجمالي النهائي المستحق:</span>
            <span className="text-primary font-extrabold">{formatEGP(inv.total)}</span>
          </div>
        </div>

        {/* Payments breakdown */}
        {payments.length > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-surface-2 border border-border">
            <div className="font-bold mb-2">تفاصيل الدفع:</div>
            <div className="space-y-1 text-sm">
              {payments.map((p) => {
                const label = ({ cash: "كاش", visa: "فيزا", vodafone_cash: "فودافون كاش", instapay: "انستاباي", bank_transfer: "تحويل بنكي" } as any)[p.payment_method] ?? p.payment_method;
                return (
                  <div key={p.id} className="flex justify-between flex-wrap gap-2 pb-1 border-b border-dashed border-border/50">
                    <div>
                      <span className="font-semibold">{label}:</span> {formatEGP(p.amount)}
                      {p.received_by_name && <span className="text-xs text-muted-foreground"> — استلمها: {p.received_by_name}</span>}
                    </div>
                    {(p.reference_number || p.transfer_to_account) && (
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {p.transfer_to_account && `إلى: ${p.transfer_to_account} `}
                        {p.reference_number && `مرجع: #${p.reference_number}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {inv.status === "cancelled" && (
          <div className="mt-4 p-3 bg-destructive/15 border border-destructive/30 rounded-lg text-center text-destructive font-bold">
            ❌ فاتورة ملغاة — السبب: {inv.cancel_reason}
          </div>
        )}

        <div className="mt-8 pt-4 border-t border-dashed border-border text-xs text-muted-foreground text-center">
          <div>تم إصدار هذه الفاتورة إلكترونياً بواسطة:</div>
          <div className="mt-1 font-bold text-foreground text-sm">✍️ {cashierName ?? "—"}</div>
          <div className="mt-1">بتاريخ {formatDateTime(inv.created_at)}</div>
          
        </div>

        <div className="text-center mt-6 text-sm text-muted-foreground">شكراً لتعاملكم معنا 🙏</div>
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>إلغاء الفاتورة</DialogTitle></DialogHeader>
          <Textarea placeholder="سبب الإلغاء *" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>تراجع</Button>
            <Button variant="destructive" onClick={cancel}>تأكيد الإلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
