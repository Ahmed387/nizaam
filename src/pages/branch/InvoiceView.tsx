import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { Printer, X, FileDown, Receipt, Bluetooth, Trash2, Pencil, Wallet } from "lucide-react";
import { printThermalReceipt, buildESCPOSReceipt, printRawESCPOS, isWebBluetoothSupported, getBluetoothConnection } from "@/lib/thermalPrinter";
import { EditInvoiceDialog } from "@/components/EditInvoiceDialog";
import { MultiMethodPaymentDialog } from "@/components/MultiMethodPaymentDialog";
import { CancelInvoiceDialog } from "@/components/CancelInvoiceDialog";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ThermalReceiptPrint } from "@/components/ThermalReceiptPrint";

export default function InvoiceView() {
  const { id, invoiceId } = useParams<{ id: string; invoiceId: string }>();
  const nav = useNavigate();
  const { user, profile, hasRole, isAdmin, tenant } = useAuth();
  const [inv, setInv] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [installments, setInstallments] = useState<any[]>([]);
  const [plan, setPlan] = useState<any>(null);
  const [branch, setBranch] = useState<any>(null);
  const [cashierName, setCashierName] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: i, error: e1 } = await supabase
          .from("invoices")
          .select("*, contacts:contact_id(name, phone, address, balance)")
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
        const { data: pp } = await supabase.from("payment_plans").select("*").eq("reference_type", "invoice").eq("reference_id", invoiceId).maybeSingle();
        setPlan(pp ?? null);
        if (pp?.id) {
          const { data: ins } = await supabase.from("payment_installments").select("*").eq("payment_plan_id", pp.id).order("installment_number");
          setInstallments(ins ?? []);
        }
        const { data: b } = await supabase.from("branches").select("*").eq("id", id).maybeSingle();
        setBranch(b);
      } catch (err: any) {
        console.error("Invoice load error:", err);
        setError(err.message ?? "تعذر تحميل الفاتورة");
      }
    })();
  }, [invoiceId, id]);

  // Realtime: refresh invoice/installments/contacts if anything changes
  useRealtimeRefresh(["invoices", "payment_installments", "contacts"], () => setReloadKey((k) => k + 1));
  useEffect(() => {
    if (!invoiceId) return;
    if (reloadKey === 0) return;
    (async () => {
      const { data: i } = await supabase.from("invoices").select("*, contacts:contact_id(name, phone, address, balance)").eq("id", invoiceId).maybeSingle();
      if (i) setInv(i);
      const { data: pp } = await supabase.from("payment_plans").select("*").eq("reference_type", "invoice").eq("reference_id", invoiceId).maybeSingle();
      setPlan(pp ?? null);
      if (pp?.id) {
        const { data: ins } = await supabase.from("payment_installments").select("*").eq("payment_plan_id", pp.id).order("installment_number");
        setInstallments(ins ?? []);
      }
    })();
  }, [reloadKey, invoiceId]);

  if (error) return <BranchLayout><div className="p-8 text-center text-destructive">⚠️ {error}</div></BranchLayout>;
  if (!inv) return <BranchLayout><div className="p-8 text-center">جاري التحميل...</div></BranchLayout>;

  const canCancel = (isAdmin || hasRole("branch_manager")) && inv.status === "active";
  const canDelete = isAdmin || hasRole("branch_manager");
  const canEdit = (isAdmin || hasRole("branch_manager")) && inv.status === "active";

  const hardDelete = async () => {
    setDeleting(true);
    const { error } = await supabase.rpc("hard_delete_invoice" as any, { _invoice_id: invoiceId! });
    if (error) { setDeleting(false); return toast.error(error.message); }
    await logAudit({ userId: user!.id, userName: profile!.name, branchId: id, action: "DELETE", entity: "Invoice", entityId: invoiceId, details: { invoice_number: inv.invoice_number } });
    toast.success("تم حذف الفاتورة نهائياً + رجعت البضاعة + اتشالت الفلوس من الخزنة");
    nav(`/branch/${id}/sales`);
  };

  const thermalData = () => ({
    storeName: tenant?.name ?? branch?.name ?? "",
    storePhone: branch?.phone ?? undefined,
    storeAddress: branch?.address ?? undefined,
    invoiceNumber: inv.invoice_number,
    dateTime: formatDateTime(inv.created_at),
    cashier: cashierName ?? undefined,
    customer: inv.contacts?.name ?? undefined,
    customerPhone: inv.contacts?.phone ?? undefined,
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
          <div className="flex gap-2 no-print flex-wrap">
            {canCancel && <Button variant="outline" onClick={() => setCancelOpen(true)}><X className="w-4 h-4 ml-1" /> إلغاء</Button>}
            {canEdit && <Button variant="outline" onClick={() => setEditOpen(true)} className="border-primary text-primary hover:bg-primary/10"><Pencil className="w-4 h-4 ml-1" /> تعديل</Button>}
            {canDelete && <Button variant="destructive" onClick={() => setDeleteOpen(true)}><Trash2 className="w-4 h-4 ml-1" /> حذف نهائي</Button>}
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

      <div className="print-area max-w-3xl mx-auto card-elevated p-8 bg-card">
        {/* Header: Seller info */}
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-border">
          <div className="text-right">
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
            {inv.contact_id ? (
              <a href={`/branch/${id}/customers/${inv.contact_id}`} className="font-bold text-primary hover:underline">
                {inv.contacts?.name ?? "عميل"}
              </a>
            ) : (
              <div className="font-bold">عميل نقدي</div>
            )}
            {inv.contacts?.phone && <div className="text-xs text-muted-foreground">☎ {inv.contacts.phone}</div>}
            {inv.contacts?.address && <div className="text-xs text-muted-foreground">📍 {inv.contacts.address}</div>}
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
          {Number((inv as any).vat_amount) > 0 && (
            <div className="flex justify-between">
              <span>ضريبة القيمة المضافة ({Number((inv as any).vat_rate)}%):</span>
              <span className="font-bold">+ {formatEGP(Number((inv as any).vat_amount))}</span>
            </div>
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

        {/* Payment summary: total / paid / remaining + installments schedule */}
        {(() => {
          const totalDue = Number(inv.total ?? 0);
          const paidNow = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
          const remaining = Math.max(totalDue - paidNow, 0);
          if (totalDue <= 0) return null;
          return (
            <div className="mt-4 p-4 rounded-lg border-2 border-primary/30 bg-primary/5">
              <div className="font-bold mb-3 text-primary">💳 ملخص الدفع</div>
              <div className="grid grid-cols-3 gap-3 text-center text-sm mb-3">
                <div className="bg-card rounded p-2 border border-border">
                  <div className="text-xs text-muted-foreground">إجمالي الفاتورة</div>
                  <div className="font-extrabold text-lg">{formatEGP(totalDue)}</div>
                </div>
                <div className="bg-card rounded p-2 border border-success/40">
                  <div className="text-xs text-muted-foreground">المدفوع الآن</div>
                  <div className="font-extrabold text-lg text-success">{formatEGP(paidNow)}</div>
                </div>
                <div className="bg-card rounded p-2 border border-warning/40">
                  <div className="text-xs text-muted-foreground">المتبقي (آجل)</div>
                  <div className="font-extrabold text-lg text-warning">{formatEGP(remaining)}</div>
                </div>
              </div>
              {remaining > 0.01 && inv.status !== "cancelled" && (
                <div className="no-print mb-3">
                  <Button onClick={() => setPayOpen(true)} className="btn-gradient w-full">
                    <Wallet className="w-4 h-4 ml-2" /> تسجيل دفعة من المتبقي ({formatEGP(remaining)})
                  </Button>
                </div>
              )}
              {installments.length > 0 && (
                <div>
                  <div className="text-sm font-bold mb-2">
                    📅 جدول الأقساط — {installments.length} قسط على مدار{" "}
                    {(() => {
                      const first = new Date(installments[0].due_date);
                      const last = new Date(installments[installments.length - 1].due_date);
                      const months = Math.max(1, Math.round((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 30)) + 1);
                      return `${months} شهر`;
                    })()}
                  </div>
                  <table className="w-full text-xs border border-border">
                    <thead>
                      <tr className="bg-surface-2">
                        <th className="p-2 text-right">#</th>
                        <th className="p-2 text-right">تاريخ الاستحقاق</th>
                        <th className="p-2 text-center">المبلغ</th>
                        <th className="p-2 text-center">المسدد</th>
                        <th className="p-2 text-left">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {installments.map((ins) => {
                        const st = ins.status === "paid" ? { label: "مدفوع", cls: "text-success" }
                          : ins.status === "partial" ? { label: "جزئي", cls: "text-warning" }
                          : ins.status === "cancelled" ? { label: "ملغي", cls: "text-muted-foreground line-through" }
                          : { label: "مستحق", cls: "text-muted-foreground" };
                        return (
                          <tr key={ins.id} className="border-t border-border">
                            <td className="p-2 font-mono">{ins.installment_number}</td>
                            <td className="p-2">{formatDateTime(ins.due_date).split(" ")[0]}</td>
                            <td className="p-2 text-center font-bold">{formatEGP(ins.amount)}</td>
                            <td className="p-2 text-center">{formatEGP(ins.paid_amount ?? 0)}</td>
                            <td className={`p-2 text-left font-semibold ${st.cls}`}>{st.label}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {installments.length === 0 && remaining > 0 && (
                <div className="text-xs text-muted-foreground text-center">
                  المبلغ المتبقي مسجل كآجل بدون جدول أقساط محدد.
                </div>
              )}
            </div>
          );
        })()}



        {inv.status === "cancelled" && (
          <div className="mt-4 p-3 bg-destructive/15 border border-destructive/30 rounded-lg text-destructive">
            <div className="font-bold text-center">❌ فاتورة ملغاة — السبب: {inv.cancel_reason}</div>
            {(inv.refund_amount > 0) && (
              <div className="text-xs text-center mt-1">
                تم رد {formatEGP(inv.refund_amount)} عن طريق {inv.refund_method === "cash" ? "الكاش" : "رصيد العميل"}
                {inv.cancelled_at ? ` — ${formatDateTime(inv.cancelled_at)}` : ""}
              </div>
            )}
          </div>
        )}

        <div className="mt-8 pt-4 border-t border-dashed border-border text-xs text-muted-foreground text-center">
          <div>تم إصدار هذه الفاتورة إلكترونياً بواسطة:</div>
          <div className="mt-1 font-bold text-foreground text-sm">✍️ {cashierName ?? "—"}</div>
          <div className="mt-1">بتاريخ {formatDateTime(inv.created_at)}</div>
          
        </div>

        <div className="text-center mt-6 text-sm text-muted-foreground">شكراً لتعاملكم معنا 🙏</div>
      </div>

      {/* Thermal 80mm print layout — hidden on screen, only shown when printing */}
      <ThermalReceiptPrint
        kind="sale"
        branchName={branch?.name}
        invoiceNumber={inv.invoice_number}
        createdAt={inv.created_at}
        paymentType={inv.payment_method}
        dueDate={inv.due_date}
        cashier={cashierName}
        partyName={inv.contacts?.name ?? (inv.contact_id ? null : "عميل نقدي")}
        notes={inv.notes}
        items={items.map((it: any) => ({
          name: it.product_name,
          qty: Number(it.quantity),
          unit_price: Number(it.selling_price ?? it.price ?? 0),
          total: Number(it.total ?? 0),
        }))}
        subtotal={Number(inv.subtotal ?? 0)}
        discount={Number(inv.discount_amount ?? 0)}
        total={Number(inv.total ?? 0)}
        paid={payments.reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0)}
        previousBalance={inv.contacts?.balance != null ? Number(inv.contacts.balance) + Number(inv.total ?? 0) : null}
        currentBalance={inv.contacts?.balance != null ? Number(inv.contacts.balance) : null}
        paymentMethodLabel={inv.payment_method}
      />

      <CancelInvoiceDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        invoice={inv}
        onDone={() => setReloadKey((k) => k + 1)}
      />


      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-destructive">حذف الفاتورة نهائياً</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="font-semibold">هتمسح الفاتورة <span className="font-mono text-primary">{inv.invoice_number}</span> نهائياً من النظام.</p>
            <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
              <li>كل البضاعة هترجع للمخزن تلقائياً</li>
              <li>أي فلوس اتقبضت هتتشال من الخزنة</li>
              <li>الأقساط والمدفوعات المرتبطة بالفاتورة هتتمسح</li>
              <li><b className="text-destructive">العملية دي مش بترجع — استخدمها بحذر</b></li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>تراجع</Button>
            <Button variant="destructive" onClick={hardDelete} disabled={deleting}>
              {deleting ? "جاري الحذف..." : "أوافق — احذف نهائياً"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditInvoiceDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        invoice={inv}
        branchId={id!}
        onSaved={() => location.reload()}
      />

      {(() => {
        const paidNow = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
        const remaining = Math.max(Number(inv.total ?? 0) - paidNow, 0);
        if (remaining <= 0.01) return null;
        if (plan?.id) {
          return (
            <MultiMethodPaymentDialog
              open={payOpen}
              onOpenChange={setPayOpen}
              mode={{ kind: "plan", planId: plan.id }}
              defaultAmount={remaining}
              direction="in"
              title="تسجيل دفعة من المتبقي"
              onSuccess={() => location.reload()}
            />
          );
        }
        if (inv.contact_id) {
          return (
            <MultiMethodPaymentDialog
              open={payOpen}
              onOpenChange={setPayOpen}
              mode={{ kind: "contact", contactId: inv.contact_id, branchId: id! }}
              defaultAmount={remaining}
              direction="in"
              title="تسجيل دفعة من المتبقي"
              onSuccess={() => location.reload()}
            />
          );
        }
        return null;
      })()}
    </BranchLayout>
  );
}
