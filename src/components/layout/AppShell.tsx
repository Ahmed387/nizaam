import { NavLink, useLocation, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABELS } from "@/lib/roles";
import { Store, ChevronDown, LogOut, Menu, X, ChevronsRight, ChevronsLeft, UserCog, Download, ArrowRight, PanelRightClose, PanelRightOpen } from "lucide-react";
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

  // ---- Multi-level menu helpers -------------------------------------------
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const matchItem = (to: string) => {
    const [path, search] = to.split("?");
    if (loc.pathname !== path && !loc.pathname.startsWith(path + "/")) return false;
    if (search) {
      const want = new URLSearchParams(search);
      const cur = new URLSearchParams(loc.search);
      for (const [k, v] of want.entries()) if (cur.get(k) !== v) return false;
    }
    return true;
  };
  const pathMatches = (to: string) => {
    const path = to.split("?")[0];
    return loc.pathname === path || loc.pathname.startsWith(path + "/");
  };
  const branchHasActive = (item: NavItem): boolean =>
    pathMatches(item.to) || (item.children ?? []).some(branchHasActive);

  const renderItem = (item: NavItem, depth: number, isCollapsed: boolean, isMobile: boolean): ReactNode => {
    const hasChildren = !!item.children?.length;
    const active = hasChildren ? false : matchItem(item.to);
    const autoOpen = hasChildren && item.children!.some(branchHasActive);
    const key = `${item.label}-${item.to}`;
    const isOpen = expanded[key] ?? autoOpen;

    const padX = isCollapsed ? "justify-center px-2" : depth === 1 ? "px-3 pr-8" : depth >= 2 ? "px-3 pr-12" : "px-3";
    const rowClass = `group/link relative w-full flex items-center gap-3 ${padX} py-2.5 rounded-xl ${
      depth > 0 ? "text-[12.5px] font-medium" : "text-[13.5px] font-semibold"
    } transition-all duration-200 ${
      active
        ? "bg-gradient-to-l from-primary to-primary-glow text-primary-foreground shadow-[0_4px_14px_-4px_hsl(217_91%_55%_/_0.5)] font-semibold"
        : "text-sidebar-foreground/85 hover:bg-primary/10 hover:text-primary"
    }`;

    if (hasChildren) {
      const branchActive = branchHasActive(item);
      const trigger = (
        <button
          type="button"
          onClick={() => {
            if (isCollapsed && !isMobile) { setCollapsed(false); setExpanded((e) => ({ ...e, [key]: true })); return; }
            setExpanded((e) => ({ ...e, [key]: !isOpen }));
          }}
          aria-expanded={isOpen}
          className={`${rowClass} ${isOpen ? "bg-primary/15 text-primary shadow-[inset_-3px_0_0_0_hsl(var(--primary)/0.45)]" : branchActive ? "text-primary" : ""}`}
        >
          <span className={`shrink-0 flex items-center justify-center rounded-lg ${isOpen ? "bg-primary/15 text-primary" : branchActive ? "text-primary" : "text-muted-foreground group-hover/link:text-primary"}`}>
            {item.icon}
          </span>
          {!isCollapsed && <span className="flex-1 truncate text-right">{item.label}</span>}
          {!isCollapsed && (
            <ChevronDown className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180 text-primary" : ""}`} />
          )}
        </button>
      );
      return (
        <div key={key} className="space-y-1">
          {isCollapsed && !isMobile ? (
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent side="left" className="font-semibold">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            trigger
          )}
          {!isCollapsed && isOpen && (
            <div className="overflow-hidden animate-accordion-down space-y-1 border-r-2 border-primary/30 mr-4 pr-1 py-1 rounded-r-2xl bg-gradient-to-l from-primary/5 via-primary/[0.02] to-transparent">
              {item.children!.map((c) => renderItem(c, depth + 1, isCollapsed, isMobile))}
            </div>
          )}
        </div>
      );
    }

    const linkContent = (
      <>
        {active && !isCollapsed && (
          <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary-foreground/80 rounded-l-full" aria-hidden />
        )}
        <span className={`shrink-0 relative flex items-center justify-center ${active ? "" : "text-muted-foreground group-hover/link:text-primary"}`}>
          {item.icon}
          {isCollapsed && item.badge && item.badge > 0 ? (
            <span className="absolute -top-1.5 -left-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold ring-2 ring-sidebar">
              {item.badge > 9 ? "9+" : item.badge}
            </span>
          ) : null}
        </span>
        {!isCollapsed && <span className="flex-1 truncate">{item.label}</span>}
        {!isCollapsed && item.badge && item.badge > 0 ? (
          <span className={`shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold ${active ? "bg-primary-foreground/25 text-primary-foreground" : "bg-destructive text-destructive-foreground"}`}>
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        ) : null}
      </>
    );
    const link = item.newTab ? (
      <a key={key} href={item.to} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={rowClass}>
        {linkContent}
      </a>
    ) : (
      <NavLink key={key} to={item.to} onClick={() => setOpen(false)} className={rowClass}>
        {linkContent}
      </NavLink>
    );
    if (isCollapsed || item.hint) {
      return (
        <Tooltip key={key} delayDuration={100}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent
            side="left"
            align="center"
            sideOffset={10}
            dir="rtl"
            className="max-w-[230px] rounded-xl border-primary/25 bg-popover/95 px-3 py-2 text-right shadow-[0_10px_30px_-12px_hsl(var(--primary)/0.45)] backdrop-blur-sm"
          >
            {isCollapsed ? (
              <span className="text-[12.5px] font-semibold">{item.label}</span>
            ) : (
              <span className="block text-[11.5px] font-medium leading-relaxed text-muted-foreground">
                <span className="mb-0.5 block text-[12.5px] font-bold text-foreground">{item.label}</span>
                {item.hint}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      );
    }
    return link;
  };


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
                <div className="flex items-center gap-2 px-3 pt-1 pb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary/80">
                    {group.label}
                  </span>
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
