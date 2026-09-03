import { ReactNode, useEffect, useState } from "react";
import {
  Home, Store, FolderTree, ListChecks, BarChart3, ScrollText, Settings, Sparkles,
  ShoppingCart, PackagePlus, Boxes, UserCircle, Factory, Wallet, BadgeDollarSign, Receipt, ArrowLeftRight, HandCoins, Warehouse, LayoutDashboard, CalendarRange, BookmarkPlus, ClipboardCheck, Coins, FileText, ArrowDownCircle, ArrowUpCircle, BookOpen, ShieldCheck, Inbox, TrendingUp, Percent, Trash2, History,
Wand2, Building2 } from "lucide-react";
import { AppShell, NavItem } from "./AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

export function AdminLayout({ children }: { children: ReactNode }) {
  const { tenant, tenantId, branches, isAdmin, isSuperAdmin, isOwner, isViewer, hasRole, user, can } = useAuth();
  // A viewer sees exactly what the owner sees in the sidebar — read-only.
  const ownerView = isOwner || isViewer;
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [pendingDiscounts, setPendingDiscounts] = useState(0);
  const [mainTreasuryId, setMainTreasuryId] = useState<string | null>(null);
  const [hasPersonalExpAccess, setHasPersonalExpAccess] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("branches").select("id").eq("tenant_id", tenantId).eq("code", "PARTNER-CASH").maybeSingle()
      .then(({ data }) => setMainTreasuryId((data as any)?.id ?? null));
  }, [tenantId]);

  useEffect(() => {
    if (!user) { setHasPersonalExpAccess(false); return; }
    // Identity is resolved server-side (email OR login username), because some
    // accounts sign in with a generated internal email.
    supabase.rpc("personal_owner_info" as any).then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      setHasPersonalExpAccess(!!row?.owner_id && row?.access !== "none");
    });
  }, [user]);


  const loadPending = async () => {
    if (!tenantId || !isAdmin) return;
    const { count } = await supabase
      .from("approval_requests" as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "pending");
    setPendingApprovals(count ?? 0);
  };
  const loadDiscounts = async () => {
    if (!tenantId) return;
    const { count } = await supabase
      .from("discount_approval_requests" as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "pending");
    setPendingDiscounts(count ?? 0);
  };
  useEffect(() => { loadPending(); loadDiscounts(); }, [tenantId, isAdmin]);
  useRealtimeRefresh(["approval_requests"], loadPending);
  useRealtimeRefresh(["discount_approval_requests"], loadDiscounts);

  const totalAdminApprovals = (pendingApprovals || 0) + (pendingDiscounts || 0);

  // Role-based visibility gate — identical rules to the previous flat sidebar.
  const allow = (perm: string, opts: { to?: string; ownerOnly?: boolean; adminOnly?: boolean } = {}) => {
    if (ownerView) {
      if (isViewer && !isAdmin && opts.to === "/admin/settings") return false;
      return true;
    }
    if (opts.ownerOnly) return can(perm);
    return isAdmin || can(perm);
  };
  const only = (cond: boolean, item: NavItem): NavItem[] => (cond ? [item] : []);
  // A parent section stays visible when the user owns the parent permission OR
  // any of its (already permission-filtered) children. When the parent page
  // itself is not permitted, the header link points at the first allowed child
  // so no one gets a link to a page they cannot open, and empty dropdowns are
  // never rendered.
  const section = (parentAllowed: boolean, item: NavItem, children: NavItem[]): NavItem[] => {
    const kids = children.filter(Boolean);
    if (parentAllowed) return [{ ...item, children: kids.length ? kids : undefined }];
    if (!kids.length) return [];
    return [{ ...item, to: kids[0].to, children: kids }];
  };

  const adminNav: NavItem[] = [
    // ===== عام =====
    ...only(allow("admin_home.view"), { to: "/admin/dashboard", label: "الرئيسية", icon: <Home className="w-4 h-4" />, group: "عــام" }),
    ...only(allow("admin_ask_me.view"), { to: "/admin/ask-me", label: "اسألني", icon: <Sparkles className="w-4 h-4" />, group: "عــام" }),
    ...only(allow("admin_reports_hub.view"), { to: "/admin/reports-hub?tab=owner", label: "لوحة المالك", icon: <TrendingUp className="w-4 h-4" />, group: "عــام" }),
    ...only(allow("admin_insights.view", { ownerOnly: true }), { to: "/admin/insights", label: "الرؤى التنفيذية", icon: <Sparkles className="w-4 h-4" />, group: "عــام" }),

    // ===== العمليات =====
    ...section(
      allow("admin_catalog.view"),
      { to: "/admin/catalog?tab=branches", label: "الفروع والمخازن", icon: <Warehouse className="w-4 h-4" />, group: "العمليـات" },
      [
        ...(allow("admin_catalog.view") ? [
          { to: "/admin/catalog?tab=inventory", label: "مخزون كل الفروع", icon: <Boxes className="w-4 h-4" /> },
        ] : []),
        ...(allow("admin_product_attributes.view") ? [{ to: "/admin/product-attributes", label: "خصائص المنتجات", icon: <Wand2 className="w-4 h-4" /> }] : []),
        ...(allow("admin_catalog.view") ? [
          { to: "/admin/catalog?tab=categories", label: "التصنيفات", icon: <FolderTree className="w-4 h-4" /> },
          { to: "/admin/catalog?tab=pricelist", label: "قائمة الأسعار", icon: <ListChecks className="w-4 h-4" /> },
        ] : []),
      ],
    ),
    ...section(
      allow("admin_employees.view"),
      { to: "/admin/employees", label: "الموظفين", icon: <UserCircle className="w-4 h-4" />, group: "العمليـات" },
      [
        ...(allow("admin_employees.view") ? [{ to: "/admin/attendance", label: "الحضور والانصراف (كل الفروع)", icon: <ClipboardCheck className="w-4 h-4" /> }] : []),
        ...(allow("admin_shifts.view") ? [{ to: "/admin/shifts", label: "سجل الورديات", icon: <CalendarRange className="w-4 h-4" /> }] : []),
        ...(allow("admin_presence.view") ? [{ to: "/admin/presence", label: "تتبع المستخدمين", icon: <UserCircle className="w-4 h-4" /> }] : []),
      ],
    ),
    ...only(allow("admin_contacts.view"), { to: "/admin/contacts", label: "الحسابات", hint: "كل ما يتعلق بالعملاء والموردين وأرصدتهم وبياناتهم", icon: <Factory className="w-4 h-4" />, group: "العمليـات" }),

    // ===== المالية =====
    ...only(allow("admin_financial_position.view", { ownerOnly: true }), {
      to: "/admin/financial-position",
      label: "الذمم المالية",
      icon: <HandCoins className="w-4 h-4" />,
      group: "الماليـة",
      children: [
        { to: "/admin/financial-position?tab=partners", label: "الشركاء", icon: <UserCircle className="w-4 h-4" /> },
        { to: "/admin/financial-position?tab=advances", label: "سلف الشركاء", icon: <HandCoins className="w-4 h-4" /> },
      ],
    }),
    ...section(
      allow("admin_main_treasury.view", { adminOnly: true }),
      { to: "/admin/main-treasury", label: "الخزينة", icon: <Wallet className="w-4 h-4" />, group: "الماليـة" },
      [
        ...(allow("admin_finance.view") ? [{ to: "/admin/finance?tab=vouchers", label: "السندات المالية", icon: <Receipt className="w-4 h-4" /> }] : []),
        ...(allow("admin_finance.view") ? [{ to: "/admin/finance?tab=receivables", label: "ذمم العملاء والموردين", icon: <Coins className="w-4 h-4" /> }] : []),
        ...(allow("admin_finance.view", { adminOnly: true }) ? [{ to: "/admin/accounting/branch-capital", label: "تحويل فلوس للفروع", icon: <Building2 className="w-4 h-4" /> }] : []),
      ],
    ),
    ...section(
      allow("admin_reports_hub.view"),
      { to: "/admin/reports-hub?tab=central", label: "التقارير", icon: <BarChart3 className="w-4 h-4" />, group: "الماليـة" },
      [
        ...(allow("admin_reports_hub.view") ? [
          { to: "/admin/reports-hub?tab=monthly", label: "ملخص الأرباح", icon: <Coins className="w-4 h-4" /> },
          { to: "/admin/reports-hub?tab=profitability", label: "الربحية", icon: <TrendingUp className="w-4 h-4" /> },
          { to: "/admin/reports-hub?tab=comparison", label: "مقارنة الفترات", icon: <ArrowLeftRight className="w-4 h-4" /> },
          { to: "/admin/reports-hub?tab=scheduled", label: "المجدولة", icon: <CalendarRange className="w-4 h-4" /> },
        ] : []),
        ...(allow("admin_historical_analytics.view") ? [{ to: "/admin/historical-analytics", label: "الأرشيف والتحليل التاريخي", icon: <History className="w-4 h-4" /> }] : []),
      ],
    ),

    // ===== الإدارة =====
    ...section(
      allow("admin_settings.view", { to: "/admin/settings" }),
      { to: "/admin/settings", label: "الإعدادات", icon: <Settings className="w-4 h-4" />, group: "الإدارة" },
      [
        ...(allow("admin_system_health.view", { ownerOnly: true }) ? [{ to: "/admin/system-health", label: "فحص السيستم", icon: <ShieldCheck className="w-4 h-4" /> }] : []),
        ...(allow("admin_approvals.view", { adminOnly: true }) ? [{ to: "/admin/approvals-hub", label: "طلبات الموافقة", icon: <Inbox className="w-4 h-4" />, badge: totalAdminApprovals || undefined }] : []),
      ],
    }),

    // ===== مستقل =====
    ...only(hasPersonalExpAccess, { to: "/admin/personal-expenses", label: "المصاريف الشخصية", icon: <Wallet className="w-4 h-4" />, bigTitle: true }),
  ];





  // A role's normal branch permissions remain available when an individual
  // employee is granted extra admin pages. The extra grant is additive; it
  // must not make the admin sidebar look like it replaced the role access.
  // Employees linked to several branches get a full section per branch,
  // not only the first one — otherwise "الخزنة" always points at one branch.
  const employeeBranchNav: NavItem[] = !isAdmin
    ? branches.flatMap((br) => {
        const group = `فرع ${br.name}`;
        return [
          { to: `/branch/${br.id}/dashboard`, label: "الرئيسية", icon: <Home className="w-4 h-4" />, group },
          ...(can("invoices.view") ? [{ to: `/branch/${br.id}/invoices`, label: "الفواتير والمستندات", icon: <FileText className="w-4 h-4" />, group }] : []),
          ...(can("inventory.view") ? [{ to: `/branch/${br.id}/inventory`, label: "المخزون", icon: <Boxes className="w-4 h-4" />, group }] : []),
          ...(can("customers.view") || can("suppliers.view") ? [{ to: `/branch/${br.id}/contacts`, label: "العملاء والموردين", icon: <UserCircle className="w-4 h-4" />, group }] : []),
          ...(can("treasury.view") ? [{ to: `/branch/${br.id}/treasury`, label: `خزنة ${br.name}`, icon: <Wallet className="w-4 h-4" />, group }] : []),
          ...(can("employees.view") ? [{ to: `/branch/${br.id}/employees`, label: "الموظفين", icon: <BadgeDollarSign className="w-4 h-4" />, group }] : []),
          ...(can("reports.view") ? [{ to: `/branch/${br.id}/reports`, label: "تقارير الفرع", icon: <BarChart3 className="w-4 h-4" />, group }] : []),
        ] as NavItem[];
      })
    : [];


  const supervisorNav: NavItem[] = [
    { to: "/admin/employees", label: "الموظفين والحضور", icon: <ClipboardCheck className="w-4 h-4" /> },
    { to: "/admin/presence", label: "تتبع المستخدمين", icon: <UserCircle className="w-4 h-4" /> },
  ];

  // Any partner browsing the admin screens (with or without viewer role)
  // needs a way back to their partner portal.
  const partnerBackNav: NavItem[] = (!isAdmin && hasRole("partner")) ? [
    { to: "/partner/dashboard", label: "↩ بوابة الشريك", icon: <LayoutDashboard className="w-4 h-4" />, group: "التنقل" },
  ] : [];

  const nav = isAdmin || ownerView
    ? [...partnerBackNav, ...adminNav]
    : adminNav.length > 0
      ? [...partnerBackNav, ...adminNav, ...employeeBranchNav]
      : hasRole("supervisor")
        ? supervisorNav
        : employeeBranchNav;

  const subtitleText = isAdmin
    ? "لوحة التحكم العامة"
    : isViewer
      ? "لوحة التحكم العامة — عرض فقط"
      : hasRole("partner")
        ? "عرض فقط — بدون تعديل"
        : "ملاحظ — الحضور والانصراف";


  return (
    <AppShell
      title={tenant?.name ?? "Nizam"}
      subtitle={subtitleText}
      nav={nav}
    >
      {children}
    </AppShell>
  );
}


export function BranchLayout({ children, backTo, backLabel }: { children: ReactNode; backTo?: string; backLabel?: string }) {
  const { id } = useParams<{ id: string }>();
  const { branches, isAdmin, hasRole, user, can: hasPerm } = useAuth();
  const branch = branches.find((b) => b.id === id);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [pendingAdvCount, setPendingAdvCount] = useState(0);
  const [pendingMyApprovals, setPendingMyApprovals] = useState(0);
  const [pendingDiscountCount, setPendingDiscountCount] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("products")
        .select("quantity, low_stock_alert")
        .eq("branch_id", id);
      if (cancelled) return;
      setLowStockCount((data ?? []).filter((p: any) => p.quantity <= p.low_stock_alert).length);
    };
    load();
    const channel = supabase
      .channel(`products-low-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "products", filter: `branch_id=eq.${id}` }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [id]);

  useEffect(() => {
    if (!id || !user) return;
    const isBranchManager = hasRole("branch_manager");
    if (!isBranchManager && !isAdmin) {
      setPendingAdvCount(0);
      return;
    }
    const targetStatus = isAdmin ? "pending_admin" : "pending_branch_manager";
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from("advance_requests")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", id)
        .eq("status", targetStatus);
      if (!cancelled) setPendingAdvCount(count ?? 0);
    };
    load();
    const ch = supabase
      .channel(`adv-req-badge-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "advance_requests", filter: `branch_id=eq.${id}` }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [id, user?.id, isAdmin, hasRole]);

  // My approval requests badge (branch manager only)
  useEffect(() => {
    if (!user || !hasRole("branch_manager")) { setPendingMyApprovals(0); return; }
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from("approval_requests" as any)
        .select("id", { count: "exact", head: true })
        .eq("requested_by", user.id)
        .eq("status", "pending");
      if (!cancelled) setPendingMyApprovals(count ?? 0);
    };
    load();
    const ch = supabase
      .channel(`my-appr-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_requests", filter: `requested_by=eq.${user.id}` }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [user?.id, hasRole]);

  // Pending discount approvals badge (managers + admin)
  useEffect(() => {
    if (!id || !user) return;
    const canSee = isAdmin || hasRole("branch_manager");
    if (!canSee) { setPendingDiscountCount(0); return; }
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from("discount_approval_requests" as any)
        .select("id", { count: "exact", head: true })
        .eq("branch_id", id)
        .eq("status", "pending");
      if (!cancelled) setPendingDiscountCount(count ?? 0);
    };
    load();
    const ch = supabase
      .channel(`disc-appr-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "discount_approval_requests", filter: `branch_id=eq.${id}` }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [id, user?.id, isAdmin, hasRole]);

  if (!branch && !isAdmin) return <Navigate to="/" replace />;

  // Permission-driven sidebar (admins always see everything; others filtered via role_permissions matrix)
  const allNav: (NavItem & { perm: string })[] = [
    { to: `/branch/${id}/dashboard`, label: "الرئيسية", icon: <Home className="w-4 h-4" />, perm: "dashboard.view", newTab: true },
    
    { to: `/branch/${id}/invoices`, label: "الفواتير والمستندات", icon: <FileText className="w-4 h-4" />, perm: "invoices.view", newTab: true },
    
    { to: `/branch/${id}/inventory`, label: "المخزون", icon: <Boxes className="w-4 h-4" />, badge: lowStockCount, perm: "inventory.view", newTab: true },
    { to: `/branch/${id}/contacts`, label: "العملاء والموردين", icon: <UserCircle className="w-4 h-4" />, perm: "customers.view", newTab: true },
    { to: `/branch/${id}/treasury`, label: "الخزنة", icon: <Wallet className="w-4 h-4" />, perm: "treasury.view", newTab: true },
    { to: `/branch/${id}/employees`, label: "الموظفين", icon: <BadgeDollarSign className="w-4 h-4" />, badge: pendingAdvCount, perm: "employees.view", newTab: true },
    { to: `/branch/${id}/reports`, label: "التقارير", icon: <BarChart3 className="w-4 h-4" />, perm: "reports.view", newTab: true },
  ];

  const isManager = hasRole("branch_manager");
  const canSeeDiscounts = isAdmin || isManager;
  const canAccessAdmin = isAdmin || hasPerm("admin_home.view");
  const nav: NavItem[] = [
    ...(canAccessAdmin ? [{ to: "/admin/dashboard", label: "↩ لوحة التحكم", icon: <LayoutDashboard className="w-4 h-4" /> }] : []),
    ...allNav.filter((i) => hasPerm(i.perm)).map(({ perm, ...rest }) => rest),
    ...(canSeeDiscounts ? [{ to: `/branch/${id}/discount-approvals`, label: "طلبات الخصم", icon: <Percent className="w-4 h-4" />, badge: pendingDiscountCount || undefined }] : []),
    ...(canSeeDiscounts ? [{ to: `/branch/${id}/void-approvals`, label: "طلبات إلغاء الدفعات", icon: <Trash2 className="w-4 h-4" /> }] : []),
    ...(isManager ? [{ to: `/branch/${id}/approval-requests`, label: "طلباتي للموافقة", icon: <Inbox className="w-4 h-4" />, badge: pendingMyApprovals || undefined }] : []),
  ];


  return (
    <AppShell title={branch?.name ?? "فرع"} subtitle={branch?.code ?? ""} nav={nav} backTo={backTo} backLabel={backLabel}>
      {children}
    </AppShell>
  );
}
