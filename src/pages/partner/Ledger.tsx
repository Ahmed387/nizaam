import { useEffect, useMemo, useState } from "react";
import { PartnerLayout } from "@/components/layout/PartnerLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const LABEL: Record<string, string> = {
  contribution: "مساهمة", drawing: "مسحوبة", profit_share: "أرباح", capital_adjustment: "تسوية",
};

export default function PartnerLedger() {
  const { user } = useAuth();
  const [txs, setTxs] = useState<any[]>([]);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [type, setType] = useState("all");

  const load = async () => {
    if (!user) return;
    const { data: link } = await supabase.from("partner_users" as any).select("partner_id").eq("user_id", user.id).maybeSingle();
    if (!link) return;
    let q = supabase.from("partner_transactions" as any).select("*").eq("partner_id", (link as any).partner_id).order("created_at");
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", `${to}T23:59:59`);
    if (type !== "all") q = q.eq("transaction_type", type);
    const { data } = await q;
    setTxs((data ?? []) as any[]);
  };
  useEffect(() => { load(); }, [user?.id, from, to, type]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`ledger-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_transactions" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  const { totalIn, totalOut, netBalance, rows } = useMemo(() => {
    let bal = 0, tIn = 0, tOut = 0;
    const list = txs.map(t => {
      const signed = t.transaction_type === "drawing" ? -Number(t.amount) : Number(t.amount);
      if (signed >= 0) tIn += signed; else tOut += Math.abs(signed);
      bal += signed;
      return { ...t, signed, running: bal };
    });
    return { totalIn: tIn, totalOut: tOut, netBalance: bal, rows: list.reverse() };
  }, [txs]);

  const fmt = (n: number) => Number(n).toLocaleString("en-EG", { maximumFractionDigits: 2 });

  return (
    <PartnerLayout>
      <div dir="rtl" className="text-right space-y-4">
        <PageHeader title="كشف الحساب" subtitle="كل حركاتك المالية" />

        <div className="grid grid-cols-3 gap-3">
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">إجمالي الوارد</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-success">+{fmt(totalIn)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">إجمالي المسحوب</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-destructive">-{fmt(totalOut)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">الصافي</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(netBalance)}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>تصفية</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>من تاريخ</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><Label>إلى تاريخ</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
            <div><Label>النوع</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="contribution">مساهمات</SelectItem>
                  <SelectItem value="drawing">مسحوبات</SelectItem>
                  <SelectItem value="profit_share">أرباح</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">التاريخ</th><th className="p-2">النوع</th><th className="p-2">المبلغ</th><th className="p-2">الوصف</th><th className="p-2">الشهر</th><th className="p-2">الرصيد الجاري</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">لا يوجد</td></tr>}
                {rows.map(t => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2">{new Date(t.created_at).toLocaleDateString("en-EG")}</td>
                    <td className="p-2">{LABEL[t.transaction_type]}</td>
                    <td className={`p-2 font-mono ${t.signed >= 0 ? "text-success" : "text-destructive"}`}>{t.signed >= 0 ? "+" : ""}{fmt(t.signed)}</td>
                    <td className="p-2">{t.description || "-"}</td>
                    <td className="p-2">{t.month_year || "-"}</td>
                    <td className="p-2 font-mono">{fmt(t.running)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </PartnerLayout>
  );
}
