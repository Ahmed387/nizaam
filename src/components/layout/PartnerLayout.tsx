import { ReactNode } from "react";
import { LayoutDashboard, BookOpen, UserCircle } from "lucide-react";
import { AppShell, NavItem } from "./AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

export function PartnerLayout({ children }: { children: ReactNode }) {
  const { tenant, hasRole, isAdmin, isSuperAdmin, loading, user } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole("partner") && !isAdmin && !isSuperAdmin) return <Navigate to="/" replace />;

  const nav: NavItem[] = [
    { to: "/partner/dashboard", label: "لوحة الشريك", icon: <LayoutDashboard className="w-4 h-4" /> },
    { to: "/partner/ledger", label: "كشف الحساب", icon: <BookOpen className="w-4 h-4" /> },
    { to: "/partner/profile", label: "الملف الشخصي", icon: <UserCircle className="w-4 h-4" /> },
  ];

  return (
    <AppShell title={tenant?.name ?? "Nizam"} subtitle="بوابة الشريك" nav={nav}>
      {children}
    </AppShell>
  );
}
