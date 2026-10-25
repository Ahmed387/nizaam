import { applyCairoRange, cairoTodayDay } from "@/lib/cairoDate";
import { PermCard } from "@/contexts/PermCustomize";
import { PermPart } from "@/contexts/PermCustomize";
import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { formatEGP, formatDateTime } from "@/lib/format";
import { fetchRecentDocs, RECENT_DOC_KIND_CLASS, type RecentDoc } from "@/lib/recentDocs";
import {
  DollarSign, AlertTriangle, Plus, Users, Boxes, Receipt, CheckSquare,
  BarChart3, Building2, ShoppingCart, PackagePlus, ArrowRightLeft, ArrowUpRight,
  HandCoins, ClipboardCheck, Wallet, FileText, ClipboardList, Paperclip,
  BookmarkPlus, RotateCcw, Undo2, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, Truck,
} from "lucide-react";
import { BusinessSnapshot } from "@/components/reports/BusinessSnapshot";
import { FinancialAmount } from "@/components/FinancialAmount";
import { DetailsChevron } from "@/components/DetailsChevron";
import { RecentDocDetails } from "@/components/RecentDocDetails";

export default function AdminDashboard() {
  const nav = useNavigate();
  // audit tools (data errors, alerts, overdue marking) are admin only on the server — a viewer / partner never calls them
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [salesToday, setSalesToday] = useState(0);
  const [invoicesToday, setInvoicesToday] = useState(0);
  const [lowStock, setLowStock] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [activeSessions, setActiveSessions] = useState(0);
  const [branchSummary, setBranchSummary] = useState<any[]>([]);
  const [recent, setRecent] = useState<RecentDoc[]>([]);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const toggleRow = (key: string) => setExpandedRowId((prev) => (prev === key ? null : key));
  const [activeCountBranches, setActiveCountBranches] = useState<Set<string>>(new Set());
  const [integrity, setIntegrity] = useState<{ errors: number; warnings: number; info: number } | null>(null);

  const load = useCallback(async () => {
    // «اليوم» حسب توقيت القاهرة — مش ساعة الجهاز. كل الصفوف (بدون حد 1000) ومن نفس الاستعلام للكروت والفروع.
    const day = cairoTodayDay();
    const [invToday, prods, { data: branches }, { count: approvalsCount }, sessions, audit] = await Promise.all([
      fetchAllRows<any>(() => applyCairoRange(
        supabase.from("invoices").select("id, total, branch_id").eq("status", "active").not("is_migrated", "is", true),
        "invoice_date", day, day).order("id")),
      fetchAllRows<any>(() => supabase.from("products").select("id, quantity, low_stock_alert").is("archived_at", null).order("id")),
      supabase.from("branches").select("*").eq("is_active", true).eq("is_system", false),
      supabase.from("approval_requests" as any).select("id", { count: "exact", head: true }).eq("status", "pending"),
      fetchAllRows<any>(() => supabase.from("inventory_sessions" as any).select("id, branch_id").in("status", ["counting", "reviewing", "pending_approval"]).order("id")),
      isAdmin ? (supabase.rpc as any)("system_integrity_summary", { p_tenant: null }).then((r: any) => r.data ?? null, () => null) : Promise.resolve(null),
    ]);

    const r2 = (v: number) => Math.round(v * 100) / 100;
    setSalesToday(r2(invToday.reduce((s, x) => s + Number(x.total), 0)));
    setInvoicesToday(invToday.length);
    // one definition of "low stock" everywhere: an alert level is set and the quantity reached it
    setLowStock(prods.filter((p) => Number(p.low_stock_alert || 0) > 0 && Number(p.quantity || 0) <= Number(p.low_stock_alert)).length);
    setPendingApprovals(approvalsCount ?? 0);
    setActiveSessions(sessions.length);
    setIntegrity(audit);
    setRecent(await fetchRecentDocs(5));
    setActiveCountBranches(new Set(sessions.map((s: any) => s.branch_id)));

    // Branch cards — today's sales only (operational, no profit/treasury), same rows as the card above
    setBranchSummary((branches ?? []).map((b) => ({
      ...b,
      todaySales: r2(invToday.filter((x) => x.branch_id === b.id).reduce((s, x) => s + Number(x.total), 0)),
    })));

    setLoading(false);
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try { await supabase.rpc("mark_overdue_installments" as any); } catch {}
      try { await supabase.rpc("generate_alerts" as any); } catch {}
    })();
  }, [isAdmin]);
  useRealtimeRefresh(
    ["invoices", "products", "branches", "inventory_sessions", "approval_requests"],
    load
  );

  return (
    <AdminLayout>
      <PageHeader title="الرئيسية" subtitle="بنكسب ولا بنخسر — والنهارده عامل إيه" />


      {/* 1) The answer first: are we winning, and what is the stock worth (this month) */}
      <PermPart page="admin_home" part="business_snapshot" group><div className="mb-6"><BusinessSnapshot compact /></div></PermPart>

      {/* 2) Today — four plain numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <PermPart page="admin_home" part="sales_today">
        <Link to="/admin/reports-hub?tab=central" className="block hover:scale-[1.02] transition-transform" title="افتح التقارير التفصيلية">
          <StatCard label="مبيعات النهارده" value={formatEGP(salesToday)} icon={<DollarSign className="w-5 h-5" />} accent="success" hint={`${invoicesToday} فاتورة`} />
        </Link>
        </PermPart>
        <PermPart page="admin_home" part="low_stock">
        <StatCard label="أصناف قربت تخلص" value={lowStock} icon={<AlertTriangle className="w-5 h-5" />} accent={lowStock > 0 ? "warning" : "secondary"} />
        </PermPart>
        <PermPart page="admin_home" part="pending_approvals">
        <Link to="/admin/approvals-hub?tab=approvals" className="block hover:scale-[1.02] transition-transform">
          <StatCard label="طلبات مستنية موافقتك" value={pendingApprovals} icon={<CheckSquare className="w-5 h-5" />} accent={pendingApprovals > 0 ? "warning" : "secondary"} />
        </Link>
        </PermPart>
        {isAdmin && <PermPart page="admin_home" part="data_errors">
        <Link to="/admin/system-health?tab=integrity" className="block hover:scale-[1.02] transition-transform">
          <StatCard label="أخطاء في البيانات" value={integrity?.errors ?? 0} icon={<ClipboardCheck className="w-5 h-5" />} accent={integrity && integrity.errors > 0 ? "warning" : "secondary"} hint={integrity ? `${integrity.warnings} تنبيه` : undefined} />
        </Link>
        </PermPart>}
      </div>

      <PermPart page="admin_home" part="branches" group>
      {/* 3) Branches — one small card each: today's sales and the four daily actions */}
      <div className="mb-6">
        <h3 className="font-bold text-lg mb-3">الفروع</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {branchSummary.map((b: any) => (
            <PermCard key={b.id} label={`كارت فرع ${b.name}`}><div className="card-elevated p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-5 h-5 text-primary shrink-0" />
                  <span className="font-bold truncate">{b.name}</span>
                  {activeCountBranches.has(b.id) && <span className="text-[10px] rounded bg-warning/20 text-warning px-1.5 py-0.5 font-bold">جرد</span>}
                </div>
                <Button asChild size="sm" className="gap-1"><Link to={`/branch/${b.id}/dashboard`}>دخول <ArrowUpRight className="w-4 h-4" /></Link></Button>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                <span className="text-sm text-muted-foreground">مبيعات النهارده</span>
                <FinancialAmount value={b.todaySales} size="md" className="justify-end font-extrabold text-success" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { to: `/branch/${b.id}/sales/new`, label: "بيع", icon: ShoppingCart, cls: "text-success bg-success/10" },
                  { to: `/branch/${b.id}/shipments/new`, label: "شراء", icon: PackagePlus, cls: "text-primary bg-primary/10" },
                  { to: `/branch/${b.id}/treasury?tab=receipts`, label: "قبض", icon: ArrowDownCircle, cls: "text-success bg-success/10" },
                  { to: `/branch/${b.id}/treasury?tab=payments`, label: "صرف", icon: ArrowUpCircle, cls: "text-destructive bg-destructive/10" },
                ].map((q) => (
                  <Link key={q.label} to={q.to} className={`flex flex-col items-center gap-1 rounded-lg py-2 text-xs font-bold ${q.cls} hover:opacity-80`}>
                    <q.icon className="w-4 h-4" />{q.label}
                  </Link>
                ))}
              </div>
            </div></PermCard>
          ))}
        </div>
      </div>
      </PermPart>

      <PermPart page="admin_home" part="recent_docs">
      {/* Latest 5 documents */}
      <div>
        <h3 className="font-bold mb-3">آخر 5 حركات</h3>
        <DataTable
          loading={loading}
          rows={recent}
          empty="لا توجد حركات"
          onRowClick={(r: RecentDoc) => nav(r.path)}
          indexColumn
          getRowKey={(r: RecentDoc) => `${r.kind}-${r.id}`}
          isRowExpanded={(r: RecentDoc) => expandedRowId === `${r.kind}-${r.id}`}
          renderExpandedRow={(r: RecentDoc) => <PermPart page="admin_home" part="doc_details"><RecentDocDetails doc={r} /></PermPart>}
          columns={[
            {
              key: "kind",
              header: "النوع",
              render: (r: RecentDoc) => (
                <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${RECENT_DOC_KIND_CLASS[r.kind]}`}>{r.kindLabel}</span>
              ),
            },
            {
              key: "number",
              header: "رقم",
              render: (r: RecentDoc) => (
                <span className="inline-flex items-center gap-1">
                  <button type="button" className="text-primary font-medium hover:underline" onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleRow(`${r.kind}-${r.id}`); }}>{r.number}</button>
                  <DetailsChevron label="عرض تفاصيل المستند" expanded={expandedRowId === `${r.kind}-${r.id}`} onClick={() => toggleRow(`${r.kind}-${r.id}`)} />
                </span>
              ),
            },
            { key: "branch", header: "الفرع", render: (r: RecentDoc) => r.branch_name ?? "—" },
            { key: "party", header: "الطرف", render: (r: RecentDoc) => r.party },
            { key: "amount", header: "المبلغ", render: (r: RecentDoc) => formatEGP(r.amount) },
            { key: "created_at", header: "الوقت", render: (r: RecentDoc) => formatDateTime(r.created_at) },
          ]}
        />
      </div>
      </PermPart>
    </AdminLayout>
  );
}
