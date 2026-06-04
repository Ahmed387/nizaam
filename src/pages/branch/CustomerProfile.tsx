import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { ArrowRight, Receipt, DollarSign, Calendar, Phone, MapPin, Wallet, Truck } from "lucide-react";
import { toast } from "sonner";
import { PaymentPlansPanel } from "@/components/PaymentPlansPanel";
import { MultiMethodPaymentDialog } from "@/components/MultiMethodPaymentDialog";

export default function CustomerProfile() {
  const { id: branchId, customerId } = useParams<{ id: string; customerId: string }>();
  const nav = useNavigate();
  const [customer, setCustomer] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);

  const load = async () => {
    const [{ data: c }, { data: invs }, { data: pays }] = await Promise.all([
      supabase.from("contacts").select("*").eq("id", customerId!).maybeSingle(),
      supabase.from("invoices").select("*").eq("contact_id", customerId!).order("created_at", { ascending: false }),
      supabase.from("payment_transactions").select("*").eq("contact_id", customerId!).eq("direction", "in").order("created_at", { ascending: false }),
    ]);
    setCustomer(c);
    setInvoices(invs ?? []);
    setPayments(pays ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  const activeInvs = invoices.filter((i) => i.status === "active");
  const totalSpent = activeInvs.reduce((s, i) => s + Number(i.total), 0);
  const firstPurchase = invoices[invoices.length - 1]?.created_at;
  const lastPurchase = invoices[0]?.created_at;
  // الرصيد: + = لينا (مديونية على العميل)، − = علينا (دفع زيادة)
  const balance = Number(customer?.balance ?? 0);
  const owedToUs = balance > 0 ? balance : 0;

  return (
    <BranchLayout>
      <PageHeader
        title={customer?.name ?? "ملف العميل"}
        subtitle={customer?.phone ?? ""}
        actions={
          <div className="flex gap-2 flex-wrap">
            {owedToUs > 0 && (
              <Button className="btn-gradient" onClick={() => setPayOpen(true)}>
                <Wallet className="w-4 h-4 ml-1" /> استلام دفعة
              </Button>
            )}
            {customer?.type === "supplier" || customer?.type === "both" ? (
              <Button variant="outline" onClick={() => nav(`/branch/${branchId}/suppliers/${customerId}`)}>
                <Truck className="w-4 h-4 ml-1" /> عرض كمورد
              </Button>
            ) : customer?.type === "customer" ? (
              <Button variant="outline" onClick={async () => {
                const { error } = await supabase.from("contacts").update({ type: "both" } as any).eq("id", customerId!);
                if (error) return toast.error(error.message);
                toast.success("تم تحويل العميل إلى عميل ومورد");
                load();
              }}>
                <Truck className="w-4 h-4 ml-1" /> أيضاً مورد
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => nav(`/branch/${branchId}/contacts?tab=customer`)}>
              <ArrowRight className="w-4 h-4 ml-1" /> رجوع
            </Button>
          </div>
        }
      />

      {customer && (
        <div className="card-elevated p-5 mb-6 grid md:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" /> <span dir="ltr">{customer.phone ?? "—"}</span></div>
          <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" /> {customer.address ?? "—"}</div>
          <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /> مسجل {formatDateTime(customer.created_at)}</div>
          {customer.notes && <div className="md:col-span-3 text-muted-foreground">📝 {customer.notes}</div>}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="عدد الفواتير" value={activeInvs.length} icon={<Receipt className="w-5 h-5" />} accent="primary" />
        <StatCard label="إجمالي المشتريات" value={formatEGP(totalSpent)} icon={<DollarSign className="w-5 h-5" />} accent="success" />
        <StatCard label="المستحق علينا" value={formatEGP(owedToUs)} icon={<Wallet className="w-5 h-5" />} accent={owedToUs > 0 ? "warning" : "success"} />
        <StatCard label="آخر شراء" value={lastPurchase ? formatDateTime(lastPurchase).split(" ")[0] : "—"} icon={<Calendar className="w-5 h-5" />} accent="secondary" />
      </div>

      <h3 className="font-bold mb-3">المديونيات وخطط الدفع</h3>
      {customerId && <div className="mb-6"><PaymentPlansPanel entityType="customer" entityId={customerId} direction="in" /></div>}

      {payments.length > 0 && (
        <>
          <h3 className="font-bold mb-3">المدفوعات المباشرة</h3>
          <div className="mb-6">
            <DataTable
              rows={payments}
              columns={[
                { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
                { key: "payment_method", header: "الطريقة" },
                { key: "reference_number", header: "المرجع", render: (r: any) => r.reference_number ?? "—" },
                { key: "received_by_name", header: "بواسطة", render: (r: any) => r.received_by_name ?? "—" },
                { key: "amount", header: "المبلغ", render: (r: any) => <span className="font-bold text-success">{formatEGP(r.amount)}</span> },
              ]}
            />
          </div>
        </>
      )}

      <h3 className="font-bold mb-3">سجل الفواتير</h3>
      <DataTable
        loading={loading}
        rows={invoices}
        onRowClick={(r: any) => nav(`/branch/${branchId}/sales/${r.id}`)}
        columns={[
          { key: "invoice_number", header: "رقم الفاتورة", render: (r: any) => <span className="font-semibold">{r.invoice_number}</span> },
          { key: "total", header: "المبلغ", render: (r: any) => formatEGP(r.total) },
          { key: "discount_amount", header: "الخصم", render: (r: any) => formatEGP(r.discount_amount) },
          { key: "status", header: "الحالة", render: (r: any) => (
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${r.status === "active" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"}`}>
              {r.status === "active" ? "نشطة" : "ملغاة"}
            </span>
          )},
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ]}
      />

      {payOpen && customerId && (
        <MultiMethodPaymentDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          mode={{ kind: "contact", contactId: customerId, branchId: branchId! }}
          defaultAmount={owedToUs}
          direction="in"
          title={`استلام دفعة — ${customer?.name ?? ""}`}
          onSuccess={load}
        />
      )}
    </BranchLayout>
  );
}

