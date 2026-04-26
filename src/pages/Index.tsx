import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

const Index = () => {
  const { user, isAdmin, branches, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!user) nav("/welcome", { replace: true });
    else if (isAdmin) nav("/admin/dashboard", { replace: true });
    else if (branches[0]) nav(`/branch/${branches[0].id}/dashboard`, { replace: true });
    else nav("/login", { replace: true });
  }, [user, isAdmin, branches, loading, nav]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
};

export default Index;
