import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
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
import { toast } from "sonner";
import { Loader2, PlusCircle } from "lucide-react";

const INST_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "منتظر", cls: "bg-muted text-muted-foreground" },
  partially_paid: { label: "جزئي", cls: "bg-warning/15 text-warning" },
  paid: { label: "مسدد", cls: "bg-success/15 text-success" },
  overdue: { label: "متأخر", cls: "bg-destructive/15 text-destructive" },
  cancelled: { label: "ملغي", cls: "bg-muted text-muted-foreground line-through" },

};

export default function PartnerAdvanceDetail() {
  const { id } = useParams();
  const [adv, setAdv] = useState<any>(null);
  const [insts, setInsts] = useState<any[]>([]);
  const [pays, setPays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openPay, setOpenPay] = useState(false);
  const [pay, setPay] = useState({ amount: "", payment_method: "treasury", payment_date: new Date().toISOString().slice(0, 10), notes: "" });

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: a }, { data: i }, { data: p }] = await Promise.all([
      supabase.from("partner_advances" as any).select("*, equity_partners(name)").eq("id", id).maybeSingle(),
      supabase.from("partner_advance_installments" as any).select("*").eq("advance_id", id).order("installment_number"),
      supabase.from("partner_advance_payments" as any).select("*").eq("advance_id", id).order("created_at", { ascending: false }),
    ]);
    setAdv(a);
    setInsts((i ?? []) as any[]);
    setPays((p ?? []) as any[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (!id) return;
    const ch = supabase.channel(`padv-d-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_advances", filter: `id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_advance_installments", filter: `advance_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_advance_payments", filter: `advance_id=eq.${id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  const submitPay = async () => {
    const amt = Number(pay.amount);
    if (!amt || amt <= 0) return toast.error("مبلغ غير صحيح");
    const { error } = await supabase.rpc("record_partner_advance_payment" as any, {
      _advance_id: id,
      _amount: amt,
      _payment_method: pay.payment_method,
      _payment_date: pay.payment_date,
      _notes: pay.notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل الدفعة");
    setOpenPay(false);
    setPay({ amount: "", payment_method: "treasury", payment_date: new Date().toISOString().slice(0, 10), notes: "" });
    load();
  };
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const doCancel = async () => {
    setCancelling(true);
    const { data, error } = await supabase.rpc("cancel_partner_advance" as any, {
      _advance_id: id, _reason: cancelReason || null,
    });
    setCancelling(false);
    if (error) return toast.error(error.message);
    const conv = Number((data as any)?.converted_to_drawing || 0);
    toast.success(conv > 0
      ? `تم إلغاء السلفة — الباقي ${conv.toLocaleString("en-EG")} ج.م اتحوّل لمسحوبات على الشريك`
      : "تم إلغاء السلفة");
    setCancelOpen(false);
    load();
  };

  if (loading) return <AdminLayout><div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div></AdminLayout>;
  if (!adv) return <AdminLayout><div className="p-8 text-center">السلفة غير موجودة</div></AdminLayout>;

  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });
  const paid = Number(adv.amount) - Number(adv.remaining_amount);
  const canPay = adv.status !== "fully_paid" && adv.status !== "cancelled";

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <PageHeader title={`سلفة — ${adv.equity_partners?.name ?? ""}`} subtitle={adv.reason || "بدون سبب محدد"} />
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/admin/financial-position/advances">← السلف</Link></Button>
            {canPay && <Button onClick={() => setOpenPay(true)}><PlusCircle className="w-4 h-4 ml-2" />تسجيل دفعة</Button>}
            {adv.status !== "cancelled" && (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>إلغاء السلفة</Button>
            )}
          </div>
        </div>

        {adv.status === "cancelled" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            🚫 السلفة دي ملغاة. أي مبلغ كان لسه متبقي اتحوّل لمسحوبات على الشريك.
          </div>
        )}

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>إلغاء السلفة</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                الفلوس اللي اتصرفت وما اتسددتش ({fmt(adv.remaining_amount)} ج.م) هتتحوّل لمسحوبات على الشريك مع قيد محاسبي.
                لو السلفة اتخصم منها من توزيع أرباح متسجل، النظام هيرفض الإلغاء.
              </p>
              <div><Label>سبب الإلغاء</Label><Input value={cancelReason} onChange={e => setCancelReason(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelOpen(false)}>رجوع</Button>
              <Button variant="destructive" onClick={doCancel} disabled={cancelling}>
                {cancelling ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}تأكيد الإلغاء
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">إجمالي السلفة</CardTitle></CardHeader><CardContent><div className="text-xl font-bold">{fmt(adv.amount)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">المسدد</CardTitle></CardHeader><CardContent><div className="text-xl font-bold text-success">{fmt(paid)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">المتبقي</CardTitle></CardHeader><CardContent><div className="text-xl font-bold text-destructive">{fmt(adv.remaining_amount)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">القسط الشهري</CardTitle></CardHeader><CardContent><div className="text-xl font-bold">{fmt(adv.monthly_deduction)}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>جدول الأقساط ({insts.length})</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">#</th><th className="p-2">تاريخ الاستحقاق</th><th className="p-2">المبلغ</th><th className="p-2">المدفوع</th><th className="p-2">الحالة</th></tr></thead>
              <tbody>
                {insts.map(i => {
                  const st = INST_STATUS[i.status] ?? INST_STATUS.pending;
                  return (
                    <tr key={i.id} className="border-t">
                      <td className="p-2 font-mono">{i.installment_number}</td>
                      <td className="p-2">{new Date(i.due_date).toLocaleDateString("en-EG")}</td>
                      <td className="p-2 font-mono">{fmt(i.amount)}</td>
                      <td className="p-2 font-mono">{fmt(i.paid_amount)}</td>
                      <td className="p-2"><Badge className={st.cls}>{st.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>الدفعات ({pays.length})</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr className="text-right"><th className="p-2">التاريخ</th><th className="p-2">المبلغ</th><th className="p-2">الطريقة</th><th className="p-2">ملاحظات</th></tr></thead>
              <tbody>
                {pays.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">لا توجد دفعات</td></tr>}
                {pays.map(p => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2">{new Date(p.payment_date).toLocaleDateString("en-EG")}</td>
                    <td className="p-2 font-mono text-success">{fmt(p.amount)}</td>
                    <td className="p-2">{p.payment_method === "treasury" ? "من الخزنة" : p.payment_method === "profit_deduction" ? "خصم من الأرباح" : "يدوي"}</td>
                    <td className="p-2 text-muted-foreground">{p.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={openPay} onOpenChange={setOpenPay}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تسجيل دفعة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>المبلغ (ج.م) *</Label><Input type="number" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} /><div className="text-xs text-muted-foreground mt-1">المتبقي: {fmt(adv.remaining_amount)}</div></div>
            <div><Label>طريقة السداد</Label>
              <Select value={pay.payment_method} onValueChange={v => setPay({ ...pay, payment_method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="treasury">من الخزنة</SelectItem>
                  <SelectItem value="profit_deduction">خصم من الأرباح</SelectItem>
                  <SelectItem value="manual">يدوي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>تاريخ الدفعة</Label><Input type="date" value={pay.payment_date} onChange={e => setPay({ ...pay, payment_date: e.target.value })} /></div>
            <div><Label>ملاحظات</Label><Textarea value={pay.notes} onChange={e => setPay({ ...pay, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenPay(false)}>إلغاء</Button>
            <Button onClick={submitPay}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
