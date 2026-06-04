import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { ArrowRight, Receipt, DollarSign, Calendar, Phone, MapPin } from "lucide-react";
import { PaymentPlansPanel } from "@/components/PaymentPlansPanel";

export default function CustomerProfile() {
  const { id: branchId, customerId } = useParams<{ id: string; customerId: string }>();
  const nav = useNavigate();
  const [customer, setCustomer] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: invs }] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", customerId!).maybeSingle(),
        supabase.from("invoices").select("*").eq("contact_id", customerId!).order("created_at", { ascending: false }),
      ]);
      setCustomer(c);
      setInvoices(invs ?? []);
      setLoading(false);
    })();
  }, [customerId]);

  const activeInvs = invoices.filter((i) => i.status === "active");
  const totalSpent = activeInvs.reduce((s, i) => s + Number(i.total), 0);
  const firstPurchase = invoices[invoices.length - 1]?.created_at;
  const lastPurchase = invoices[0]?.created_at;

  return (
    <BranchLayout>
      <PageHeader
        title={customer?.name ?? "ملف العميل"}
        subtitle={customer?.phone ?? ""}
        actions={
          <Button variant="outline" onClick={() => nav(`/branch/${branchId}/customers`)}>
            <ArrowRight className="w-4 h-4 ml-1" /> رجوع
          </Button>
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
        <StatCard label="أول شراء" value={firstPurchase ? formatDateTime(firstPurchase).split(" ")[0] : "—"} icon={<Calendar className="w-5 h-5" />} accent="secondary" />
        <StatCard label="آخر شراء" value={lastPurchase ? formatDateTime(lastPurchase).split(" ")[0] : "—"} icon={<Calendar className="w-5 h-5" />} accent="warning" />
      </div>

      <h3 className="font-bold mb-3">المديونيات وخطط الدفع</h3>
      {customerId && <div className="mb-6"><PaymentPlansPanel entityType="customer" entityId={customerId} direction="in" /></div>}

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
    </BranchLayout>
  );
}
