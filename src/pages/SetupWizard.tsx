import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Loader2, Building2, Users, UserCog, Sparkles, Plus, Trash2,
  CheckCircle2, ChevronRight, ChevronLeft, Rocket, Store,
} from "lucide-react";

type Branch = { name: string };
type Partner = { name: string; capital_share: number; operating_share: number; initial_capital: number };
type Step = 1 | 2 | 3 | 4 | 5;

const STEPS = [
  { n: 1, title: "الشركة", icon: Building2 },
  { n: 2, title: "الفروع", icon: Store },
  { n: 3, title: "الشركاء", icon: Users },
  { n: 4, title: "المدير", icon: UserCog },
  { n: 5, title: "التنفيذ", icon: Rocket },
] as const;

const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

export default function SetupWizard() {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  // company
  const [company, setCompany] = useState({ name: "", slug: "" });
  // branches
  const [branches, setBranches] = useState<Branch[]>([{ name: "الفرع الرئيسي" }]);
  // partners
  const [partners, setPartners] = useState<Partner[]>([
    { name: "", capital_share: 100, operating_share: 100, initial_capital: 0 },
  ]);
  // admin
  const [admin, setAdmin] = useState({ name: "", email: "", password: "" });

  const totalCap = partners.reduce((s, p) => s + Number(p.capital_share || 0), 0);
  const totalOp = partners.reduce((s, p) => s + Number(p.operating_share || 0), 0);
  const totalCapital = partners.reduce((s, p) => s + Number(p.initial_capital || 0), 0);

  const slugify = (s: string) =>
    s.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 40);

  const canNext = (): string | null => {
    if (step === 1) {
      if (!company.name.trim()) return "اسم الشركة مطلوب";
      if (!/^[a-z0-9-]{3,40}$/.test(company.slug)) return "المعرف: أحرف إنجليزية صغيرة وأرقام و- (3-40 حرف)";
    }
    if (step === 2) {
      if (!branches.length) return "أضف فرعاً واحداً على الأقل";
      if (branches.some(b => !b.name.trim())) return "كل الفروع محتاجة أسماء";
    }
    if (step === 3 && partners.length) {
      if (partners.some(p => !p.name.trim())) return "كل الشركاء محتاجين أسماء";
      if (Math.abs(totalCap - 100) > 0.01) return `مجموع نسب رأس المال = ${totalCap}% (لازم = 100%)`;
      if (Math.abs(totalOp - 100) > 0.01) return `مجموع نسب التشغيل = ${totalOp}% (لازم = 100%)`;
    }
    if (step === 4) {
      if (!admin.name.trim()) return "اسم المدير مطلوب";
      if (!/^\S+@\S+\.\S+$/.test(admin.email)) return "بريد إلكتروني غير صالح";
      if (admin.password.length < 6) return "كلمة المرور 6 أحرف على الأقل";
    }
    return null;
  };

  const goNext = () => {
    const err = canNext();
    if (err) { toast.error(err); return; }
    setStep((s) => Math.min(5, s + 1) as Step);
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1) as Step);

  const submit = async () => {
    const err = canNext();
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("bootstrap-tenant", {
        body: {
          company_name: company.name.trim(),
          slug: company.slug,
          admin_name: admin.name.trim(),
          admin_email: admin.email.trim(),
          admin_password: admin.password,
          branches: branches.map(b => ({ name: b.name.trim() })),
          partners: partners.map(p => ({
            name: p.name.trim(),
            capital_share: Number(p.capital_share) || 0,
            operating_share: Number(p.operating_share) || 0,
            initial_capital: Number(p.initial_capital) || 0,
          })),
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult(data);
      toast.success("تم إنشاء الشركة بنجاح 🎉");
    } catch (e: any) {
      toast.error(e.message ?? "فشل التنفيذ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-3">
            <Sparkles className="w-4 h-4" /> معالج إنشاء شركة جديدة
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold gradient-text mb-2">Nizam Bootstrap</h1>
          <p className="text-muted-foreground">إنشاء شركة كاملة بكل حساباتها وفروعها وشركائها في خطوات بسيطة</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-between mb-8 px-2 overflow-x-auto">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = step > s.n;
            const active = step === s.n;
            return (
              <div key={s.n} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1.5 min-w-fit">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${
                    active ? "bg-primary text-primary-foreground scale-110 shadow-lg shadow-primary/30" :
                    done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                  }`}>
                    {done ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                  </div>
                  <span className={`text-xs whitespace-nowrap ${active ? "font-bold text-primary" : "text-muted-foreground"}`}>
                    {s.title}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-2 transition-all ${done ? "bg-emerald-500" : "bg-muted"}`} />
                )}
              </div>
            );
          })}
        </div>

        <Card className="p-6 sm:p-8 shadow-xl">
          {/* Step 1: Company */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold mb-1">بيانات الشركة</h2>
                <p className="text-sm text-muted-foreground">اسم الشركة اللي هيظهر في التقارير والفواتير</p>
              </div>
              <div>
                <Label>اسم الشركة *</Label>
                <Input
                  className="mt-1.5"
                  placeholder="مثلاً: شركة أحمد ناصر للتجارة"
                  value={company.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setCompany((c) => ({ name, slug: c.slug || slugify(name) }));
                  }}
                />
              </div>
              <div>
                <Label>المعرف (Slug) *</Label>
                <Input
                  dir="ltr"
                  className="mt-1.5 text-right"
                  placeholder="ahmed-nasser"
                  value={company.slug}
                  onChange={(e) => setCompany((c) => ({ ...c, slug: slugify(e.target.value) }))}
                />
                <p className="text-xs text-muted-foreground mt-1">أحرف إنجليزية صغيرة وأرقام وشرطة (-) فقط</p>
              </div>
            </div>
          )}

          {/* Step 2: Branches */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold mb-1">الفروع</h2>
                  <p className="text-sm text-muted-foreground">كل فرع هيتفتح له خزينة تلقائياً</p>
                </div>
                <Button size="sm" onClick={() => setBranches([...branches, { name: "" }])}>
                  <Plus className="w-4 h-4 ml-1" /> إضافة فرع
                </Button>
              </div>
              <div className="space-y-2">
                {branches.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                      {i + 1}
                    </div>
                    <Input
                      placeholder="اسم الفرع"
                      value={b.name}
                      onChange={(e) => {
                        const c = [...branches]; c[i].name = e.target.value; setBranches(c);
                      }}
                    />
                    {branches.length > 1 && (
                      <Button size="icon" variant="ghost" onClick={() => setBranches(branches.filter((_, x) => x !== i))}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="text-sm text-muted-foreground bg-muted/40 rounded-lg p-3">
                💡 هيتم إنشاء أكواد الفروع تلقائياً (FR-001, FR-002, …)
              </div>
            </div>
          )}

          {/* Step 3: Partners */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold mb-1">الشركاء</h2>
                  <p className="text-sm text-muted-foreground">اختياري — لو الشركة فرد واحد سيبها كما هي</p>
                </div>
                <Button size="sm" onClick={() => setPartners([...partners, { name: "", capital_share: 0, operating_share: 0, initial_capital: 0 }])}>
                  <Plus className="w-4 h-4 ml-1" /> إضافة شريك
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className={`p-2 rounded-lg text-center ${Math.abs(totalCap - 100) < 0.01 ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"}`}>
                  رأس المال: {totalCap}%
                </div>
                <div className={`p-2 rounded-lg text-center ${Math.abs(totalOp - 100) < 0.01 ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"}`}>
                  التشغيل: {totalOp}%
                </div>
                <div className="p-2 rounded-lg bg-primary/10 text-primary text-center">
                  إجمالي المساهمات: {fmt(totalCapital)} ج.م
                </div>
              </div>

              <div className="space-y-3">
                {partners.map((p, i) => (
                  <div key={i} className="border rounded-xl p-3 bg-muted/20">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold">الشريك #{i + 1}</span>
                      {partners.length > 1 && (
                        <Button size="icon" variant="ghost" onClick={() => setPartners(partners.filter((_, x) => x !== i))}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <div className="sm:col-span-1">
                        <Label className="text-xs">الاسم</Label>
                        <Input value={p.name} onChange={(e) => { const c = [...partners]; c[i].name = e.target.value; setPartners(c); }} />
                      </div>
                      <div>
                        <Label className="text-xs">رأس المال %</Label>
                        <Input type="number" step="0.01" value={p.capital_share}
                          onChange={(e) => { const c = [...partners]; c[i].capital_share = Number(e.target.value); setPartners(c); }} />
                      </div>
                      <div>
                        <Label className="text-xs">التشغيل %</Label>
                        <Input type="number" step="0.01" value={p.operating_share}
                          onChange={(e) => { const c = [...partners]; c[i].operating_share = Number(e.target.value); setPartners(c); }} />
                      </div>
                      <div>
                        <Label className="text-xs">مساهمة (ج.م)</Label>
                        <Input type="number" step="0.01" value={p.initial_capital}
                          onChange={(e) => { const c = [...partners]; c[i].initial_capital = Number(e.target.value); setPartners(c); }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Admin */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold mb-1">حساب المدير</h2>
                <p className="text-sm text-muted-foreground">هيقدر يدخل النظام ويدير كل حاجة</p>
              </div>
              <div>
                <Label>الاسم الكامل *</Label>
                <Input className="mt-1.5" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} />
              </div>
              <div>
                <Label>البريد الإلكتروني *</Label>
                <Input dir="ltr" type="email" className="mt-1.5 text-right"
                  value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
              </div>
              <div>
                <Label>كلمة المرور *</Label>
                <Input type="password" className="mt-1.5"
                  value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} />
                <p className="text-xs text-muted-foreground mt-1">6 أحرف على الأقل</p>
              </div>
            </div>
          )}

          {/* Step 5: Execute */}
          {step === 5 && !result && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold mb-1">مراجعة نهائية</h2>
                <p className="text-sm text-muted-foreground">راجع البيانات قبل التنفيذ</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">الشركة</div>
                  <div className="font-semibold">{company.name}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">/{company.slug}</div>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">المدير</div>
                  <div className="font-semibold">{admin.name}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">{admin.email}</div>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">الفروع ({branches.length})</div>
                  <ul className="text-sm">{branches.map((b, i) => <li key={i}>• {b.name}</li>)}</ul>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">الشركاء ({partners.length}) — رأس مال {fmt(totalCapital)} ج.م</div>
                  <ul className="text-sm">
                    {partners.map((p, i) => <li key={i}>• {p.name || "—"} ({p.capital_share}% / {p.operating_share}%)</li>)}
                  </ul>
                </div>
              </div>
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-sm">
                <p className="font-semibold mb-2">💫 التوليد التلقائي هيشمل:</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>✓ دليل حسابات كامل (60+ حساب) — Chart of Accounts</li>
                  <li>✓ {branches.length} فرع مع خزائن</li>
                  <li>✓ {partners.length} شريك مع تسجيل رأس المال محاسبياً</li>
                  <li>✓ قيد رأس المال الافتتاحي: Dr 1100 / Cr 3100</li>
                  <li>✓ التحقق من توازن ميزان المراجعة</li>
                </ul>
              </div>
              <Button className="w-full h-12 btn-gradient text-base" onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="w-5 h-5 ml-2 animate-spin" /> : <Rocket className="w-5 h-5 ml-2" />}
                إنشاء الشركة الآن
              </Button>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-4 text-center">
              <div className="w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-12 h-12" />
              </div>
              <h2 className="text-2xl font-bold">تم إنشاء الشركة بنجاح 🎉</h2>
              <div className="text-right space-y-2 max-w-md mx-auto">
                <ResultRow label="دليل الحسابات" value={`${result.chart_of_accounts_count} حساب`} />
                <ResultRow label="الفروع" value={`${result.branches?.length ?? 0} فرع`} />
                <ResultRow label="الشركاء" value={`${result.partners?.length ?? 0} شريك`} />
                <ResultRow
                  label="ميزان المراجعة"
                  value={result.trial_balance?.balanced ? "متوازن ✓" : `فرق ${fmt(result.trial_balance?.variance)} ⚠️`}
                  ok={result.trial_balance?.balanced}
                />
                <ResultRow label="مدين" value={`${fmt(result.trial_balance?.total_debit)} ج.م`} />
                <ResultRow label="دائن" value={`${fmt(result.trial_balance?.total_credit)} ج.م`} />
              </div>
              <div className="flex gap-2 justify-center pt-2">
                <Button className="btn-gradient" onClick={() => nav("/login")}>
                  الذهاب لتسجيل الدخول
                </Button>
                <Button variant="outline" onClick={() => { setResult(null); setStep(1); }}>
                  إنشاء شركة أخرى
                </Button>
              </div>
            </div>
          )}

          {/* Nav buttons */}
          {!result && step < 5 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t">
              <Button variant="outline" onClick={goBack} disabled={step === 1}>
                <ChevronRight className="w-4 h-4 ml-1" /> السابق
              </Button>
              <Button className="btn-gradient" onClick={goNext}>
                التالي <ChevronLeft className="w-4 h-4 mr-1" />
              </Button>
            </div>
          )}
          {!result && step === 5 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t">
              <Button variant="outline" onClick={goBack} disabled={busy}>
                <ChevronRight className="w-4 h-4 ml-1" /> السابق
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ResultRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between border rounded-lg px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold ${ok === false ? "text-destructive" : ok === true ? "text-emerald-500" : ""}`}>{value}</span>
    </div>
  );
}
