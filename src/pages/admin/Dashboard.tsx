import { applyCairoRange, cairoTodayDay } from "@/lib/cairoDate";
import { fetchOpeningSummary, type OpeningSummary } from "@/lib/ledger";
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
import { ExecutiveProfitSummary } from "@/components/ExecutiveProfitSummary";
import { KpiHealthAlert } from "@/components/KpiHealthAlert";
import { BudgetAlertsWidget } from "@/components/BudgetAlertsWidget";
import { FinancialAmount } from "@/components/FinancialAmount";
import { DetailsChevron } from "@/components/DetailsChevron";
import { RecentDocDetails } from "@/components/RecentDocDetails";

export default function AdminDashboard() {
  const nav = useNavigate();
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
  const [opening, setOpening] = useState<OpeningSummary | null>(null);
  const [integrity, setIntegrity] = useState<{ errors: number; warnings: number; info: number } | null>(null);

  const load = useCallback(async () => {
    // «اليوم» حسب توقيت القاهرة — مش ساعة الجهاز. كل الصفوف (بدون حد 1000) ومن نفس الاستعلام للكروت والفروع.
    const day = cairoTodayDay();
    const [invToday, prods, { data: branches }, { count: approvalsCount }, sessions, ob, audit] = await Promise.all([
      fetchAllRows<any>(() => applyCairoRange(
        supabase.from("invoices").select("id, total, branch_id").eq("status", "active").not("is_migrated", "is", true),
        "invoice_date", day, day).order("id")),
      fetchAllRows<any>(() => supabase.from("products").select("id, quantity, low_stock_alert").is("archived_at", null).order("id")),
      supabase.from("branches").select("*").eq("is_active", true).eq("is_system", false),
      supabase.from("approval_requests" as any).select("id", { count: "exact", head: true }).eq("status", "pending"),
      fetchAllRows<any>(() => supabase.from("inventory_sessions" as any).select("id, branch_id").in("status", ["counting", "reviewing", "pending_approval"]).order("id")),
      fetchOpeningSummary().catch(() => null),
      (supabase.rpc as any)("system_integrity_summary", { p_tenant: null }).then((r: any) => r.data ?? null, () => null),
    ]);

    const r2 = (v: number) => Math.round(v * 100) / 100;
    setSalesToday(r2(invToday.reduce((s, x) => s + Number(x.total), 0)));
    setInvoicesToday(invToday.length);
    // one definition of "low stock" everywhere: an alert level is set and the quantity reached it
    setLowStock(prods.filter((p) => Number(p.low_stock_alert || 0) > 0 && Number(p.quantity || 0) <= Number(p.low_stock_alert)).length);
    setPendingApprovals(approvalsCount ?? 0);
    setActiveSessions(sessions.length);
    setOpening(ob);
    setIntegrity(audit);
    setRecent(await fetchRecentDocs(5));
    setActiveCountBranches(new Set(sessions.map((s: any) => s.branch_id)));

    // Branch cards — today's sales only (operational, no profit/treasury), same rows as the card above
    setBranchSummary((branches ?? []).map((b) => ({
      ...b,
      todaySales: r2(invToday.filter((x) => x.branch_id === b.id).reduce((s, x) => s + Number(x.total), 0)),
    })));

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
      <PageHeader title="لوحة التحكم العامة" subtitle="نظرة تشغيلية على اليوم — كل الفروع" />


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

      {/* Opening balances (linked to the main treasury) + data integrity checks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Link to="/admin/accounting/opening-balances" className="card-elevated p-4 block hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="font-bold text-sm">الأرصدة الافتتاحية {opening?.main_treasury ? `— ${opening.main_treasury.name}` : ""}</div>
            <span className="text-xs text-muted-foreground">{opening?.as_of ? `بتاريخ ${opening.as_of}` : "لسه ما اترحلتش"}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-xs">
            <div><div className="text-muted-foreground">نقدية أول المدة</div><b>{formatEGP(opening?.cash_total ?? 0)}</b></div>
            <div><div className="text-muted-foreground">مديونية عملاء</div><b>{formatEGP(opening?.customers_debt ?? 0)}</b></div>
            <div><div className="text-muted-foreground">مقدمات عملاء</div><b>{formatEGP(opening?.customers_advance ?? 0)}</b></div>
            <div><div className="text-muted-foreground">مستحقات موردين</div><b>{formatEGP(opening?.suppliers_payable ?? 0)}</b></div>
            <div><div className="text-muted-foreground">مقدمات لينا عند موردين</div><b>{formatEGP(opening?.suppliers_advance ?? 0)}</b></div>
            <div><div className="text-muted-foreground">مخزون أول المدة</div><b>{formatEGP(opening?.inventory_value ?? 0)}</b></div>
          </div>
        </Link>
        <Link to="/admin/system-health?tab=integrity" className={`card-elevated p-4 block hover:shadow-md transition-shadow ${integrity && integrity.errors > 0 ? "border-destructive/40 bg-destructive/5" : ""}`}>
          <div className="flex items-center justify-between">
            <div className="font-bold text-sm">فحص سلامة البيانات (تلقائي)</div>
            <AlertTriangle className={`w-4 h-4 ${integrity && integrity.errors > 0 ? "text-destructive" : "text-muted-foreground"}`} />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
            <div><div className="text-muted-foreground">أخطاء</div><b className={integrity && integrity.errors > 0 ? "text-destructive" : ""}>{integrity?.errors ?? "—"}</b></div>
            <div><div className="text-muted-foreground">تنبيهات</div><b>{integrity?.warnings ?? "—"}</b></div>
            <div><div className="text-muted-foreground">معلومات</div><b>{integrity?.info ?? "—"}</b></div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">أرصدة افتتاحية × مقدمات بين الفروع، تكرار دفعات، مستندات ومرتجعات وخزنة ومخزون وقيود.</div>
        </Link>
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
                <FinancialAmount value={b.todaySales} size="md" className="justify-end font-extrabold text-success" />
              </Link>

              {/* Quick actions grid — clearer colors */}
              <div className="p-4">
                <div className="text-sm font-bold text-foreground mb-3 px-1">الإجراءات السريعة</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
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
                    { to: `/branch/${b.id}/shipments`, label: "فواتير الشراء", icon: Truck, color: "text-primary", bg: "bg-primary/20", border: "border-primary/40", hover: "hover:bg-primary/30" },
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
          renderExpandedRow={(r: RecentDoc) => <RecentDocDetails doc={r} />}
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
    </AdminLayout>
  );
}
