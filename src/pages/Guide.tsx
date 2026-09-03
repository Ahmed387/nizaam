import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  ArrowRight,
  Check,
  RotateCcw,
  SkipForward,
  Loader2,
  Rocket,
  Building2,
  Users,
  Landmark,
  HandCoins,
  Package,
  BookOpen,
  ExternalLink,
  PartyPopper,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

type GoLiveAction = { label: string; to: string };

type GoLiveStep = {
  key: string;
  title: string;
  description: string;
  icon: typeof Building2;
  actions: GoLiveAction[];
};

const GO_LIVE_STEPS: GoLiveStep[] = [
  {
    key: "go-live-1",
    title: "الهيكل التنظيمي",
    description:
      "ابدأ بإنشاء فروع شركتك، ثم أضف الموظفين واربط كل موظف بفرعه مع تحديد صلاحياته.",
    icon: Building2,
    actions: [
      { label: "إدارة الفروع", to: "/admin/branches" },
      { label: "إدارة الموظفين", to: "/admin/employees" },
    ],
  },
  {
    key: "go-live-2",
    title: "المحفظة الأم",
    description:
      "قم بتسجيل الشركاء وإضافة (مساهمة - Contribution) لإثبات رأس المال الفعلي في الخزينة المركزية.",
    icon: Landmark,
    actions: [{ label: "إدارة الشركاء ورأس المال", to: "/admin/financial-position?tab=partners" }],
  },
  {
    key: "go-live-3",
    title: "تمويل الفروع النقدية",
    description:
      "لا تقم بعمل تحويل عادي. استخدم هذه الشاشة لتوزيع جزء من رأس مال الشركاء كـ \"عهدة تشغيلية\" لخزن الفروع لبدء العمل.",
    icon: HandCoins,
    actions: [{ label: "توزيع العهد على الفروع", to: "/admin/accounting/branch-capital" }],
  },
  {
    key: "go-live-4",
    title: "أرصدة أول المدة",
    description:
      "استخدم خاصية \"الرصيد الافتتاحي\" لإدخال كميات المخزون الحالية وتكلفتها لضبط محرك الـ FIFO بشكل صحيح وربطه بحقوق الملكية.",
    icon: Package,
    actions: [{ label: "الأرصدة الافتتاحية - المخزون", to: "/admin/accounting/opening-balances" }],
  },
  {
    key: "go-live-5",
    title: "الديون السابقة",
    description:
      "قم بإثبات الأموال التي لك في السوق، والديون التي عليك للموردين كأرصدة افتتاحية لتبدأ الحسابات بأرقام مطابقة للواقع.",
    icon: BookOpen,
    actions: [{ label: "الأرصدة الافتتاحية - العملاء والموردين", to: "/admin/accounting/opening-balances" }],
  },
];

export default function Guide() {
  const nav = useNavigate();
  const { isAdmin, isOwner } = useAuth();
  const { completed, loading, setSectionDone, setGuideSkipped, resetProgress } = useOnboardingProgress();
  const [justCompleted, setJustCompleted] = useState<string | null>(null);

  const isAdminUser = isAdmin || isOwner;

  const doneCount = useMemo(
    () => GO_LIVE_STEPS.filter((s) => completed[s.key]).length,
    [completed],
  );
  const pct = GO_LIVE_STEPS.length ? Math.round((doneCount / GO_LIVE_STEPS.length) * 100) : 0;

  const toggleStep = async (key: string) => {
    const next = !completed[key];
    await setSectionDone(key, next);
    if (next) {
      setJustCompleted(key);
      toast.success("تمام! خطوة جاهزة للإطلاق 🚀");
      setTimeout(() => setJustCompleted((k) => (k === key ? null : k)), 1200);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap animate-fade-in">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => nav(-1)}>
            <ArrowRight className="w-4 h-4" />
            رجوع
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              onClick={async () => {
                await resetProgress();
                toast.success("رجعنا من الأول — يلا بينا");
              }}
            >
              <RotateCcw className="w-4 h-4" />
              ابدأ من هنا تاني
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={async () => {
                await setGuideSkipped(true);
                toast.success("تمام، قفلنا الدليل. تلاقيه في أي وقت من علامة (؟) فوق");
                nav(-1);
              }}
            >
              <SkipForward className="w-4 h-4" />
              تخطي الدليل
            </Button>
          </div>
        </div>

        {/* Hero + progress */}
        <Card className="overflow-hidden border border-border/60 bg-gradient-to-l from-primary/10 via-primary/5 to-transparent animate-scale-in">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center shadow-[0_8px_24px_-6px_hsl(var(--primary)/0.45)] shrink-0">
                <Rocket className="w-7 h-7 text-primary-foreground" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">لوحة تحكم الإطلاق الفعلي</h1>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/15 text-primary text-xs font-bold">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    للأدمن
                  </span>
                </div>
                <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed max-w-3xl">
                  قائمة مهام متسلسلة بتحضّر النظام للتشغيل الفعلي. أكمل الـ 5 خطوات بالترتيب، وكل خطوة فيها زرار يوديك للشاشة المعنية على طول.
                </p>
              </div>
              <div className="shrink-0 text-center md:text-right">
                <div className="text-3xl font-extrabold text-primary tabular-nums">{pct}%</div>
                <div className="text-xs text-muted-foreground font-medium">{doneCount} / {GO_LIVE_STEPS.length} خطوات</div>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between text-sm font-bold mb-2">
                <span className="text-foreground">تقدّم الإطلاق</span>
                <span className="text-primary tabular-nums">{pct}%</span>
              </div>
              <Progress value={pct} className="h-3" />
            </div>
          </CardContent>
        </Card>

        {/* Steps */}
        <div className="relative">
          {/* connecting line */}
          <div
            className="absolute right-8 md:right-10 top-6 bottom-6 w-0.5 bg-gradient-to-b from-primary/30 via-primary/20 to-transparent hidden sm:block"
            aria-hidden="true"
          />

          <div className="space-y-4">
            {GO_LIVE_STEPS.map((step, index) => {
              const Icon = step.icon;
              const isDone = !!completed[step.key];
              const isJustCompleted = justCompleted === step.key;

              return (
                <Card
                  key={step.key}
                  className={`
                    relative overflow-hidden border transition-all duration-300 animate-fade-in
                    ${isDone ? "border-success/40 bg-success/5" : "border-border/60 hover:border-primary/40 bg-card"}
                    ${isJustCompleted ? "ring-2 ring-success/60 scale-[1.01]" : ""}
                  `}
                  style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}
                >
                  <CardHeader className="p-5 pb-0">
                    <div className="flex items-start gap-4">
                      <div
                        className={`
                          relative z-10 w-12 h-12 md:w-14 md:h-14 rounded-xl flex items-center justify-center shrink-0 shadow-sm
                          ${isDone
                            ? "bg-gradient-to-br from-success to-emerald-600 text-success-foreground"
                            : "bg-gradient-to-br from-primary to-primary-glow text-primary-foreground"
                          }
                        `}
                      >
                        {isDone ? (
                          <Check className="w-6 h-6 md:w-7 md:h-7" />
                        ) : (
                          <Icon className="w-6 h-6 md:w-7 md:h-7" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pt-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`
                              inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-extrabold
                              ${isDone ? "bg-success/15 text-success" : "bg-primary/15 text-primary"}
                            `}
                          >
                            {index + 1}
                          </span>
                          <h2 className="text-lg md:text-xl font-extrabold tracking-tight">{step.title}</h2>
                          {isDone && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/15 text-success text-xs font-bold">
                              <Check className="w-3 h-3" />
                              جاهزة
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-3xl">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-5 pt-4">
                    <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
                      <div className="flex flex-wrap gap-2">
                        {step.actions.map((action) => (
                          <Button
                            key={action.to}
                            size="sm"
                            variant={isDone ? "outline" : "default"}
                            className="gap-2"
                            onClick={() => nav(action.to)}
                          >
                            <ExternalLink className="w-4 h-4" />
                            {action.label}
                          </Button>
                        ))}
                      </div>

                      {isAdminUser && (
                        <Button
                          size="sm"
                          variant={isDone ? "outline" : "secondary"}
                          className={`
                            gap-2 shrink-0 transition-colors
                            ${isDone ? "border-success/40 text-success hover:bg-success/10" : ""}
                          `}
                          onClick={() => toggleStep(step.key)}
                        >
                          <Check className="w-4 h-4" />
                          {isDone ? "رجّعها مش جاهزة" : "أكملت الخطوة دي"}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Completion */}
        {pct === 100 && (
          <Card className="overflow-hidden border border-success/40 bg-gradient-to-l from-success/10 via-success/5 to-transparent animate-scale-in">
            <CardContent className="p-6 md:p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-success to-emerald-600 flex items-center justify-center mx-auto shadow-[0_8px_24px_-6px_hsl(var(--success)/0.45)]">
                <PartyPopper className="w-8 h-8 text-success-foreground" />
              </div>
              <h2 className="text-xl md:text-2xl font-extrabold mt-4">النظام جاهز للإطلاق الفعلي! 🎉</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl mx-auto leading-relaxed">
                أكملت كل خطوات الإطلاق الخمس. الأرصدة الافتتاحية، رأس المال، العهد، الفروع، والمستخدمين كلهم جهزين. ممكن تبدأ العمليات اليومية دلوقتي.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
                <Button onClick={() => nav("/admin/dashboard")}>
                  <Rocket className="w-4 h-4" />
                  ابدأ العمليات
                </Button>
                <Button variant="outline" onClick={() => nav(-1)}>
                  <ArrowRight className="w-4 h-4" />
                  رجوع
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
