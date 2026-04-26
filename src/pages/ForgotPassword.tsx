import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Store, Mail } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return toast.error("أدخل بريدك الإلكتروني");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
      toast.success("تم إرسال رابط الاستعادة");
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
          <h1 className="text-2xl font-extrabold">استعادة كلمة المرور</h1>
          <p className="text-muted-foreground text-sm mt-1 text-center">
            أدخل بريدك الإلكتروني وسنرسل لك رابط لإعادة تعيين كلمة المرور
          </p>
        </div>

        {sent ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-success/15 flex items-center justify-center mx-auto">
              <Mail className="w-8 h-8 text-success" />
            </div>
            <div>
              <p className="font-semibold">تحقق من بريدك الإلكتروني</p>
              <p className="text-sm text-muted-foreground mt-1">
                أرسلنا رابط استعادة إلى <span dir="ltr" className="font-mono">{email}</span>
              </p>
            </div>
            <Link to="/login" className="text-primary hover:underline text-sm font-medium block">
              العودة لتسجيل الدخول
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input
                id="email" type="email" required dir="ltr" className="text-right mt-1.5"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full h-11 btn-gradient text-base">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "إرسال رابط الاستعادة"}
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              <Link to="/login" className="text-primary hover:underline font-medium">العودة لتسجيل الدخول</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
