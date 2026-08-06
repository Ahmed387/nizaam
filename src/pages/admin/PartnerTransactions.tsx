import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function PartnerTransactions({ embedded }: { embedded?: boolean } = {}) {
  const [params] = useSearchParams();
  const { tenantId } = useAuth();
  const [partners, setPartners] = useState<any[]>([]);
  const [form, setForm] = useState({
    partner_id: "",
    type: params.get("type") ?? "contribution",
    amount: "", description: "",
    month_year: new Date().toISOString().slice(0, 7),
  });
  const [recent, setRecent] = useState<any[]>([]);

  const loadPartners = async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("equity_partners" as any)
      .select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("name");
    setPartners((data ?? []) as any[]);
  };
  const loadRecent = async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("partner_transactions" as any)
      .select("*, equity_partners(name)").eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }).limit(20);
    setRecent((data ?? []) as any[]);
  };
  useEffect(() => { loadPartners(); loadRecent(); }, [tenantId]);

  const submit = async () => {
    if (!form.partner_id) return toast.error("اختر الشريك");
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return toast.error("المبلغ غير صحيح");
    const { error } = await supabase.rpc("record_partner_transaction" as any, {
      _partner_id: form.partner_id,
      _transaction_type: form.type,
      _amount: amt,
      _description: form.description || null,
      _month_year: form.month_year,
    });
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل الحركة");
    setForm({ ...form, amount: "", description: "" });
    loadRecent();
  };

  const fmt = (n: number) => Number(n).toLocaleString("en-EG");

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <div dir="rtl" className="text-right space-y-4">
        {!embedded && <PageHeader title="حركات الشركاء" subtitle="تسجيل مساهمات، مسحوبات، وأرباح" />}

        <Card>
          <CardHeader><CardTitle>تسجيل حركة جديدة</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>الشريك *</Label>
              <Select value={form.partner_id} onValueChange={v => setForm({ ...form, partner_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر شريك" /></SelectTrigger>
                <SelectContent>{partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>النوع</Label>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contribution">مساهمة</SelectItem>
                  <SelectItem value="drawing">مسحوبة</SelectItem>
                  <SelectItem value="profit_share">توزيع أرباح</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>المبلغ (ج.م) *</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            <div><Label>الشهر</Label><Input value={form.month_year} onChange={e => setForm({ ...form, month_year: e.target.value })} /></div>
            <div className="md:col-span-2"><Label>الوصف</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="md:col-span-2 flex justify-end"><Button onClick={submit}>حفظ الحركة</Button></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>آخر 20 حركة</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">التاريخ</th><th className="p-2">الشريك</th><th className="p-2">النوع</th><th className="p-2">المبلغ</th><th className="p-2">الوصف</th></tr></thead>
              <tbody>
                {recent.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">لا يوجد</td></tr>}
                {recent.map(t => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2">{new Date(t.created_at).toLocaleDateString("en-EG")}</td>
                    <td className="p-2 font-semibold">{t.equity_partners?.name ?? "-"}</td>
                    <td className="p-2">{t.transaction_type}</td>
                    <td className="p-2 font-mono">{fmt(t.amount)}</td>
                    <td className="p-2">{t.description || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </ConditionalLayout>
  );
}
