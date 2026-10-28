import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import * as XLSX from "xlsx";
import { fetchAllRows } from "@/lib/fetchAll";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/format";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { cairoTodayDay } from "@/lib/cairoDate";
import { useListFilter, useRememberedFilter } from "@/hooks/useListFilter";
import { readAll, useWholeList } from "@/hooks/useWholeList";
import { isActive, type ListColumn } from "@/lib/tableFilter";

// what each column shows, for the Excel filters on the whole log (owner 2026-10-26)
const LIST_COLS: ListColumn<any>[] = [
  { key: "created_at", label: "التاريخ", kind: "date", get: (r) => r.created_at },
  { key: "user_name", label: "المستخدم", kind: "text", get: (r) => r.user_name },
  { key: "branch", label: "الفرع", kind: "text", get: (r) => r.branches?.name },
  { key: "action", label: "العملية", kind: "text", get: (r) => r.action },
  { key: "entity", label: "النوع", kind: "text", get: (r) => r.entity },
  { key: "entity_id", label: "المعرف", kind: "text", get: (r) => String(r.entity_id ?? "").slice(0, 8) },
];

export default function AuditLog({ embedded }: { embedded?: boolean } = {}) {
  const { tenant, profile } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const PAGE = 50;
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const load = () => {
    setLoading(true);
    const start = (page - 1) * PAGE;
    supabase.from("audit_log").select("*, branches(name)", { count: "exact" }).order("created_at", { ascending: false }).order("id").range(start, start + PAGE - 1).then(({ data, count }) => {
      setRows(data ?? []); setTotal(count ?? 0); setLoading(false);
    });
  };
  // Excel filters: a column filter / sort reads the whole log (≈ 3,600 rows) and pages it here; without one, the
  // database pages it as before
  const { pathname } = useLocation();
  const [colState, setColState] = useRememberedFilter(`xf:v1:${pathname}:audit`);
  const whole = useWholeList<any>("audit_log", (signal) => readAll(() => supabase.from("audit_log")
    .select("id, created_at, user_name, action, entity, entity_id, branch_id, branches(name)")
    .order("created_at", { ascending: false }).order("id"), signal), { auto: isActive(colState) });
  const { result: listRes, adapter, state: colEff, apply } = useListFilter({ rows: whole.rows, columns: LIST_COLS, state: colState, onChange: setColState, ensureRows: whole.ensure });
  const wholeMode = isActive(colEff);
  const colSig = JSON.stringify(colEff);
  useEffect(() => { setPage(1); }, [colSig]);
  useEffect(() => { if (!wholeMode) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, wholeMode]);
  useRealtimeRefresh(["audit_log"], () => { whole.refresh(); if (!wholeMode) load(); });
  const shownRows = wholeMode ? (listRes ? listRes.rows.slice((page - 1) * PAGE, page * PAGE) : []) : rows;
  const shownTotal = wholeMode ? (listRes ? listRes.rows.length : 0) : total;
  const tableAdapter = useMemo(() => ({ ...adapter, shown: adapter.shown ?? total }), [adapter, total]);

  const exportExcel = async () => {
    const t = toast.loading("جاري تجهيز السجل كامل...");
    let all: any[];
    try {
      // what the filters leave (every page), in the order shown
      all = apply(await fetchAllRows<any>(() =>
        supabase.from("audit_log").select("id, created_at, user_name, action, entity, entity_id, details, branches(name)")
          .order("created_at", { ascending: false }).order("id")));
    } catch (e: any) { toast.dismiss(t); return toast.error(e.message); }
    toast.dismiss(t);
    const data = all.map((r) => ({
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
    XLSX.writeFile(wb, `audit-log-${cairoTodayDay()}.xlsx`);
    toast.success(`تم تصدير ${data.length} عملية`);
  };

  const actionColor: Record<string, string> = {
    CREATE: "bg-success/15 text-success",
    UPDATE: "bg-primary/15 text-primary",
    DELETE: "bg-destructive/15 text-destructive",
    CANCEL: "bg-warning/15 text-warning",
  };

  const columns: any[] = [
    { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
    { key: "user_name", header: "المستخدم", render: (r: any) => <span className="font-semibold">{r.user_name}</span> },
    { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
    { key: "action", header: "العملية", render: (r: any) => (
      <span className={`px-2 py-1 rounded text-xs font-bold ${actionColor[r.action] ?? "bg-muted"}`}>{r.action}</span>
    )},
    { key: "entity", header: "النوع" },
    { key: "entity_id", header: "المعرف", render: (r: any) => <span className="font-mono text-xs text-muted-foreground">{String(r.entity_id ?? "").slice(0, 8)}</span> },
  ];

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader
        title="سجل العمليات"
        subtitle={`${wholeMode ? `${shownTotal} من ${total}` : total} عملية مسجلة — السجل للقراءة فقط ولا يمكن تعديله أو حذفه`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>
          </div>
        }
      />
      <DataTable loading={wholeMode ? !listRes : loading} rows={shownRows} columns={columns} excel={{ id: "audit", server: tableAdapter }} />
      <div className="flex items-center justify-center gap-2 mt-3 text-sm">
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>السابق</Button>
        <span className="text-muted-foreground">صفحة {page} من {Math.max(1, Math.ceil(shownTotal / PAGE))}</span>
        <Button variant="outline" size="sm" disabled={page >= Math.ceil(shownTotal / PAGE) || loading} onClick={() => setPage((p) => p + 1)}>التالي</Button>
      </div>

    </ConditionalLayout>
  );
}
