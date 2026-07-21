import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Users, Wallet, TrendingUp, PlusCircle, ArrowUpCircle, ArrowDownCircle, Gift, HandCoins, BookOpen, FileText, ScrollText, Scale, PieChart, LineChart, Activity, Clock } from "lucide-react";

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
        <PageHeader title="الذمة المالية" subtitle="إدارة الشركاء والمساهمات والأرباح" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">عدد الشركاء</CardTitle>
              <Users className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent><div className="text-3xl font-bold">{stats.count}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">إجمالي رأس المال</CardTitle>
              <Wallet className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent><div className="text-3xl font-bold">{fmt(stats.capital)} <span className="text-sm">ج.م</span></div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">إجمالي الأرصدة الحالية</CardTitle>
              <TrendingUp className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent><div className="text-3xl font-bold">{fmt(stats.balance)} <span className="text-sm">ج.م</span></div></CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>الإجراءات السريعة</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Button asChild variant="default"><Link to="/admin/financial-position/partners"><PlusCircle className="w-4 h-4 ml-2" />إدارة الشركاء</Link></Button>
            <Button asChild variant="outline"><Link to="/admin/financial-position/advances"><HandCoins className="w-4 h-4 ml-2 text-warning" />سلف الشركاء</Link></Button>
            <Button asChild variant="outline"><Link to="/admin/financial-position/transactions?type=contribution"><ArrowUpCircle className="w-4 h-4 ml-2 text-success" />تسجيل مساهمة</Link></Button>
            <Button asChild variant="outline"><Link to="/admin/financial-position/transactions?type=drawing"><ArrowDownCircle className="w-4 h-4 ml-2 text-destructive" />تسجيل مسحوبة</Link></Button>
            <Button asChild variant="outline"><Link to="/admin/financial-position/transactions?type=profit_share"><Gift className="w-4 h-4 ml-2 text-primary" />توزيع أرباح</Link></Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>المحاسبة العامة (دفتر الأستاذ)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Button asChild variant="outline"><Link to="/admin/accounting/chart"><BookOpen className="w-4 h-4 ml-2 text-primary" />دليل الحسابات</Link></Button>
            <Button asChild variant="outline"><Link to="/admin/accounting/journal"><ScrollText className="w-4 h-4 ml-2 text-primary" />القيود اليومية</Link></Button>
            <Button asChild variant="outline"><Link to="/admin/accounting/ledger"><FileText className="w-4 h-4 ml-2 text-primary" />دفتر الأستاذ</Link></Button>
            <Button asChild variant="outline"><Link to="/admin/accounting/trial-balance"><Scale className="w-4 h-4 ml-2 text-primary" />ميزان المراجعة</Link></Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>القوائم المالية والتحليل</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Button asChild variant="outline"><Link to="/admin/accounting/balance-sheet"><PieChart className="w-4 h-4 ml-2 text-primary" />الميزانية العمومية</Link></Button>
            <Button asChild variant="outline"><Link to="/admin/accounting/income-statement"><LineChart className="w-4 h-4 ml-2 text-primary" />قائمة الدخل</Link></Button>
            <Button asChild variant="outline"><Link to="/admin/accounting/cash-flow"><Activity className="w-4 h-4 ml-2 text-primary" />التدفقات النقدية</Link></Button>
            <Button asChild variant="outline"><Link to="/admin/accounting/aging"><Clock className="w-4 h-4 ml-2 text-warning" />تقرير الأعمار</Link></Button>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
