import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/StatCard";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { BookmarkPlus, Clock, CheckCircle2, XCircle, PackageCheck } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

const STATUS_LABEL: Record<string, { ar: string; cls: string }> = {
  pending:   { ar: "في الانتظار", cls: "bg-warning/15 text-warning" },
  received:  { ar: "وصل", cls: "bg-primary/15 text-primary" },
  completed: { ar: "اكتمل", cls: "bg-success/15 text-success" },
  cancelled: { ar: "ملغي", cls: "bg-destructive/15 text-destructive" },
};

export default function AllPreOrders() {
  const [rows, setRows] = useState<any[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [branchFilter, setBranchFilter] = useState<string>("all");

  const load = async () => {
    const [{ data: po }, { data: br }] = await Promise.all([
      supabase.from("pre_orders").select("*").order("created_at", { ascending: false }),
      supabase.from("branches").select("id, name").neq("code", "PARTNER-CASH"),
    ]);
    setRows(po ?? []);
    setBranches(Object.fromEntries((br ?? []).map((b: any) => [b.id, b.name])));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useRealtimeRefresh(
    ["pre_orders", "pre_order_transactions", "invoices", "invoice_payments", "payment_transactions", "payment_plans"],
    load
  );

  const stats = useMemo(() => ({
    pending: rows.filter((r) => r.status === "pending").length,
    received: rows.filter((r) => r.status === "received").length,
    completed: rows.filter((r) => r.status === "completed").length,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
    deposits: rows.filter((r) => r.status !== "cancelled" || !r.deposit_refunded)
      .reduce((s, r) => s + Number(r.deposit_amount || 0), 0),
  }), [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (branchFilter !== "all" && r.branch_id !== branchFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.order_number?.toLowerCase().includes(q)
        || r.customer_name?.toLowerCase().includes(q)
        || r.customer_phone?.toLowerCase().includes(q)
        || r.product_name?.toLowerCase().includes(q);
    }
    return true;
  }), [rows, search, statusFilter, branchFilter]);

  return (
    <AdminLayout>
      <PageHeader title="الحجوزات (كل الفروع)" subtitle="عرض موحد لكل حجوزات العملاء" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="في الانتظار" value={String(stats.pending)} icon={<Clock className="w-5 h-5" />} />
        <StatCard label="وصل — جاهز" value={String(stats.received)} icon={<PackageCheck className="w-5 h-5" />} />
        <StatCard label="اكتمل" value={String(stats.completed)} icon={<CheckCircle2 className="w-5 h-5" />} />
        <StatCard label="ملغي" value={String(stats.cancelled)} icon={<XCircle className="w-5 h-5" />} />
        <StatCard label="إجمالي العربون" value={formatEGP(stats.deposits)} icon={<BookmarkPlus className="w-5 h-5" />} />
      </div>

      <div className="card-elevated p-4 mb-4 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="ابحث برقم/عميل/منتج" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="bg-input border border-border rounded-lg px-3 py-2 text-sm" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="all">كل الفروع</option>
          {Object.entries(branches).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <div className="flex gap-1 flex-wrap">
          {[
            { v: "all", label: "الكل" },
            { v: "pending", label: "في الانتظار" },
            { v: "received", label: "وصل" },
            { v: "completed", label: "اكتمل" },
            { v: "cancelled", label: "ملغي" },
          ].map((f) => (
            <Button key={f.v} size="sm" variant={statusFilter === f.v ? "default" : "outline"} onClick={() => setStatusFilter(f.v)}>{f.label}</Button>
          ))}
        </div>
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        empty="لا توجد حجوزات"
        columns={[
          { key: "order_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary font-bold">{r.order_number}</span> },
          { key: "branch", header: "الفرع", render: (r: any) => branches[r.branch_id] ?? "—" },
          { key: "customer", header: "العميل", render: (r: any) => (
            <div>
              <div className="font-semibold">{r.customer_name}</div>
              {r.customer_phone && <div className="text-xs text-muted-foreground" dir="ltr">{r.customer_phone}</div>}
            </div>
          )},
          { key: "product", header: "المنتج", render: (r: any) => (
            <div>
              <div>{r.product_name}</div>
              {r.model_code && <div className="text-xs text-muted-foreground">{r.model_code}</div>}
              <div className="text-xs text-muted-foreground">كمية: {r.quantity}</div>
            </div>
          )},
          { key: "deposit", header: "العربون", render: (r: any) =>
            Number(r.deposit_amount) > 0
              ? <span className="text-success font-bold">{formatEGP(r.deposit_amount)}</span>
              : <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground">بدون</span>
          },
          { key: "total", header: "الإجمالي المتوقع", render: (r: any) => formatEGP(Number(r.expected_price) * r.quantity) },
          { key: "status", header: "الحالة", render: (r: any) => {
            const s = STATUS_LABEL[r.status] ?? { ar: r.status, cls: "" };
            return <span className={`px-2 py-1 rounded text-xs font-bold ${s.cls}`}>{s.ar}</span>;
          }},
          { key: "created_by", header: "أنشأه", render: (r: any) => r.created_by_name ?? "—" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ]}
      />
    </AdminLayout>
  );
}
