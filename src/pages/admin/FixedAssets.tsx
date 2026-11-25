import { VesselAccountSelect, useHasVesselAccounts } from "@/components/payments/VesselAccountSelect";
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
import { Plus, Package, PlayCircle, Trash2, CalendarClock, Pencil, Ban, Undo2 } from "lucide-react";
import { assetMoneyChanged, cancelEffect, formOfAsset, liveAssets, STATUS_LABEL, type AssetStatus } from "@/lib/fixedAssets";
import { FinancialAmount } from "@/components/FinancialAmount";
import { cairoTodayDay } from "@/lib/cairoDate";
import { choosable, loadAllPaymentMethods, type PaymentMethodOption } from "@/lib/paymentMethods";
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
  status: AssetStatus;
  notes: string | null;
  payment_method: string | null;
  cancel_reason: string | null;
  replaced_by: string | null;
  replaces: string | null;
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
  // 0284: edit / cancel / undo a disposal
  const [editing, setEditing] = useState<FixedAsset | null>(null);
  const [editReason, setEditReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState<FixedAsset | null>(null);
  const [undoOpen, setUndoOpen] = useState<FixedAsset | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [acting, setActing] = useState(false);
  const [disposal, setDisposal] = useState({ disposal_date: cairoTodayDay(), disposal_amount: "0", method: "cash" });
  // 0245: the vessel account the money left from (purchase) / came to (sale)
  const [buyAcc, setBuyAcc] = useState("");
  const [sellAcc, setSellAcc] = useState("");
  const buyHasAcc = useHasVesselAccounts(form.method);
  const sellHasAcc = useHasVesselAccounts(disposal.method);

  const load = async () => {
    if (!tenantId) return;
    const [m, fa] = await Promise.all([
      loadAllPaymentMethods().catch(() => [] as PaymentMethodOption[]),
      supabase.from("fixed_assets" as any).select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    ]);
    setMethods(m.filter(x => choosable(x) && x.kind !== "virtual"));
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
    setEditing(null);
    setForm({ ...emptyForm(), branch_id: branches.length === 1 ? branches[0].id : "" });
    setOpen(true);
  };
  const openEdit = (a: FixedAsset) => {
    setEditing(a);
    setForm(formOfAsset(a));
    setBuyAcc("");
    setEditReason("");
    setOpen(true);
  };
  const moneyChanged = !!editing && assetMoneyChanged(editing, form, form.funding === "paid" ? buyAcc : "");
  const codeOf = (id: string | null) => assets.find(x => x.id === id)?.code ?? "";

  const runAction = async (fn: string, args: Record<string, unknown>, ok: string) => {
    if (!actionReason.trim()) { toast.error("اكتب السبب"); return; }
    setActing(true);
    const { error } = await supabase.rpc(fn as any, args as any);
    setActing(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success(ok);
    setCancelOpen(null); setUndoOpen(null); setActionReason("");
    load();
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
    if (form.funding === "paid" && buyHasAcc && !buyAcc) { toast.error("اختار الحساب اللي الفلوس اتحولت منه"); return; }
    if (editing) {
      if (moneyChanged && !editReason.trim()) { toast.error("اكتب سبب التعديل"); return; }
      setSaving(true);
      const { data, error } = await supabase.rpc("edit_fixed_asset" as any, {
        p_asset: editing.id,
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
        p_account: form.funding === "paid" && buyHasAcc && buyAcc ? buyAcc : null,
        p_reason: editReason || null,
      } as any);
      setSaving(false);
      if (error) { toast.error(rpcErrorText(error)); return; }
      const d = data as any;
      toast.success(d?.mode === "replace" ? `اتلغى ${d.old_code} في يومه واتعمل ${d.code} بالأرقام الصح` : "تم حفظ التعديل");
      setOpen(false); setEditing(null);
      load();
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
      ...(form.funding === "paid" && buyHasAcc && buyAcc ? { p_account: buyAcc } : {}),
    } as any);
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
    if (Number(disposal.disposal_amount) > 0 && sellHasAcc && !sellAcc) { toast.error("اختار الحساب اللي الفلوس وصلت عليه"); return; }
    const { error } = await supabase.rpc("dispose_fixed_asset" as any, {
      _asset_id: disposeOpen.id,
      _disposal_date: disposal.disposal_date,
      _disposal_amount: Number(disposal.disposal_amount || 0),
      _method: disposal.method,
      ...(Number(disposal.disposal_amount) > 0 && sellHasAcc && sellAcc ? { _account: sellAcc } : {}),
    } as any);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success("تم التخلص من الأصل");
    setDisposeOpen(null);
    setDisposal({ disposal_date: cairoTodayDay(), disposal_amount: "0", method: "cash" });
    load();
  };

  const live = useMemo(() => liveAssets(assets), [assets]);
  const totalCost = useMemo(() => live.reduce((s, a) => s + Number(a.cost || 0), 0), [live]);
  const totalAccum = useMemo(() => live.reduce((s, a) => s + (accum[a.id] || 0), 0), [live, accum]);
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
              <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setEditing(null); }}>
                <DialogTrigger asChild>
                  <Button onClick={openCreate}><Plus className="w-4 h-4 ml-2" />أصل جديد</Button>
                </DialogTrigger>
                <DialogContent dir="rtl" className="max-w-2xl">
                  <DialogHeader><DialogTitle>{editing ? `تعديل ${editing.code} — ${editing.name}` : "إضافة أصل ثابت"}</DialogTitle></DialogHeader>
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
                        <Select value={form.method} onValueChange={v => { setForm({ ...form, method: v }); setBuyAcc(""); }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{methods.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                        </Select>
                        {buyHasAcc && <div className="mt-2"><Label>الحساب اللي اتحول منه *</Label><VesselAccountSelect sending method={form.method} value={buyAcc} onChange={setBuyAcc} /></div>}
                      </div>
                    )}
                    <div className="col-span-2"><Label>ملاحظات</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                    {editing && moneyChanged && (
                      <div className="col-span-2 space-y-2 p-2 rounded border border-warning/40 bg-warning/10 text-sm">
                        <div>التعديل ده بيغيّر الفلوس أو الدفاتر، فـ {editing.code} هيتلغي في أيامه (الشراء والإهلاك) ويتعمل أصل جديد بالأرقام الصح. الاتنين بيفضلوا في السجل.</div>
                        <div><Label>سبب التعديل *</Label><Input value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="مثلاً: التكلفة اتكتبت غلط" /></div>
                      </div>
                    )}
                    {editing && !moneyChanged && (
                      <div className="col-span-2 p-2 rounded bg-muted text-sm">الاسم / الفئة / الملاحظات بس — مفيش حاجة بتتحرك في الدفاتر.</div>
                    )}
                    {!editing && form.funding && Number(form.cost) > 0 && (
                      <div className="col-span-2 p-2 rounded bg-muted text-sm">
                        {form.funding === "paid"
                          ? `هيطلع ${fmt(Number(form.cost))} من ${methodLabel(form.method)} في ${branchName(form.branch_id)} يوم ${form.acquisition_date}، والأصل يدخل الدفاتر بنفس المبلغ (المصروفات والربح مش بيتأثروا يوم الشراء).`
                          : `الأصل يدخل الدفاتر بـ ${fmt(Number(form.cost))} كرصيد افتتاحي — الخزنة مش بتتأثر.`}
                        {monthly > 0 && ` بعد كده كل شهر ${fmt(monthly)} مصروف إهلاك (بيقلل الربح) لمدة ${form.useful_life_months} شهر.`}
                      </div>
                    )}
                  </div>
                  <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : editing ? "حفظ التعديل" : "حفظ"}</Button></DialogFooter>
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
                  const cancelled = a.status === "cancelled";
                  const ac = cancelled ? 0 : accum[a.id] || 0;
                  const bookValue = a.status === "active" ? Number(a.cost) - ac : 0;
                  return (
                    <TableRow key={a.id} className={cancelled ? "opacity-60" : undefined}>
                      <TableCell className="font-mono">{a.code}</TableCell>
                      <TableCell>
                        <div className={cancelled ? "line-through" : undefined}>{a.name}</div>
                        {a.replaces && <div className="text-xs text-muted-foreground">بدل {codeOf(a.replaces)}</div>}
                        {cancelled && <div className="text-xs text-muted-foreground">{a.replaced_by ? `اتعدّل — بقى ${codeOf(a.replaced_by)}` : "اتلغى"} (كانت تكلفته {fmt(a.cost)}){a.cancel_reason ? ` — ${a.cancel_reason}` : ""}</div>}
                      </TableCell>
                      <TableCell>{a.category || "—"}</TableCell>
                      <TableCell>{branchName(a.branch_id)}</TableCell>
                      <TableCell>{a.acquisition_date}</TableCell>
                      <TableCell className="text-left font-mono">{cancelled ? "—" : fmt(a.cost)}</TableCell>
                      <TableCell className="text-left font-mono text-warning">{fmt(ac)}</TableCell>
                      <TableCell className="text-left font-mono text-success">{fmt(bookValue)}</TableCell>
                      <TableCell>{a.useful_life_months} شهر</TableCell>
                      <TableCell>{a.status === "active" ? <Badge>{STATUS_LABEL.active}</Badge> : <Badge variant={cancelled ? "outline" : "secondary"}>{STATUS_LABEL[a.status]}</Badge>}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {a.status === "active" && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => openEdit(a)}><Pencil className="w-4 h-4 ml-1" />تعديل</Button>
                              <Button variant="ghost" size="sm" onClick={() => setDisposeOpen(a)}><Trash2 className="w-4 h-4 text-destructive ml-1" />التخلص</Button>
                            </>
                          )}
                          {a.status === "disposed" && (
                            <Button variant="ghost" size="sm" onClick={() => { setActionReason(""); setUndoOpen(a); }}><Undo2 className="w-4 h-4 ml-1" />إلغاء التخلص</Button>
                          )}
                          {!cancelled && (
                            <Button variant="ghost" size="sm" onClick={() => { setActionReason(""); setCancelOpen(a); }}><Ban className="w-4 h-4 text-destructive ml-1" />إلغاء</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={!!cancelOpen} onOpenChange={o => { if (!o) setCancelOpen(null); }}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>إلغاء {cancelOpen?.code} — {cancelOpen?.name}</DialogTitle></DialogHeader>
            {cancelOpen && (
              <div className="space-y-3 text-sm">
                <ul className="list-disc pr-5 space-y-1">
                  {cancelEffect(cancelOpen, accum[cancelOpen.id] || 0, methodLabel).map((l, i) => <li key={i}>{l}</li>)}
                </ul>
                <div><Label>سبب الإلغاء *</Label><Input value={actionReason} onChange={e => setActionReason(e.target.value)} placeholder="مثلاً: اتسجل بالغلط" /></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="destructive" disabled={acting} onClick={() => cancelOpen && runAction("cancel_fixed_asset", { p_asset: cancelOpen.id, p_reason: actionReason }, `تم إلغاء ${cancelOpen.code}`)}>
                {acting ? "جاري الإلغاء..." : "تأكيد الإلغاء"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!undoOpen} onOpenChange={o => { if (!o) setUndoOpen(null); }}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>إلغاء التخلص من {undoOpen?.code} — {undoOpen?.name}</DialogTitle></DialogHeader>
            {undoOpen && (
              <div className="space-y-3 text-sm">
                <p>الأصل يرجع «نشط» كأنه ما اتباعش. {Number(undoOpen.disposal_amount) > 0 ? `الـ ${fmt(Number(undoOpen.disposal_amount))} اللي دخلت من البيع هتطلع من نفس الخزنة يوم ${undoOpen.disposal_date}.` : "مكانش فيه فلوس دخلت."} والإهلاك يكمل من بعد كده.</p>
                <div><Label>السبب *</Label><Input value={actionReason} onChange={e => setActionReason(e.target.value)} /></div>
              </div>
            )}
            <DialogFooter>
              <Button disabled={acting} onClick={() => undoOpen && runAction("undo_fixed_asset_disposal", { p_asset: undoOpen.id, p_reason: actionReason }, `${undoOpen.code} رجع نشط`)}>
                {acting ? "جاري..." : "تأكيد"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
                  <Select value={disposal.method} onValueChange={v => { setDisposal({ ...disposal, method: v }); setSellAcc(""); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{methods.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {sellHasAcc && <div className="mt-2"><Label>الحساب اللي وصلت عليه *</Label><VesselAccountSelect method={disposal.method} value={sellAcc} onChange={setSellAcc} /></div>}
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
