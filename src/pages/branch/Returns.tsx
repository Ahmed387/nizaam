import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { Plus } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

export default function Returns() {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    const { data } = await supabase
      .from("returns")
      .select("*, invoices(invoice_number)")
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["returns"], load);

  return (
    <BranchLayout>
      <PageHeader
        title="المرتجعات"
        subtitle="إرجاع منتجات من فواتير سابقة"
        actions={
          <Button onClick={() => nav(`/branch/${branchId}/sales/returns/new`)} className="gap-2">
            <Plus className="w-4 h-4" /> مرتجع جديد
          </Button>
        }
      />
      <DataTable
        loading={loading}
        rows={rows}
        empty="لا توجد مرتجعات"
        columns={[
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
          { key: "invoice", header: "الفاتورة", render: (r: any) => r.invoices?.invoice_number ?? "—" },
          { key: "reason", header: "السبب" },
          { key: "total_refund", header: "قيمة الإرجاع", render: (r: any) => <b className="text-destructive">{formatEGP(r.total_refund)}</b> },
        ]}
      />
    </BranchLayout>
  );
}
