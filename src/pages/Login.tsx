import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Store, Eye, EyeOff } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const { user, isAdmin, isSuperAdmin, branches, loading, hasRole, ctxReady, roles, can } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (loading || !user || !ctxReady) return;
    if (isSuperAdmin) nav("/super/dashboard", { replace: true });
    else if (isAdmin) nav("/admin/dashboard", { replace: true });
    else if (hasRole("partner")) nav("/partner/dashboard", { replace: true });
    else if (can("admin_home.view")) nav("/admin/dashboard", { replace: true });
    else if (can("admin_cockpit.view")) nav("/admin/cockpit", { replace: true });
    else if (can("admin_ask_me.view")) nav("/admin/ask-me", { replace: true });
    else if (can("admin_insights.view")) nav("/admin/insights", { replace: true });
    else if (can("admin_catalog.view")) nav("/admin/catalog", { replace: true });
    else if (can("admin_contacts.view")) nav("/admin/contacts", { replace: true });
    else if (can("admin_employees.view")) nav("/admin/employees", { replace: true });
    else if (can("admin_finance.view")) nav("/admin/finance", { replace: true });
    else if (can("admin_reports_hub.view")) nav("/admin/reports-hub", { replace: true });
    else if (branches[0]) nav(`/branch/${branches[0].id}/dashboard`, { replace: true });
    else if (roles.length > 0) nav("/admin/dashboard", { replace: true });
    else toast.error("حسابك غير مرتبط بأي فرع أو صلاحية — كلّم مدير الشركة");
  }, [user, isAdmin, isSuperAdmin, branches, loading, hasRole, nav, ctxReady, roles, can]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const mail = email.trim().toLowerCase();
    if (!mail || !password) return toast.error("اكتب البريد الإلكتروني وكلمة المرور");
    setBusy(true);
    try {
      // 1) Standard sign-in (works for owners, managers and any employee with an account)
      const { error } = await supabase.auth.signInWithPassword({ email: mail, password });
      if (!error) {
        toast.success("تم تسجيل الدخول بنجاح");
        return;
      }

      // 2) Fallback for legacy employees whose auth account isn't synced yet
      const { data, error: fnErr } = await supabase.functions.invoke("employee-signin", {
        body: { email: mail, password },
      });
      let resolvedCredentials = !fnErr && data?.ok ? data : null;
      let reason: string | null = !fnErr && data?.error ? String(data.error) : null;

      // 3) Compatibility path for older partner accounts whose visible email was
      // historically stored as a username while Auth used an internal address.
      if (!resolvedCredentials) {
        const { data: partnerData, error: partnerErr } = await supabase.functions.invoke("partner-signin", {
          body: { email: mail, password },
        });
        if (!partnerErr && partnerData?.ok) resolvedCredentials = partnerData;
      }

      if (!resolvedCredentials) {
        toast.error(reason ?? "البريد الإلكتروني أو كلمة المرور غير صحيحة");
        return;
      }


      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: resolvedCredentials.email,
        password,
      });
      if (signErr) {
        toast.error("البريد الإلكتروني أو كلمة المرور غير صحيحة");
        return;
      }
      toast.success("تم تسجيل الدخول بنجاح");
    } catch (err: any) {
      toast.error(err?.message ?? "حدث خطأ أثناء تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
      <Helmet>
        <title>تسجيل الدخول | Nizam</title>
        <meta name="description" content="ادخل إلى حساب Nizam لإدارة المتاجر متعددة الفروع: مبيعات، مخزون، خزنة، موظفين وتقارير في مكان واحد." />
        <link rel="canonical" href="https://nizaam.lovable.app/login" />
        <meta property="og:title" content="تسجيل الدخول | Nizam" />
        <meta property="og:url" content="https://nizaam.lovable.app/login" />
        <meta property="og:description" content="ادخل إلى حساب Nizam لإدارة المتاجر متعددة الفروع." />
      </Helmet>
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl gradient-primary" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl bg-secondary/40" />
      </div>

      <div className="relative w-full max-w-md card-elevated p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mb-4 shadow-lg">
            <Store className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold gradient-text">Nizam</h1>
          <p className="text-muted-foreground text-sm mt-1">نظام إدارة المتاجر متعددة الفروع</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input id="email" type="email" required dir="ltr" className="text-right mt-1.5"
              autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com" />
          </div>
          <div>
            <Label htmlFor="password">كلمة المرور</Label>
            <div className="relative mt-1.5">
              <Input id="password" type={showPassword ? "text" : "password"} required className="pl-10"
                autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}>
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" disabled={busy} className="w-full h-11 btn-gradient text-base">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "تسجيل الدخول"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            دخول موحّد للمدير والموظف — النظام بيحدد صلاحياتك وصفحتك تلقائياً.
          </p>
          <div className="text-center">
            <a href="/forgot-password" className="text-xs text-primary hover:underline font-medium">
              نسيت كلمة المرور؟
            </a>
          </div>
        </form>

        <p className="text-xs text-muted-foreground text-center mt-6">
          ليس لديك شركة؟ <a href="/signup" className="text-primary hover:underline font-medium">أنشئ شركتك الآن مجاناً</a>
        </p>
      </div>
    </div>
  );
}

