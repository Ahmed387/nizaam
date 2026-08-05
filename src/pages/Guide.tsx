import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { GUIDE_SECTIONS } from "@/lib/guideContent";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { ArrowRight, Check, ExternalLink, RotateCcw, SkipForward, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function Guide() {
  const nav = useNavigate();
  const { can, isAdmin, isOwner, branches } = useAuth();
  const { completed, loading, setSectionDone, setGuideSkipped, resetProgress } = useOnboardingProgress();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const branchId = branches?.[0]?.id ?? null;
  const full = isAdmin || isOwner;

  // الأقسام والخطوات متفلترة لحظيًا على صلاحيات اليوزر.
  // أي تغيير يعمله المالك في الصلاحيات بيوصل هنا فورًا (realtime في AuthContext)
  // فالدليل بيزيد أو يقل من غير ما اليوزر يعمل خروج ودخول.
  const sections = useMemo(() => {
    return GUIDE_SECTIONS.map((s) => ({
      ...s,
      steps: s.steps.filter((st) => full || !st.perm || can(st.perm)),
    })).filter((s) => {
      if (!full && s.anyPerm && !s.anyPerm.some((p) => can(p))) return false;
      return s.steps.length > 0;
    });
  }, [full, can]);

  const doneCount = sections.filter((s) => completed[s.key]).length;
  const pct = sections.length ? Math.round((doneCount / sections.length) * 100) : 0;
  const stepsCount = sections.reduce((n, s) => n + s.steps.length, 0);

  const go = (to?: string | null) => {
    if (!to) {
      toast.info("الشاشة دي مرتبطة بفرع — اختار فرع الأول من الشاشة الرئيسية");
      return;
    }
    nav(to);
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
      <div className="max-w-4xl mx-auto p-4 md:p-6 lg:p-8 space-y-5">
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
              onClick={async () => { await resetProgress(); toast.success("رجعنا من الأول — يلا بينا"); }}
            >
              <RotateCcw className="w-4 h-4" />
              ابدأ من هنا تاني
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={async () => { await setGuideSkipped(true); toast.success("تمام، قفلنا الدليل. تلاقيه في أي وقت من علامة (؟) فوق"); nav(-1); }}
            >
              <SkipForward className="w-4 h-4" />
              تخطي الدليل
            </Button>
          </div>
        </div>

        {/* Hero + progress */}
        <div className="card-elevated p-6 bg-gradient-to-l from-primary/10 via-primary/5 to-transparent animate-scale-in">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center shadow-[0_4px_12px_-2px_hsl(var(--primary)/0.4)]">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold">ابدأ من هنا</h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                دليل كامل يمشّيك على النظام خطوة خطوة. كل خطوة فيها زرار يوديك للشاشة على طول.
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-lg p-3 mt-3 leading-relaxed">
            الدليل ده متفصّل على صلاحياتك إنت: بتشوف {sections.length} قسم فيهم {stepsCount} خطوة. لو المالك زوّد أو قلّل
            صلاحياتك، الأقسام هنا بتتغير على طول من غير ما تعمل خروج ودخول.
          </p>
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm font-bold mb-2">
              <span>خلّصت {doneCount} من {sections.length} قسم</span>
              <span className="text-primary tabular-nums">{pct}%</span>
            </div>
            <Progress value={pct} className="h-2.5" />
          </div>
        </div>

        {/* Sections */}
        {sections.map((s, i) => {
          const Icon = s.icon;
          const isDone = !!completed[s.key];
          const open = openKey === s.key;
          return (
            <div key={s.key} className="animate-fade-in" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <CollapsibleSection
                title={`${i + 1}. ${s.title}`}
                icon={isDone ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                open={open}
                onToggle={() => setOpenKey(open ? null : s.key)}
                className={isDone ? "ring-1 ring-success/40" : ""}
              >
                <div className="p-4 md:p-6 space-y-3">
                  <p className="text-sm text-muted-foreground -mt-1">{s.hint}</p>
                  {s.steps
                    .map((st, idx) => {
                      const target = st.to?.(branchId) ?? null;
                      return (
                        <div
                          key={idx}
                          className="rounded-xl border border-border bg-surface/60 p-4 flex flex-col md:flex-row md:items-center gap-3 transition-colors hover:border-primary/40"
                        >
                          <div className="w-7 h-7 rounded-lg bg-primary/15 text-primary text-xs font-extrabold flex items-center justify-center shrink-0">
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm">{st.title}</div>
                            <div className="text-sm text-muted-foreground mt-1 leading-relaxed">{st.desc}</div>
                          </div>
                          {st.to && (
                            <Button size="sm" variant="secondary" className="gap-2 shrink-0" onClick={() => go(target)}>
                              <ExternalLink className="w-4 h-4" />
                              وديني هناك
                            </Button>
                          )}
                        </div>
                      );
                    })}

                  <div className="flex justify-end pt-1">
                    <Button
                      size="sm"
                      variant={isDone ? "outline" : "default"}
                      className="gap-2"
                      onClick={async () => {
                        await setSectionDone(s.key, !isDone);
                        if (!isDone) {
                          toast.success(`تمام! خلّصت قسم ${s.title}`);
                          const next = sections[i + 1];
                          setOpenKey(next ? next.key : null);
                        }
                      }}
                    >
                      <Check className="w-4 h-4" />
                      {isDone ? "رجّعه مش مخلّص" : "خلّصت القسم ده"}
                    </Button>
                  </div>
                </div>
              </CollapsibleSection>
            </div>
          );
        })}

        {pct === 100 && (
          <div className="card-elevated p-6 text-center animate-scale-in">
            <div className="text-lg font-extrabold text-success">تمام كده! خلّصت الدليل كله 🎉</div>
            <p className="text-sm text-muted-foreground mt-1">أي وقت تحب ترجعله، دوس على علامة (؟) فوق.</p>
          </div>
        )}
      </div>
    </div>
  );
}
