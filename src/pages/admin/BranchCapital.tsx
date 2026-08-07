import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Building2, PlusCircle, TrendingUp, TrendingDown, Wallet, Package, Users, PieChart } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useBranchScope } from "@/lib/branchScope";

type Branch = { id: string; name: string; code: string };
type Allocation = { id: string; branch_id: string; amount: number; allocation_date: string; notes: string | null; created_at: string };
type Position = {
  branch_id: string;
  allocated_capital: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
  expenses: number;
  net_profit: number;
  receivables: number;
  payables: number;
  inventory_value: number;
  treasury_cash: number;
  total_assets: number;
  roi_pct: number | null;
};

const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

export default function BranchCapital() {
  const { tenantId } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const { filterBranches } = useBranchScope();
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ branch_id: "", amount: "", allocation_date: new Date().toISOString().slice(0, 10), notes: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [{ data: br }, { data: al }] = await Promise.all([
      (supabase.from("branches") as any).select("id,name,code").eq("tenant_id", tenantId).eq("is_active", true).eq("is_system", false).order("code"),
      supabase.from("branch_capital_allocations" as any).select("*").eq("tenant_id", tenantId).order("allocation_date", { ascending: false }),
    ]);
    const brs = (br ?? []) as Branch[];
    setBranches(filterBranches((brs) as any) as any);
    setAllocations((al ?? []) as any);

    // load positions in parallel
    const results = await Promise.all(
      brs.map(async (b) => {
        const { data } = await supabase.rpc("get_branch_financial_position" as any, { _branch_id: b.id });
        return [b.id, data as Position] as const;
      })
    );
    setPositions(Object.fromEntries(results));
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);

  const submit = async () => {
    if (!form.branch_id) return toast.error("اختر الفرع");
    const amt = Number(form.amount);
    if (!amt) return toast.error("أدخل المبلغ");
    setSaving(true);
    const { error } = await supabase.rpc("allocate_capital_to_branch" as any, {
      _branch_id: form.branch_id,
      _amount: amt,
      _allocation_date: form.allocation_date,
      _notes: form.notes || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل التخصيص");
    setOpen(false);
    setForm({ branch_id: "", amount: "", allocation_date: new Date().toISOString().slice(0, 10), notes: "" });
    load();
  };

  const totalAllocated = Object.values(positions).reduce((s, p) => s + Number(p?.allocated_capital || 0), 0);
  const totalNetProfit = Object.values(positions).reduce((s, p) => s + Number(p?.net_profit || 0), 0);
  const totalAssets = Object.values(positions).reduce((s, p) => s + Number(p?.total_assets || 0), 0);

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader
          title="توزيع رأس المال على الفروع"
          subtitle="تخصيص رأس المال والمركز المالي لكل فرع"
          actions={
            <Button className="btn-gradient" onClick={() => setOpen(true)}>
              <PlusCircle className="w-4 h-4 ml-1" /> تخصيص جديد
            </Button>
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">إجمالي رأس المال الموزع</CardTitle>
              <Wallet className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent><div className="text-3xl font-bold">{fmt(totalAllocated)} <span className="text-sm">ج.م</span></div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">صافي أرباح الفروع</CardTitle>
              <TrendingUp className={`w-5 h-5 ${totalNetProfit >= 0 ? "text-success" : "text-destructive"}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${totalNetProfit >= 0 ? "text-success" : "text-destructive"}`}>
                {fmt(totalNetProfit)} <span className="text-sm">ج.م</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">إجمالي أصول الفروع</CardTitle>
              <PieChart className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent><div className="text-3xl font-bold">{fmt(totalAssets)} <span className="text-sm">ج.م</span></div></CardContent>
          </Card>
        </div>

        <Tabs defaultValue="positions">
          <TabsList>
            <TabsTrigger value="positions">المركز المالي للفروع</TabsTrigger>
            <TabsTrigger value="history">سجل التخصيصات</TabsTrigger>
          </TabsList>

          <TabsContent value="positions" className="space-y-4 mt-4">
            {loading && <div className="text-center text-muted-foreground py-8">جاري التحميل...</div>}
            {!loading && branches.length === 0 && (
              <Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد فروع نشطة</CardContent></Card>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {branches.map((b) => {
                const p = positions[b.id];
                if (!p) return null;
                const roi = p.roi_pct;
                return (
                  <Card key={b.id} className="border-2">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <Building2 className="w-5 h-5 text-primary" />
                          {b.name} <span className="text-xs text-muted-foreground font-mono">({b.code})</span>
                        </CardTitle>
                        {roi !== null && (
                          <span className={`text-sm font-bold px-2 py-1 rounded ${roi >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                            ROI: {roi}%
                          </span>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <Row label="رأس المال المخصص" value={p.allocated_capital} icon={<Wallet className="w-4 h-4 text-primary" />} highlight />
                      <hr className="my-2" />
                      <Row label="الإيرادات" value={p.revenue} icon={<TrendingUp className="w-4 h-4 text-success" />} />
                      <Row label="تكلفة البضاعة" value={-p.cogs} icon={<Package className="w-4 h-4 text-muted-foreground" />} />
                      <Row label="مجمل الربح" value={p.gross_profit} bold />
                      <Row label="المصروفات التشغيلية" value={-p.expenses} icon={<TrendingDown className="w-4 h-4 text-destructive" />} />
                      <Row label="صافي الربح" value={p.net_profit} bold className={p.net_profit >= 0 ? "text-success" : "text-destructive"} />
                      <hr className="my-2" />
                      <Row label="النقدية بالخزنة" value={p.treasury_cash} />
                      <Row label="قيمة المخزون" value={p.inventory_value} />
                      <Row label="المدينون (لم يُحصل)" value={p.receivables} />
                      <Row label="الدائنون (لم يُدفع)" value={p.payables} className="text-warning" />
                      <hr className="my-2" />
                      <Row label="إجمالي الأصول التشغيلية" value={p.total_assets} bold highlight />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <Card>
              <CardHeader><CardTitle>سجل التخصيصات</CardTitle></CardHeader>
              <CardContent>
                {allocations.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">لا توجد تخصيصات بعد</div>
                ) : (
                  <div className="space-y-2">
                    {allocations.map((a) => {
                      const br = branches.find((b) => b.id === a.branch_id);
                      return (
                        <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                          <div className="flex items-center gap-3">
                            <Building2 className="w-4 h-4 text-primary" />
                            <div>
                              <div className="font-semibold">{br?.name ?? "—"}</div>
                              <div className="text-xs text-muted-foreground">{formatDate(a.allocation_date)} · {a.notes || "بدون ملاحظات"}</div>
                            </div>
                          </div>
                          <div className={`text-lg font-bold ${a.amount >= 0 ? "text-success" : "text-destructive"}`}>
                            {a.amount >= 0 ? "+" : ""}{fmt(a.amount)} ج.م
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>تخصيص رأس مال لفرع</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>الفرع *</Label>
                <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name} ({b.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>المبلغ (ج.م) * — استخدم سالب للسحب من التخصيص</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1.5" dir="ltr" />
              </div>
              <div>
                <Label>التاريخ</Label>
                <Input type="date" value={form.allocation_date} onChange={(e) => setForm({ ...form, allocation_date: e.target.value })} className="mt-1.5" />
              </div>
              <div>
                <Label>ملاحظات</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1.5" rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button className="btn-gradient" onClick={submit} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

function Row({ label, value, icon, bold, highlight, className }: { label: string; value: number; icon?: React.ReactNode; bold?: boolean; highlight?: boolean; className?: string }) {
  return (
    <div className={`flex items-center justify-between ${highlight ? "bg-primary/5 rounded px-2 py-1" : ""} ${className || ""}`}>
      <span className={`flex items-center gap-2 ${bold ? "font-semibold" : "text-muted-foreground"}`}>
        {icon}{label}
      </span>
      <span className={`tabular-nums ${bold ? "font-bold" : ""}`} dir="ltr">{fmt(value)}</span>
    </div>
  );
}
