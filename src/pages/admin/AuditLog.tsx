import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format";

export default function AuditLog() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.from("audit_log").select("*, branches(name)").order("created_at", { ascending: false }).limit(500).then(({ data }) => {
      setRows(data ?? []); setLoading(false);
    });
  }, []);

  const actionColor: Record<string, string> = {
    CREATE: "bg-success/15 text-success",
    UPDATE: "bg-primary/15 text-primary",
    DELETE: "bg-destructive/15 text-destructive",
    CANCEL: "bg-warning/15 text-warning",
  };

  return (
    <AdminLayout>
      <PageHeader title="سجل العمليات" subtitle={`${rows.length} عملية مسجلة`} />
      <DataTable
        loading={loading} rows={rows}
        columns={[
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
          { key: "user_name", header: "المستخدم", render: (r: any) => <span className="font-semibold">{r.user_name}</span> },
          { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
          { key: "action", header: "العملية", render: (r: any) => (
            <span className={`px-2 py-1 rounded text-xs font-bold ${actionColor[r.action] ?? "bg-muted"}`}>{r.action}</span>
          )},
          { key: "entity", header: "النوع" },
          { key: "entity_id", header: "المعرف", render: (r: any) => <span className="font-mono text-xs text-muted-foreground">{r.entity_id?.slice(0, 8)}</span> },
        ]}
      />
    </AdminLayout>
  );
}
