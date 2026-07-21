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
import { ColorChip } from "@/components/ColorPicker";

export default function PurchaseReturnView() {
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
        .from("purchase_returns" as any)
        .select("*, contacts:contact_id(name, phone, address), shipments:shipment_id(shipment_number)")
        .eq("id", returnId!)
        .maybeSingle();
      if (e1 || !r) { setErr("المرتجع غير موجود"); return; }
      setRet(r);
      const { data: it } = await supabase
        .from("purchase_return_items")
        .select("*, products(sku)")
        .eq("purchase_return_id", returnId!);
      setItems(it ?? []);
      const { data: b } = await supabase.from("branches").select("*").eq("id", branchId!).maybeSingle();
      setBranch(b);
    })();
  }, [returnId, branchId]);

  if (err) return <BranchLayout><div className="p-8 text-center text-destructive">⚠️ {err}</div></BranchLayout>;
  if (!ret) return <BranchLayout><div className="p-8 text-center">جاري التحميل...</div></BranchLayout>;

  const supplier = (ret as any).contacts;
  const methodLabel: any = { cash: "نقدي", visa: "فيزا", vodafone_cash: "فودافون كاش", instapay: "انستاباي", bank_transfer: "تحويل بنكي", balance: "خصم من رصيد المورد" };

  return (
    <BranchLayout>
      <PageHeader
        title={`مرتجع شراء ${(ret as any).return_number}`}
        subtitle={formatDateTime((ret as any).created_at)}
        actions={
          <div className="flex gap-2 no-print">
            <Button variant="outline" size="sm" onClick={() => nav(`/branch/${branchId}/invoices?tab=purchase_return`)} className="gap-2">
              <ArrowRight className="w-4 h-4" /> رجوع
            </Button>
            <Button size="sm" onClick={printThermalInvoice} className="gap-2 btn-gradient">
              <Printer className="w-4 h-4" /> طباعة الفاتورة
            </Button>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto card-elevated p-8 bg-card no-print">
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-border">
          <div className="text-right">
            <div className="text-xs text-muted-foreground mb-1">الجهة المُرجِعة</div>
            <h2 className="text-2xl font-extrabold gradient-text">🏢 {tenant?.name ?? branch?.name}</h2>
            <p className="text-sm font-semibold mt-1">📍 فرع: {branch?.name}</p>
          </div>
          <div className="text-left bg-warning/10 border border-warning/30 rounded-lg p-3">
            <div className="text-xs text-muted-foreground">رقم المرتجع</div>
            <div className="font-mono font-extrabold text-warning text-lg">{(ret as any).return_number}</div>
            <div className="text-xs text-muted-foreground mt-2">تاريخ المرتجع</div>
            <div className="text-sm font-bold"><EditableInvoiceDate table="purchase_returns" recordId={(ret as any).id} value={(ret as any).invoice_date} fallback={(ret as any).created_at} onSaved={(d) => setRet({ ...(ret as any), invoice_date: d })} /></div>
            <div className="text-[10px] text-muted-foreground mt-1.5">تاريخ الإدخال: {formatDateTime((ret as any).created_at)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-surface-2 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">🏭 المورد</div>
            <div className="font-bold">{supplier?.name ?? "—"}</div>
            {supplier?.phone && <div className="text-xs text-muted-foreground">☎ {supplier.phone}</div>}
            {supplier?.address && <div className="text-xs text-muted-foreground">📍 {supplier.address}</div>}
          </div>
          <div className="bg-surface-2 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">🧾 الشحنة الأصلية</div>
            <div className="font-bold font-mono">{(ret as any).shipments?.shipment_number ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">طريقة الاسترداد: {methodLabel[(ret as any).refund_method] ?? (ret as any).refund_method}</div>
          </div>
        </div>

        <table className="w-full text-sm mb-6 border border-border">
          <thead>
            <tr className="bg-surface-2 border-b-2 border-border">
              <th className="text-right p-2">#</th>
              <th className="text-right p-2">المنتج</th>
              <th className="text-right p-2">الكود</th>
              <th className="text-center p-2">الكمية</th>
              <th className="text-center p-2">سعر التكلفة</th>
              <th className="text-left p-2">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id} className="border-b border-border">
                <td className="p-2 text-muted-foreground">{idx + 1}</td>
                <td className="p-2 font-medium"><span className="inline-flex items-center gap-1.5">{it.product_name}{(it as any).color && <ColorChip name={(it as any).color} />}</span></td>
                <td className="p-2 text-muted-foreground">{(it as any).products?.sku ?? "—"}</td>
                <td className="text-center p-2">{it.quantity}</td>
                <td className="text-center p-2">{formatEGP(it.unit_cost)}</td>
                <td className="text-left p-2 font-bold">{formatEGP(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-2 text-sm border-t-2 border-border pt-3">
          {(ret as any).reason && <div className="flex justify-between"><span>السبب:</span><span className="font-bold">{(ret as any).reason}</span></div>}
          <div className="flex justify-between text-lg pt-2 border-t border-border">
            <span className="font-bold">إجمالي المرتجع:</span>
            <span className="text-warning font-extrabold">{formatEGP((ret as any).total_amount)}</span>
          </div>
        </div>
      </div>

      <ThermalReceiptPrint
        kind="purchase_return"
        branchName={branch?.name}
        invoiceNumber={(ret as any).return_number}
        createdAt={(ret as any).created_at}
        paymentType={(ret as any).refund_method}
        cashier={null}
        partyName={supplier?.name ?? "—"}
        notes={null}
        reason={(ret as any).reason}
        originalRef={(ret as any).shipments?.shipment_number ?? null}
        originalRefLabel="شحنة أصلية"
        items={items.map((it: any) => ({
          name: it.product_name,
          qty: Number(it.quantity ?? 0),
          unit_price: Number(it.unit_cost ?? 0),
          total: Number(it.total ?? 0),
        }))}
        subtotal={Number((ret as any).total_amount ?? 0)}
        total={Number((ret as any).total_amount ?? 0)}
        paid={Number((ret as any).total_amount ?? 0)}
        paymentMethodLabel={methodLabel[(ret as any).refund_method] ?? (ret as any).refund_method}
      />
    </BranchLayout>
  );
}
