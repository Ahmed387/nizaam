import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Store, ShieldCheck } from "lucide-react";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    // Supabase auto-creates a session from the recovery link hash.
    // Listen for PASSWORD_RECOVERY event or check existing session.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
    if (password !== confirm) return toast.error("كلمتا المرور غير متطابقتين");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("تم تحديث كلمة المرور");
      await supabase.auth.signOut();
      nav("/login", { replace: true });
    }
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
          <h1 className="text-2xl font-extrabold">تعيين كلمة مرور جديدة</h1>
          <p className="text-muted-foreground text-sm mt-1">أدخل كلمة المرور الجديدة الخاصة بك</p>
        </div>

        {!ready ? (
          <div className="text-center py-6">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground mt-3">جاري التحقق من الرابط...</p>
            <p className="text-xs text-muted-foreground mt-2">
              إذا لم يكتمل التحميل، تأكد أنك فتحت الرابط من بريدك مباشرة
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="password">كلمة المرور الجديدة</Label>
              <Input
                id="password" type="password" required minLength={6} className="mt-1.5"
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div>
              <Label htmlFor="confirm">تأكيد كلمة المرور</Label>
              <Input
                id="confirm" type="password" required minLength={6} className="mt-1.5"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full h-11 btn-gradient text-base">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                <span className="inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> حفظ كلمة المرور</span>
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
