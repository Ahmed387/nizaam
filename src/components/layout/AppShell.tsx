import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABELS } from "@/lib/roles";
import { Store, LogOut, Menu, X } from "lucide-react";
import { useState, ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

export function AppShell({
  title,
  subtitle,
  nav,
  children,
}: {
  title: string;
  subtitle?: string;
  nav: NavItem[];
  children: ReactNode;
}) {
  const { profile, roles, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  const sidebar = (
    <aside className="w-72 shrink-0 bg-sidebar border-l border-sidebar-border flex flex-col h-screen sticky top-0">
      <div className="p-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
            <Store className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-extrabold text-base text-sidebar-foreground">{title}</div>
            {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {nav.map((item) => {
          const active = loc.pathname === item.to || loc.pathname.startsWith(item.to + "/");
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent"
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3 p-2 mb-2">
          <div className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center font-bold text-sm">
            {profile?.name?.[0] ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{profile?.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {roles.map((r) => ROLE_LABELS[r]).join("، ")}
            </div>
          </div>
        </div>
        <Button variant="ghost" className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={signOut}>
          <LogOut className="w-4 h-4" /> تسجيل خروج
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-sidebar border-b border-sidebar-border flex items-center justify-between px-4">
        <button onClick={() => setOpen(true)} className="p-2 rounded-lg hover:bg-sidebar-accent">
          <Menu className="w-5 h-5" />
        </button>
        <div className="font-bold">{title}</div>
        <div className="w-9" />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:block">{sidebar}</div>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative">
            <button onClick={() => setOpen(false)} className="absolute -left-12 top-4 p-2 rounded-lg bg-sidebar text-sidebar-foreground">
              <X className="w-5 h-5" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0 pt-14 lg:pt-0">
        <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold">{title}</h1>
        {subtitle && <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
