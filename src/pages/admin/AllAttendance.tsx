import { useEffect, useState } from "react";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";

import { DataTable } from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  present: "حاضر", late: "متأخر", absent: "غائب", leave: "إجازة",
};

export default function AllAttendance() {
  const { branches } = useAuth();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState<string>("all");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase.from("attendance").select("*, branches(name)").eq("date", date).order("created_at", { ascending: false });
      if (branchId !== "all") q = q.eq("branch_id", branchId);
      const { data } = await q;
      if (!cancelled) { setRows(data ?? []); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [date, branchId]);

  return (
    <AdminLayout>
      <PageHeader
        title="الحضور (كل الفروع)"
        subtitle={formatDate(date)}
        actions={
          <div className="flex gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الفروع</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <DataTable
        loading={loading}
        rows={rows}
        empty="لا توجد سجلات لهذا اليوم"
        columns={[
          { key: "employee_name", header: "الموظف", render: (r: any) => <span className="font-semibold">{r.employee_name}</span> },
          { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
          { key: "status", header: "الحالة", render: (r: any) => STATUS_LABEL[r.status] ?? r.status },
          { key: "check_in", header: "حضور", render: (r: any) => r.check_in ? <span dir="ltr" className="text-xs">{new Date(r.check_in).toLocaleTimeString("ar-EG")}</span> : "—" },
          { key: "check_out", header: "انصراف", render: (r: any) => r.check_out ? <span dir="ltr" className="text-xs">{new Date(r.check_out).toLocaleTimeString("ar-EG")}</span> : "—" },
          { key: "notes", header: "ملاحظات", render: (r: any) => r.notes ?? "—" },
        ]}
      />
    </AdminLayout>
  );
}
