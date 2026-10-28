import { getCairoDayBounds, cairoTodayDay } from "@/lib/cairoDate";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/format";
import { FileSpreadsheet, ShieldAlert, CalendarClock, UserCheck } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  created_at: string;
  user_name: string | null;
  entity_id: string | null;
  branches?: { name?: string } | null;
  details: any;
};

export default function ReturnOverrides({ embedded }: { embedded?: boolean } = {}) {
  const { tenant, profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = () => {
    setLoading(true);
    fetchAllRows<any>(() => supabase
      .from("audit_log")
      .select("*, branches(name)")
      .eq("entity", "return_owner_override")
      .order("created_at", { ascending: false })
      .order("id"))
      .then((data) => setRows((data as any) ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(["audit_log"], () => load());

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      const d = r.details ?? {};
      if (from && new Date(r.created_at) < new Date(from)) return false;
      if (to && new Date(r.created_at) > new Date(getCairoDayBounds(undefined, to).endIso!)) return false;
      if (!term) return true;
      return [r.user_name, d.invoice_number, d.reason, r.branches?.name]
        .filter(Boolean)
        .some((v: any) => String(v).toLowerCase().includes(term));
    });
  }, [rows, q, from, to]);

  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const thisMonth = filtered.filter((r) => new Date(r.created_at).getTime() >= monthStart).length;
    const maxDays = filtered.reduce((m, r) => Math.max(m, Number(r.details?.days_since ?? 0)), 0);
    return { total: filtered.length, thisMonth, maxDays };
  }, [filtered]);

  const [view, setView] = useState<any[] | null>(null); // what the column filters leave (Excel filters), for the exports
  const exportExcel = () => {
    const data = (view ?? filtered).map((r: any) => ({
      "التاريخ": formatDateTime(r.created_at),
      "المالك المُتجاوِز": r.user_name ?? "—",
      "الفرع": r.branches?.name ?? "—",
      "رقم الفاتورة": r.details?.invoice_number ?? "—",
      "عمر الفاتورة (يوم)": r.details?.days_since ?? "",
      "الحد المسموح (يوم)": r.details?.window_days ?? "",
      "السبب": r.details?.reason ?? "",
    }));
    const meta = [
      ["الشركة", tenant?.name ?? ""],
      ["التقرير", "تجاوزات نافذة المرتجعات"],
      ["تاريخ التصدير", new Date().toLocaleString("ar-EG")],
      ["صدّره", profile?.name ?? ""],
      ["عدد التجاوزات", String(data.length)],
      [],
    ];
    const ws = XLSX.utils.aoa_to_sheet(meta);
    XLSX.utils.sheet_add_json(ws, data, { origin: -1 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تجاوزات المرتجعات");
    XLSX.writeFile(wb, `return-overrides-${cairoTodayDay()}.xlsx`);
    toast.success(`تم تصدير ${data.length} تجاوز`);
  };

  const body = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="إجمالي التجاوزات" value={stats.total} icon={<ShieldAlert className="w-5 h-5" />} accent={stats.total > 0 ? "warning" : "secondary"} />
        <StatCard label="تجاوزات هذا الشهر" value={stats.thisMonth} icon={<CalendarClock className="w-5 h-5" />} accent="primary" />
        <StatCard label="أقصى عمر فاتورة (يوم)" value={stats.maxDays} icon={<UserCheck className="w-5 h-5" />} accent="secondary" />
      </div>

      <div className="card-elevated p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <div className="text-xs text-muted-foreground mb-1">بحث (المالك / رقم الفاتورة / السبب)</div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث…" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">من</div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">إلى</div>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button variant="outline" className="gap-2" onClick={exportExcel} disabled={!filtered.length}>
          <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
        </Button>
      </div>

      <DataTable
        onView={setView}
        loading={loading}
        rows={filtered}
        empty="لا توجد تجاوزات مسجّلة — كل المرتجعات تمت داخل الفترة المسموحة ✅"
        columns={[
          { key: "created_at", header: "التاريخ", render: (r: Row) => formatDateTime(r.created_at) },
          { key: "user_name", header: "المالك المُتجاوِز", render: (r: Row) => r.user_name || "—" },
          { key: "branch", header: "الفرع", render: (r: Row) => r.branches?.name ?? "—" },
          {
            key: "invoice",
            header: "الفاتورة",
            render: (r: Row) => (
              <span className="font-semibold">{r.details?.invoice_number ?? r.entity_id?.slice(0, 8) ?? "—"}</span>
            ),
          },
          {
            key: "days",
            header: "التجاوز",
            render: (r: Row) => {
              const d = Number(r.details?.days_since ?? 0);
              const w = Number(r.details?.window_days ?? 0);
              const over = Math.max(0, d - w);
              return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/15 text-warning text-xs font-bold">
                  {d} يوم / حد {w} — زيادة {over}
                </span>
              );
            },
          },
          {
            key: "reason",
            header: "السبب",
            render: (r: Row) => <span className="text-sm">{r.details?.reason || "—"}</span>,
          },
        ]}
      />
    </div>
  );

  if (embedded) return body;

  return (
    <AdminLayout>
      <PageHeader title="تجاوزات نافذة المرتجعات" subtitle="كل مرتجع تم بعد انتهاء الفترة المسموحة — مين تجاوز، امتى، والسبب" />
      {body}
    </AdminLayout>
  );
}
