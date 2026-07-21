import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Target, TrendingUp, TrendingDown, Trash2 } from "lucide-react";

const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

type Period = { id: string; name: string; period_start: string; period_end: string; status: string };
type Account = { id: string; code: string; name: string; name_ar: string | null; account_type: string };
type Variance = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  planned_amount: number;
  actual_amount: number;
  variance: number;
  variance_pct: number | null;
};
type Budget = { id: string; fiscal_period_id: string; account_id: string; planned_amount: number; notes: string | null };

export default function Budgets() {
  const { tenantId } = useAuth();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [variance, setVariance] = useState<Variance[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [filter, setFilter] = useState<"all" | "revenue" | "expense" | "asset" | "liability">("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ account_id: "", planned_amount: "", notes: "" });

  const loadPeriods = async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("fiscal_periods" as any).select("*").eq("tenant_id", tenantId).order("period_end", { ascending: false });
    const list = (data as any) ?? [];
    setPeriods(list);
    if (!selectedPeriod && list.length) setSelectedPeriod(list[0].id);
  };

  const loadAccounts = async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("chart_of_accounts").select("id,code,name,name_ar,account_type").eq("tenant_id", tenantId).eq("is_active", true).order("code");
    setAccounts((data as any) ?? []);
  };

  const loadVariance = async () => {
    if (!selectedPeriod) return;
    const [v, b] = await Promise.all([
      supabase.rpc("get_budget_variance" as any, { _fiscal_period_id: selectedPeriod }),
      supabase.from("budgets" as any).select("*").eq("fiscal_period_id", selectedPeriod),
    ]);
    setVariance((v.data as any) ?? []);
    setBudgets((b.data as any) ?? []);
  };

  useEffect(() => { loadPeriods(); loadAccounts(); }, [tenantId]);
  useEffect(() => { loadVariance(); }, [selectedPeriod]);

  const filtered = useMemo(() => filter === "all" ? variance : variance.filter(v => v.account_type === filter), [variance, filter]);

  const totals = useMemo(() => filtered.reduce((acc, v) => ({
    planned: acc.planned + Number(v.planned_amount || 0),
    actual: acc.actual + Number(v.actual_amount || 0),
    variance: acc.variance + Number(v.variance || 0),
  }), { planned: 0, actual: 0, variance: 0 }), [filtered]);

  const savePlan = async () => {
    if (!tenantId || !selectedPeriod || !form.account_id || !form.planned_amount) {
      toast.error("اختر الحساب وأدخل المبلغ");
      return;
    }
    const { error } = await supabase.from("budgets" as any).upsert({
      tenant_id: tenantId,
      fiscal_period_id: selectedPeriod,
      account_id: form.account_id,
      planned_amount: Number(form.planned_amount),
      notes: form.notes || null,
    } as any, { onConflict: "tenant_id,fiscal_period_id,account_id" });
    if (error) { toast.error(error.message); return; }
    toast.success("تم حفظ الموازنة");
    setOpen(false);
    setForm({ account_id: "", planned_amount: "", notes: "" });
    loadVariance();
  };

  const deletePlan = async (accountId: string) => {
    const row = budgets.find(b => b.account_id === accountId);
    if (!row) return;
    if (!confirm("حذف بند الموازنة؟")) return;
    const { error } = await supabase.from("budgets" as any).delete().eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم الحذف");
    loadVariance();
  };

  const activePeriod = periods.find(p => p.id === selectedPeriod);

  return (
    <AdminLayout>
      <PageHeader title="الموازنة التقديرية" subtitle="خطط الإيرادات والمصروفات وقارنها بالفعلي" />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Label>الفترة المالية</Label>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger><SelectValue placeholder="اختر فترة" /></SelectTrigger>
                <SelectContent>
                  {periods.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.period_start} → {p.period_end})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[180px]">
              <Label>تصفية</Label>
              <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحسابات</SelectItem>
                  <SelectItem value="revenue">الإيرادات</SelectItem>
                  <SelectItem value="expense">المصروفات</SelectItem>
                  <SelectItem value="asset">الأصول</SelectItem>
                  <SelectItem value="liability">الخصوم</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button disabled={!selectedPeriod}><Plus className="w-4 h-4 ml-2" />بند موازنة</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>خطة لحساب</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>الحساب</Label>
                    <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                      <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                      <SelectContent>
                        {accounts.filter(a => ["revenue","expense","asset","liability"].includes(a.account_type)).map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.code} — {a.name_ar || a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>المبلغ المخطط</Label>
                    <Input type="number" value={form.planned_amount} onChange={e => setForm({ ...form, planned_amount: e.target.value })} />
                  </div>
                  <div>
                    <Label>ملاحظات</Label>
                    <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                  </div>
                </div>
                <DialogFooter><Button onClick={savePlan}>حفظ</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedPeriod ? (
            <p className="text-center text-muted-foreground py-8">أنشئ فترة مالية أولًا من صفحة الإقفال المحاسبي</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">إجمالي المخطط</div><div className="text-2xl font-bold">{fmt(totals.planned)}</div></CardContent></Card>
                <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">إجمالي الفعلي</div><div className="text-2xl font-bold">{fmt(totals.actual)}</div></CardContent></Card>
                <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">الانحراف</div><div className={`text-2xl font-bold ${totals.variance >= 0 ? "text-success" : "text-destructive"}`}>{fmt(totals.variance)}</div></CardContent></Card>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الحساب</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead className="text-left">المخطط</TableHead>
                    <TableHead className="text-left">الفعلي</TableHead>
                    <TableHead className="text-left">الانحراف</TableHead>
                    <TableHead className="text-left">%</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد بيانات</TableCell></TableRow>
                  )}
                  {filtered.map(v => {
                    const positive = v.variance >= 0;
                    return (
                      <TableRow key={v.account_id}>
                        <TableCell>{v.account_code} — {v.account_name}</TableCell>
                        <TableCell><Badge variant="outline">{v.account_type}</Badge></TableCell>
                        <TableCell className="text-left font-mono">{fmt(v.planned_amount)}</TableCell>
                        <TableCell className="text-left font-mono">{fmt(v.actual_amount)}</TableCell>
                        <TableCell className={`text-left font-mono ${positive ? "text-success" : "text-destructive"}`}>
                          <span className="inline-flex items-center gap-1">
                            {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {fmt(v.variance)}
                          </span>
                        </TableCell>
                        <TableCell className="text-left font-mono">{v.variance_pct == null ? "—" : `${v.variance_pct}%`}</TableCell>
                        <TableCell>
                          {v.planned_amount > 0 && (
                            <Button variant="ghost" size="icon" onClick={() => deletePlan(v.account_id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
