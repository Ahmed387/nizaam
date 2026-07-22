import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, PlusCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TX_LABEL: Record<string, { label: string; sign: number; color: string }> = {
  contribution: { label: "مساهمة", sign: 1, color: "text-success" },
  drawing: { label: "مسحوبة", sign: -1, color: "text-destructive" },
  profit_share: { label: "أرباح", sign: 1, color: "text-primary" },
  capital_adjustment: { label: "تسوية", sign: 1, color: "text-warning" },
};

export default function PartnerProfile() {
  const { id } = useParams();
  const [partner, setPartner] = useState<any>(null);
  const [txs, setTxs] = useState<any[]>([]);
  const [advances, setAdvances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTx, setOpenTx] = useState(false);
  const [tx, setTx] = useState({ type: "contribution", amount: "", description: "", month_year: new Date().toISOString().slice(0, 7) });

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: p }, { data: t }, { data: adv }] = await Promise.all([
      supabase.from("equity_partners" as any).select("*").eq("id", id).maybeSingle(),
      supabase.from("partner_transactions" as any).select("*").eq("partner_id", id).order("created_at", { ascending: false }),
      supabase.from("partner_advances" as any).select("*").eq("partner_id", id).in("status", ["active", "partially_paid"]),
    ]);
    setPartner(p);
    setTxs((t ?? []) as any[]);
    setAdvances((adv ?? []) as any[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]);


  useEffect(() => {
    if (!id) return;
    const ch = supabase.channel(`partner-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "equity_partners", filter: `id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_transactions", filter: `partner_id=eq.${id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  const runningBalances = useMemo(() => {
    const sorted = [...txs].reverse();
    let bal = 0;
    const map: Record<string, number> = {};
    for (const t of sorted) {
      const cfg = TX_LABEL[t.transaction_type];
      const delta = (cfg?.sign ?? 1) * Number(t.amount) * (t.transaction_type === "drawing" ? -1 : 1);
      // note: for drawing, sign is already -1 so multiplied by -1 makes positive; simplify:
      const signed = t.transaction_type === "drawing" ? -Number(t.amount) : Number(t.amount);
      bal += signed;
      map[t.id] = bal;
    }
    return map;
  }, [txs]);

  const submitTx = async () => {
    const amt = Number(tx.amount);
    if (!amt || amt <= 0) return toast.error("المبلغ غير صحيح");
    const { error } = await supabase.rpc("record_partner_transaction" as any, {
      _partner_id: id,
      _transaction_type: tx.type,
      _amount: amt,
      _description: tx.description || null,
      _month_year: tx.month_year,
    });
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل الحركة");
    setOpenTx(false);
    setTx({ type: "contribution", amount: "", description: "", month_year: new Date().toISOString().slice(0, 7) });
    load();
  };

  if (loading) return <AdminLayout><div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div></AdminLayout>;
  if (!partner) return <AdminLayout><div className="p-8 text-center">الشريك غير موجود</div></AdminLayout>;

  const fmt = (n: number) => Number(n).toLocaleString("en-EG", { maximumFractionDigits: 2 });

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-4">
        <div className="flex items-center justify-between">
          <PageHeader title={partner.name} subtitle="ملف الشريك" />
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/admin/financial-position/partners">← العودة</Link></Button>
            <Button onClick={() => setOpenTx(true)}><PlusCircle className="w-4 h-4 ml-2" />تسجيل حركة</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">الرصيد الحالي</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(partner.current_balance)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">إجمالي المساهمات</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-success">{fmt(partner.total_contributions)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">إجمالي المسحوبات</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-destructive">{fmt(partner.total_drawings)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">إجمالي الأرباح</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-primary">{fmt(partner.total_profit_share)}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>بيانات الشريك</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><div className="text-muted-foreground">النوع</div><div className="font-semibold">{partner.partner_type}</div></div>
            <div><div className="text-muted-foreground">حصة رأس المال</div><div className="font-semibold">{(Number(partner.capital_share) * 100).toFixed(2)}%</div></div>
            <div><div className="text-muted-foreground">حصة التشغيل</div><div className="font-semibold">{(Number(partner.operating_share) * 100).toFixed(2)}%</div></div>
            <div><div className="text-muted-foreground">رأس المال المبدئي</div><div className="font-semibold">{fmt(partner.initial_capital)}</div></div>
            <div><div className="text-muted-foreground">الحالة</div><div>{partner.is_active ? <Badge className="bg-success/15 text-success">نشط</Badge> : <Badge variant="secondary">معطل</Badge>}</div></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>سجل الحركات ({txs.length})</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-right">
                  <th className="p-2">التاريخ</th><th className="p-2">النوع</th><th className="p-2">المبلغ</th>
                  <th className="p-2">الشهر</th><th className="p-2">الوصف</th><th className="p-2">الرصيد الجاري</th>
                </tr>
              </thead>
              <tbody>
                {txs.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">لا توجد حركات</td></tr>}
                {txs.map(t => {
                  const cfg = TX_LABEL[t.transaction_type];
                  const signed = t.transaction_type === "drawing" ? -Number(t.amount) : Number(t.amount);
                  return (
                    <tr key={t.id} className="border-t">
                      <td className="p-2">{new Date(t.created_at).toLocaleDateString("en-EG")}</td>
                      <td className={`p-2 font-semibold ${cfg?.color}`}>{cfg?.label ?? t.transaction_type}</td>
                      <td className={`p-2 font-mono ${signed >= 0 ? "text-success" : "text-destructive"}`}>{signed >= 0 ? "+" : ""}{fmt(signed)}</td>
                      <td className="p-2">{t.month_year || "-"}</td>
                      <td className="p-2">{t.description || "-"}</td>
                      <td className="p-2 font-mono">{fmt(runningBalances[t.id] ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={openTx} onOpenChange={setOpenTx}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تسجيل حركة جديدة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>النوع</Label>
              <Select value={tx.type} onValueChange={v => setTx({ ...tx, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contribution">مساهمة (زيادة رصيد)</SelectItem>
                  <SelectItem value="drawing">مسحوبة (نقص رصيد)</SelectItem>
                  <SelectItem value="profit_share">توزيع أرباح</SelectItem>
                  <SelectItem value="capital_adjustment">تسوية رأس مال</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>المبلغ (ج.م) *</Label><Input type="number" value={tx.amount} onChange={e => setTx({ ...tx, amount: e.target.value })} /></div>
            <div><Label>الشهر (YYYY-MM)</Label><Input value={tx.month_year} onChange={e => setTx({ ...tx, month_year: e.target.value })} /></div>
            <div><Label>الوصف</Label><Input value={tx.description} onChange={e => setTx({ ...tx, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenTx(false)}>إلغاء</Button>
            <Button onClick={submitTx}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
