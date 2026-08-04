import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import {
  DollarSign, AlertTriangle, Trash2, Plus, Users, Boxes, Receipt, CheckSquare,
  BarChart3, Building2, ShoppingCart, PackagePlus, ArrowRightLeft, ArrowUpRight,
  HandCoins, ClipboardCheck, Wallet, FileText, ClipboardList, Paperclip,
  BookmarkPlus, RotateCcw, Undo2, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, Truck,
} from "lucide-react";
import { ExecutiveProfitSummary } from "@/components/ExecutiveProfitSummary";
import { KpiHealthAlert } from "@/components/KpiHealthAlert";
import { BudgetAlertsWidget } from "@/components/BudgetAlertsWidget";

export default function AdminDashboard() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [salesToday, setSalesToday] = useState(0);
  const [invoicesToday, setInvoicesToday] = useState(0);
  const [lowStock, setLowStock] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [activeSessions, setActiveSessions] = useState(0);
  const [branchSummary, setBranchSummary] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [activeCountBranches, setActiveCountBranches] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const [
      { data: invToday },
      { data: prods },
      { data: branches },
      { data: recentInv },
      { data: approvals },
      { data: sessions },
    ] = await Promise.all([
      supabase.from("invoices").select("total").eq("status", "active").gte("created_at", todayIso),
      supabase.from("products").select("quantity, low_stock_alert").is("archived_at", null),
      supabase.from("branches").select("*").eq("is_active", true).neq("code", "PARTNER-CASH"),
      supabase.from("invoices").select("*, branches(name)").order("created_at", { ascending: false }).limit(5),
      supabase.from("approval_requests" as any).select("id").eq("status", "pending"),
      supabase
        .from("inventory_sessions" as any)
        .select("branch_id")
        .in("status", ["counting", "reviewing", "pending_approval"]),
    ]);

    setSalesToday((invToday ?? []).reduce((s, x) => s + Number(x.total), 0));
    setInvoicesToday((invToday ?? []).length);
    setLowStock((prods ?? []).filter((p) => p.quantity <= p.low_stock_alert).length);
    setPendingApprovals((approvals ?? []).length);
    setActiveSessions((sessions ?? []).length);
    setRecent(recentInv ?? []);
    setActiveCountBranches(new Set((sessions ?? []).map((s: any) => s.branch_id)));

    // Branch cards — today's sales only (operational, no profit/treasury)
    const summary = await Promise.all(
      (branches ?? []).map(async (b) => {
        const { data: sales } = await supabase
          .from("invoices")
          .select("total")
          .eq("branch_id", b.id)
          .eq("status", "active")
          .gte("created_at", todayIso);
        const todaySales = (sales ?? []).reduce((s, x) => s + Number(x.total), 0);
        return { ...b, todaySales };
      })
    );
    setBranchSummary(summary);

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      try { await supabase.rpc("mark_overdue_installments" as any); } catch {}
      try { await supabase.rpc("generate_alerts" as any); } catch {}
    })();
  }, []);
  useRealtimeRefresh(
    ["invoices", "products", "branches", "inventory_sessions", "approval_requests"],
    load
  );

  return (
    <AdminLayout>
      <PageHeader title="لوحة التحكم العامة" subtitle="نظرة تشغيلية على اليوم — كل الفروع"
        actions={
          <Button asChild variant="destructive" size="sm" className="gap-2">
            <Link to="/admin/settings#reset"><Trash2 className="w-4 h-4" /> إعادة تعيين بيانات الشركة</Link>
          </Button>
        }
      />

      <KpiHealthAlert />

      <BudgetAlertsWidget />

      <ExecutiveProfitSummary />

      {/* Operational KPIs — TODAY only */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <Link to="/admin/reports?tab=central" className="block hover:scale-[1.02] transition-transform" title="افتح التقارير التفصيلية">
          <StatCard label="مبيعات اليوم" value={formatEGP(salesToday)} icon={<DollarSign className="w-5 h-5" />} accent="success" hint={`${invoicesToday} فاتورة`} />
        </Link>
        <StatCard label="فواتير اليوم" value={invoicesToday} icon={<FileText className="w-5 h-5" />} accent="primary" />
        <StatCard label="منتجات تحت الحد" value={lowStock} icon={<AlertTriangle className="w-5 h-5" />} accent="warning" />
        <Link to="/admin/approvals-hub?tab=approvals" className="block hover:scale-[1.02] transition-transform">
          <StatCard label="موافقات معلقة" value={pendingApprovals} icon={<CheckSquare className="w-5 h-5" />} accent={pendingApprovals > 0 ? "warning" : "secondary"} />
        </Link>
        <StatCard label="جلسات جرد نشطة" value={activeSessions} icon={<ClipboardList className="w-5 h-5" />} accent={activeSessions > 0 ? "primary" : "secondary"} />
      </div>

      {/* Link to Financial Dashboard (treasury, receivables, payables live there) */}
      <div className="card-elevated p-4 mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-success/15 text-success flex items-center justify-center">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-sm">للأرقام المالية: الخزنة، المديونيات، الأرباح</div>
            <div className="text-xs text-muted-foreground">شاهد التفاصيل في الداشبورد المالي والتقارير</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/admin/financial-dashboard"><Wallet className="w-4 h-4" /> الداشبورد المالي</Link>
          </Button>
          <Button asChild size="sm" className="gap-2">
            <Link to="/admin/reports"><BarChart3 className="w-4 h-4" /> التقارير التفصيلية</Link>
          </Button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="card-elevated p-4 mb-6">
        <h3 className="font-bold mb-3 text-sm text-muted-foreground">إجراءات سريعة — على مستوى الشركة</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            { to: "/admin/branches", label: "إضافة فرع", icon: Plus, color: "text-primary", bg: "bg-primary/10" },
            { to: "/admin/employees", label: "الموظفين", icon: Users, color: "text-secondary", bg: "bg-secondary/10" },
            { to: "/admin/catalog?tab=pricelist", label: "الكتالوج", icon: Boxes, color: "text-primary", bg: "bg-primary/10" },
            { to: "/admin/vouchers", label: "كل السندات", icon: Receipt, color: "text-success", bg: "bg-success/10" },
            { to: "/admin/approvals-hub?tab=approvals", label: "الموافقات", icon: CheckSquare, color: "text-warning", bg: "bg-warning/10" },
            { to: "/admin/receivables", label: "المديونيات", icon: HandCoins, color: "text-destructive", bg: "bg-destructive/10" },
            { to: "/admin/reports", label: "التقارير", icon: BarChart3, color: "text-primary", bg: "bg-primary/10" },
            { to: "/admin/attachments", label: "كل المرفقات", icon: Paperclip, color: "text-accent-foreground", bg: "bg-accent/10" },
          ].map((s) => (
            <Link key={s.label} to={s.to}
              className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border hover:border-primary hover:shadow-md transition-all group">
              <div className={`w-11 h-11 rounded-full ${s.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <span className="text-[11px] font-semibold text-center leading-tight">{s.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Branch entry cards — redesigned bento */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-7 w-1.5 bg-primary rounded-full" />
          <h3 className="font-bold text-xl">الفروع — دخول مباشر وإجراءات سريعة</h3>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {branchSummary.map((b: any) => (
            <div key={b.id} className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-sm hover:shadow-lg transition-shadow">
              {activeCountBranches.has(b.id) && (
                <div className="absolute top-4 -left-12 rotate-[-45deg] bg-warning text-warning-foreground text-[10px] font-bold px-12 py-1 shadow-md z-10 flex items-center gap-1 justify-center">
                  <ClipboardCheck className="w-3 h-3" /> جارٍ الجرد
                </div>
              )}
              {/* Header strip */}
              <div className="bg-gradient-to-l from-primary/20 via-primary/10 to-transparent p-5 border-b border-border">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-md">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-xl truncate">{b.name}</div>
                    <div className="text-sm font-medium text-muted-foreground">{b.code ?? "—"}</div>
                  </div>
                </div>
                {/* Large branch entry button */}
                <Button asChild size="lg" className="w-full mt-4 gap-2 text-base font-bold shadow-md">
                  <Link to={`/branch/${b.id}/dashboard`}>دخول الفرع <ArrowUpRight className="w-5 h-5" /></Link>
                </Button>
              </div>

              {/* Today's sales */}
              <Link
                to={`/admin/reports?branch=${b.id}`}
                className="mx-4 mt-4 flex items-center justify-between p-4 rounded-xl bg-card hover:bg-surface-2 transition border border-border"
                title="عرض تقرير الفرع التفصيلي"
              >
                <span className="text-base font-semibold text-muted-foreground">مبيعات اليوم</span>
                <b className="text-success text-2xl">{formatEGP(b.todaySales)}</b>
              </Link>

              {/* Quick actions grid — clearer colors */}
              <div className="p-4">
                <div className="text-sm font-bold text-foreground mb-3 px-1">الإجراءات السريعة</div>
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { to: `/branch/${b.id}/sales/new`, label: "بيع", icon: ShoppingCart, color: "text-success", bg: "bg-success/20", border: "border-success/40", hover: "hover:bg-success/30" },
                    { to: `/branch/${b.id}/shipments/new`, label: "شراء", icon: PackagePlus, color: "text-primary", bg: "bg-primary/20", border: "border-primary/40", hover: "hover:bg-primary/30" },
                    { to: `/branch/${b.id}/pre-orders`, label: "حجز", icon: BookmarkPlus, color: "text-secondary", bg: "bg-secondary/20", border: "border-secondary/40", hover: "hover:bg-secondary/30" },
                    { to: `/branch/${b.id}/invoices?tab=sale_return`, label: "مرتجع بيع", icon: RotateCcw, color: "text-warning", bg: "bg-warning/20", border: "border-warning/40", hover: "hover:bg-warning/30" },
                    { to: `/branch/${b.id}/invoices?tab=purchase_return`, label: "مرتجع شراء", icon: Undo2, color: "text-warning", bg: "bg-warning/20", border: "border-warning/40", hover: "hover:bg-warning/30" },
                    { to: `/branch/${b.id}/treasury?tab=receipts`, label: "قبض", icon: ArrowDownCircle, color: "text-success", bg: "bg-success/20", border: "border-success/40", hover: "hover:bg-success/30" },
                    { to: `/branch/${b.id}/treasury?tab=payments`, label: "صرف", icon: ArrowUpCircle, color: "text-destructive", bg: "bg-destructive/20", border: "border-destructive/40", hover: "hover:bg-destructive/30" },
                    { to: `/branch/${b.id}/transfers`, label: "تحويل", icon: ArrowLeftRight, color: "text-primary", bg: "bg-primary/20", border: "border-primary/40", hover: "hover:bg-primary/30" },
                    { to: `/branch/${b.id}/invoices?tab=quote`, label: "عرض سعر", icon: FileText, color: "text-secondary", bg: "bg-secondary/20", border: "border-secondary/40", hover: "hover:bg-secondary/30" },
                    { to: `/branch/${b.id}/inventory?tab=count`, label: "جرد", icon: ClipboardList, color: "text-primary", bg: "bg-primary/20", border: "border-primary/40", hover: "hover:bg-primary/30" },
                    { to: `/branch/${b.id}/inventory?tab=adjustments`, label: "تسوية", icon: ClipboardList, color: "text-warning", bg: "bg-warning/20", border: "border-warning/40", hover: "hover:bg-warning/30" },
                    { to: `/branch/${b.id}/shipments`, label: "الشحنات", icon: Truck, color: "text-primary", bg: "bg-primary/20", border: "border-primary/40", hover: "hover:bg-primary/30" },
                    { to: `/branch/${b.id}/treasury`, label: "الخزنة", icon: Wallet, color: "text-primary", bg: "bg-primary/20", border: "border-primary/40", hover: "hover:bg-primary/30" },
                    { to: `/branch/${b.id}/reports`, label: "التقارير", icon: BarChart3, color: "text-secondary", bg: "bg-secondary/20", border: "border-secondary/40", hover: "hover:bg-secondary/30" },
                    { to: `/branch/${b.id}/attachments`, label: "المرفقات", icon: Paperclip, color: "text-muted-foreground", bg: "bg-muted", border: "border-border", hover: "hover:bg-muted/70" },
                  ].map((q) => (
                    <Link key={q.label} to={q.to}
                      className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl ${q.bg} border ${q.border} ${q.hover} transition-all hover:scale-105 hover:shadow-md group`}>
                      <q.icon className={`w-5 h-5 ${q.color}`} />
                      <span className={`text-xs font-bold text-center leading-tight ${q.color}`}>{q.label}</span>
                    </Link>
                  ))}
                </div>
              </div>

            </div>
          ))}
        </div>
      </div>


      {/* Latest 5 invoices */}
      <div>
        <h3 className="font-bold mb-3">آخر 5 فواتير</h3>
        <DataTable
          loading={loading}
          rows={recent}
          empty="لا توجد فواتير"
          onRowClick={(r: any) => nav(`/branch/${r.branch_id}/sales/${r.id}`)}
          columns={[
            {
              key: "invoice_number",
              header: "رقم",
              render: (r: any) => (
                <span className="text-primary font-medium hover:underline">{r.invoice_number}</span>
              ),
            },
            { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
            { key: "total", header: "المبلغ", render: (r: any) => formatEGP(r.total) },
            { key: "created_at", header: "الوقت", render: (r: any) => formatDateTime(r.created_at) },
          ]}
        />
      </div>
    </AdminLayout>
  );
}
