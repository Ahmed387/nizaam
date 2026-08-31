import { NavLink, useLocation, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABELS } from "@/lib/roles";
import { Store, LogOut, Menu, X, ChevronsRight, ChevronsLeft, UserCog, Download, ArrowRight, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState, useEffect, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OfflineQueueIndicator } from "@/components/OfflineQueueIndicator";
import { HelpButton } from "@/components/HelpButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  newTab?: boolean;
  group?: string;
  hint?: string;
  /** Optional nested items → renders a collapsible dropdown */
  children?: NavItem[];
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

  // Auto-collapse the sidebar on document forms (new/edit invoice, shipment, return, quote)
  // so the user gets maximum width while filling it in.
  const isDocumentForm = /\/(new|edit)(\/|$)/.test(loc.pathname);
  useEffect(() => {
    if (isDocumentForm) setCollapsed(true);
  }, [isDocumentForm, loc.pathname]);


  // Group nav items by their optional `group` field, preserving insertion order
  const groupedNav = (() => {
    const groups: { label: string; items: NavItem[] }[] = [];
    const map = new Map<string, NavItem[]>();
    for (const item of nav) {
      const key = item.group ?? "";
      if (!map.has(key)) {
        map.set(key, []);
        groups.push({ label: key, items: map.get(key)! });
      }
      map.get(key)!.push(item);
    }
    return groups;
  })();

  const renderSidebar = (isCollapsed: boolean, isMobile: boolean) => (
    <aside
      className={`${isCollapsed ? "w-[76px]" : "w-72"} shrink-0 flex flex-col h-screen sticky top-0 transition-[width] duration-300 ${isMobile ? "" : "p-3"}`}
    >
      <div
        className={`flex-1 flex flex-col ${isMobile ? "rounded-none border-l" : "rounded-2xl border"} border-sidebar-border bg-sidebar shadow-[0_4px_24px_-8px_hsl(217_91%_55%_/_0.08)] overflow-hidden`}
      >
        {/* Brand header */}
        <div className={`${isCollapsed ? "px-3 py-4" : "px-4 py-4"} flex items-center ${isCollapsed ? "justify-center" : "justify-between"} gap-2`}>
          {!isCollapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center shrink-0 shadow-[0_4px_12px_-2px_hsl(217_91%_55%_/_0.4)]">
                <Store className="w-[18px] h-[18px] text-primary-foreground" strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <div className="font-extrabold text-[15px] leading-tight text-sidebar-foreground truncate tracking-tight">{title}</div>
                {subtitle && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{subtitle}</div>}
              </div>
            </div>
          )}
          {isCollapsed && (
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center shrink-0 shadow-[0_4px_12px_-2px_hsl(217_91%_55%_/_0.4)]">
              <Store className="w-5 h-5 text-primary-foreground" strokeWidth={2.25} />
            </div>
          )}
          {!isMobile && !isCollapsed && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="hidden lg:inline-flex p-1.5 rounded-lg hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground shrink-0 transition-colors"
              aria-label="طي القائمة"
              title="طي"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Divider */}
        <div className={`${isCollapsed ? "mx-3" : "mx-4"} h-px bg-sidebar-border/70`} />

        {/* Nav (grouped) */}
        <nav className={`flex-1 overflow-y-auto ${isCollapsed ? "px-2 py-3" : "px-3 py-3"} space-y-4`}>
          {isCollapsed && !isMobile && (
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCollapsed(false)}
                  className="w-full flex items-center justify-center py-2.5 rounded-xl bg-gradient-to-l from-primary to-primary-glow text-primary-foreground hover:opacity-90 shadow-[0_4px_14px_-4px_hsl(217_91%_55%_/_0.5)] transition-all mb-2"
                  aria-label="فتح القائمة"
                >
                  <ChevronsLeft className="w-5 h-5" strokeWidth={2.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="font-semibold">فتح القائمة</TooltipContent>
            </Tooltip>
          )}

          {groupedNav.map((group, gi) => (
            <div key={`${group.label}-${gi}`} className="space-y-1">
              {!isCollapsed && group.label && (
                <div className="px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
                  {group.label}
                </div>
              )}
              {isCollapsed && group.label && gi > 0 && (
                <div className="mx-2 h-px bg-sidebar-border/60 my-2" />
              )}
              {group.items.map((item) => renderItem(item, 0, isCollapsed, isMobile))}

            </div>
          ))}
        </nav>

        {/* User card + sign out */}
        <div className={`${isCollapsed ? "p-2" : "p-3"} border-t border-sidebar-border/70 space-y-1.5`}>
          {!isCollapsed ? (
            <Link
              to="/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 p-2 rounded-xl bg-sidebar-accent/60 hover:bg-sidebar-accent transition-colors"
              title="الصفحة الشخصية"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/90 to-primary-glow flex items-center justify-center font-bold text-sm text-primary-foreground shrink-0 shadow-sm">
                {profile?.name?.[0] ?? "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate leading-tight">{profile?.name}</div>
                <div className="text-[10.5px] text-muted-foreground truncate mt-0.5">
                  {roles.map((r) => ROLE_LABELS[r]).join("، ")}
                </div>
              </div>
              <UserCog className="w-4 h-4 text-muted-foreground shrink-0" />
            </Link>
          ) : (
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <Link
                  to="/profile"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center p-1.5 rounded-xl hover:bg-sidebar-accent transition-colors"
                >
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/90 to-primary-glow flex items-center justify-center font-bold text-sm text-primary-foreground shadow-sm">
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
                  className="w-full rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10"
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
              className="w-full justify-start gap-2 rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10 font-semibold"
              onClick={signOut}
            >
              <LogOut className="w-4 h-4" /> تسجيل خروج
            </Button>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <div dir="rtl" className="min-h-screen flex bg-background w-full">
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
          <HelpButton />
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
            <button onClick={() => setOpen(false)} className="absolute left-2 top-4 p-2 rounded-lg bg-sidebar text-sidebar-foreground">
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
              <HelpButton />
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
