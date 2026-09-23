import { useEffect, useState } from "react";
import { PartnerLayout } from "@/components/layout/PartnerLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Wallet, AlertCircle, CheckCircle2 } from "lucide-react";
import { FinancialAmount } from "@/components/FinancialAmount";

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "نشطة", cls: "bg-primary/15 text-primary" },
  partially_paid: { label: "سداد جزئي", cls: "bg-warning/15 text-warning" },
  fully_paid: { label: "مسددة", cls: "bg-success/15 text-success" },
  cancelled: { label: "ملغاة", cls: "bg-muted text-muted-foreground" },
};
const INST_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "منتظر", cls: "bg-muted text-muted-foreground" },
  partially_paid: { label: "جزئي", cls: "bg-warning/15 text-warning" },
  paid: { label: "مسدد", cls: "bg-success/15 text-success" },
  overdue: { label: "متأخر", cls: "bg-destructive/15 text-destructive" },
};

export default function PartnerAdvancesView() {
  const { user } = useAuth();
  const [advances, setAdvances] = useState<any[]>([]);
  const [instsByAdv, setInstsByAdv] = useState<Record<string, any[]>>({});

  const load = async () => {
    if (!user) return;
    const { data: pu } = await supabase.from("partner_users" as any).select("partner_id").eq("user_id", user.id);
    const partnerIds = ((pu ?? []) as any[]).map(x => x.partner_id);
    if (!partnerIds.length) { setAdvances([]); return; }
    const { data: a } = await supabase.from("partner_advances" as any)
      .select("*").in("partner_id", partnerIds).order("created_at", { ascending: false });
    const rows = (a ?? []) as any[];
    setAdvances(rows);
    if (rows.length) {
      const { data: ins } = await supabase.from("partner_advance_installments" as any)
        .select("*").in("advance_id", rows.map(r => r.id)).order("installment_number");
      const grouped: Record<string, any[]> = {};
      ((ins ?? []) as any[]).forEach(i => {
        (grouped[i.advance_id] ??= []).push(i);
      });
      setInstsByAdv(grouped);
    }
  };
  useEffect(() => { load(); }, [user]);

  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });
  const totalOutstanding = advances.reduce((s, r) => s + Number(r.remaining_amount || 0), 0);
  const activeCount = advances.filter(r => r.status !== "fully_paid" && r.status !== "cancelled").length;

  return (
    <PartnerLayout>
      <div dir="rtl" className="text-right space-y-4">
        <PageHeader title="سلفي" subtitle="عرض السلف وأقساط السداد" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">عدد السلف</CardTitle><Wallet className="w-5 h-5 text-primary" /></CardHeader><CardContent><div className="text-2xl font-bold">{advances.length}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">سلف قائمة</CardTitle><AlertCircle className="w-5 h-5 text-warning" /></CardHeader><CardContent><div className="text-2xl font-bold text-warning">{activeCount}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">المتبقي المستحق</CardTitle><CheckCircle2 className="w-5 h-5 text-destructive" /></CardHeader><CardContent><FinancialAmount value={fmt(totalOutstanding)} size="md" className="justify-start" /></CardContent></Card>
        </div>

        {advances.length === 0 && <Card><CardContent className="p-6 text-center text-muted-foreground">لا توجد سلف</CardContent></Card>}

        {advances.map(a => {
          const st = STATUS[a.status] ?? STATUS.active;
          const insts = instsByAdv[a.id] ?? [];
          return (
            <Card key={a.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">{new Date(a.advance_date).toLocaleDateString("en-EG")} — {a.reason || "سلفة"}</CardTitle>
                  <div className="text-xs text-muted-foreground mt-1">{a.installments_count} قسط · القسط الشهري {fmt(a.monthly_deduction)} ج.م</div>
                </div>
                <Badge className={st.cls}>{st.label}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div><div className="text-muted-foreground">الإجمالي</div><div className="font-bold">{fmt(a.amount)}</div></div>
                  <div><div className="text-muted-foreground">المسدد</div><div className="font-bold text-success">{fmt(Number(a.amount) - Number(a.remaining_amount))}</div></div>
                  <div><div className="text-muted-foreground">المتبقي</div><div className="font-bold text-destructive">{fmt(a.remaining_amount)}</div></div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">#</th><th className="p-2">الاستحقاق</th><th className="p-2">المبلغ</th><th className="p-2">المدفوع</th><th className="p-2">الحالة</th></tr></thead>
                    <tbody>
                      {insts.map(i => {
                        const s = INST_STATUS[i.status] ?? INST_STATUS.pending;
                        return (
                          <tr key={i.id} className="border-t">
                            <td className="p-2 font-mono">{i.installment_number}</td>
                            <td className="p-2">{new Date(i.due_date).toLocaleDateString("en-EG")}</td>
                            <td className="p-2 font-mono">{fmt(i.amount)}</td>
                            <td className="p-2 font-mono">{fmt(i.paid_amount)}</td>
                            <td className="p-2"><Badge className={s.cls}>{s.label}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PartnerLayout>
  );
}
