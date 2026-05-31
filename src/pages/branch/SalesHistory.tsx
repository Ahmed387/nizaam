import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PermGate } from "@/components/ProtectedRoute";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { Plus, RotateCcw, BookmarkPlus } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

export default function SalesHistory() {
  const { id } = useParams<{ id: string }>();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase.from("invoices").select("*, customers(name)").eq("branch_id", id).order("created_at", { ascending: false });
    const cashierIds = [...new Set((data ?? []).map((r: any) => r.cashier_id).filter(Boolean))];
    const { data: cashiers } = cashierIds.length
      ? await supabase.from("profiles").select("id, name").in("id", cashierIds)
      : { data: [] as any[] };
    const cashierMap = new Map((cashiers ?? []).map((c: any) => [c.id, c.name]));
    setRows((data ?? []).map((r: any) => ({ ...r, cashier_name: cashierMap.get(r.cashier_id) ?? "—" })));
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["invoices"], load);

  return (
    <BranchLayout>
      <PageHeader title="سجل المبيعات"
        actions={
          <div className="flex gap-2 flex-wrap">
            <PermGate perm="preorders.view"><Link to={`/branch/${id}/pre-orders`}><Button variant="outline"><BookmarkPlus className="w-4 h-4 ml-1" /> طلبات الحجز</Button></Link></PermGate>
            <PermGate perm="sales.view"><Link to={`/branch/${id}/sales/returns`}><Button variant="outline"><RotateCcw className="w-4 h-4 ml-1" /> مرتجعات</Button></Link></PermGate>
            <PermGate perm="sales.create"><Link to={`/branch/${id}/sales/new`}><Button className="btn-gradient"><Plus className="w-4 h-4 ml-1" /> فاتورة جديدة</Button></Link></PermGate>
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
          { key: "cashier", header: "الكاشير", render: (r: any) => r.cashier_name ?? "—" },
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
