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
  const { user, loading, isAdmin, isSuperAdmin, isOwner, hasRole, tenant, signOut, can } = useAuth();
  const loc = useLocation();

  if (loading) {
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

  if (ownerOnly && !isOwner) return <Navigate to="/" replace />;
  if (superAdminOnly && !isSuperAdmin) return <Navigate to="/" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  if (perm && !can(perm)) return <Navigate to="/" replace />;
  if (roles && !isAdmin && !roles.some((r) => hasRole(r))) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/** Inline permission gate for buttons / sections inside pages. Hides children when permission is missing. */
export function PermGate({ perm, fallback = null, children }: { perm: string; fallback?: ReactNode; children: ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? <>{children}</> : <>{fallback}</>;
}
