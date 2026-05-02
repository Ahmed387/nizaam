import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Store, Eye, EyeOff } from "lucide-react";

const POSITIONS = ["كاشير", "مدير فرع", "أمين مخزن", "محاسب", "مندوب مبيعات", "موظف خدمة عملاء"];

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  // Employee mode fields
  const [empEmail, setEmpEmail] = useState("");
  const [empPhone, setEmpPhone] = useState("");
  const [empJob, setEmpJob] = useState("");
  const [empPassword, setEmpPassword] = useState("");

  const { user, isAdmin, isSuperAdmin, branches, loading } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      if (isSuperAdmin) nav("/super/dashboard", { replace: true });
      else if (isAdmin) nav("/admin/dashboard", { replace: true });
      else if (branches[0]) nav(`/branch/${branches[0].id}/dashboard`, { replace: true });
    }
  }, [user, isAdmin, isSuperAdmin, branches, loading, nav]);

  const submitAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error("بيانات الدخول غير صحيحة");
    else toast.success("تم تسجيل الدخول بنجاح");
  };

  const submitEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empEmail || !empPhone || !empJob || !empPassword) {
      return toast.error("املأ كل البيانات بما فيها كلمة المرور");
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("employee-signin", {
        body: { email: empEmail, phone: empPhone, job_title: empJob, password: empPassword },
      });
      if (error) {
        const ctx: any = (error as any).context;
        let msg = "Access Denied";
        try {
          if (ctx?.body) {
            const parsed = typeof ctx.body === "string" ? JSON.parse(ctx.body) : ctx.body;
            msg = parsed?.error ?? msg;
          }
        } catch {}
        toast.error(msg);
        return;
      }
      if (!data?.ok) {
        toast.error(data?.error ?? "Access Denied");
        return;
      }
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (signErr) {
        toast.error(signErr.message);
        return;
      }
      toast.success(`أهلاً بك! تم الدخول كـ ${empJob}`);
    } catch (err: any) {
      toast.error(err.message ?? "حدث خطأ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl gradient-primary" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl bg-secondary/40" />
      </div>

      <div className="relative w-full max-w-md card-elevated p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mb-4 shadow-lg">
            <Store className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold gradient-text">Nexa Store</h1>
          <p className="text-muted-foreground text-sm mt-1">نظام إدارة المتاجر متعددة الفروع</p>
        </div>

        <Tabs defaultValue="employee" className="w-full">
          <TabsList className="grid grid-cols-2 w-full mb-4">
            <TabsTrigger value="employee">دخول موظف</TabsTrigger>
            <TabsTrigger value="admin">دخول مدير شركة</TabsTrigger>
          </TabsList>

          <TabsContent value="employee">
            <form onSubmit={submitEmployee} className="space-y-3">
              <div>
                <Label>البريد الإلكتروني *</Label>
                <Input type="email" required dir="ltr" className="text-right mt-1.5"
                  value={empEmail} onChange={(e) => setEmpEmail(e.target.value)} />
              </div>
              <div>
                <Label>رقم التليفون *</Label>
                <Input required dir="ltr" className="text-right mt-1.5"
                  value={empPhone} onChange={(e) => setEmpPhone(e.target.value)} />
              </div>
              <div>
                <Label>الوظيفة *</Label>
                <Select value={empJob} onValueChange={setEmpJob}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر وظيفتك" /></SelectTrigger>
                  <SelectContent>
                    {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>كلمة المرور *</Label>
                <Input type="password" required className="mt-1.5"
                  value={empPassword} onChange={(e) => setEmpPassword(e.target.value)} />
              </div>
              <Button type="submit" disabled={busy} className="w-full h-11 btn-gradient text-base">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "دخول"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                لو ظهرت لك Access Denied، تواصل مع مدير الشركة لإضافتك أو مراجعة بياناتك.
              </p>
            </form>
          </TabsContent>

          <TabsContent value="admin">
            <form onSubmit={submitAdmin} className="space-y-3">
              <div>
                <Label htmlFor="email">البريد الإلكتروني</Label>
                <Input id="email" type="email" required dir="ltr" className="text-right mt-1.5"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@company.com" />
              </div>
              <div>
                <Label htmlFor="password">كلمة المرور</Label>
                <div className="relative mt-1.5">
                  <Input id="password" type={showPassword ? "text" : "password"} required className="pl-10"
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
              <div className="text-center">
                <a href="/forgot-password" className="text-xs text-primary hover:underline font-medium">
                  نسيت كلمة المرور؟
                </a>
              </div>
            </form>
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground text-center mt-6">
          ليس لديك شركة؟ <a href="/signup" className="text-primary hover:underline font-medium">أنشئ شركتك الآن مجاناً</a>
        </p>
      </div>
    </div>
  );
}
