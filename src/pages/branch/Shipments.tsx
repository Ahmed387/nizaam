import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PermGate } from "@/components/ProtectedRoute";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { Plus, Eye } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

export default function Shipments() {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    const { data } = await supabase
      .from("shipments")
      .select("*, suppliers(company_name)")
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["shipments"], load);

  return (
    <BranchLayout>
      <PageHeader
        title="الشحنات"
        subtitle="استلام البضاعة من الموردين"
        actions={
          <PermGate perm="shipments.create">
            <Button onClick={() => nav(`/branch/${branchId}/shipments/new`)} className="gap-2">
              <Plus className="w-4 h-4" /> شحنة جديدة
            </Button>
          </PermGate>
        }
      />

      <DataTable
        loading={loading}
        rows={rows}
        empty="لا توجد شحنات بعد"
        columns={[
          { key: "arrival_date", header: "تاريخ الوصول", render: (r: any) => formatDate(r.arrival_date) },
          { key: "supplier", header: "المورد", render: (r: any) => r.suppliers?.company_name ?? "—" },
          { key: "received_by", header: "المستلم" },
          { key: "shipping_cost", header: "شحن", render: (r: any) => formatEGP(r.shipping_cost) },
          { key: "admin_cost", header: "إدارية", render: (r: any) => formatEGP(r.admin_cost) },
          { key: "total_cost", header: "الإجمالي", render: (r: any) => <b className="text-primary">{formatEGP(r.total_cost)}</b> },
          {
            key: "actions",
            header: "",
            render: (r: any) => (
              <Button size="sm" variant="ghost" onClick={() => nav(`/branch/${branchId}/shipments/${r.id}`)}>
                <Eye className="w-4 h-4" />
              </Button>
            ),
          },
        ]}
      />
    </BranchLayout>
  );
}
