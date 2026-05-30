import { ReactNode, useEffect, useState } from "react";
import {
  Home, Store, FolderTree, ListChecks, BarChart3, ScrollText, Settings, Sparkles,
  ShoppingCart, PackagePlus, Boxes, UserCircle, Factory, Wallet, BadgeDollarSign, Receipt, ArrowLeftRight, HandCoins, Warehouse, LayoutDashboard, CalendarRange, BookmarkPlus, ClipboardCheck, Coins, FileText, ArrowDownCircle, ArrowUpCircle, BookOpen,
} from "lucide-react";
import { AppShell, NavItem } from "./AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const adminNav: NavItem[] = [
  { to: "/admin/dashboard", label: "الرئيسية", icon: <Home className="w-4 h-4" /> },
  { to: "/admin/catalog", label: "الفروع والمخزون", icon: <Store className="w-4 h-4" /> },
  { to: "/admin/suppliers", label: "الموردين (كل الفروع)", icon: <Factory className="w-4 h-4" /> },
  { to: "/admin/employees", label: "الموظفين (كل الفروع)", icon: <UserCircle className="w-4 h-4" /> },
  { to: "/admin/presence", label: "تتبع المستخدمين", icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: "/admin/finance", label: "المالية", icon: <BookOpen className="w-4 h-4" /> },
  { to: "/admin/reports-hub", label: "التقارير", icon: <BarChart3 className="w-4 h-4" /> },
  { to: "/admin/settings", label: "الإعدادات", icon: <Settings className="w-4 h-4" /> },
];


export function AdminLayout({ children }: { children: ReactNode }) {
  const { tenant, isAdmin, hasRole } = useAuth();
  // Supervisor: limited admin sidebar (attendance + employees + presence)
  const supervisorNav: NavItem[] = [
    { to: "/admin/employees", label: "الموظفين والحضور", icon: <ClipboardCheck className="w-4 h-4" /> },
    { to: "/admin/presence", label: "تتبع المستخدمين", icon: <UserCircle className="w-4 h-4" /> },
  ];

  const nav = isAdmin ? adminNav : hasRole("supervisor") ? supervisorNav : [];
  return (
    <AppShell
      title={tenant?.name ?? "Nexa Store"}
      subtitle={isAdmin ? "لوحة التحكم العامة" : "ملاحظ — الحضور والانصراف"}
      nav={nav}
    >
      {children}
    </AppShell>
  );
}


export function BranchLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { branches, isAdmin, hasRole, user, can: hasPerm } = useAuth();
  const branch = branches.find((b) => b.id === id);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [pendingAdvCount, setPendingAdvCount] = useState(0);

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

  if (!branch && !isAdmin) return <Navigate to="/" replace />;

  // Permission-driven sidebar (admins always see everything; others filtered via role_permissions matrix)
  const allNav: (NavItem & { perm: string })[] = [
    { to: `/branch/${id}/dashboard`, label: "الرئيسية", icon: <Home className="w-4 h-4" />, perm: "dashboard.view" },
    { to: `/branch/${id}/sales`, label: "المبيعات", icon: <ShoppingCart className="w-4 h-4" />, perm: "sales.view" },
    { to: `/branch/${id}/invoices`, label: "الفواتير والمستندات", icon: <FileText className="w-4 h-4" />, perm: "invoices.view" },
    { to: `/branch/${id}/shipments`, label: "الشحنات", icon: <PackagePlus className="w-4 h-4" />, perm: "shipments.view" },
    { to: `/branch/${id}/inventory`, label: "المخزون", icon: <Boxes className="w-4 h-4" />, badge: lowStockCount, perm: "inventory.view" },
    { to: `/branch/${id}/contacts`, label: "العملاء والموردين", icon: <UserCircle className="w-4 h-4" />, perm: "customers.view" },
    { to: `/branch/${id}/treasury`, label: "الخزنة", icon: <Wallet className="w-4 h-4" />, perm: "treasury.view" },
    { to: `/branch/${id}/employees`, label: "الموظفين", icon: <BadgeDollarSign className="w-4 h-4" />, badge: pendingAdvCount, perm: "employees.view" },
    { to: `/branch/${id}/reports`, label: "التقارير", icon: <BarChart3 className="w-4 h-4" />, perm: "reports.view" },
  ];

  const nav: NavItem[] = [
    ...(isAdmin ? [{ to: "/admin/dashboard", label: "↩ الرئيسية (الأدمن)", icon: <LayoutDashboard className="w-4 h-4" /> }] : []),
    ...allNav.filter((i) => hasPerm(i.perm)).map(({ perm, ...rest }) => rest),
  ];


  return (
    <AppShell title={branch?.name ?? "فرع"} subtitle={branch?.code ?? ""} nav={nav}>
      {children}
    </AppShell>
  );
}
