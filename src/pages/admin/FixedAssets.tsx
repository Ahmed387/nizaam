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
import { cairoTodayDay } from "@/lib/cairoDate";
import { loadAllPaymentMethods, type PaymentMethodOption } from "@/lib/paymentMethods";
import { rpcErrorText } from "@/lib/rpcError";

const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

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
  branch_id: string | null;
  funding: "opening" | "paid" | null;
};

export default function FixedAssets() {
  const { tenantId, branches } = useAuth();
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [accum, setAccum] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [disposeOpen, setDisposeOpen] = useState<FixedAsset | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [runMonth, setRunMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [running, setRunning] = useState(false);
  const emptyForm = () => ({
    name: "",
    category: "",
    branch_id: "",
    acquisition_date: cairoTodayDay(),
    cost: "",
    salvage_value: "0",
    useful_life_months: "60",
    funding: "" as "" | "opening" | "paid",
    method: "cash",
    notes: "",
  });
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [disposal, setDisposal] = useState({ disposal_date: cairoTodayDay(), disposal_amount: "0", method: "cash" });

  const load = async () => {
    if (!tenantId) return;
    const [m, fa] = await Promise.all([
      loadAllPaymentMethods().catch(() => [] as PaymentMethodOption[]),
      supabase.from("fixed_assets" as any).select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    ]);
    setMethods(m.filter(x => x.is_enabled && x.kind !== "virtual"));
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

  const branchName = (id: string | null) => branches.find(b => b.id === id)?.name || "—";
  const methodLabel = (v: string) => methods.find(m => m.value === v)?.label || v;

  const openCreate = () => {
    setForm({ ...emptyForm(), branch_id: branches.length === 1 ? branches[0].id : "" });
    setOpen(true);
  };

  const monthly = useMemo(() => {
    const c = Number(form.cost || 0), sv = Number(form.salvage_value || 0), n = Number(form.useful_life_months || 0);
    return n > 0 && c > sv ? (c - sv) / n : 0;
  }, [form.cost, form.salvage_value, form.useful_life_months]);

  const save = async () => {
    if (!tenantId) return;
    if (!form.name || !form.cost || !form.useful_life_months || !form.branch_id || !form.funding) {
      toast.error("اكتب الاسم والتكلفة والعمر، واختار الفرع وطريقة الحصول على الأصل");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("add_fixed_asset" as any, {
      p_name: form.name,
      p_category: form.category || null,
      p_branch: form.branch_id,
      p_date: form.acquisition_date,
      p_cost: Number(form.cost),
      p_salvage: Number(form.salvage_value || 0),
      p_life_months: Number(form.useful_life_months),
      p_funding: form.funding,
      p_method: form.method,
      p_notes: form.notes || null,
    });
    setSaving(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    const d = (data as any)?.depreciation;
    toast.success(`تم إضافة الأصل ${(data as any)?.code ?? ""}` + (d?.entries ? ` — واتحسب إهلاك ${d.entries} شهر (${fmt(d.amount)})` : ""));
    setOpen(false);
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
    if (error) { toast.error(rpcErrorText(error)); return; }
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
      _method: disposal.method,
    });
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success("تم التخلص من الأصل");
    setDisposeOpen(null);
    setDisposal({ disposal_date: cairoTodayDay(), disposal_amount: "0", method: "cash" });
    load();
  };

  const totalCost = useMemo(() => assets.reduce((s, a) => s + Number(a.cost || 0), 0), [assets]);
  const totalAccum = useMemo(() => Object.values(accum).reduce((s, n) => s + n, 0), [accum]);
  const nbv = totalCost - totalAccum;

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-6">
        <PageHeader title="الأصول الثابتة" subtitle="الإهلاك بيتحسب لوحده كل شهر (من الشهر اللي بعد الشراء) — لو مفيش أصول مفيش إهلاك" />

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
                  <Button variant="outline"><CalendarClock className="w-4 h-4 ml-2" />ترحيل إهلاك شهر يدوي</Button>
                </DialogTrigger>
                <DialogContent dir="rtl">
                  <DialogHeader><DialogTitle>ترحيل إهلاك شهري</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>الشهر</Label>
                      <Input type="month" value={runMonth} onChange={e => setRunMonth(e.target.value)} />
                    </div>
                    <p className="text-sm text-muted-foreground">الإهلاك بيترحّل لوحده كل يوم لأي شهر خلص. الزرار ده بس لو عاوز ترحّل شهر خلص حالًا. الشهر الحالي مش بيترحّل قبل ما يخلص، ومفيش شهر بيترحّل مرتين.</p>
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
                    <div><Label>الاسم *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="عربية نقل، تكييف، رفوف..." /></div>
                    <div><Label>الفئة</Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="سيارات، أجهزة..." /></div>
                    <div><Label>الفرع *</Label>
                      <Select value={form.branch_id} onValueChange={v => setForm({ ...form, branch_id: v })}>
                        <SelectTrigger><SelectValue placeholder="اختار الفرع" /></SelectTrigger>
                        <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>تاريخ الشراء</Label><Input type="date" max={cairoTodayDay()} value={form.acquisition_date} onChange={e => setForm({ ...form, acquisition_date: e.target.value })} /></div>
                    <div><Label>التكلفة *</Label><Input type="number" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} /></div>
                    <div><Label>قيمة الخردة (لو هيتباع في الآخر)</Label><Input type="number" value={form.salvage_value} onChange={e => setForm({ ...form, salvage_value: e.target.value })} /></div>
                    <div><Label>العمر الإنتاجي (شهور) *</Label><Input type="number" value={form.useful_life_months} onChange={e => setForm({ ...form, useful_life_months: e.target.value })} /></div>
                    <div><Label>إهلاك الشهر</Label><div className="h-10 flex items-center font-mono">{fmt(monthly)}</div></div>
                    <div className="col-span-2"><Label>الأصل ده جه منين؟ *</Label>
                      <Select value={form.funding} onValueChange={v => setForm({ ...form, funding: v as "opening" | "paid" })}>
                        <SelectTrigger><SelectValue placeholder="اختار" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="opening">كان عندنا قبل السيستم (رصيد افتتاحي — مفيش فلوس بتطلع)</SelectItem>
                          <SelectItem value="paid">اشتريناه ودفعنا من خزنة الفرع</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {form.funding === "paid" && (
                      <div className="col-span-2"><Label>اتدفع من *</Label>
                        <Select value={form.method} onValueChange={v => setForm({ ...form, method: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{methods.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="col-span-2"><Label>ملاحظات</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                    {form.funding && Number(form.cost) > 0 && (
                      <div className="col-span-2 p-2 rounded bg-muted text-sm">
                        {form.funding === "paid"
                          ? `هيطلع ${fmt(Number(form.cost))} من ${methodLabel(form.method)} في ${branchName(form.branch_id)} يوم ${form.acquisition_date}، والأصل يدخل الدفاتر بنفس المبلغ (المصروفات والربح مش بيتأثروا يوم الشراء).`
                          : `الأصل يدخل الدفاتر بـ ${fmt(Number(form.cost))} كرصيد افتتاحي — الخزنة مش بتتأثر.`}
                        {monthly > 0 && ` بعد كده كل شهر ${fmt(monthly)} مصروف إهلاك (بيقلل الربح) لمدة ${form.useful_life_months} شهر.`}
                      </div>
                    )}
                  </div>
                  <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></DialogFooter>
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
                  <TableHead>الفرع</TableHead>
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
                {assets.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-6">لا توجد أصول</TableCell></TableRow>}
                {assets.map(a => {
                  const ac = accum[a.id] || 0;
                  const bookValue = Number(a.cost) - ac;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono">{a.code}</TableCell>
                      <TableCell>{a.name}</TableCell>
                      <TableCell>{a.category || "—"}</TableCell>
                      <TableCell>{branchName(a.branch_id)}</TableCell>
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
              {Number(disposal.disposal_amount) > 0 && (
                <div><Label>الفلوس دخلت في</Label>
                  <Select value={disposal.method} onValueChange={v => setDisposal({ ...disposal, method: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{methods.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
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
