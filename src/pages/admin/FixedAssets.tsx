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
import { Plus, Package, PlayCircle, Trash2, CalendarClock } from "lucide-react";
import { FinancialAmount } from "@/components/FinancialAmount";

const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

type Account = { id: string; code: string; name: string; name_ar: string | null; account_type: string };
type FixedAsset = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  acquisition_date: string;
  cost: number;
  salvage_value: number;
  useful_life_months: number;
  status: "active" | "disposed";
  disposal_date: string | null;
  disposal_amount: number | null;
  asset_account_id: string | null;
  accum_depreciation_account_id: string | null;
  depreciation_expense_account_id: string | null;
};

export default function FixedAssets() {
  const { tenantId } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [accum, setAccum] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [disposeOpen, setDisposeOpen] = useState<FixedAsset | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [runMonth, setRunMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [running, setRunning] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "",
    acquisition_date: new Date().toISOString().slice(0, 10),
    cost: "",
    salvage_value: "0",
    useful_life_months: "60",
    asset_account_id: "",
    accum_depreciation_account_id: "",
    depreciation_expense_account_id: "",
    notes: "",
  });
  const [disposal, setDisposal] = useState({ disposal_date: new Date().toISOString().slice(0, 10), disposal_amount: "0" });

  const load = async () => {
    if (!tenantId) return;
    const [a, fa] = await Promise.all([
      supabase.from("chart_of_accounts").select("id,code,name,name_ar,account_type").eq("tenant_id", tenantId).eq("is_active", true).order("code"),
      supabase.from("fixed_assets" as any).select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    ]);
    setAccounts((a.data as any) ?? []);
    const list = (fa.data as any) ?? [];
    setAssets(list);
    // fetch accumulated depreciation totals
    if (list.length) {
      const { data: de } = await supabase.from("depreciation_entries" as any).select("asset_id, amount").in("asset_id", list.map((x: any) => x.id));
      const map: Record<string, number> = {};
      ((de as any) ?? []).forEach((row: any) => { map[row.asset_id] = (map[row.asset_id] || 0) + Number(row.amount || 0); });
      setAccum(map);
    } else {
      setAccum({});
    }
  };

  useEffect(() => { load(); }, [tenantId]);

  const defaults = useMemo(() => ({
    asset: accounts.find(a => a.code === "1500")?.id || "",
    accum: accounts.find(a => a.code === "1590")?.id || "",
    expense: accounts.find(a => a.code === "6500")?.id || "",
  }), [accounts]);

  const openCreate = () => {
    setForm(f => ({
      ...f,
      asset_account_id: defaults.asset,
      accum_depreciation_account_id: defaults.accum,
      depreciation_expense_account_id: defaults.expense,
    }));
    setOpen(true);
  };

  const save = async () => {
    if (!tenantId) return;
    if (!form.code || !form.name || !form.cost || !form.useful_life_months) {
      toast.error("أدخل الكود والاسم والتكلفة والعمر الإنتاجي");
      return;
    }
    const { error } = await supabase.from("fixed_assets" as any).insert({
      tenant_id: tenantId,
      code: form.code,
      name: form.name,
      category: form.category || null,
      acquisition_date: form.acquisition_date,
      cost: Number(form.cost),
      salvage_value: Number(form.salvage_value || 0),
      useful_life_months: Number(form.useful_life_months),
      asset_account_id: form.asset_account_id || null,
      accum_depreciation_account_id: form.accum_depreciation_account_id || null,
      depreciation_expense_account_id: form.depreciation_expense_account_id || null,
      notes: form.notes || null,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("تم إضافة الأصل");
    setOpen(false);
    setForm({
      code: "", name: "", category: "",
      acquisition_date: new Date().toISOString().slice(0, 10),
      cost: "", salvage_value: "0", useful_life_months: "60",
      asset_account_id: defaults.asset,
      accum_depreciation_account_id: defaults.accum,
      depreciation_expense_account_id: defaults.expense,
      notes: "",
    });
    load();
  };

  const runDepreciation = async () => {
    if (!tenantId || !runMonth) return;
    setRunning(true);
    const { data, error } = await supabase.rpc("post_monthly_depreciation" as any, {
      _tenant_id: tenantId,
      _period_month: `${runMonth}-01`,
    });
    setRunning(false);
    if (error) { toast.error(error.message); return; }
    const n = ((data as any) ?? []).length;
    toast.success(n > 0 ? `تم ترحيل ${n} قيد إهلاك` : "لا يوجد إهلاك جديد لهذا الشهر");
    setRunOpen(false);
    load();
  };

  const dispose = async () => {
    if (!disposeOpen) return;
    const { error } = await supabase.rpc("dispose_fixed_asset" as any, {
      _asset_id: disposeOpen.id,
      _disposal_date: disposal.disposal_date,
      _disposal_amount: Number(disposal.disposal_amount || 0),
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تم التخلص من الأصل");
    setDisposeOpen(null);
    setDisposal({ disposal_date: new Date().toISOString().slice(0, 10), disposal_amount: "0" });
    load();
  };

  const totalCost = useMemo(() => assets.reduce((s, a) => s + Number(a.cost || 0), 0), [assets]);
  const totalAccum = useMemo(() => Object.values(accum).reduce((s, n) => s + n, 0), [accum]);
  const nbv = totalCost - totalAccum;

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title="الأصول الثابتة" subtitle="إدارة الأصول واحتساب الإهلاك الشهري تلقائيًا" />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">عدد الأصول</CardTitle>
              <Package className="w-5 h-5 text-primary" />
            </CardHeader>
            <CardContent><div className="text-3xl font-bold">{assets.filter(a => a.status === "active").length}</div></CardContent>
          </Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">إجمالي التكلفة</CardTitle></CardHeader><CardContent><FinancialAmount value={fmt(totalCost)} size="md" className="justify-start" /></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">مجمع الإهلاك</CardTitle></CardHeader><CardContent><FinancialAmount value={fmt(totalAccum)} size="md" className="justify-start text-warning" /></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">القيمة الدفترية</CardTitle></CardHeader><CardContent><FinancialAmount value={fmt(nbv)} size="md" className="justify-start text-success" /></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>سجل الأصول</CardTitle>
            <div className="flex gap-2">
              <Dialog open={runOpen} onOpenChange={setRunOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline"><CalendarClock className="w-4 h-4 ml-2" />ترحيل إهلاك الشهر</Button>
                </DialogTrigger>
                <DialogContent dir="rtl">
                  <DialogHeader><DialogTitle>ترحيل إهلاك شهري</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>الشهر</Label>
                      <Input type="month" value={runMonth} onChange={e => setRunMonth(e.target.value)} />
                    </div>
                    <p className="text-sm text-muted-foreground">سيتم احتساب قسط شهر واحد لكل أصل نشط لم يتم ترحيله بعد لهذا الشهر، وإنشاء القيود المحاسبية تلقائيًا.</p>
                  </div>
                  <DialogFooter>
                    <Button onClick={runDepreciation} disabled={running}>
                      <PlayCircle className="w-4 h-4 ml-2" />{running ? "جاري الترحيل..." : "تنفيذ"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button onClick={openCreate}><Plus className="w-4 h-4 ml-2" />أصل جديد</Button>
                </DialogTrigger>
                <DialogContent dir="rtl" className="max-w-2xl">
                  <DialogHeader><DialogTitle>إضافة أصل ثابت</DialogTitle></DialogHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>الكود *</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
                    <div><Label>الاسم *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                    <div><Label>الفئة</Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="سيارات، أجهزة..." /></div>
                    <div><Label>تاريخ الشراء</Label><Input type="date" value={form.acquisition_date} onChange={e => setForm({ ...form, acquisition_date: e.target.value })} /></div>
                    <div><Label>التكلفة *</Label><Input type="number" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} /></div>
                    <div><Label>قيمة الخردة</Label><Input type="number" value={form.salvage_value} onChange={e => setForm({ ...form, salvage_value: e.target.value })} /></div>
                    <div><Label>العمر الإنتاجي (شهور) *</Label><Input type="number" value={form.useful_life_months} onChange={e => setForm({ ...form, useful_life_months: e.target.value })} /></div>
                    <div className="col-span-2"><Label>حساب الأصل</Label>
                      <Select value={form.asset_account_id} onValueChange={v => setForm({ ...form, asset_account_id: v })}>
                        <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                        <SelectContent>{accounts.filter(a => a.account_type === "asset").map(a => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name_ar || a.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2"><Label>حساب مجمع الإهلاك</Label>
                      <Select value={form.accum_depreciation_account_id} onValueChange={v => setForm({ ...form, accum_depreciation_account_id: v })}>
                        <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                        <SelectContent>{accounts.filter(a => a.account_type === "asset").map(a => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name_ar || a.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2"><Label>حساب مصروف الإهلاك</Label>
                      <Select value={form.depreciation_expense_account_id} onValueChange={v => setForm({ ...form, depreciation_expense_account_id: v })}>
                        <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                        <SelectContent>{accounts.filter(a => a.account_type === "expense").map(a => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name_ar || a.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2"><Label>ملاحظات</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                  </div>
                  <DialogFooter><Button onClick={save}>حفظ</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكود</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الفئة</TableHead>
                  <TableHead>تاريخ الشراء</TableHead>
                  <TableHead className="text-left">التكلفة</TableHead>
                  <TableHead className="text-left">مجمع الإهلاك</TableHead>
                  <TableHead className="text-left">القيمة الدفترية</TableHead>
                  <TableHead>العمر</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">لا توجد أصول</TableCell></TableRow>}
                {assets.map(a => {
                  const ac = accum[a.id] || 0;
                  const bookValue = Number(a.cost) - ac;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono">{a.code}</TableCell>
                      <TableCell>{a.name}</TableCell>
                      <TableCell>{a.category || "—"}</TableCell>
                      <TableCell>{a.acquisition_date}</TableCell>
                      <TableCell className="text-left font-mono">{fmt(a.cost)}</TableCell>
                      <TableCell className="text-left font-mono text-warning">{fmt(ac)}</TableCell>
                      <TableCell className="text-left font-mono text-success">{fmt(bookValue)}</TableCell>
                      <TableCell>{a.useful_life_months} شهر</TableCell>
                      <TableCell>{a.status === "active" ? <Badge>نشط</Badge> : <Badge variant="secondary">مستبعد</Badge>}</TableCell>
                      <TableCell>
                        {a.status === "active" && (
                          <Button variant="ghost" size="sm" onClick={() => setDisposeOpen(a)}>
                            <Trash2 className="w-4 h-4 text-destructive ml-1" />التخلص
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={!!disposeOpen} onOpenChange={() => setDisposeOpen(null)}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>التخلص من {disposeOpen?.name}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {disposeOpen && (
                <div className="p-3 rounded-md bg-muted text-sm space-y-1">
                  <div>التكلفة: <span className="font-mono">{fmt(disposeOpen.cost)}</span></div>
                  <div>مجمع الإهلاك: <span className="font-mono">{fmt(accum[disposeOpen.id] || 0)}</span></div>
                  <div>القيمة الدفترية: <span className="font-mono">{fmt(Number(disposeOpen.cost) - (accum[disposeOpen.id] || 0))}</span></div>
                </div>
              )}
              <div><Label>تاريخ التخلص</Label><Input type="date" value={disposal.disposal_date} onChange={e => setDisposal({ ...disposal, disposal_date: e.target.value })} /></div>
              <div><Label>سعر البيع / التحصيل</Label><Input type="number" value={disposal.disposal_amount} onChange={e => setDisposal({ ...disposal, disposal_amount: e.target.value })} /></div>
              {disposeOpen && (() => {
                const nbv = Number(disposeOpen.cost) - (accum[disposeOpen.id] || 0);
                const gain = Number(disposal.disposal_amount || 0) - nbv;
                return (
                  <div className={`p-2 rounded text-sm ${gain >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                    {gain >= 0 ? "ربح متوقع: " : "خسارة متوقعة: "}<span className="font-mono">{fmt(Math.abs(gain))}</span>
                  </div>
                );
              })()}
            </div>
            <DialogFooter><Button onClick={dispose} variant="destructive">تأكيد التخلص</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
