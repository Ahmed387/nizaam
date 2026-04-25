import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Store } from "lucide-react";

export default function Setup() {
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);
  const [name, setName] = useState("المدير العام");
  const [email, setEmail] = useState("admin@an.com");
  const [password, setPassword] = useState("nasser2811");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    supabase.from("user_roles").select("id", { head: true, count: "exact" }).eq("role", "admin").then(({ count }) => {
      setHasAdmin((count ?? 0) > 0);
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { name, username: email.split("@")[0] },
        },
      });
      if (error) throw error;
      const userId = data.user?.id;
      if (!userId) throw new Error("لم يتم إنشاء المستخدم");

      // Wait briefly for profile trigger, then assign admin role
      await new Promise((r) => setTimeout(r, 500));
      const { error: rErr } = await supabase.from("user_roles").insert({ user_id: userId, role: "admin" });
      if (rErr) throw rErr;

      toast.success("تم إنشاء حساب المدير العام بنجاح");
      nav("/admin/dashboard");
    } catch (e: any) {
      toast.error(e.message ?? "خطأ في الإنشاء");
    } finally {
      setBusy(false);
    }
  };

  if (hasAdmin === null) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
  }
  if (hasAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card-elevated p-8 max-w-md text-center">
          <h2 className="text-xl font-bold mb-2">الإعداد مكتمل</h2>
          <p className="text-muted-foreground mb-6">يوجد حساب مدير عام بالفعل. توجه لصفحة تسجيل الدخول.</p>
          <Button className="btn-gradient" onClick={() => nav("/login")}>الذهاب لتسجيل الدخول</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="card-elevated p-8 w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center mb-3">
            <Store className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold gradient-text">الإعداد الأولي</h1>
          <p className="text-muted-foreground text-sm mt-1">إنشاء حساب المدير العام للنظام</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>الاسم الكامل</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1.5" />
          </div>
          <div>
            <Label>البريد الإلكتروني</Label>
            <Input type="email" dir="ltr" className="text-right mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label>كلمة المرور</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="mt-1.5" />
            <p className="text-xs text-muted-foreground mt-1">8 أحرف على الأقل</p>
          </div>
          <Button type="submit" disabled={busy} className="w-full h-11 btn-gradient">
            {busy ? <Loader2 className="animate-spin w-4 h-4" /> : "إنشاء حساب المدير"}
          </Button>
        </form>
      </div>
    </div>
  );
}
