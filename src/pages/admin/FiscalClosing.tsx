import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { CalendarClock, Lock, PieChart, Plus, ExternalLink, Save, ShieldAlert } from "lucide-react";

const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

type Period = { id: string; name: string; period_start: string; period_end: string; status: string; net_profit: number | null; closed_at: string | null; closing_entry_id: string | null };
type Partner = { id: string; name: string; capital_share: number; is_active: boolean };
type Distribution = { id: string; distribution_date: string; total_amount: number; status: string; journal_entry_id: string | null; fiscal_period_id: string | null; notes: string | null };

const DEFAULT_CLOSE_MMDD = "12-31";

export default function FiscalClosing() {
  const { tenantId } = useAuth();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [closeMMDD, setCloseMMDD] = useState<string>(DEFAULT_CLOSE_MMDD);
  const [savingSetting, setSavingSetting] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [openPeriod, setOpenPeriod] = useState(false);
  const [openDist, setOpenDist] = useState(false);
  const y = new Date().getFullYear();
  const [pForm, setPForm] = useState({ name: `السنة المالية ${y}`, period_start: `${y}-01-01`, period_end: `${y}-12-31` });
  const [dForm, setDForm] = useState({ fiscal_period_id: "", total_amount: "", distribution_date: today, notes: "" });

  const settingKey = tenantId ? `fiscal_close_date_${tenantId}` : "";

  const load = async () => {
    if (!tenantId) return;
    const [p, e, d, s] = await Promise.all([
      supabase.from("fiscal_periods" as any).select("*").eq("tenant_id", tenantId).order("period_end", { ascending: false }),
      supabase.from("equity_partners" as any).select("id,name,capital_share,is_active").eq("tenant_id", tenantId).eq("is_active", true),
      supabase.from("profit_distributions" as any).select("*").eq("tenant_id", tenantId).order("distribution_date", { ascending: false }).limit(50),
      supabase.from("settings" as any).select("value").eq("key", settingKey).maybeSingle(),
    ]);
    setPeriods((p.data as any) ?? []);
    setPartners((e.data as any) ?? []);
    setDistributions((d.data as any) ?? []);
    const savedMMDD = (s.data as any)?.value?.mmdd;
    if (savedMMDD && /^\d{2}-\d{2}$/.test(savedMMDD)) {
      setCloseMMDD(savedMMDD);
      setPForm(f => ({ ...f, period_end: `${y}-${savedMMDD}` }));
    }
  };
  useEffect(() => { load(); }, [tenantId]);

  const totalShare = partners.reduce((s, p) => s + Number(p.capital_share || 0), 0);
  const previewAmount = Number(dForm.total_amount) || 0;

  const saveCloseDate = async () => {
    if (!tenantId) return;
    if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(closeMMDD)) {
      toast.error("صيغة غير صحيحة — استخدم MM-DD (مثلاً 01-07)");
      return;
    }
    setSavingSetting(true);
    const { error } = await supabase.from("settings" as any).upsert({
      key: settingKey, value: { mmdd: closeMMDD } as any, tenant_id: tenantId,
    } as any, { onConflict: "key" });
    setSavingSetting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم حفظ تاريخ الإقفال الافتراضي");
    setPForm(f => ({ ...f, period_end: `${y}-${closeMMDD}` }));
  };

  const createPeriod = async () => {
    if (!tenantId) return;
    if (!pForm.name.trim()) { toast.error("أدخل اسم الفترة"); return; }
    const { error } = await supabase.from("fiscal_periods" as any).insert({
      tenant_id: tenantId, name: pForm.name.trim(),
      period_start: pForm.period_start, period_end: pForm.period_end,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تم إنشاء الفترة");
    setOpenPeriod(false); load();
  };

  const closePeriod = async (id: string, name: string, periodEnd: string) => {
    if (!confirm(`تأكيد إقفال الفترة "${name}"؟ سيتم إنشاء قيد الإقفال وترحيل صافي الربح للأرباح المحتجزة. الفترة الجديدة ستبدأ تلقائياً من 1 يناير للسنة الجاية.`)) return;
    const { data, error } = await supabase.rpc("close_fiscal_period" as any, { p_period_id: id }) as any;
    if (error) { toast.error(error.message); return; }
    toast.success(`تم الإقفال — صافي الربح: ${fmt(Number(data?.net_profit || 0))} ج.م`);

    // Auto-create next fiscal period: starts Jan 1 of next year, ends on saved close date
    try {
      const closedYear = new Date(periodEnd).getFullYear();
      const nextYear = closedYear + 1;
      const nextStart = `${nextYear}-01-01`;
      const nextEnd = `${nextYear}-${closeMMDD}`;
      const nextName = `السنة المالية ${nextYear}`;
      const { data: existing } = await supabase.from("fiscal_periods" as any)
        .select("id").eq("tenant_id", tenantId).eq("period_start", nextStart).maybeSingle();
      if (!existing) {
        const { error: insErr } = await supabase.from("fiscal_periods" as any).insert({
          tenant_id: tenantId, name: nextName, period_start: nextStart, period_end: nextEnd,
        });
        if (!insErr) toast.success(`تم فتح ${nextName} تلقائياً (${nextStart} → ${nextEnd})`);
      }
    } catch {}
    load();
  };

  const doDistribute = async () => {
    if (!tenantId) return;
    const amt = Number(dForm.total_amount);
    if (!amt || amt <= 0) { toast.error("أدخل مبلغ التوزيع"); return; }
    if (partners.length === 0) { toast.error("لا يوجد شركاء نشطين"); return; }
    const { error } = await supabase.rpc("distribute_profits" as any, {
      p_tenant_id: tenantId,
      p_fiscal_period_id: dForm.fiscal_period_id || null,
      p_total_amount: amt,
      p_distribution_date: dForm.distribution_date,
      p_notes: dForm.notes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تم توزيع الأرباح");
    setOpenDist(false);
    setDForm({ fiscal_period_id: "", total_amount: "", distribution_date: today, notes: "" });
    load();
  };

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <PageHeader title="الإغلاق المحاسبي وتوزيع الأرباح" subtitle="إقفال الفترات المالية وتوزيع صافي الأرباح على الشركاء" />
          <Button asChild variant="default">
            <Link to="/admin/accounting/flexible-distribution">
              <PieChart className="w-4 h-4 ml-1" />توزيع أرباح مرن (بدون إقفال)
            </Link>
          </Button>
        </div>

        {/* Fiscal Close Date Setting */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="w-5 h-5 text-primary" />
              تاريخ الإقفال السنوي الافتراضي
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs">MM-DD (مثال: 01-07 = 7 يناير)</Label>
                <Input
                  value={closeMMDD}
                  onChange={e => setCloseMMDD(e.target.value)}
                  placeholder="12-31"
                  className="ltr text-center font-mono"
                />
              </div>
              <Button onClick={saveCloseDate} disabled={savingSetting} className="gap-1">
                <Save className="w-4 h-4" /> حفظ
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              الفترة الجديدة تبدأ دائماً من <b>1 يناير</b> من السنة الجاية بعد أي إقفال — حتى لو الإقفال بعد نهاية السنة (لتغطية الأقساط المتبقية).
            </p>
          </CardContent>
        </Card>



        {/* Fiscal Periods */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><CalendarClock className="w-5 h-5 text-primary" />الفترات المحاسبية</CardTitle>
            <Dialog open={openPeriod} onOpenChange={setOpenPeriod}>
              <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />فترة جديدة</Button></DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader><DialogTitle>إنشاء فترة محاسبية</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>الاسم</Label><Input value={pForm.name} onChange={e => setPForm({ ...pForm, name: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>من</Label><Input type="date" value={pForm.period_start} onChange={e => setPForm({ ...pForm, period_start: e.target.value })} /></div>
                    <div><Label>إلى</Label><Input type="date" value={pForm.period_end} onChange={e => setPForm({ ...pForm, period_end: e.target.value })} /></div>
                  </div>
                </div>
                <DialogFooter><Button onClick={createPeriod}>حفظ</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {periods.length === 0 ? <div className="text-muted-foreground text-center py-8">لا توجد فترات</div> : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-right">الاسم</TableHead>
                  <TableHead className="text-right">الفترة</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">صافي الربح</TableHead>
                  <TableHead className="text-right">قيد الإقفال</TableHead>
                  <TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {periods.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.period_start} → {p.period_end}</TableCell>
                      <TableCell>
                        <Badge variant={p.status === "closed" ? "default" : "outline"}>
                          {p.status === "closed" ? "مغلقة" : "مفتوحة"}
                        </Badge>
                      </TableCell>
                      <TableCell className={Number(p.net_profit || 0) >= 0 ? "text-success" : "text-destructive"}>
                        {p.net_profit != null ? fmt(Number(p.net_profit)) : "—"}
                      </TableCell>
                      <TableCell>
                        {p.closing_entry_id ? (
                          <Link className="text-primary hover:underline inline-flex items-center gap-1" to={`/admin/accounting/journal/${p.closing_entry_id}`}>
                            <ExternalLink className="w-3 h-3" />عرض
                          </Link>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        {p.status !== "closed" && (
                          <Button size="sm" variant="outline" onClick={() => closePeriod(p.id, p.name, p.period_end)}>
                            <Lock className="w-4 h-4 ml-1" />إقفال
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Profit Distribution */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><PieChart className="w-5 h-5 text-primary" />توزيع الأرباح</CardTitle>
            <Dialog open={openDist} onOpenChange={setOpenDist}>
              <DialogTrigger asChild><Button size="sm" disabled={partners.length === 0}><Plus className="w-4 h-4 ml-1" />توزيع جديد</Button></DialogTrigger>
              <DialogContent dir="rtl" className="max-w-lg">
                <DialogHeader><DialogTitle>توزيع أرباح على الشركاء</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>الفترة المحاسبية (اختياري)</Label>
                    <Select value={dForm.fiscal_period_id || "none"} onValueChange={v => setDForm({ ...dForm, fiscal_period_id: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">بدون ربط بفترة</SelectItem>
                        {periods.filter(p => p.status === "closed").map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name} (ربح: {fmt(Number(p.net_profit || 0))})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>المبلغ الإجمالي *</Label><Input type="number" value={dForm.total_amount} onChange={e => setDForm({ ...dForm, total_amount: e.target.value })} /></div>
                    <div><Label>تاريخ التوزيع</Label><Input type="date" value={dForm.distribution_date} onChange={e => setDForm({ ...dForm, distribution_date: e.target.value })} /></div>
                  </div>
                  <div><Label>ملاحظات</Label><Textarea rows={2} value={dForm.notes} onChange={e => setDForm({ ...dForm, notes: e.target.value })} /></div>

                  {/* Preview */}
                  <div className="border rounded-lg p-3 bg-muted/30">
                    <div className="font-semibold mb-2 text-sm">معاينة التوزيع</div>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead className="text-right">الشريك</TableHead>
                        <TableHead className="text-right">النسبة</TableHead>
                        <TableHead className="text-right">النصيب</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {partners.map(p => {
                          const pct = totalShare > 0 ? (Number(p.capital_share) / totalShare) * 100 : 0;
                          const amt = previewAmount * pct / 100;
                          return (
                            <TableRow key={p.id}>
                              <TableCell>{p.name}</TableCell>
                              <TableCell>{pct.toFixed(2)}%</TableCell>
                              <TableCell className="font-medium">{fmt(amt)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                <DialogFooter><Button onClick={doDistribute}>تنفيذ التوزيع</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {distributions.length === 0 ? <div className="text-muted-foreground text-center py-8">لا توجد توزيعات</div> : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">الفترة</TableHead>
                  <TableHead className="text-right">المبلغ</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">القيد</TableHead>
                  <TableHead className="text-right">ملاحظات</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {distributions.map(d => {
                    const per = periods.find(p => p.id === d.fiscal_period_id);
                    return (
                      <TableRow key={d.id}>
                        <TableCell>{d.distribution_date}</TableCell>
                        <TableCell>{per?.name || "—"}</TableCell>
                        <TableCell className="font-medium">{fmt(d.total_amount)}</TableCell>
                        <TableCell><Badge variant={d.status === "posted" ? "default" : "outline"}>{d.status === "posted" ? "مرحّل" : d.status}</Badge></TableCell>
                        <TableCell>
                          {d.journal_entry_id ? (
                            <Link className="text-primary hover:underline inline-flex items-center gap-1" to={`/admin/accounting/journal/${d.journal_entry_id}`}>
                              <ExternalLink className="w-3 h-3" />عرض
                            </Link>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">{d.notes || "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
