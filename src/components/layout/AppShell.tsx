import { NavLink, useLocation, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABELS } from "@/lib/roles";
import { Store, LogOut, Menu, X, ChevronsRight, ChevronsLeft, UserCog, Download, ArrowRight, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OfflineQueueIndicator } from "@/components/OfflineQueueIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  newTab?: boolean;
}

export function AppShell({
  title,
  subtitle,
  nav,
  backTo,
  backLabel,
  children,
}: {
  title: string;
  subtitle?: string;
  nav: NavItem[];
  backTo?: string;
  backLabel?: string;
  children: ReactNode;
}) {
  const { profile, roles, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  const canGoBack = typeof window !== "undefined" && window.history.length > 1;
  const goBack = () => {
    if (backTo) navigate(backTo);
    else navigate(-1);
  };
  const isBackDisabled = !backTo && !canGoBack;

  const renderSidebar = (isCollapsed: boolean, isMobile: boolean) => (
    <aside
      className={`${isCollapsed ? "w-16" : "w-72"} shrink-0 bg-sidebar border-l border-sidebar-border flex flex-col h-screen sticky top-0 transition-[width] duration-200`}
    >
      <div className={`${isCollapsed ? "p-3" : "p-5"} border-b border-sidebar-border flex items-center ${isCollapsed ? "justify-center" : "justify-between"} gap-2`}>
        {!isCollapsed && (
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shrink-0">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="font-extrabold text-base text-sidebar-foreground truncate">{title}</div>
              {subtitle && <div className="text-xs text-muted-foreground truncate">{subtitle}</div>}
            </div>
          </div>
        )}
        {isCollapsed && (
          <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shrink-0">
            <Store className="w-5 h-5 text-white" />
          </div>
        )}
        {!isMobile && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden lg:inline-flex p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground shrink-0"
            aria-label={isCollapsed ? "فتح القائمة" : "طي القائمة"}
            title={isCollapsed ? "فتح" : "طي"}
          >
            {isCollapsed ? <ChevronsLeft className="w-4 h-4" /> : <ChevronsRight className="w-4 h-4" />}
          </button>
        )}
      </div>

      <nav className={`flex-1 overflow-y-auto ${isCollapsed ? "p-2" : "p-3"} space-y-1`}>
        {nav.map((item) => {
          const active = loc.pathname === item.to || loc.pathname.startsWith(item.to + "/");
          const linkClass = `flex items-center gap-3 ${isCollapsed ? "justify-center px-2" : "px-3"} py-2.5 rounded-lg text-sm font-medium transition-colors ${
            active ? "bg-primary text-primary-foreground shadow-sm" : "text-sidebar-foreground hover:bg-sidebar-accent"
          }`;
          const linkContent = (
            <>
              <span className="shrink-0 relative">
                {item.icon}
                {isCollapsed && item.badge && item.badge > 0 ? (
                  <span className="absolute -top-2 -left-2 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                ) : null}
              </span>
              {!isCollapsed && <span className="flex-1 truncate">{item.label}</span>}
              {!isCollapsed && item.badge && item.badge > 0 ? (
                <span className="shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </>
          );
          const link = item.newTab ? (
            <a
              key={item.to}
              href={item.to}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className={linkClass}
            >
              {linkContent}
            </a>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={linkClass}
            >
              {linkContent}
            </NavLink>
          );
          if (isCollapsed) {
            return (
              <Tooltip key={item.to} delayDuration={100}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="left">{item.label}</TooltipContent>
              </Tooltip>
            );
          }
          return link;
        })}
      </nav>

      <div className={`${isCollapsed ? "p-2" : "p-3"} border-t border-sidebar-border`}>
        {!isCollapsed && (
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 p-2 mb-2 rounded-lg hover:bg-sidebar-accent transition-colors"
            title="الصفحة الشخصية"
          >
            <div className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center font-bold text-sm shrink-0">
              {profile?.name?.[0] ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{profile?.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {roles.map((r) => ROLE_LABELS[r]).join("، ")}
              </div>
            </div>
            <UserCog className="w-4 h-4 text-muted-foreground shrink-0" />
          </Link>
        )}
        {isCollapsed && (
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <Link
                to="/profile"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center p-2 mb-2 rounded-lg hover:bg-sidebar-accent transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center font-bold text-sm">
                  {profile?.name?.[0] ?? "?"}
                </div>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="left">الصفحة الشخصية</TooltipContent>
          </Tooltip>
        )}
        {isCollapsed ? (
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={signOut}
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">تسجيل خروج</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={signOut}
          >
            <LogOut className="w-4 h-4" /> تسجيل خروج
          </Button>
        )}
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen flex bg-background w-full">
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-sidebar border-b border-sidebar-border flex items-center justify-between px-4">
        <div className="flex items-center gap-1">
          <button onClick={() => setOpen(true)} className="p-2 rounded-lg hover:bg-sidebar-accent">
            <Menu className="w-5 h-5" />
          </button>
          <button
            onClick={goBack}
            disabled={isBackDisabled}
            className="p-2 rounded-lg hover:bg-sidebar-accent disabled:opacity-50"
            aria-label={backLabel ?? "رجوع"}
            title={backLabel ?? "رجوع"}
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
        <div className="font-bold truncate">{title}</div>
        <div className="flex items-center gap-1">
          <OfflineQueueIndicator />
          <ThemeToggle />
          <NotificationBell />
        </div>
      </div>

      {/* Desktop sidebar */}
      {!hidden && <div className="hidden lg:block">{renderSidebar(collapsed, false)}</div>}

      {/* Mobile drawer — opens from the right (RTL) */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="relative">
            {renderSidebar(false, true)}
            <button onClick={() => setOpen(false)} className="absolute -left-12 top-4 p-2 rounded-lg bg-sidebar text-sidebar-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
        </div>
      )}

      <main className="flex-1 min-w-0 pt-14 lg:pt-0">
        <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto">
          <div className="hidden lg:flex items-center justify-between gap-1 mb-2">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHidden((h) => !h)}
                title={hidden ? "إظهار القائمة" : "إخفاء القائمة"}
                className="gap-2"
              >
                {hidden ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
                {hidden ? "إظهار القائمة" : "إخفاء القائمة"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={goBack}
                disabled={isBackDisabled}
                className="gap-2"
                title={backLabel ?? "رجوع"}
              >
                <ArrowRight className="w-4 h-4" />
                {backLabel ?? "رجوع"}
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <OfflineQueueIndicator />
              <ThemeToggle />
              <NotificationBell />
            </div>
          </div>
          {children}
        </div>
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
