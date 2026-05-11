import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/format";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

export default function AuditLog() {
  const { tenant, profile } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.from("audit_log").select("*, branches(name)").order("created_at", { ascending: false }).limit(500).then(({ data }) => {
      setRows(data ?? []); setLoading(false);
    });
  }, []);

  const exportExcel = () => {
    const data = rows.map((r) => ({
      "التاريخ": formatDateTime(r.created_at),
      "المستخدم": r.user_name,
      "الفرع": r.branches?.name ?? "—",
      "العملية": r.action,
      "النوع": r.entity,
      "المعرف": r.entity_id ?? "",
      "التفاصيل": r.details ? JSON.stringify(r.details) : "",
    }));
    const meta = [
      ["الشركة", tenant?.name ?? ""], ["تاريخ التصدير", new Date().toLocaleString("ar-EG")],
      ["صدّره", profile?.name ?? ""], ["عدد العمليات", String(data.length)], [],
    ];
    const ws = XLSX.utils.aoa_to_sheet(meta);
    XLSX.utils.sheet_add_json(ws, data, { origin: -1 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "سجل العمليات");
    XLSX.writeFile(wb, `audit-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`تم تصدير ${data.length} عملية`);
  };

  const actionColor: Record<string, string> = {
    CREATE: "bg-success/15 text-success",
    UPDATE: "bg-primary/15 text-primary",
    DELETE: "bg-destructive/15 text-destructive",
    CANCEL: "bg-warning/15 text-warning",
  };

  return (
    <AdminLayout>
      <PageHeader title="سجل العمليات" subtitle={`${rows.length} عملية مسجلة`}
        actions={<Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>} />
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
          { key: "entity_id", header: "المعرف", render: (r: any) => <span className="font-mono text-xs text-muted-foreground">{String(r.entity_id ?? "").slice(0, 8)}</span> },
        ]}
      />
    </AdminLayout>
  );
}
