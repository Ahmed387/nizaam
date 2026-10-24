import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const Index = () => {
  const { user, isAdmin, isSuperAdmin, hasRole, branches, tenant, loading, ctxReady, can } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (loading || !ctxReady) return;
    if (!user) { nav("/welcome", { replace: true }); return; }
    if (isSuperAdmin) { nav("/super/dashboard", { replace: true }); return; }
    // Force admins to finish tenant setup before entering the system
    if (isAdmin && tenant && tenant.setup_completed === false) {
      nav("/setup-wizard", { replace: true });
      return;
    }
    if (isAdmin) { nav("/admin/dashboard", { replace: true }); return; }
    if (hasRole("partner")) { nav("/partner/dashboard", { replace: true }); return; }
    if (hasRole("supervisor")) { nav("/admin/employees", { replace: true }); return; }
    // Workers/Drivers should NOT access the system — sign out and redirect.
    if (hasRole("worker") || hasRole("driver")) {
      toast.error("هذا الحساب ميداني ولا يملك صلاحية الدخول للنظام");
      supabase.auth.signOut().finally(() => nav("/welcome", { replace: true }));
      return;
    }
    const grantedAdminEntry = [
      ["admin_home.view", "/admin/dashboard"],
      ["admin_ask_me.view", "/admin/ask-me"],
      ["admin_catalog.view", "/admin/catalog"],
      ["admin_contacts.view", "/admin/contacts"],
      ["admin_employees.view", "/admin/employees"],
      ["admin_finance.view", "/admin/finance"],
      ["admin_reports_hub.view", "/admin/reports-hub"],
    ].find(([permission]) => can(permission));
    if (grantedAdminEntry) { nav(grantedAdminEntry[1], { replace: true }); return; }
    if (branches[0]) { nav(`/branch/${branches[0].id}/dashboard`, { replace: true }); return; }
    // Signed in but no open branch (e.g. the platform owner paused it): say so instead of the landing page.
    nav("/branch-paused", { replace: true });
  }, [user, isAdmin, isSuperAdmin, hasRole, branches, tenant, loading, ctxReady, can, nav]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
};

export default Index;
