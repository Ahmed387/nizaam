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
}: {
  children: ReactNode;
  roles?: AppRole[];
  adminOnly?: boolean;
  superAdminOnly?: boolean;
}) {
  const { user, loading, isAdmin, isSuperAdmin, hasRole, tenant, signOut } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;

  // Suspended tenant — auto sign-out non-super users
  if (tenant?.is_suspended && !isSuperAdmin) {
    signOut();
    return <Navigate to={`/suspended?slug=${tenant.slug}`} replace />;
  }

  if (superAdminOnly && !isSuperAdmin) return <Navigate to="/" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  if (roles && !isAdmin && !roles.some((r) => hasRole(r))) return <Navigate to="/" replace />;

  return <>{children}</>;
}
