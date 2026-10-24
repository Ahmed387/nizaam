import { ReactNode } from "react";
import { Crown, Building2, BarChart3, Users, GitPullRequest } from "lucide-react";
import { AppShell, NavItem } from "./AppShell";

const superNav: NavItem[] = [
  { to: "/super/dashboard", label: "نظرة عامة", icon: <BarChart3 className="w-4 h-4" /> },
  { to: "/super/tenants", label: "الشركات", icon: <Building2 className="w-4 h-4" /> },
  { to: "/super/branch-requests", label: "طلبات زيادة الفروع", icon: <GitPullRequest className="w-4 h-4" /> },
  { to: "/super/users", label: "كل المستخدمين", icon: <Users className="w-4 h-4" /> },
];

export function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell title="Super Admin" subtitle="إدارة المنصة" nav={superNav}>
      <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-primary/10 text-primary text-sm font-medium w-fit">
        <Crown className="w-4 h-4" /> أنت في وضع مالك المنصة
      </div>
      {children}
    </AppShell>
  );
}
