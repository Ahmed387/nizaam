import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { Plus, RotateCcw } from "lucide-react";

export default function SalesHistory() {
  const { id } = useParams<{ id: string }>();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    supabase.from("invoices").select("*, customers(name), profiles!invoices_cashier_id_fkey(name)").eq("branch_id", id).order("created_at", { ascending: false }).then(({ data }) => {
      setRows(data ?? []); setLoading(false);
    });
  }, [id]);

  return (
    <BranchLayout>
      <PageHeader title="سجل المبيعات"
        actions={
          <div className="flex gap-2">
            <Link to={`/branch/${id}/sales/returns`}><Button variant="outline"><RotateCcw className="w-4 h-4 ml-1" /> مرتجعات</Button></Link>
            <Link to={`/branch/${id}/sales/new`}><Button className="btn-gradient"><Plus className="w-4 h-4 ml-1" /> فاتورة جديدة</Button></Link>
          </div>
        }
      />
      <DataTable
        loading={loading} rows={rows}
        onRowClick={(r: any) => window.location.assign(`/branch/${id}/sales/${r.id}`)}
        columns={[
          { key: "invoice_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary font-bold">{r.invoice_number}</span> },
          { key: "customer", header: "العميل", render: (r: any) => r.customers?.name ?? "نقدي" },
          { key: "total", header: "المبلغ", render: (r: any) => formatEGP(r.total) },
          { key: "discount_amount", header: "الخصم", render: (r: any) => Number(r.discount_amount) > 0 ? formatEGP(r.discount_amount) : "—" },
          { key: "cashier", header: "الكاشير", render: (r: any) => r.profiles?.name ?? "—" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
          { key: "status", header: "الحالة", render: (r: any) => (
            <span className={`px-2 py-1 rounded text-xs ${r.status === "active" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
              {r.status === "active" ? "نشطة" : "ملغاة"}
            </span>
          )},
        ]}
      />
    </BranchLayout>
  );
}
