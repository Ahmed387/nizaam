import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Users, Wallet, TrendingUp, PlusCircle, ArrowUpCircle, ArrowDownCircle, Gift, HandCoins, BookOpen, FileText, ScrollText, Scale, PieChart, LineChart, Activity, Clock, Landmark, Lock, Target, BarChart3, Package, Building2, Info, Lightbulb } from "lucide-react";

// Simple tooltip-like note wrapper — plain Arabic explanation under each button.
function ActionButton({
  to,
  icon,
  title,
  note,
  variant = "outline",
  iconClass = "text-primary",
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  note: string;
  variant?: "default" | "outline";
  iconClass?: string;
}) {
  return (
    <Link
      to={to}
      className={`group relative flex flex-col gap-1 rounded-xl border p-3 text-right transition-all hover:shadow-md hover:-translate-y-0.5 ${
        variant === "default"
          ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
          : "bg-card hover:bg-accent/40 border-border"
      }`}
    >
      <div className="flex items-center gap-2 font-semibold text-sm">
        <span className={variant === "default" ? "text-primary-foreground" : iconClass}>{icon}</span>
        <span>{title}</span>
      </div>
      <p className={`text-xs leading-relaxed ${variant === "default" ? "text-primary-foreground/85" : "text-muted-foreground"}`}>
        {note}
      </p>
    </Link>
  );
}

export default function FinancialPosition() {
  const { tenantId } = useAuth();
  const [stats, setStats] = useState({ count: 0, capital: 0, balance: 0 });

  const load = async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from("equity_partners" as any)
      .select("initial_capital, current_balance, is_active")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);
    const rows = (data ?? []) as any[];
    setStats({
      count: rows.length,
      capital: rows.reduce((s, r) => s + Number(r.initial_capital || 0), 0),
      balance: rows.reduce((s, r) => s + Number(r.current_balance || 0), 0),
    });
  };
  useEffect(() => { load(); }, [tenantId]);

  const fmt = (n: number) => n.toLocaleString("en-EG", { maximumFractionDigits: 2 });

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title="الذمة المالية للشركاء" subtitle="كل حاجة عن فلوس الشركاء ورأس المال والأرباح — في مكان واحد" />

        {/* Friendly intro */}
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex items-start gap-3">
          <Lightbulb className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm leading-relaxed">
            <div className="font-bold text-primary mb-1">الصفحة دي بتقولك إيه؟</div>
            <p className="text-muted-foreground">
              هنا بتشوف <span className="font-semibold text-foreground">كل شريك في الشركة بيملك كام</span>،
              <span className="font-semibold text-foreground"> ومحطوط رأسمال إد إيه</span>، و
              <span className="font-semibold text-foreground">رصيده الحالي وصل لكام</span> بعد الأرباح والسحوبات.
              كل زرار تحت هيوديك على شاشة تفصيلية — تحت كل زرار في شرح صغير علشان تعرف يعمل إيه قبل ما تدوس.
            </p>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">عدد الشركاء</CardTitle>
              <Users className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.count}</div>
              <p className="text-xs text-muted-foreground mt-1">عدد الناس اللي معاك في الشركة دلوقتي.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">إجمالي رأس المال</CardTitle>
              <Wallet className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{fmt(stats.capital)} <span className="text-sm">ج.م</span></div>
              <p className="text-xs text-muted-foreground mt-1">الفلوس اللي الشركاء حطوها في الشركة من الأول.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">إجمالي الأرصدة الحالية</CardTitle>
              <TrendingUp className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{fmt(stats.balance)} <span className="text-sm">ج.م</span></div>
              <p className="text-xs text-muted-foreground mt-1">رصيد الشركاء دلوقتي بعد الأرباح والسحوبات والسلف.</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick actions */}
        <Card>
          <CardHeader>
            <CardTitle>الإجراءات السريعة</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" />
              الحاجات اللي بتعملها كتير — سلف، مساهمات، توزيع أرباح.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <ActionButton
              to="/admin/financial-position/partners"
              icon={<PlusCircle className="w-4 h-4" />}
              title="إدارة الشركاء"
              note="ضيف شريك جديد، عدّل بياناته، أو شوف كشف حساب أي حد."
              variant="default"
            />
            <ActionButton
              to="/admin/financial-position/advances"
              icon={<HandCoins className="w-4 h-4" />}
              title="سلف الشركاء"
              note="لما شريك ياخد فلوس مقدماً على حساب أرباحه الجاية."
              iconClass="text-warning"
            />
            <ActionButton
              to="/admin/financial-position/transactions?type=contribution"
              icon={<ArrowUpCircle className="w-4 h-4" />}
              title="تسجيل مساهمة"
              note="شريك دخّل فلوس جديدة في الشركة — سجّلها هنا."
              iconClass="text-success"
            />
            <ActionButton
              to="/admin/financial-position/transactions?type=drawing"
              icon={<ArrowDownCircle className="w-4 h-4" />}
              title="تسجيل مسحوبة"
              note="شريك سحب فلوس من الشركة لنفسه — سجّل السحب هنا."
              iconClass="text-destructive"
            />
            <ActionButton
              to="/admin/financial-position/transactions?type=profit_share"
              icon={<Gift className="w-4 h-4" />}
              title="توزيع أرباح"
              note="وزّع أرباح فترة معينة على الشركاء حسب نسبة كل واحد."
            />
          </CardContent>
        </Card>

        {/* Bookkeeping */}
        <Card>
          <CardHeader>
            <CardTitle>الدفاتر المحاسبية</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" />
              دي أساس المحاسبة — كل حركة فلوس بتتسجل هنا تلقائياً.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <ActionButton
              to="/admin/accounting/chart"
              icon={<BookOpen className="w-4 h-4" />}
              title="دليل الحسابات"
              note="قائمة بكل الحسابات في الشركة (كاش، بنك، مبيعات، مصاريف...)."
            />
            <ActionButton
              to="/admin/accounting/journal"
              icon={<ScrollText className="w-4 h-4" />}
              title="القيود اليومية"
              note="كل عملية فلوس بتحصل بتتسجل كقيد — هنا بتشوفها كلها."
            />
            <ActionButton
              to="/admin/accounting/ledger"
              icon={<FileText className="w-4 h-4" />}
              title="دفتر الأستاذ"
              note="كشف تفصيلي لكل حساب على حدة — إيه دخل وإيه طلع."
            />
            <ActionButton
              to="/admin/accounting/trial-balance"
              icon={<Scale className="w-4 h-4" />}
              title="ميزان المراجعة"
              note="بيتأكد إن كل الحسابات متوازنة (المدين = الدائن)."
            />
          </CardContent>
        </Card>

        {/* Financial statements */}
        <Card>
          <CardHeader>
            <CardTitle>القوائم المالية والتحليل</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" />
              التقارير الكبيرة اللي بتقولك الشركة ماشية إزاي وبتكسب ولا لأ.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <ActionButton
              to="/admin/accounting/balance-sheet"
              icon={<PieChart className="w-4 h-4" />}
              title="الميزانية العمومية"
              note="بتقولك الشركة عندها إيه (أصول) وعليها إيه (التزامات) في تاريخ معين."
            />
            <ActionButton
              to="/admin/accounting/income-statement"
              icon={<LineChart className="w-4 h-4" />}
              title="قائمة الدخل"
              note="بتقولك كسبت كام وصرفت كام، والصافي في الآخر ربح ولا خسارة."
            />
            <ActionButton
              to="/admin/accounting/cash-flow"
              icon={<Activity className="w-4 h-4" />}
              title="التدفقات النقدية"
              note="الفلوس دخلت من فين وخرجت لفين خلال الفترة."
            />
            <ActionButton
              to="/admin/accounting/aging"
              icon={<Clock className="w-4 h-4" />}
              title="تقرير الأعمار"
              note="مين ليه فلوس عندك بقالها كام يوم — علشان تعرف تحصّل بدري."
              iconClass="text-warning"
            />
            <ActionButton
              to="/admin/accounting/bank-reconciliation"
              icon={<Landmark className="w-4 h-4" />}
              title="المطابقة البنكية"
              note="بتطابق كشف حساب البنك مع اللي عندك في السيستم — تتأكد مفيش فرق."
            />
            <ActionButton
              to="/admin/accounting/fiscal-closing"
              icon={<Lock className="w-4 h-4" />}
              title="الإقفال وتوزيع الأرباح"
              note="لما السنة تخلص — بتقفل الحسابات وتوزع الربح على الشركاء."
              iconClass="text-warning"
            />
            <ActionButton
              to="/admin/accounting/budgets"
              icon={<Target className="w-4 h-4" />}
              title="الموازنة التقديرية"
              note="بتحط خطة كام هتصرف وكام هتكسب، وبتقارن باللي حصل فعلاً."
            />
            <ActionButton
              to="/admin/accounting/kpis"
              icon={<BarChart3 className="w-4 h-4" />}
              title="مؤشرات الأداء KPIs"
              note="أرقام سريعة بتقولك الشركة صحتها كويسة ولا في مشكلة."
            />
            <ActionButton
              to="/admin/accounting/fixed-assets"
              icon={<Package className="w-4 h-4" />}
              title="الأصول الثابتة والإهلاك"
              note="الحاجات اللي اشتريتها للشركة (عربيات، أجهزة) وقيمتها بتقل مع الوقت."
            />
            <ActionButton
              to="/admin/accounting/branch-capital"
              icon={<Building2 className="w-4 h-4" />}
              title="توزيع رأس المال على الفروع"
              note="بتوزع رأس مال الشركة على الفروع علشان تعرف كل فرع بيربح لوحده كام."
            />
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
