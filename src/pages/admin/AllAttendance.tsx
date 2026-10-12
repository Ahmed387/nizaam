import { useEffect, useState } from "react";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";

import { DataTable } from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/lib/format";
import { cairoTodayDay } from "@/lib/cairoDate";
import { EmployeeLink } from "@/components/employees/EmployeeLink";

const STATUS_LABEL: Record<string, string> = {
  present: "حاضر", late: "متأخر", absent: "غائب", leave: "إجازة",
};

export default function AllAttendance({ embedded = false }: { embedded?: boolean } = {}) {
  const { branches } = useAuth();
  const [date, setDate] = useState(cairoTodayDay());
  const [branchId, setBranchId] = useState<string>("all");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // attendance has no FK to branches, so the branch name is resolved locally
      // instead of via a PostgREST embed (which fails with PGRST200).
      let q = supabase.from("attendance").select("*").eq("date", date).order("created_at", { ascending: false });
      if (branchId !== "all") q = q.eq("branch_id", branchId);
      const { data } = await q;
      const nameById = new Map(branches.map((b) => [b.id, b.name]));
      const mapped = (data ?? []).map((r: any) => ({ ...r, branch_name: nameById.get(r.branch_id) ?? null }));
      if (!cancelled) { setRows(mapped); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [date, branchId, reloadTick, branches]);

  useRealtimeRefresh(["attendance"], () => setReloadTick((t) => t + 1));

  const actions = (
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
  );

  return (
    <ConditionalLayout embedded={embedded} variant="admin" title="الحضور (كل الفروع)" subtitle={formatDate(date)} actions={actions}>
      <DataTable
        loading={loading}
        rows={rows}
        empty="لا توجد سجلات لهذا اليوم"
        columns={[
          { key: "employee_name", header: "الموظف", render: (r: any) => <EmployeeLink id={r.employee_id} name={r.employee_name} /> },
          { key: "branch", header: "الفرع", render: (r: any) => r.branch_name ?? "—" },
          { key: "status", header: "الحالة", render: (r: any) => STATUS_LABEL[r.status] ?? r.status },
          { key: "check_in", header: "حضور", render: (r: any) => r.check_in ? <span dir="ltr" className="text-xs">{new Date(r.check_in).toLocaleTimeString("ar-EG")}</span> : "—" },
          { key: "check_out", header: "انصراف", render: (r: any) => r.check_out ? <span dir="ltr" className="text-xs">{new Date(r.check_out).toLocaleTimeString("ar-EG")}</span> : "—" },
          { key: "notes", header: "ملاحظات", render: (r: any) => r.notes ?? "—" },
        ]}
      />
    </ConditionalLayout>
  );
}
