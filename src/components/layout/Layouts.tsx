import { ReactNode, useEffect, useState } from "react";
import {
  Home, Store, FolderTree, ListChecks, BarChart3, ScrollText, Settings, Sparkles,
  ShoppingCart, PackagePlus, Boxes, UserCircle, Factory, Wallet, BadgeDollarSign, Receipt, ArrowLeftRight, HandCoins, Warehouse, LayoutDashboard, CalendarRange, BookmarkPlus, ClipboardCheck, Coins, FileText, ArrowDownCircle, ArrowUpCircle, BookOpen, ShieldCheck, Inbox, TrendingUp, Percent,
} from "lucide-react";
import { AppShell, NavItem } from "./AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

export function AdminLayout({ children }: { children: ReactNode }) {
  const { tenant, tenantId, isAdmin, isSuperAdmin, isOwner, hasRole } = useAuth();
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [pendingDiscounts, setPendingDiscounts] = useState(0);

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

  const adminNav: NavItem[] = [
    { to: "/admin/dashboard", label: "الرئيسية", icon: <Home className="w-4 h-4" /> },
    { to: "/admin/catalog", label: "الفروع والمخزون", icon: <Store className="w-4 h-4" /> },
    { to: "/admin/contacts", label: "جهات التواصل (كل الفروع)", icon: <Factory className="w-4 h-4" /> },
    { to: "/admin/employees", label: "الموظفين (كل الفروع)", icon: <UserCircle className="w-4 h-4" /> },
    { to: "/admin/presence", label: "تتبع المستخدمين", icon: <ClipboardCheck className="w-4 h-4" /> },
    { to: "/admin/finance", label: "المالية", icon: <BookOpen className="w-4 h-4" /> },
    ...(isSuperAdmin ? [{ to: "/admin/financial-position", label: "الذمة المالية (الشركاء)", icon: <HandCoins className="w-4 h-4" /> }] : []),
    { to: "/admin/reports-hub", label: "التقارير", icon: <BarChart3 className="w-4 h-4" /> },
    ...(isAdmin ? [{ to: "/admin/approvals-hub", label: "طلبات موافقة الأدمن", icon: <ShieldCheck className="w-4 h-4" />, badge: totalAdminApprovals || undefined }] : []),
    { to: "/admin/settings", label: "الإعدادات", icon: <Settings className="w-4 h-4" /> },
  ];

  const supervisorNav: NavItem[] = [
    { to: "/admin/employees", label: "الموظفين والحضور", icon: <ClipboardCheck className="w-4 h-4" /> },
    { to: "/admin/presence", label: "تتبع المستخدمين", icon: <UserCircle className="w-4 h-4" /> },
  ];

  const nav = isAdmin ? adminNav : hasRole("supervisor") ? supervisorNav : [];
  return (
    <AppShell
      title={tenant?.name ?? "Nizam"}
      subtitle={isAdmin ? "لوحة التحكم العامة" : "ملاحظ — الحضور والانصراف"}
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
  const nav: NavItem[] = [
    ...(isAdmin ? [{ to: "/admin/dashboard", label: "↩ الرئيسية (الأدمن)", icon: <LayoutDashboard className="w-4 h-4" /> }] : []),
    ...allNav.filter((i) => hasPerm(i.perm)).map(({ perm, ...rest }) => rest),
    ...(canSeeDiscounts ? [{ to: `/branch/${id}/discount-approvals`, label: "طلبات الخصم", icon: <Percent className="w-4 h-4" />, badge: pendingDiscountCount || undefined }] : []),
    ...(isManager ? [{ to: `/branch/${id}/approval-requests`, label: "طلباتي للموافقة", icon: <Inbox className="w-4 h-4" />, badge: pendingMyApprovals || undefined }] : []),
  ];


  return (
    <AppShell title={branch?.name ?? "فرع"} subtitle={branch?.code ?? ""} nav={nav} backTo={backTo} backLabel={backLabel}>
      {children}
    </AppShell>
  );
}
