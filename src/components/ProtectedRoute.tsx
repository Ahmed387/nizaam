import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppRole } from "@/lib/roles";
import { Loader2 } from "lucide-react";

export function ProtectedRoute({
  children,
  roles,
  adminOnly,
  superAdminOnly,
  ownerOnly,
  perm,
}: {
  children: ReactNode;
  roles?: AppRole[];
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  ownerOnly?: boolean;
  /** Optional permission key (e.g. "sales.view"). When provided, takes precedence over `roles`. */
  perm?: string;
}) {
  const { user, loading, ctxReady, isAdmin, isSuperAdmin, isOwner, isViewer, hasRole, tenant, signOut, can, branches } = useAuth();
  const loc = useLocation();

  if (loading || (user && !ctxReady)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;

  if (tenant?.is_suspended && !isSuperAdmin) {
    signOut();
    return <Navigate to={`/suspended?slug=${tenant.slug}`} replace />;
  }

  // Force admins to complete tenant setup before entering the app.
  // Allow the wizard route itself and profile so they can finish or sign out.
  if (
    isAdmin &&
    tenant &&
    (tenant as any).setup_completed === false &&
    !loc.pathname.startsWith("/setup-wizard") &&
    !loc.pathname.startsWith("/profile")
  ) {
    return <Navigate to="/setup-wizard" replace />;
  }

  // Bulk-created logins must change their password before using the system.
  if (
    (user as any)?.user_metadata?.must_change_password === true &&
    !loc.pathname.startsWith("/profile")
  ) {
    return <Navigate to="/profile" replace state={{ mustChangePassword: true }} />;
  }

  // المراقب: قراءة فقط — ممنوع من شاشات الإعدادات وترحيل/زرع البيانات، وممنوع من مسارات الشركاء/السوبر أدمن
  const VIEWER_BLOCKED = [
    "/admin/settings", "/admin/data-setup", "/admin/data-migration", "/admin/seed",
    "/partner", "/super",
  ];
  const viewerOnly = isViewer && !isAdmin && !isSuperAdmin;
  if (viewerOnly && VIEWER_BLOCKED.some((p) => loc.pathname.startsWith(p))) {
    return <Navigate to="/" replace />;
  }
  // Branch URL guard: a user may only open /branch/<id>/* for branches assigned to them.
  // Admins / super admins / the tenant owner / viewers (read-only) keep access to every branch.
  const branchMatch = loc.pathname.match(/^\/branch\/([^/]+)/);
  if (branchMatch && !isAdmin && !isSuperAdmin && !isOwner && !isViewer) {
    const allowed = branches.some((b) => b.id === branchMatch[1]);
    if (!allowed) return <Navigate to="/" replace />;
  }

  // المراقب: استثناء محدود — قراءة فقط لشاشات الإدارة/الفروع المصرح بها (مش كل مسار في النظام)
  const VIEWER_ALLOWED_PREFIXES = ["/admin", "/branch", "/profile", "/guide"];
  const viewerRead =
    viewerOnly && (loc.pathname === "/" || VIEWER_ALLOWED_PREFIXES.some((p) => loc.pathname.startsWith(p)));

  // Gates are OR-ed: an explicitly granted permission can unlock a page that is
  // otherwise owner/admin/role gated.
  const gates: boolean[] = [];
  if (ownerOnly) gates.push(isOwner || isSuperAdmin || viewerRead);
  if (superAdminOnly) gates.push(isSuperAdmin);
  if (adminOnly) gates.push(isAdmin || viewerRead);
  if (roles) gates.push(isAdmin || viewerRead || roles.some((r) => hasRole(r)));
  if (perm) gates.push(can(perm) || viewerRead);
  if (gates.length > 0 && !gates.some(Boolean)) return <Navigate to="/" replace />;


  return <>{children}</>;
}

/** Inline permission gate for buttons / sections inside pages. Hides children when permission is missing. */
export function PermGate({ perm, fallback = null, children }: { perm: string; fallback?: ReactNode; children: ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? <>{children}</> : <>{fallback}</>;
}
