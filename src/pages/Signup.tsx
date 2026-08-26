import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Store, Building2, User, ArrowRight, ArrowLeft, Check } from "lucide-react";

type Step = 1 | 2 | 3;

export default function Signup() {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [branchName, setBranchName] = useState("الفرع الرئيسي");

  const autoSlug = (v: string) =>
    v.toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 30);

  const next = () => {
    if (step === 1) {
      if (!companyName.trim()) return toast.error("أدخل اسم الشركة");
      if (!slug || slug.length < 3) return toast.error("أدخل معرف الشركة (3 أحرف على الأقل)");
      if (!/^[a-z0-9-]+$/.test(slug)) return toast.error("المعرف: أحرف إنجليزية صغيرة وأرقام و- فقط");
    }
    if (step === 2) {
      if (!adminName.trim()) return toast.error("أدخل اسمك");
      if (!adminEmail.includes("@")) return toast.error("بريد غير صالح");
      if (adminPassword.length < 6) return toast.error("كلمة المرور 6 أحرف على الأقل");
    }
    setStep((s) => (s + 1) as Step);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("tenant-signup", {
        body: {
          company_name: companyName,
          slug,
          admin_email: adminEmail,
          admin_password: adminPassword,
          admin_name: adminName,
          branch_name: branchName || undefined,
        },
      });
      const sErr = await edgeErrorMessage(error, data);
      if (sErr) throw new Error(sErr);

      toast.success("تم إنشاء الحساب! جاري تسجيل الدخول...");
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: adminEmail,
        password: adminPassword,
      });
      if (signErr) {
        toast.error("الحساب تم إنشاؤه، حاول الدخول يدوياً");
        nav("/login");
        return;
      }
      nav("/admin/dashboard", { replace: true });
    } catch (e: any) {
      toast.error(e.message ?? "فشل التسجيل");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
      <Helmet>
        <title>ابدأ الآن | Nizam</title>
        <meta name="description" content="أنشئ حساب شركتك على Nizam في أقل من دقيقة وابدأ إدارة المبيعات والمخزون والخزنة والموظفين لكل فروعك بسهولة." />
        <link rel="canonical" href="https://nizaam.lovable.app/signup" />
        <meta property="og:title" content="ابدأ الآن | Nizam" />
        <meta property="og:url" content="https://nizaam.lovable.app/signup" />
        <meta property="og:description" content="أنشئ حساب شركتك على Nizam وابدأ إدارة فروعك في دقيقة." />
      </Helmet>
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl gradient-primary" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl bg-secondary/40" />
      </div>

      <div className="relative w-full max-w-lg card-elevated p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center mb-3 shadow-lg">
            <Store className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold gradient-text">ابدأ مجاناً</h1>
          <p className="text-muted-foreground text-sm mt-1">أنشئ حساب شركتك في أقل من دقيقة</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                step >= n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {step > n ? <Check className="w-4 h-4" /> : n}
              </div>
              {n < 3 && <div className={`w-12 h-0.5 mx-1 ${step > n ? "bg-primary" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <div className="flex items-center gap-2 text-sm font-medium text-primary mb-2">
              <Building2 className="w-4 h-4" /> بيانات الشركة
            </div>
            <div>
              <Label>اسم الشركة</Label>
              <Input
                className="mt-1.5"
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  if (!slug) setSlug(autoSlug(e.target.value));
                }}
                placeholder="مثال: متجر النور"
              />
            </div>
            <div>
              <Label>معرف الشركة (يُستخدم في الرابط)</Label>
              <Input
                dir="ltr"
                className="text-right mt-1.5"
                value={slug}
                onChange={(e) => setSlug(autoSlug(e.target.value))}
                placeholder="al-noor-store"
              />
              <p className="text-xs text-muted-foreground mt-1">أحرف إنجليزية صغيرة وأرقام و- فقط</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <div className="flex items-center gap-2 text-sm font-medium text-primary mb-2">
              <User className="w-4 h-4" /> حساب المدير
            </div>
            <div>
              <Label>اسمك بالكامل</Label>
              <Input className="mt-1.5" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
            </div>
            <div>
              <Label>البريد الإلكتروني</Label>
              <Input
                type="email" dir="ltr" className="text-right mt-1.5"
                value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
              />
            </div>
            <div>
              <Label>كلمة المرور</Label>
              <Input
                type="password" className="mt-1.5"
                value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="6 أحرف على الأقل"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <div className="flex items-center gap-2 text-sm font-medium text-primary mb-2">
              <Store className="w-4 h-4" /> أول فرع
            </div>
            <div>
              <Label>اسم الفرع</Label>
              <Input
                className="mt-1.5"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="الفرع الرئيسي"
              />
              <p className="text-xs text-muted-foreground mt-1">يمكنك إضافة فروع إضافية لاحقاً</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-4 text-sm space-y-1">
              <div><span className="text-muted-foreground">الشركة:</span> <span className="font-medium">{companyName}</span></div>
              <div><span className="text-muted-foreground">المعرف:</span> <span className="font-medium" dir="ltr">{slug}</span></div>
              <div><span className="text-muted-foreground">المدير:</span> <span className="font-medium">{adminName}</span></div>
              <div><span className="text-muted-foreground">البريد:</span> <span className="font-medium" dir="ltr">{adminEmail}</span></div>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-8">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((s) => (s - 1) as Step)} disabled={busy}>
              <ArrowRight className="w-4 h-4 ml-1" /> السابق
            </Button>
          )}
          {step < 3 ? (
            <Button onClick={next} className="flex-1 btn-gradient">
              التالي <ArrowLeft className="w-4 h-4 mr-1" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={busy} className="flex-1 btn-gradient">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "إنشاء الحساب"}
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-6">
          لديك حساب بالفعل؟{" "}
          <Link to="/login" className="text-primary hover:underline">تسجيل الدخول</Link>
        </p>
      </div>
    </div>
  );
}
