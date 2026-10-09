import { fetchContactBalance } from "@/lib/contactBalances";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { sideBalanceLabel, fetchDocumentStatus, fetchContactStatement, type DocumentStatus } from "@/lib/ledger";
import { Printer, X, FileDown, Pencil, Wallet, CheckCircle2, Clock, CircleDashed } from "lucide-react";
import { EditInvoiceDialog } from "@/components/EditInvoiceDialog";
import { MultiMethodPaymentDialog } from "@/components/MultiMethodPaymentDialog";
import { CancelInvoiceDialog } from "@/components/CancelInvoiceDialog";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { ThermalReceiptPrint, printThermalInvoice } from "@/components/ThermalReceiptPrint";
import { RecordAttachments } from "@/components/RecordAttachments";
import { EditableInvoiceDate } from "@/components/EditableInvoiceDate";
import { ColorChip } from "@/components/ColorPicker";
import { computePayState, PaymentStatusBadge } from "@/components/PaymentStatusBadge";
import { VariantLine } from "@/components/VariantChips";

export default function InvoiceView() {
  const { id, invoiceId } = useParams<{ id: string; invoiceId: string }>();
  const nav = useNavigate();
  const { hasRole, isAdmin, tenant } = useAuth();
  const [inv, setInv] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [ledger, setLedger] = useState<DocumentStatus | null>(null);
  const [installments, setInstallments] = useState<any[]>([]);
  const [plan, setPlan] = useState<any>(null);
  const [branch, setBranch] = useState<any>(null);
  const [cashierName, setCashierName] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [error, setError] = useState<string | null>(null);

  // Customer balance around this invoice, live from the customer side of the unified ledger (the stored
  // previous/current snapshot of old invoices was netted with the supplier side, so it is not shown).
  const [liveBal, setLiveBal] = useState<{ prev: number; curr: number } | null>(null);
  useEffect(() => {
    if (!inv?.contact_id || !inv?.id) { setLiveBal(null); return; }
    let cancelled = false;
    // company-wide for admins; branch staff see this branch's customer statement
    fetchContactStatement(inv.contact_id, "customer", isAdmin ? null : inv.branch_id).then((lines) => {
      if (cancelled) return;
      const row = lines.find((r) => r.doc_type === "invoice" && r.doc_id === inv.id);
      if (!row) { setLiveBal(null); return; }
      setLiveBal({ curr: row.balance, prev: Math.round((row.balance - row.debit + row.credit) * 100) / 100 });
    }).catch(() => { if (!cancelled) setLiveBal(null); });
    return () => { cancelled = true; };
  }, [inv?.contact_id, inv?.id, inv?.branch_id, inv?.total, isAdmin, reloadKey]);

  useEffect(() => {
    (async () => {
      try {
        const { data: i, error: e1 } = await supabase
          .from("invoices")
          .select("*, contacts:contact_id(name, phone, address)")
          .eq("id", invoiceId)
          .maybeSingle();
        if (e1) throw e1;
        if (!i) {
          setError("الفاتورة غير موجودة");
          return;
        }
        // customer side of the unified ledger (no netting with a supplier side)
        if ((i as any).contact_id) {
          
          const bal = await fetchContactBalance((i as any).contact_id);
          if ((i as any).contacts) (i as any).contacts.balance = bal;
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
        // voided payments, their reversal rows and old netting rows are not payments of this invoice
        setPayments((pays ?? []).filter((p: any) => !p.voided_at && !p.reverses_payment_id && p.payment_method !== "settlement"));
        setLedger((await fetchDocumentStatus("invoice", [invoiceId!]).catch(() => new Map())).get(invoiceId!) ?? null);
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
  useRealtimeRefresh(["invoices", "invoice_payments", "payment_plans", "payment_installments", "payment_transactions", "contacts"], () => setReloadKey((k) => k + 1));
  useEffect(() => {
    if (!invoiceId) return;
    if (reloadKey === 0) return;
    (async () => {
      const { data: i } = await supabase.from("invoices").select("*, contacts:contact_id(name, phone, address)").eq("id", invoiceId).maybeSingle();
      if (i) {
        // TODO Phase 2.2B: Remove after contacts.balance column is dropped
        if ((i as any).contact_id) {
          
          const bal = await fetchContactBalance((i as any).contact_id);
          if ((i as any).contacts) (i as any).contacts.balance = bal;
        }
        setInv(i);
      }
      const { data: pays } = await supabase.from("invoice_payments").select("*").eq("invoice_id", invoiceId).order("created_at");
      setPayments((pays ?? []).filter((p: any) => !p.voided_at && !p.reverses_payment_id && p.payment_method !== "settlement"));
      setLedger((await fetchDocumentStatus("invoice", [invoiceId!]).catch(() => new Map())).get(invoiceId!) ?? null);
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
  const canEdit = (isAdmin || hasRole("branch_manager")) && inv.status === "active";

  return (
    <BranchLayout>
      <PageHeader title={`فاتورة ${inv.invoice_number}`}
        actions={
          <div className="flex gap-2 no-print flex-wrap items-center">
            {canEdit && <Button variant="outline" onClick={() => nav(`/branch/${id}/sales/${invoiceId}/edit`)} className="border-primary text-primary hover:bg-primary/10"><Pencil className="w-4 h-4 ml-1" /> التعديل على الفاتورة</Button>}
            <Button className="btn-gradient" onClick={printThermalInvoice}><Printer className="w-4 h-4 ml-1" /> طباعة الفاتورة</Button>
            {canCancel && (
              <Button
                variant="outline"
                onClick={() => setCancelOpen(true)}
                className="border-warning text-warning hover:bg-warning/10"
              >
                <X className="w-4 h-4 ml-1" /> إلغاء الفاتورة
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={printThermalInvoice} title="تحميل PDF"><FileDown className="w-4 h-4" /></Button>
          </div>
        }
      />

      <div className="print-area max-w-3xl mx-auto card-elevated p-8 bg-card relative overflow-hidden">
        {/* Payment status ribbon — real-time */}
        {inv.status === "active" && (() => {
          const total = Number(inv.total ?? 0);
          const paidFromInvoicePayments = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
          const paidFromPlan = plan ? Number(plan.paid_amount ?? 0) : 0;
          const paidNow = Math.max(paidFromInvoicePayments, paidFromPlan);
          const state = computePayState(total, paidNow);
          const barColor =
            state === "paid" ? "bg-success" : state === "partial" ? "bg-warning" : "bg-muted-foreground/30";
          const remaining = Math.max(total - paidNow, 0);
          const stateStyles =
            state === "paid"
              ? "bg-success/10 border-success/40 text-success"
              : state === "partial"
              ? "bg-warning/10 border-warning/40 text-warning"
              : "bg-muted border-border text-muted-foreground";
          const StateIcon = state === "paid" ? CheckCircle2 : state === "partial" ? Clock : CircleDashed;
          const stateLabel = state === "paid" ? "مدفوعة بالكامل" : state === "partial" ? "دفع جزئي" : "غير مدفوعة";
          return (
            <>
              <div className={`absolute top-0 right-0 bottom-0 w-2 ${barColor} no-print`} aria-hidden />
              <div className={`no-print mb-5 rounded-2xl border-2 ${stateStyles} px-4 py-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2`}>
                <div className="flex items-center gap-2">
                  <StateIcon className="w-5 h-5" />
                  <span className="text-base font-extrabold">{stateLabel}</span>
                </div>
                {state !== "unpaid" && total > 0 && (
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">
                      المدفوع: <span className="text-success font-extrabold tabular-nums" dir="ltr">{formatEGP(paidNow)}</span>
                    </span>
                    {state !== "paid" && (
                      <span className="text-muted-foreground">
                        المتبقي: <span className="text-warning font-extrabold tabular-nums" dir="ltr">{formatEGP(remaining)}</span>
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      الإجمالي: <span className="text-foreground font-extrabold tabular-nums" dir="ltr">{formatEGP(total)}</span>
                    </span>
                  </div>
                )}
              </div>
            </>
          );
        })()}
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
            <div className="text-xs text-muted-foreground mt-2">تاريخ الفاتورة</div>
            <div className="text-sm font-bold"><EditableInvoiceDate table="invoices" recordId={inv.id} value={inv.invoice_date} fallback={inv.created_at} readOnly onSaved={(d) => setInv({ ...inv, invoice_date: d })} /></div>
            <div className="text-[10px] text-muted-foreground mt-1.5">تاريخ الإدخال: {formatDateTime(inv.created_at)}</div>
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
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-20" />
            <col className="w-28" />
            <col className="w-24" />
            <col className="w-28" />
          </colgroup>
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
                <td className="p-2 font-medium align-middle">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      dir="auto"
                      className="leading-relaxed whitespace-normal [overflow-wrap:normal] [word-break:normal] [unicode-bidi:plaintext]"
                    >
                      {it.product_name}
                    </span>
                    {it.color && <ColorChip name={it.color} />}
                  </div>
                  <VariantLine attrs={{ ...(it as any), color: null }} className="block mt-0.5" />
                </td>

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

        {/* Customer balance before / after this invoice — customer side of the unified ledger */}
        {inv.contact_id && liveBal && (() => {
          const prev = liveBal.prev;
          const curr = liveBal.curr;
          const prevLbl = sideBalanceLabel("customer", prev);
          const currLbl = sideBalanceLabel("customer", curr);
          return (
            <div className="mt-4 p-3 rounded-lg border border-border bg-surface-2/40">
              <div className="font-bold text-sm mb-2">📒 حساب العميل (قبل وبعد الفاتورة)</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-card p-2 rounded border border-border">
                  <div className="text-xs text-muted-foreground">الرصيد السابق</div>
                  <div className="font-bold">{formatEGP(prevLbl.amount)}</div>
                  <div className={`text-xs ${prevLbl.tone === "good" ? "text-success" : prevLbl.tone === "bad" ? "text-destructive" : "text-muted-foreground"}`}>{prevLbl.label}</div>
                </div>
                <div className="bg-card p-2 rounded border border-border">
                  <div className="text-xs text-muted-foreground">الرصيد بعد الفاتورة</div>
                  <div className="font-bold">{formatEGP(currLbl.amount)}</div>
                  <div className={`text-xs ${currLbl.tone === "good" ? "text-success" : currLbl.tone === "bad" ? "text-destructive" : "text-muted-foreground"}`}>{currLbl.label}</div>
                </div>
              </div>
            </div>
          );
        })()}


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
          // المدفوع والمتبقي من الدفتر الموحد: دفعات الفاتورة + التحصيلات العامة والإيداعات (الأقدم أولاً،
          // من أي فرع) + رصيد المرتجعات. لو الفاتورة قبل 2026 (أرشيف) أو الدفتر مش متاح: دفعات الفاتورة نفسها.
          const ownPaid = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
          const useLedger = !!ledger && ledger.state !== "before_ledger" && ledger.state !== "cancelled";
          const paidNow = useLedger ? ledger!.paid : Math.max(ownPaid, plan ? Number(plan.paid_amount ?? 0) : 0);
          const remaining = useLedger ? Math.max(ledger!.remaining, 0) : Math.max(totalDue - paidNow, 0);
          if (totalDue <= 0) return null;
          return (
            <div className="mt-4 p-4 rounded-lg border-2 border-primary/30 bg-primary/5">
              <div className="font-bold mb-3 text-primary">💳 ملخص الدفع</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center text-sm mb-3">
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
                    <Wallet className="w-4 h-4 ml-2" /> سداد المتبقي على هذه الفاتورة ({formatEGP(remaining)})
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
          <div className="mt-1">بتاريخ {formatDateTime(inv.invoice_date ?? inv.created_at)}</div>
          
        </div>

        <div className="text-center mt-6 text-sm text-muted-foreground">شكراً لتعاملكم معنا 🙏</div>
      </div>

      <div className="card-elevated p-4 print:hidden">
        <RecordAttachments recordType="invoice" recordId={inv.id} canEdit={inv.status !== "cancelled"} />
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
        vatAmount={Number((inv as any).vat_amount ?? 0)}
        vatRate={Number((inv as any).vat_rate ?? 0)}
        total={Number(inv.total ?? 0)}
        paid={ledger && ledger.state !== "before_ledger" && ledger.state !== "cancelled" ? ledger.paid : Math.max(payments.reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0), Number(plan?.paid_amount ?? 0))}
        previousBalance={liveBal ? liveBal.prev : null}
        currentBalance={liveBal ? liveBal.curr : null}
        paymentMethodLabel={inv.payment_method}
      />

      <CancelInvoiceDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        invoice={inv}
        onDone={() => setReloadKey((k) => k + 1)}
      />



      {/* Edit moved to full page: /branch/:id/sales/:invoiceId/edit */}

      {(() => {
        const paidFromInvoicePayments = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
        const paidFromPlan = plan ? Number(plan.paid_amount ?? 0) : 0;
        const paidNow = Math.max(paidFromInvoicePayments, paidFromPlan);
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
              title="سداد المتبقي على هذه الفاتورة"
              onSuccess={() => setReloadKey((k) => k + 1)}
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
              title="سداد المتبقي على هذه الفاتورة"
              onSuccess={() => setReloadKey((k) => k + 1)}
            />
          );
        }
        return null;
      })()}
    </BranchLayout>
  );
}
