import { edgeErrorMessage } from "@/lib/edgeError";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABELS } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, ArrowRight, User as UserIcon, Phone, Mail, MapPin, Briefcase, KeyRound, Eye, EyeOff } from "lucide-react";
import { formatEGP, formatDate } from "@/lib/format";

export default function Profile() {
  const nav = useNavigate();
  const { user, profile, roles, branches, loading, refresh, roleLabel } = useAuth();


  const [emp, setEmp] = useState<any>(null);
  const [loadingEmp, setLoadingEmp] = useState(true);

  const [form, setForm] = useState({ name: "", username: "", phone: "", address: "" });
  const [saving, setSaving] = useState(false);

  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [showPwd, setShowPwd] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const changeEmail = async () => {
    const e = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return toast.error("بريد إلكتروني غير صالح");
    if (e === user?.email?.toLowerCase()) return toast.error("هذا هو بريدك الحالي");
    setSavingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke("update-own-email", { body: { newEmail: e } });
      const eErr = await edgeErrorMessage(error, data);
      if (eErr) throw new Error(eErr);
      toast.success("تم تغيير البريد الإلكتروني بنجاح");
      setNewEmail("");
      await refresh();
    } catch (err: any) {
      toast.error(err.message ?? "فشل التغيير");
    } finally {
      setSavingEmail(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoadingEmp(true);
      const { data: e } = await supabase
        .from("employees")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      setEmp(e);
      setForm({
        name: profile?.name ?? "",
        username: profile?.username ?? "",
        phone: e?.phone ?? "",
        address: e?.address ?? "",
      });
      setLoadingEmp(false);
    })();
  }, [user?.id, profile?.name, profile?.username]);

  const goBack = () => {
    if (roles.includes("super_admin")) nav("/super/dashboard");
    else if (roles.includes("admin")) nav("/admin/dashboard");
    else if (branches[0]) nav(`/branch/${branches[0].id}/dashboard`);
    else nav("/");
  };

  const saveProfile = async () => {
    if (!user) return;
    if (!form.name.trim()) return toast.error("الاسم مطلوب");
    setSaving(true);
    try {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ name: form.name.trim(), username: form.username.trim() })
        .eq("id", user.id);
      if (pErr) throw pErr;

      if (emp) {
        const { error: eErr } = await supabase
          .from("employees")
          .update({
            name: form.name.trim(),
            phone: form.phone.trim() || null,
            address: form.address.trim() || null,
          })
          .eq("id", emp.id);
        if (eErr) throw eErr;
      }

      toast.success("تم حفظ بياناتك");
      await refresh();
    } catch (e: any) {
      toast.error(e.message ?? "خطأ في الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (pwd.next.length < 8 || !/[A-Za-z]/.test(pwd.next) || !/[0-9]/.test(pwd.next)) {
      return toast.error("كلمة المرور لازم تكون 8 أحرف على الأقل وتحتوي على حرف ورقم");
    }
    if (pwd.next !== pwd.confirm) return toast.error("كلمتا المرور غير متطابقتين");
    setSavingPwd(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: pwd.next,
        data: { must_change_password: false },
      });
      if (error) throw error;
      toast.success("تم تغيير كلمة المرور");
      setPwd({ current: "", next: "", confirm: "" });
    } catch (e: any) {
      toast.error(e.message ?? "خطأ");
    } finally {
      setSavingPwd(false);
    }
  };

  if (loading || loadingEmp) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const initials = (profile?.name ?? "؟").split(" ").slice(0, 2).map((s) => s[0]).join("");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 md:p-6 lg:p-8">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" onClick={goBack} className="gap-1">
            <ArrowRight className="w-4 h-4" /> رجوع
          </Button>
        </div>

        {(user as any)?.user_metadata?.must_change_password === true && (
          <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-4">
            <p className="font-bold text-warning">لازم تغيّر كلمة المرور الأول 🔐</p>
            <p className="text-sm text-muted-foreground mt-1">
              حسابك اتعمل بكلمة مرور مؤقتة. غيّرها من تحت عشان تقدر تدخل باقي الشاشات.
            </p>
          </div>
        )}



        {/* Header */}
        <Card className="p-5 mb-4">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-3xl font-bold flex items-center justify-center">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-extrabold truncate">{profile?.name}</h1>
              <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                <Mail className="w-4 h-4" /> <span dir="ltr" className="truncate">{user?.email}</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {roles.map((r) => (
                  <span key={r} className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                    {roleLabel(r)}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {emp && (
            <div className="grid sm:grid-cols-2 gap-3 mt-5 pt-5 border-t text-sm">
              <div className="flex items-center gap-2"><Briefcase className="w-4 h-4 text-muted-foreground" /> {emp.job_title}</div>
              <div className="flex items-center gap-2"><UserIcon className="w-4 h-4 text-muted-foreground" /> تعيين: {formatDate(emp.hire_date)}</div>
              <div className="flex items-center gap-2">💰 الراتب: <b>{formatEGP(emp.base_salary)}</b></div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs ${emp.is_active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                  {emp.is_active ? "نشط" : "موقوف"}
                </span>
              </div>
            </div>
          )}
        </Card>

        {/* Edit info */}
        <Card className="p-5 mb-4">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><UserIcon className="w-5 h-5" /> البيانات الشخصية</h2>
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>الاسم</Label>
                <Input className="mt-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>اسم المستخدم</Label>
                <Input dir="ltr" className="mt-1.5 text-right" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
            </div>
            {emp && (
              <>
                <div>
                  <Label className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> التليفون</Label>
                  <Input dir="ltr" className="mt-1.5 text-right" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div>
                  <Label className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> العنوان</Label>
                  <Input className="mt-1.5" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
              </>
            )}
            <div className="flex justify-end pt-2">
              <Button onClick={saveProfile} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ التعديلات"}
              </Button>
            </div>
          </div>
        </Card>

        {/* Change email */}
        <Card className="p-5 mb-4">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Mail className="w-5 h-5" /> تغيير البريد الإلكتروني</h2>
          <div className="space-y-3">
            <div>
              <Label>البريد الحالي</Label>
              <Input dir="ltr" className="mt-1.5 text-right bg-muted" value={user?.email ?? ""} disabled />
            </div>
            <div>
              <Label>البريد الجديد</Label>
              <Input
                type="email"
                dir="ltr"
                className="mt-1.5 text-right"
                placeholder="new@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">سيتم استخدام البريد الجديد فوراً لتسجيل الدخول.</p>
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={changeEmail} disabled={savingEmail || !newEmail.trim()}>
                {savingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : "تغيير البريد"}
              </Button>
            </div>
          </div>
        </Card>

        {/* Change password */}
        <Card className="p-5">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><KeyRound className="w-5 h-5" /> تغيير كلمة المرور</h2>
          <div className="space-y-3">
            <div>
              <Label>كلمة المرور الجديدة</Label>
              <div className="relative mt-1.5">
                <Input
                  type={showPwd ? "text" : "password"}
                  value={pwd.next}
                  onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
                  className="pl-10"
                />
                <button type="button" onClick={() => setShowPwd((v) => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <Label>تأكيد كلمة المرور</Label>
              <Input
                type={showPwd ? "text" : "password"}
                className="mt-1.5"
                value={pwd.confirm}
                onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
              />
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={changePassword} disabled={savingPwd || !pwd.next}>
                {savingPwd ? <Loader2 className="w-4 h-4 animate-spin" /> : "تغيير كلمة المرور"}
              </Button>
            </div>
          </div>
        </Card>

      </div>
    </div>
  );
}
