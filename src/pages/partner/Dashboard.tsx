import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PartnerLayout } from "@/components/layout/PartnerLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Wallet, PieChart, TrendingUp, ArrowUpCircle, ArrowDownCircle, Gift, BookOpen, FileText } from "lucide-react";
import { downloadPartnerStatementPdf } from "@/lib/partnerStatement";

export default function PartnerDashboard() {
  const { user, profile } = useAuth();
  const [partner, setPartner] = useState<any>(null);
  const [txs, setTxs] = useState<any[]>([]);

  const load = async () => {
    if (!user) return;
    const { data: link } = await supabase.from("partner_users" as any)
      .select("partner_id").eq("user_id", user.id).maybeSingle();
    if (!link) return;
    const pid = (link as any).partner_id;
    const [{ data: p }, { data: bal }, { data: t }] = await Promise.all([
      supabase.from("equity_partners" as any).select("*").eq("id", pid).maybeSingle(),
      supabase.from("v_partner_balances" as any).select("*").eq("partner_id", pid).maybeSingle(),
      supabase.from("partner_transactions" as any).select("*").eq("partner_id", pid).order("created_at", { ascending: false }).limit(5),
    ]);
    setPartner(p ? { ...(p as any), ...((bal as any) ?? {}) } : null);
    setTxs((t ?? []) as any[]);
  };
  useEffect(() => { load(); }, [user?.id]);

  useEffect(() => {
    if (!partner?.id) return;
    const ch = supabase.channel(`partner-dash-${partner.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "equity_partners", filter: `id=eq.${partner.id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_transactions", filter: `partner_id=eq.${partner.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [partner?.id]);

  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

  return (
    <PartnerLayout>
      <div dir="rtl" className="text-right space-y-4">
        <PageHeader title={`مرحباً ${profile?.name ?? ""}!`} subtitle="ملخص حسابك كشريك" />

        {!partner ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground">لم يتم ربط حسابك بشريك بعد. راجع الإدارة.</CardContent></Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card><CardHeader className="flex flex-row items-center justify-between pb-1"><CardTitle className="text-xs">الرصيد الحالي</CardTitle><Wallet className="w-4 h-4 text-primary" /></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(partner.current_balance)} <span className="text-xs">ج.م</span></div></CardContent></Card>
              <Card><CardHeader className="flex flex-row items-center justify-between pb-1"><CardTitle className="text-xs">نسبة رأس المال</CardTitle><PieChart className="w-4 h-4 text-primary" /></CardHeader><CardContent><div className="text-2xl font-bold">{(Number(partner.capital_share) * 100).toFixed(2)}%</div></CardContent></Card>
              <Card><CardHeader className="flex flex-row items-center justify-between pb-1"><CardTitle className="text-xs">نسبة أرباح التشغيل</CardTitle><TrendingUp className="w-4 h-4 text-primary" /></CardHeader><CardContent><div className="text-2xl font-bold">{(Number(partner.operating_share) * 100).toFixed(2)}%</div></CardContent></Card>
              <Card><CardHeader className="flex flex-row items-center justify-between pb-1"><CardTitle className="text-xs">إجمالي المساهمات</CardTitle><ArrowUpCircle className="w-4 h-4 text-success" /></CardHeader><CardContent><div className="text-2xl font-bold text-success">{fmt(partner.total_contributions)}</div></CardContent></Card>
              <Card><CardHeader className="flex flex-row items-center justify-between pb-1"><CardTitle className="text-xs">إجمالي المسحوبات</CardTitle><ArrowDownCircle className="w-4 h-4 text-destructive" /></CardHeader><CardContent><div className="text-2xl font-bold text-destructive">{fmt(partner.total_drawings)}</div></CardContent></Card>
              <Card><CardHeader className="flex flex-row items-center justify-between pb-1"><CardTitle className="text-xs">إجمالي الأرباح</CardTitle><Gift className="w-4 h-4 text-primary" /></CardHeader><CardContent><div className="text-2xl font-bold text-primary">{fmt(partner.total_profit_share)}</div></CardContent></Card>
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                <CardTitle>آخر الحركات</CardTitle>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => downloadPartnerStatementPdf({ partnerId: partner.id, branchName: "الشركة", userName: profile?.name ?? partner.name })}
                  >
                    <FileText className="w-4 h-4 ml-2" />تحميل كشف حساب PDF
                  </Button>
                  <Button asChild size="sm" variant="outline"><Link to="/partner/ledger"><BookOpen className="w-4 h-4 ml-2" />كشف الحساب الكامل</Link></Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">التاريخ</th><th className="p-2">النوع</th><th className="p-2">المبلغ</th><th className="p-2">الوصف</th></tr></thead>
                  <tbody>
                    {txs.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">لا يوجد</td></tr>}
                    {txs.map(t => {
                      const signed = t.transaction_type === "drawing" ? -Number(t.amount) : Number(t.amount);
                      return (
                        <tr key={t.id} className="border-t">
                          <td className="p-2">{new Date(t.created_at).toLocaleDateString("en-EG")}</td>
                          <td className="p-2">{t.transaction_type === "contribution" ? "مساهمة" : t.transaction_type === "drawing" ? "مسحوبة" : t.transaction_type === "profit_share" ? "أرباح" : "تسوية"}</td>
                          <td className={`p-2 font-mono ${signed >= 0 ? "text-success" : "text-destructive"}`}>{signed >= 0 ? "+" : ""}{fmt(signed)}</td>
                          <td className="p-2">{t.description || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PartnerLayout>
  );
}
