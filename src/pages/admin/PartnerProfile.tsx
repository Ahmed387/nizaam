import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { withPartnerBalance } from "@/lib/partnerBalances";
import { toast } from "sonner";
import { Loader2, Pencil, PlusCircle, Wallet, Trash2 } from "lucide-react";
import { EditPartnerTxDialog } from "@/components/EditPartnerTxDialog";
import { confirmAlert } from "@/components/ConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
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
  const [openWd, setOpenWd] = useState(false);
  const [wd, setWd] = useState({ amount: "", date: new Date().toISOString().slice(0, 10), notes: "" });
  const [wdLoading, setWdLoading] = useState(false);
  const [editTx, setEditTx] = useState<any | null>(null);
  const [openEdit, setOpenEdit] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: p }, { data: t }, { data: adv }] = await Promise.all([
      supabase.from("equity_partners" as any).select("*").eq("id", id).maybeSingle(),
      supabase.from("partner_transactions" as any).select("*").eq("partner_id", id).order("created_at", { ascending: false }),
      supabase.from("partner_advances" as any).select("*").eq("partner_id", id).in("status", ["active", "partially_paid"]),
    ]);
    setPartner(await withPartnerBalance(p as any));
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

  const deleteTx = async (t: any) => {
    const ok = await confirmAlert({
      title: "حذف الحركة نهائيًا؟",
      description: `هيتم مسح الحركة (${TX_LABEL[t.transaction_type]?.label ?? t.transaction_type} بمبلغ ${fmtAmt(t.amount)}) والرصيد هيتحدّث تلقائيًا. مفيش رجوع.`,
      confirmLabel: "أيوه، احذف",
      cancelLabel: "لأ، سيبها",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.rpc("delete_partner_transaction" as any, { _tx_id: t.id });
    if (error) return toast.error(error.message);
    toast.success("تم حذف الحركة — الرصيد اتحدّث");
    load();
  };



  const outstandingAdvances = useMemo(
    () => advances.reduce((s, a) => s + Number(a.remaining_amount || 0), 0),
    [advances]
  );
  const netAvailable = Number(partner?.current_balance || 0) - outstandingAdvances;

  const openWithdraw = () => {
    if (netAvailable <= 0) {
      toast.error(`لا يوجد صافي متاح — الرصيد ${Number(partner?.current_balance || 0)} والسلف القائمة ${outstandingAdvances}`);
      return;
    }
    setWd({ amount: String(netAvailable), date: new Date().toISOString().slice(0, 10), notes: "" });
    setOpenWd(true);
  };

  const submitWithdraw = async () => {
    const amt = Number(wd.amount);
    if (!amt || amt <= 0) return toast.error("المبلغ غير صحيح");
    if (amt > netAvailable) {
      return toast.error(`المبلغ ${amt} أكبر من الصافي المتاح ${netAvailable.toFixed(2)} (الرصيد − السلف القائمة)`);
    }
    setWdLoading(true);
    const { error } = await supabase.rpc("partner_withdraw_from_distribution" as any, {
      p_tenant_id: partner.tenant_id,
      p_partner_id: id,
      p_amount: amt,
      p_date: wd.date,
      p_notes: wd.notes || null,
    });
    setWdLoading(false);
    if (error) return toast.error(error.message);
    toast.success("تم السحب — اتخصم من الخزينة وقيد اليومية اتسجّل");
    setOpenWd(false);
    setWd({ amount: "", date: new Date().toISOString().slice(0, 10), notes: "" });
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
            <Button variant="outline" onClick={openWithdraw} disabled={netAvailable <= 0}>
              <Wallet className="w-4 h-4 ml-2" />سحب من الرصيد
            </Button>
            <Button onClick={() => setOpenTx(true)}><PlusCircle className="w-4 h-4 ml-2" />تسجيل حركة</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">الرصيد الحالي</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{fmt(partner.current_balance)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">إجمالي المساهمات</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-success">{fmt(partner.total_contributions)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">إجمالي المسحوبات</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-destructive">{fmt(partner.total_drawings)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">إجمالي الأرباح</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-primary">{fmt(partner.total_profit_share)}</div></CardContent></Card>
          <Card className="border-warning/30"><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">سلف قائمة</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-warning">{fmt(outstandingAdvances)}</div></CardContent></Card>
        </div>
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4 flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">الصافي المتاح للسحب (الرصيد − السلف القائمة)</div>
              <div className="text-xs text-muted-foreground mt-1">رأس المال + الأرباح − المسحوبات − السلف</div>
            </div>
            <div className={`text-3xl font-bold ${netAvailable >= 0 ? "text-success" : "text-destructive"}`}>{fmt(netAvailable)} ج</div>
          </CardContent>
        </Card>


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
                  <th className="p-2">الوصف</th><th className="p-2">الرصيد الجاري</th><th className="p-2">إجراءات</th>
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
                      <td className="p-2">{t.description || "-"}</td>
                      <td className="p-2 font-mono">{fmt(runningBalances[t.id] ?? 0)}</td>
                      <td className="p-2">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setEditTx(t); setOpenEdit(true); }}>
                            <Pencil className="w-3.5 h-3.5 ml-1" />تعديل
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-destructive hover:bg-destructive/10" onClick={() => deleteTx(t)}>
                            <Trash2 className="w-3.5 h-3.5 ml-1" />حذف
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <EditPartnerTxDialog tx={editTx} open={openEdit} onOpenChange={setOpenEdit} onSaved={load} />

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

      <Dialog open={openWd} onOpenChange={setOpenWd}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>سحب من رصيد الأرباح</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="border rounded-lg p-3 bg-primary/5 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">الرصيد الحالي</span>
                <span className="font-mono">{fmt(Number(partner.current_balance || 0))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">− سلف قائمة</span>
                <span className="font-mono text-warning">{fmt(outstandingAdvances)}</span>
              </div>
              <div className="flex justify-between border-t pt-1">
                <span className="font-semibold">الصافي المتاح للسحب</span>
                <span className={`font-mono font-bold ${netAvailable >= 0 ? "text-success" : "text-destructive"}`}>{fmt(netAvailable)} ج.م</span>
              </div>
            </div>
            <div><Label>المبلغ (ج.م) * — أقصى: {fmt(netAvailable)}</Label>
              <Input type="number" min={0} max={netAvailable} value={wd.amount}
                onChange={e => setWd({ ...wd, amount: e.target.value })} />
              {Number(wd.amount) > netAvailable && (
                <div className="text-xs text-destructive mt-1">المبلغ أكبر من الصافي المتاح</div>
              )}
            </div>
            <div><Label>تاريخ السحب</Label>
              <Input type="date" value={wd.date} onChange={e => setWd({ ...wd, date: e.target.value })} />
            </div>
            <div><Label>ملاحظات</Label>
              <Textarea rows={2} value={wd.notes} onChange={e => setWd({ ...wd, notes: e.target.value })} placeholder="سحب رصيد أرباح" />
            </div>
            <div className="text-xs text-muted-foreground border-r-2 border-primary/40 pr-3">
              القيد المحاسبي: مدين مستحقات التوزيع (3850) / دائن الخزينة (1100)
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenWd(false)}>إلغاء</Button>
            <Button onClick={submitWithdraw} disabled={wdLoading || Number(wd.amount) <= 0 || Number(wd.amount) > netAvailable}>
              {wdLoading && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
              تنفيذ السحب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
