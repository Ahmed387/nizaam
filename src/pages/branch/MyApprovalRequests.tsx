import { useEffect, useState } from "react";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatDateTime } from "@/lib/format";
import { Clock, CheckCircle2, XCircle } from "lucide-react";

const ENTITY_LABEL: Record<string, string> = {
  contact: "جهة تواصل",
  invoice: "فاتورة",
  shipment: "فاتورة شراء",
};

export default function MyApprovalRequests() {
  const { tenantId, user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "decided">("pending");

  const load = async () => {
    if (!tenantId || !user) return;
    setLoading(true);
    const { data } = await supabase
      .from("approval_requests" as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("requested_by", user.id)
      .order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId, user?.id]);
  useRealtimeRefresh(["approval_requests"], load);

  const filtered = rows.filter((r) => tab === "pending" ? r.status === "pending" : r.status !== "pending");

  return (
    <BranchLayout>
      <PageHeader title="طلباتي للموافقة" subtitle="حالة طلبات الحذف والتعديل التي أرسلتها لمدير الشركة" />

      <div className="flex gap-2 mb-4">
        <Button variant={tab === "pending" ? "default" : "outline"} onClick={() => setTab("pending")}>
          <Clock className="w-4 h-4 ml-1" /> المعلّقة ({rows.filter(r => r.status === "pending").length})
        </Button>
        <Button variant={tab === "decided" ? "default" : "outline"} onClick={() => setTab("decided")}>
          المنتهية ({rows.filter(r => r.status !== "pending").length})
        </Button>
      </div>

      <DataTable loading={loading} rows={filtered} columns={[
        { key: "created_at", header: "التاريخ", render: (r: any) => <span className="text-xs">{formatDateTime(r.created_at)}</span> },
        { key: "action", header: "النوع", render: (r: any) => (
          <span className={`px-2 py-1 rounded text-xs ${r.action === "delete" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
            {r.action === "delete" ? "حذف" : "تعديل"}
          </span>
        )},
        { key: "entity_type", header: "النوع", render: (r: any) => <span className="text-sm">{ENTITY_LABEL[r.entity_type] ?? r.entity_type}</span> },
        { key: "entity_label", header: "العنصر", render: (r: any) => <span className="font-semibold">{r.entity_label}</span> },
        { key: "reason", header: "السبب", render: (r: any) => <span className="text-xs text-muted-foreground">{r.reason ?? "—"}</span> },
        { key: "status", header: "الحالة", render: (r: any) => {
          if (r.status === "pending") return <span className="px-2 py-1 rounded text-xs bg-warning/10 text-warning"><Clock className="w-3 h-3 inline ml-1" />معلّق</span>;
          if (r.status === "approved") return <span className="px-2 py-1 rounded text-xs bg-success/10 text-success"><CheckCircle2 className="w-3 h-3 inline ml-1" />موافق</span>;
          return <span className="px-2 py-1 rounded text-xs bg-destructive/10 text-destructive"><XCircle className="w-3 h-3 inline ml-1" />مرفوض</span>;
        }},
        { key: "admin_note", header: "ملاحظة المدير", render: (r: any) => <span className="text-xs text-muted-foreground">{r.admin_note ?? "—"}</span> },
        { key: "decided_at", header: "تاريخ القرار", render: (r: any) => <span className="text-xs">{r.decided_at ? formatDateTime(r.decided_at) : "—"}</span> },
      ]} />
    </BranchLayout>
  );
}
