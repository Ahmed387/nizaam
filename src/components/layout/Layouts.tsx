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
  { to: "/admin/branches", label: "إدارة الفروع", icon: <Store className="w-4 h-4" /> },
  { to: "/admin/categories", label: "التصنيفات", icon: <FolderTree className="w-4 h-4" /> },
  { to: "/admin/pricelist", label: "قائمة الأسعار", icon: <ListChecks className="w-4 h-4" /> },
  { to: "/admin/pre-orders", label: "الحجوزات (كل الفروع)", icon: <BookmarkPlus className="w-4 h-4" /> },
  
  { to: "/admin/inventory", label: "مخزون كل الفروع", icon: <Warehouse className="w-4 h-4" /> },
  { to: "/admin/suppliers", label: "الموردين (كل الفروع)", icon: <Factory className="w-4 h-4" /> },
  { to: "/admin/employees", label: "الموظفين (كل الفروع)", icon: <UserCircle className="w-4 h-4" /> },
  { to: "/admin/reports", label: "التقارير المركزية", icon: <BarChart3 className="w-4 h-4" /> },
  { to: "/admin/scheduled-reports", label: "التقارير المجدولة", icon: <CalendarRange className="w-4 h-4" /> },
  { to: "/admin/attendance", label: "الحضور (كل الفروع)", icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: "/admin/receivables", label: "الذمم المالية", icon: <Coins className="w-4 h-4" /> },
  { to: "/admin/vouchers", label: "السندات المالية", icon: <BookOpen className="w-4 h-4" /> },
  { to: "/admin/audit-log", label: "سجل العمليات", icon: <ScrollText className="w-4 h-4" /> },
  { to: "/admin/settings", label: "الإعدادات", icon: <Settings className="w-4 h-4" /> },
  
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const { tenant, isAdmin, hasRole } = useAuth();
  // Supervisor: limited admin sidebar (attendance + employees only)
  const supervisorNav: NavItem[] = [
    { to: "/admin/employees", label: "الموظفين (كل الفروع)", icon: <UserCircle className="w-4 h-4" /> },
    { to: "/admin/attendance", label: "الحضور (كل الفروع)", icon: <ClipboardCheck className="w-4 h-4" /> },
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
  const { branches, isAdmin, hasRole, user } = useAuth();
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

  const can = (allowed: string[]) =>
    isAdmin || hasRole("branch_manager") || allowed.some((r) => hasRole(r as any));

  const allNav: (NavItem & { allow: string[] })[] = [
    { to: `/branch/${id}/dashboard`, label: "الرئيسية", icon: <Home className="w-4 h-4" />, allow: ["cashier", "warehouse", "accountant"] },
    { to: `/branch/${id}/sales`, label: "المبيعات", icon: <ShoppingCart className="w-4 h-4" />, allow: ["cashier", "accountant"] },
    { to: `/branch/${id}/invoices`, label: "الفواتير والمستندات", icon: <FileText className="w-4 h-4" />, allow: ["cashier", "warehouse", "accountant"] },
    { to: `/branch/${id}/pre-orders`, label: "طلبات الحجز", icon: <BookmarkPlus className="w-4 h-4" />, allow: ["cashier", "warehouse", "accountant"] },
    { to: `/branch/${id}/shipments`, label: "الشحنات", icon: <PackagePlus className="w-4 h-4" />, allow: ["warehouse", "accountant"] },
    { to: `/branch/${id}/inventory`, label: "المخزون", icon: <Boxes className="w-4 h-4" />, badge: lowStockCount, allow: ["cashier", "warehouse", "accountant"] },
    { to: `/branch/${id}/transfers`, label: "نقل المخزون", icon: <ArrowLeftRight className="w-4 h-4" />, allow: ["warehouse"] },
    { to: `/branch/${id}/customers`, label: "العملاء", icon: <UserCircle className="w-4 h-4" />, allow: ["cashier", "warehouse", "accountant"] },
    { to: `/branch/${id}/suppliers`, label: "الموردين", icon: <Factory className="w-4 h-4" />, allow: ["warehouse", "accountant"] },
    { to: `/branch/${id}/treasury`, label: "الخزنة", icon: <Wallet className="w-4 h-4" />, allow: ["accountant"] },
    { to: `/branch/${id}/employees`, label: "الموظفين", icon: <BadgeDollarSign className="w-4 h-4" />, allow: ["accountant", "warehouse"] },
    { to: `/branch/${id}/advance-requests`, label: "طلبات السلف", icon: <HandCoins className="w-4 h-4" />, badge: pendingAdvCount, allow: ["accountant", "warehouse"] },
    
    { to: `/branch/${id}/attendance`, label: "الحضور والانصراف", icon: <ClipboardCheck className="w-4 h-4" />, allow: ["cashier","accountant","warehouse"] },
    { to: `/branch/${id}/reports`, label: "التقارير", icon: <BarChart3 className="w-4 h-4" />, allow: ["accountant"] },
  ];

  const nav: NavItem[] = [
    ...(isAdmin ? [{ to: "/admin/dashboard", label: "↩ الرئيسية (الأدمن)", icon: <LayoutDashboard className="w-4 h-4" /> }] : []),
    ...allNav.filter((i) => can(i.allow)).map(({ allow, ...rest }) => rest),
  ];

  return (
    <AppShell title={branch?.name ?? "فرع"} subtitle={branch?.code ?? ""} nav={nav}>
      {children}
    </AppShell>
  );
}
