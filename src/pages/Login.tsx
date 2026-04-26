import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Store } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { user, isAdmin, branches, loading } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      if (isAdmin) nav("/admin/dashboard", { replace: true });
      else if (branches[0]) nav(`/branch/${branches[0].id}/dashboard`, { replace: true });
    }
  }, [user, isAdmin, branches, loading, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error("بيانات الدخول غير صحيحة");
    else toast.success("تم تسجيل الدخول بنجاح");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl gradient-primary" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl bg-secondary/40" />
      </div>

      <div className="relative w-full max-w-md card-elevated p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mb-4 shadow-lg">
            <Store className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold gradient-text">A & N</h1>
          <p className="text-muted-foreground text-sm mt-1">نظام إدارة المتاجر متعددة الفروع</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input
              id="email" type="email" required dir="ltr" className="text-right mt-1.5"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@an.com"
            />
          </div>
          <div>
            <Label htmlFor="password">كلمة المرور</Label>
            <Input
              id="password" type="password" required className="mt-1.5"
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <Button type="submit" disabled={busy} className="w-full h-11 btn-gradient text-base">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "تسجيل الدخول"}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center mt-6">
          ليس لديك حساب؟ <a href="/signup" className="text-primary hover:underline font-medium">أنشئ شركتك الآن مجاناً</a>
        </p>
      </div>
    </div>
  );
}
