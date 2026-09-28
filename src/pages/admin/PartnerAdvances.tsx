import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { PlusCircle, Wallet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { FinancialAmount } from "@/components/FinancialAmount";
import { cairoTodayDay } from "@/lib/cairoDate";

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "نشطة", cls: "bg-primary/15 text-primary" },
  partially_paid: { label: "سداد جزئي", cls: "bg-warning/15 text-warning" },
  fully_paid: { label: "مسددة", cls: "bg-success/15 text-success" },
  cancelled: { label: "ملغاة", cls: "bg-muted text-muted-foreground" },
};

export default function PartnerAdvances({ embedded }: { embedded?: boolean } = {}) {
  const { tenantId } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    partner_id: "",
    amount: "",
    advance_date: cairoTodayDay(),
    installments_count: "1",
    first_due_date: cairoTodayDay(),
    reason: "",
    notes: "",
  });

  const load = async () => {
    if (!tenantId) return;
    const [{ data: a }, { data: p }] = await Promise.all([
      supabase.from("partner_advances" as any)
        .select("*, equity_partners(name)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      supabase.from("equity_partners" as any)
        .select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
    ]);
    setRows((a ?? []) as any[]);
    setPartners((p ?? []) as any[]);
  };
  useEffect(() => { load(); }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase.channel(`padv-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_advances" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId]);

  const submit = async () => {
    if (!form.partner_id) return toast.error("اختر الشريك");
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return toast.error("مبلغ غير صحيح");
    const n = Math.max(1, parseInt(form.installments_count || "1", 10));
    setSaving(true);
    const { error } = await supabase.rpc("create_partner_advance" as any, {
      _partner_id: form.partner_id,
      _amount: amt,
      _advance_date: form.advance_date,
      _installments_count: n,
      _first_due_date: form.first_due_date,
      _reason: form.reason || null,
      _notes: form.notes || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم إنشاء السلفة");
    setOpen(false);
    setForm({ ...form, amount: "", reason: "", notes: "", installments_count: "1" });
    load();
  };

  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });
  const totalOutstanding = rows.reduce((s, r) => s + Number(r.remaining_amount || 0), 0);
  const activeCount = rows.filter(r => r.status !== "fully_paid" && r.status !== "cancelled").length;

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <div dir="rtl" className="text-right space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          {!embedded && <PageHeader title="سلف الشركاء" subtitle="إدارة سلف الشركاء وأقساط السداد" />}
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/admin/financial-position">← الذمة المالية للشركاء</Link></Button>
            <Button onClick={() => setOpen(true)}><PlusCircle className="w-4 h-4 ml-2" />سلفة جديدة</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">إجمالي السلف</CardTitle>
              <Wallet className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{rows.length}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">سلف قائمة</CardTitle>
              <AlertTriangle className="w-5 h-5 text-warning" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold text-warning">{activeCount}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">المتبقي المستحق</CardTitle>
              <CheckCircle2 className="w-5 h-5 text-destructive" />
            </CardHeader>
            <CardContent><FinancialAmount value={fmt(totalOutstanding)} size="md" className="justify-start" /></CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>قائمة السلف</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-right">
                  <th className="p-2">التاريخ</th><th className="p-2">الشريك</th>
                  <th className="p-2">المبلغ</th><th className="p-2">المتبقي</th>
                  <th className="p-2">الأقساط</th><th className="p-2">الحالة</th>
                  <th className="p-2">السبب</th><th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">لا توجد سلف</td></tr>}
                {rows.map(r => {
                  const st = STATUS[r.status] ?? STATUS.active;
                  return (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="p-2">{new Date(r.advance_date).toLocaleDateString("en-EG")}</td>
                      <td className="p-2 font-semibold">{r.equity_partners?.name ?? "-"}</td>
                      <td className="p-2 font-mono">{fmt(r.amount)}</td>
                      <td className="p-2 font-mono text-destructive">{fmt(r.remaining_amount)}</td>
                      <td className="p-2">{r.installments_count}</td>
                      <td className="p-2"><Badge className={st.cls}>{st.label}</Badge></td>
                      <td className="p-2 text-muted-foreground">{r.reason || "-"}</td>
                      <td className="p-2"><Button size="sm" variant="outline" asChild><Link to={`/admin/financial-position/advance/${r.id}`}>تفاصيل</Link></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader><DialogTitle>سلفة جديدة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الشريك *</Label>
              <Select value={form.partner_id} onValueChange={v => setForm({ ...form, partner_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر شريك" /></SelectTrigger>
                <SelectContent>{partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>المبلغ (ج.م) *</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div><Label>عدد الأقساط</Label><Input type="number" min={1} value={form.installments_count} onChange={e => setForm({ ...form, installments_count: e.target.value })} /></div>
              <div><Label>تاريخ السلفة</Label><Input type="date" value={form.advance_date} onChange={e => setForm({ ...form, advance_date: e.target.value })} /></div>
              <div><Label>تاريخ أول قسط</Label><Input type="date" value={form.first_due_date} onChange={e => setForm({ ...form, first_due_date: e.target.value })} /></div>
            </div>
            {Number(form.amount) > 0 && Number(form.installments_count) > 0 && (
              <div className="text-sm bg-muted/40 rounded p-2">
                القسط الشهري ≈ <span className="font-mono font-bold">{fmt(Number(form.amount) / Number(form.installments_count))}</span> ج.م
                <span className="text-muted-foreground"> (يتم تعويض التقريب في القسط الأخير)</span>
              </div>
            )}
            <div><Label>السبب</Label><Input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="مثال: ظروف شخصية" /></div>
            <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={saving}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConditionalLayout>
  );
}
