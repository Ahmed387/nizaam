import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDateTime } from "@/lib/format";
import { ArrowRight, Printer } from "lucide-react";
import { ThermalReceiptPrint, printThermalInvoice } from "@/components/ThermalReceiptPrint";
import { EditableInvoiceDate } from "@/components/EditableInvoiceDate";
import { VariantLine } from "@/components/VariantChips";
import { CancelReturnButton, CancelledReturnBanner } from "@/components/CancelReturnButton";
import { DocumentMoneyMovements } from "@/components/payments/DocumentMoneyMovements";
import { RecordAttachments } from "@/components/RecordAttachments";


export default function SaleReturnView() {
  const { id: branchId, returnId } = useParams<{ id: string; returnId: string }>();
  const nav = useNavigate();
  const { tenant } = useAuth();
  const [ret, setRet] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [branch, setBranch] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: r, error: e1 } = await supabase
        .from("returns")
        .select("*, invoices:invoice_id(invoice_number, contacts:contact_id(name, phone, address))")
        .eq("id", returnId!)
        .maybeSingle();
      if (e1 || !r) { setErr("المرتجع غير موجود"); return; }
      setRet(r);
      const { data: it } = await supabase
        .from("return_items")
        .select("*, products(name, sku, selling_price)")
        .eq("return_id", returnId!);
      setItems(it ?? []);
      const { data: b } = await supabase.from("branches").select("*").eq("id", branchId!).maybeSingle();
      setBranch(b);
    })();
  }, [returnId, branchId]);

  if (err) return <BranchLayout><div className="p-8 text-center text-destructive">⚠️ {err}</div></BranchLayout>;
  if (!ret) return <BranchLayout><div className="p-8 text-center">جاري التحميل...</div></BranchLayout>;

  const customer = ret.invoices?.contacts;
  const methodLabel: any = { cash: "نقدي", visa: "فيزا", vodafone_cash: "فودافون كاش", instapay: "انستاباي", bank_transfer: "تحويل بنكي", balance: "خصم من الرصيد" };

  return (
    <BranchLayout>
      <PageHeader
        title={`مرتجع بيع ${ret.return_number}`}
        subtitle={formatDateTime(ret.created_at)}
        actions={
          <div className="flex gap-2 no-print">
            <Button variant="outline" size="sm" onClick={() => nav(`/branch/${branchId}/invoices?tab=sale_return`)} className="gap-2">
              <ArrowRight className="w-4 h-4" /> رجوع
            </Button>
            <CancelReturnButton
              kind="sale"
              returnId={ret.id}
              returnNumber={ret.return_number}
              total={Number(ret.total_refund ?? 0)}
              status={ret.status ?? "active"}
              onDone={() => window.location.reload()}
            />
            <Button size="sm" onClick={printThermalInvoice} className="gap-2 btn-gradient">
              <Printer className="w-4 h-4" /> طباعة الفاتورة
            </Button>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto no-print"><CancelledReturnBanner ret={ret} /></div>



      <div className="max-w-3xl mx-auto card-elevated p-8 bg-card no-print">
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-border">
          <div className="text-right">
            <div className="text-xs text-muted-foreground mb-1">الجهة البائعة</div>
            <h2 className="text-2xl font-extrabold gradient-text">🏢 {tenant?.name ?? branch?.name}</h2>
            <p className="text-sm font-semibold mt-1">📍 فرع: {branch?.name}</p>
          </div>
          <div className="text-left bg-warning/10 border border-warning/30 rounded-lg p-3">
            <div className="text-xs text-muted-foreground">رقم المرتجع</div>
            <div className="font-mono font-extrabold text-warning text-lg">{ret.return_number}</div>
            <div className="text-xs text-muted-foreground mt-2">تاريخ المرتجع</div>
            <div className="text-sm font-bold"><EditableInvoiceDate table="returns" recordId={ret.id} value={(ret as any).invoice_date} fallback={ret.created_at} onSaved={(d) => setRet({ ...ret, invoice_date: d } as any)} /></div>
            <div className="text-[10px] text-muted-foreground mt-1.5">تاريخ الإدخال: {formatDateTime(ret.created_at)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-surface-2 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">👤 العميل</div>
            <div className="font-bold">{customer?.name ?? "عميل نقدي"}</div>
            {customer?.phone && <div className="text-xs text-muted-foreground">☎ {customer.phone}</div>}
            {customer?.address && <div className="text-xs text-muted-foreground">📍 {customer.address}</div>}
          </div>
          <div className="bg-surface-2 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">🧾 الفاتورة الأصلية</div>
            <div className="font-bold font-mono">{ret.invoices?.invoice_number ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">طريقة الاسترداد: {methodLabel[ret.refund_method] ?? ret.refund_method}</div>
          </div>
        </div>

        <table className="w-full text-sm mb-6 border border-border">
          <thead>
            <tr className="bg-surface-2 border-b-2 border-border">
              <th className="text-right p-2">#</th>
              <th className="text-right p-2">المنتج</th>
              <th className="text-right p-2">الكود</th>
              <th className="text-center p-2">الكمية</th>
              <th className="text-center p-2">سعر الوحدة</th>
              <th className="text-left p-2">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id} className="border-b border-border">
                <td className="p-2 text-muted-foreground">{idx + 1}</td>
                <td className="p-2 font-medium">{(it as any).product_name ?? it.products?.name ?? "—"}<VariantLine attrs={it as any} className="block mt-0.5" /></td>
                <td className="p-2 text-muted-foreground">{it.products?.sku ?? "—"}</td>
                <td className="text-center p-2">{it.quantity}</td>
                <td className="text-center p-2">{formatEGP(Number(it.refund) / Math.max(1, Number(it.quantity)))}</td>
                <td className="text-left p-2 font-bold">{formatEGP(it.refund)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-2 text-sm border-t-2 border-border pt-3">
          {ret.reason && <div className="flex justify-between"><span>السبب:</span><span className="font-bold">{ret.reason}</span></div>}
          <div className="flex justify-between text-lg pt-2 border-t border-border">
            <span className="font-bold">إجمالي المرتجع:</span>
            <span className="text-warning font-extrabold">{formatEGP(ret.total_refund)}</span>
          </div>
        </div>

        {(() => {
          const debt = Number((ret as any).refund_balance_amount ?? 0);
          const cash = Number((ret as any).refund_cash_amount ?? 0);
          const trans = Number((ret as any).refund_transfer_amount ?? 0);
          const tot = Number(ret.total_refund ?? 0);
          return (
            <div className="mt-5 rounded-xl border border-border bg-surface-2 p-4">
              <div className="font-extrabold mb-2">🧮 حصل إيه بالظبط في الفلوس؟</div>
              <div className="text-sm space-y-1.5">
                <div className="flex justify-between"><span>إجمالي قيمة البضاعة المرتجعة</span><span className="font-bold">{formatEGP(tot)}</span></div>
                <div className="flex justify-between"><span>اتخصم من الديْن اللي على العميل</span><span className="font-bold">{formatEGP(debt)}</span></div>
                <div className="flex justify-between"><span>خرج كاش من الخزنة للعميل</span><span className="font-bold">{formatEGP(cash)}</span></div>
                <div className="flex justify-between"><span>رجع تحويل (محفظة/بنك/انستاباي)</span><span className="font-bold">{formatEGP(trans)}</span></div>
                <div className="flex justify-between border-t border-border pt-1.5 mt-1.5"><span className="font-bold">مجموع اللي اتسوّى</span><span className="font-extrabold text-success">{formatEGP(debt + cash + trans)}</span></div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                يعني إيه؟ لو العميل كان لسه عليه فلوس، المرتجع بيقفّل الديْن الأول، واللي يفضل بعد كده هو بس اللي بيخرج من الخزنة كفلوس.
              </p>
            </div>
          );
        })()}
      </div>

      <div className="card-elevated p-4 print:hidden">
        <DocumentMoneyMovements docId={(ret as any).id} docRecordType="sale_return" canEdit={(ret as any).status !== "cancelled"} />
      </div>

      <div className="card-elevated p-4 print:hidden">
        <RecordAttachments recordType="sale_return" recordId={(ret as any).id} canEdit={(ret as any).status !== "cancelled"} />
      </div>

      <ThermalReceiptPrint
        kind="sale_return"
        branchName={branch?.name}
        invoiceNumber={ret.return_number}
        createdAt={ret.created_at}
        paymentType={ret.refund_method}
        cashier={null}
        partyName={customer?.name ?? "عميل نقدي"}
        notes={null}
        reason={ret.reason}
        originalRef={ret.invoices?.invoice_number ?? null}
        originalRefLabel="فاتورة أصلية"
        items={items.map((it: any) => {
          const qty = Number(it.quantity ?? 0);
          const total = Number(it.refund ?? 0);
          return { name: it.products?.name ?? "—", qty, unit_price: total / Math.max(1, qty), total };
        })}
        subtotal={Number(ret.total_refund ?? 0)}
        total={Number(ret.total_refund ?? 0)}
        paid={Number(ret.total_refund ?? 0)}
        paymentMethodLabel={methodLabel[ret.refund_method] ?? ret.refund_method}
      />
    </BranchLayout>
  );
}
