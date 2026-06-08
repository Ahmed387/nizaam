import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { InventoryStatusBadge } from "@/components/InventoryStatusBadge";
import { formatDateTime } from "@/lib/format";
import { Plus, FileText, ClipboardList, ClipboardCheck, ShieldCheck, Camera, Ban } from "lucide-react";
import { toast } from "sonner";

export default function Sessions() {
  const { id: branchId } = useParams<{ id: string }>();
  const { hasRole, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isManager = isAdmin || hasRole("branch_manager");
  const isWarehouse = hasRole("warehouse");
  const isAccountant = hasRole("accountant");

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    const { data } = await supabase
      .from("inventory_sessions" as any)
      .select("*, branches(name)")
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false });
    setRows((data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);
  useRealtimeRefresh(["inventory_sessions"], load);

  const canCancel = (status: string) => ["counting", "reviewing", "pending_approval"].includes(status);

  const cancelSession = async (sessionId: string) => {
    const { error } = await supabase
      .from("inventory_sessions" as any)
      .update({ status: "cancelled" })
      .eq("id", sessionId);
    if (error) return toast.error(error.message);
    toast.success("تم إلغاء الجلسة");
    load();
  };

  const actionFor = (r: any) => {
    if (isManager && (r.status === "pending_approval")) {
      return <Button size="sm" onClick={() => navigate(`/branch/${branchId}/inventory-count/${r.id}/approve`)}>اعتماد</Button>;
    }
    if (isAccountant && (r.status === "reviewing")) {
      return <Button size="sm" onClick={() => navigate(`/branch/${branchId}/inventory-count/${r.id}/review`)}>مراجعة</Button>;
    }
    if (isWarehouse && r.status === "counting") {
      return <Button size="sm" onClick={() => navigate(`/branch/${branchId}/inventory-count/${r.id}/count`)}>إدخال العد</Button>;
    }
    return null;
  };

  return (
    <ConditionalLayout
      title="جرد المخزن"
      subtitle="إدارة جلسات الجرد ومراجعة الفروقات"
      actions={
        isManager ? (
          <Button onClick={() => navigate(`/branch/${branchId}/inventory-count/new`)} className="gap-2">
            <Plus className="w-4 h-4" /> بدء جرد جديد
          </Button>
        ) : null
      }
    >
      <DataTable
        rows={rows}
        loading={loading}
        empty="لا توجد جلسات جرد"
        columns={[
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
          { key: "warehouse", header: "المخزن", render: (r: any) => r.branches?.name ?? "—" },
          { key: "status", header: "الحالة", render: (r: any) => <InventoryStatusBadge status={r.status} /> },
          { key: "notes", header: "ملاحظات", render: (r: any) => r.notes ?? "—" },
          {
            key: "actions",
            header: "إجراءات",
            render: (r: any) => (
              <div className="flex gap-2 justify-end flex-wrap">
                {actionFor(r)}
                {isAdmin && (
                  <Link to={`/branch/${branchId}/inventory-count/${r.id}/snapshot`}>
                    <Button size="sm" variant="outline" className="gap-1">
                      <Camera className="w-4 h-4" /> Snapshot
                    </Button>
                  </Link>
                )}
                <Link to={`/branch/${branchId}/inventory-count/${r.id}/report`}>
                  <Button size="sm" variant="outline" className="gap-1">
                    <FileText className="w-4 h-4" /> التقرير
                  </Button>
                </Link>
              </div>
            ),
          },
        ]}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6 text-sm text-muted-foreground">
        <div className="card-elevated p-4 flex gap-3 items-start"><ClipboardList className="w-5 h-5 text-blue-500" /><div><div className="font-semibold text-foreground">المدير</div>ينشئ الجلسة ويعتمدها في النهاية.</div></div>
        <div className="card-elevated p-4 flex gap-3 items-start"><ClipboardCheck className="w-5 h-5 text-amber-500" /><div><div className="font-semibold text-foreground">أمين المخزن</div>يدخل الكميات الفعلية بدون رؤية كميات النظام.</div></div>
        <div className="card-elevated p-4 flex gap-3 items-start"><ShieldCheck className="w-5 h-5 text-emerald-500" /><div><div className="font-semibold text-foreground">المحاسب</div>يراجع الفروقات ويضيف الأسباب ثم يرسلها للاعتماد.</div></div>
      </div>
    </ConditionalLayout>
  );
}
