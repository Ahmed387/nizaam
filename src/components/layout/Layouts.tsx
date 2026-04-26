import { ReactNode, useEffect, useState } from "react";
import {
  Home, Store, Users, FolderTree, ListChecks, BarChart3, ScrollText, Settings, Sparkles,
  ShoppingCart, PackagePlus, Boxes, UserCircle, Factory, Wallet, BadgeDollarSign, Receipt, ArrowLeftRight,
} from "lucide-react";
import { AppShell, NavItem } from "./AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const adminNav: NavItem[] = [
  { to: "/admin/dashboard", label: "الرئيسية", icon: <Home className="w-4 h-4" /> },
  { to: "/admin/branches", label: "إدارة الفروع", icon: <Store className="w-4 h-4" /> },
  { to: "/admin/users", label: "المستخدمين", icon: <Users className="w-4 h-4" /> },
  { to: "/admin/categories", label: "التصنيفات", icon: <FolderTree className="w-4 h-4" /> },
  { to: "/admin/pricelist", label: "قائمة الأسعار", icon: <ListChecks className="w-4 h-4" /> },
  { to: "/admin/reports", label: "التقارير المركزية", icon: <BarChart3 className="w-4 h-4" /> },
  { to: "/admin/audit-log", label: "سجل العمليات", icon: <ScrollText className="w-4 h-4" /> },
  { to: "/admin/settings", label: "الإعدادات", icon: <Settings className="w-4 h-4" /> },
  { to: "/admin/seed", label: "بيانات تجريبية", icon: <Sparkles className="w-4 h-4" /> },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const { tenant } = useAuth();
  return (
    <AppShell
      title={tenant?.name ?? "Nexa Store"}
      subtitle="لوحة التحكم العامة"
      nav={adminNav}
    >
      {children}
    </AppShell>
  );
}

export function BranchLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { branches, isAdmin } = useAuth();
  const branch = branches.find((b) => b.id === id);
  const [lowStockCount, setLowStockCount] = useState(0);

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

  if (!branch && !isAdmin) return <Navigate to="/" replace />;

  const nav: NavItem[] = [
    { to: `/branch/${id}/dashboard`, label: "الرئيسية", icon: <Home className="w-4 h-4" /> },
    { to: `/branch/${id}/sales`, label: "المبيعات", icon: <ShoppingCart className="w-4 h-4" /> },
    { to: `/branch/${id}/shipments`, label: "الشحنات", icon: <PackagePlus className="w-4 h-4" /> },
    { to: `/branch/${id}/inventory`, label: "المخزون", icon: <Boxes className="w-4 h-4" />, badge: lowStockCount },
    { to: `/branch/${id}/transfers`, label: "نقل المخزون", icon: <ArrowLeftRight className="w-4 h-4" /> },
    { to: `/branch/${id}/customers`, label: "العملاء", icon: <UserCircle className="w-4 h-4" /> },
    { to: `/branch/${id}/suppliers`, label: "الموردين", icon: <Factory className="w-4 h-4" /> },
    { to: `/branch/${id}/treasury`, label: "الخزنة", icon: <Wallet className="w-4 h-4" /> },
    { to: `/branch/${id}/employees`, label: "الموظفين", icon: <BadgeDollarSign className="w-4 h-4" /> },
    { to: `/branch/${id}/expenses`, label: "المصروفات", icon: <Receipt className="w-4 h-4" /> },
    { to: `/branch/${id}/reports`, label: "التقارير", icon: <BarChart3 className="w-4 h-4" /> },
  ];

  return (
    <AppShell title={branch?.name ?? "فرع"} subtitle={branch?.code ?? ""} nav={nav}>
      {children}
    </AppShell>
  );
}
