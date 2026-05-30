import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const Index = () => {
  const { user, isAdmin, isSuperAdmin, hasRole, branches, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/welcome", { replace: true }); return; }
    if (isSuperAdmin) { nav("/super/dashboard", { replace: true }); return; }
    if (isAdmin) { nav("/admin/dashboard", { replace: true }); return; }
    if (hasRole("supervisor")) { nav("/admin/employees", { replace: true }); return; }
    // Workers/Drivers should NOT access the system — sign out and redirect.
    if (hasRole("worker") || hasRole("driver")) {
      toast.error("هذا الحساب ميداني ولا يملك صلاحية الدخول للنظام");
      supabase.auth.signOut().finally(() => nav("/welcome", { replace: true }));
      return;
    }
    if (branches[0]) { nav(`/branch/${branches[0].id}/dashboard`, { replace: true }); return; }
    nav("/welcome", { replace: true });
  }, [user, isAdmin, isSuperAdmin, hasRole, branches, loading, nav]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
};

export default Index;
