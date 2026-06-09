import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { toast } from "sonner";
import { Loader2, Save, Building2, Receipt, Boxes, KeyRound, AlertTriangle, Trash2, Wallet, BellRing, DatabaseBackup, ShieldCheck, Target, Eye, BookOpen, ShieldCheck as Shield2, Users2, Percent } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PaymentFeesTab } from "@/components/PaymentFeesTab";
import { BackupTab } from "@/components/BackupTab";
import { TwoFactorTab } from "@/components/TwoFactorTab";
import { ViewersTab } from "@/components/ViewersTab";
import { VoucherCategoriesTab } from "@/components/VoucherCategoriesTab";
import { RolePermissionsTab } from "@/components/RolePermissionsTab";

interface CompanySettings { name: string; address: string; phone: string; tax_number: string; logo_url: string }
interface InvoiceSettings { footer_note: string; show_logo: boolean }
interface InventorySettings { default_low_stock_alert: number }

export default function Settings() {
  const { user, profile, branches, roles } = useAuth();
  const isAdminOnly = roles.includes("admin") && !roles.includes("super_admin");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [company, setCompany] = useState<CompanySettings>({ name: "", address: "", phone: "", tax_number: "", logo_url: "" });
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [pwdSaving, setPwdSaving] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceSettings>({ footer_note: "", show_logo: true });
  const [inventory, setInventory] = useState<InventorySettings>({ default_low_stock_alert: 5 });
  const [branchThresholds, setBranchThresholds] = useState<Record<string, number>>({});
  const [branchTargets, setBranchTargets] = useState<Record<string, number>>({});
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);

  // === Discount policy ===
  const [discMode, setDiscMode] = useState<"global" | "per_branch">("global");
  const [discGlobalPct, setDiscGlobalPct] = useState<number>(10);
  const [discBranchPct, setDiscBranchPct] = useState<Record<string, number>>({});
  const [savingDiscount, setSavingDiscount] = useState(false);

  const RESET_OPTIONS: { key: string; label: string }[] = [
    { key: "sales", label: "المبيعات والفواتير" },
    { key: "inventory", label: "المخزون (الكميات فقط — مش المنتجات نفسها)" },
    { key: "products", label: "حذف المنتجات نهائياً (مع كل الفواتير والمرتجعات والشحنات المرتبطة)" },
    { key: "shipments", label: "الشحنات" },
    { key: "returns", label: "مرتجعات البيع" },
    { key: "purchase_returns", label: "مرتجعات الشراء" },
    
    { key: "treasury", label: "بيانات الخزينة" },
    { key: "stock_movements", label: "سجل حركات المخزون" },
    { key: "customers", label: "بيانات العملاء" },
    { key: "suppliers", label: "الموردين (اللي مش مرتبطين بشحنات)" },
    { key: "employees", label: "الموظفين (مع رواتبهم وسلفهم)" },
    { key: "payroll", label: "الرواتب وطلبات السلف" },
    { key: "notifications", label: "الإشعارات" },
    { key: "audit_log", label: "سجل العمليات" },
  ];
  const [resetBranch, setResetBranch] = useState<string>("");
  const [resetOpts, setResetOpts] = useState<Record<string, boolean>>({});
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const selectedKeys = Object.keys(resetOpts).filter((k) => resetOpts[k]);
  const selectedLabels = RESET_OPTIONS.filter((o) => resetOpts[o.key]).map((o) => o.label);
  const branchLabel = !resetBranch
    ? "—"
    : resetBranch === "__all__"
    ? "كل الفروع"
    : (branches.find((b) => b.id === resetBranch)?.name ?? "—");

  const runReset = async () => {
    setResetting(true);
    try {
      const { error } = await supabase.rpc("admin_reset_branch_data", {
        p_branch_id: resetBranch === "__all__" ? null : resetBranch,
        p_options: Object.fromEntries(selectedKeys.map((k) => [k, true])),
      } as any);
      if (error) throw error;
      toast.success("تم مسح البيانات المحددة");
      setResetOpen(false);
      setResetOpts({});
      setResetConfirm("");
    } catch (e: any) {
      toast.error(e.message ?? "خطأ في التنفيذ");
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    (async () => {
      const [{ data }, { data: brs }] = await Promise.all([
        supabase.from("settings").select("*"),
        supabase.from("branches").select("id, low_balance_threshold, monthly_sales_target"),
      ]);
      for (const row of data ?? []) {
        if (row.key === "company") setCompany(row.value as any);
        if (row.key === "invoice") setInvoice(row.value as any);
        if (row.key === "inventory") setInventory(row.value as any);
      }
      const tmap: Record<string, number> = {};
      const gmap: Record<string, number> = {};
      for (const b of brs ?? []) {
        tmap[(b as any).id] = Number((b as any).low_balance_threshold ?? 0);
        gmap[(b as any).id] = Number((b as any).monthly_sales_target ?? 0);
      }
      setBranchThresholds(tmap);
      setBranchTargets(gmap);
      setLoading(false);
    })();
  }, []);

  const saveThresholds = async () => {
    setSavingThresholds(true);
    try {
      const updates = Object.entries(branchThresholds).map(([id, v]) =>
        supabase.from("branches").update({ low_balance_threshold: Number(v) || 0 } as any).eq("id", id)
      );
      const results = await Promise.all(updates);
      const err = results.find((r) => r.error);
      if (err?.error) throw err.error;
      await logAudit({ userId: user!.id, userName: profile?.name ?? "", action: "UPDATE", entity: "branches_thresholds", details: branchThresholds });
      toast.success("تم حفظ حدود التنبيه");
    } catch (e: any) {
      toast.error(e.message ?? "خطأ في الحفظ");
    } finally {
      setSavingThresholds(false);
    }
  };

  const saveTargets = async () => {
    setSavingTargets(true);
    try {
      const updates = Object.entries(branchTargets).map(([id, v]) =>
        supabase.from("branches").update({ monthly_sales_target: Number(v) || 0 } as any).eq("id", id)
      );
      const results = await Promise.all(updates);
      const err = results.find((r) => r.error);
      if (err?.error) throw err.error;
      await logAudit({ userId: user!.id, userName: profile?.name ?? "", action: "UPDATE", entity: "branches_targets", details: branchTargets });
      toast.success("تم حفظ أهداف المبيعات");
    } catch (e: any) {
      toast.error(e.message ?? "خطأ في الحفظ");
    } finally {
      setSavingTargets(false);
    }
  };

  const saveKey = async (key: string, value: any) => {
    setSaving(true);
    const { error } = await supabase.from("settings").upsert({ key, value, updated_by: user!.id, updated_at: new Date().toISOString() });
    if (error) toast.error(error.message);
    else {
      await logAudit({ userId: user!.id, userName: profile?.name ?? "", action: "UPDATE", entity: "settings", entityId: key, details: value });
      toast.success("تم الحفظ");
    }
    setSaving(false);
  };

  const changePassword = async () => {
    if (!pwd.next || pwd.next.length < 6) return toast.error("كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل");
    if (pwd.next !== pwd.confirm) return toast.error("تأكيد كلمة المرور غير مطابق");
    setPwdSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwd.next });
    setPwdSaving(false);
    if (error) return toast.error(error.message);
    await logAudit({ userId: user!.id, userName: profile?.name ?? "", action: "UPDATE", entity: "auth", entityId: user!.id, details: { changed: "password" } });
    toast.success("تم تغيير كلمة المرور");
    setPwd({ current: "", next: "", confirm: "" });
  };

  if (loading) {
    return <AdminLayout><div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <PageHeader title="الإعدادات" subtitle="إعدادات النظام العامة" />

      <Tabs defaultValue="company" className="w-full">
        <TabsList className="flex flex-wrap h-auto w-full gap-1 mb-6">
          {[
            { v: "company", icon: Building2, label: "بيانات الشركة" },
            { v: "invoice", icon: Receipt, label: "الفواتير" },
            { v: "inventory", icon: Boxes, label: "المخزون" },
            { v: "payments", icon: Wallet, label: "المدفوعات" },
            { v: "voucher-cats", icon: BookOpen, label: "تصنيفات السندات" },
            { v: "alerts", icon: BellRing, label: "تنبيهات الخزينة" },
            { v: "targets", icon: Target, label: "أهداف المبيعات" },
            { v: "2fa", icon: ShieldCheck, label: "المصادقة الثنائية" },
            { v: "viewers", icon: Eye, label: "حسابات المراقبة" },
            { v: "security", icon: KeyRound, label: "كلمة المرور" },
            { v: "backup", icon: DatabaseBackup, label: "نسخة احتياطية" },
            ...(isAdminOnly ? [{ v: "permissions", icon: Users2, label: "صلاحيات الأدوار" }] : []),
            ...(isAdminOnly ? [{ v: "data", icon: Trash2, label: "إدارة البيانات", danger: true as const }] : []),
          ].map((it: any) => {
            const Icon = it.icon;
            return (
              <TabsTrigger
                key={it.v}
                value={it.v}
                className={`gap-1 px-3 py-2 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground ${it.danger ? "text-destructive data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground" : ""}`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{it.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <div className="w-full">


        <TabsContent value="permissions" className="mt-4">
          <RolePermissionsTab />
        </TabsContent>


        <TabsContent value="payments" className="mt-4">
          <PaymentFeesTab />
        </TabsContent>

        <TabsContent value="voucher-cats" className="mt-4">
          <VoucherCategoriesTab />
        </TabsContent>


        <TabsContent value="company" className="mt-4">
          <div className="card-elevated p-6 space-y-4 max-w-2xl mx-auto">
            <div>
              <Label>اسم الشركة *</Label>
              <Input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} className="mt-1.5" />
              <p className="text-xs text-muted-foreground mt-1">يظهر في الفواتير ورأس التقارير</p>
            </div>
            <div>
              <Label>رابط شعار الشركة (URL)</Label>
              <Input dir="ltr" className="text-right mt-1.5" placeholder="https://..." value={company.logo_url} onChange={(e) => setCompany({ ...company, logo_url: e.target.value })} />
              {company.logo_url && <img src={company.logo_url} alt="logo" className="mt-2 h-16 rounded border bg-white p-1" />}
            </div>
            <div>
              <Label>العنوان</Label>
              <Textarea rows={2} value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} className="mt-1.5" />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>التليفون</Label>
                <Input dir="ltr" className="text-right mt-1.5" value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
              </div>
              <div>
                <Label>الرقم الضريبي</Label>
                <Input dir="ltr" className="text-right mt-1.5" value={company.tax_number} onChange={(e) => setCompany({ ...company, tax_number: e.target.value })} />
              </div>
            </div>
            <Button onClick={() => saveKey("company", company)} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="invoice" className="mt-4">
          <div className="card-elevated p-6 space-y-4 max-w-2xl mx-auto">
            <div>
              <Label>ملاحظة في تذييل الفاتورة</Label>
              <Textarea rows={3} value={invoice.footer_note} onChange={(e) => setInvoice({ ...invoice, footer_note: e.target.value })} className="mt-1.5" placeholder="شكراً لتعاملكم معنا" />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-2">
              <div>
                <Label className="cursor-pointer">إظهار شعار الشركة في الفاتورة</Label>
                <p className="text-xs text-muted-foreground">يظهر اسم الشركة في رأس الفاتورة المطبوعة</p>
              </div>
              <Switch checked={invoice.show_logo} onCheckedChange={(v) => setInvoice({ ...invoice, show_logo: v })} />
            </div>
            <Button onClick={() => saveKey("invoice", invoice)} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          <div className="card-elevated p-6 space-y-4 max-w-2xl mx-auto">
            <div>
              <Label>حد التنبيه الافتراضي للمخزون المنخفض</Label>
              <Input type="number" min={0} value={inventory.default_low_stock_alert}
                onChange={(e) => setInventory({ ...inventory, default_low_stock_alert: Number(e.target.value) })}
                className="mt-1.5" />
              <p className="text-xs text-muted-foreground mt-1">القيمة المستخدمة عند إنشاء منتج جديد، وعند الحفظ هتتطبق فوراً على كل المنتجات الموجودة</p>
            </div>
            <Button
              onClick={async () => {
                await saveKey("inventory", inventory);
                const { error: upErr } = await supabase
                  .from("products")
                  .update({ low_stock_alert: inventory.default_low_stock_alert })
                  .gte("low_stock_alert", 0);
                if (upErr) toast.error("تم حفظ الإعداد لكن فشل التطبيق على المنتجات: " + upErr.message);
                else toast.success("تم التطبيق على كل المنتجات");
              }}
              disabled={saving}
              className="gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ وتطبيق على الكل
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <div className="card-elevated p-6 space-y-4 max-w-2xl mx-auto">
            <div className="flex items-start gap-3">
              <BellRing className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold">حد التنبيه لرصيد الخزينة (لكل فرع)</h3>
                <p className="text-sm text-muted-foreground">
                  لو الرصيد الإجمالي للفرع نزل تحت القيمة دي، هيظهر تحذير في صفحة الخزينة وهيتبعت إشعار للأدمن ومدير الفرع.
                  اكتب صفر لتعطيل التنبيه.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {branches.length === 0 && <p className="text-sm text-muted-foreground">لا توجد فروع بعد.</p>}
              {branches.map((b) => (
                <div key={b.id} className="flex items-center gap-3 p-2 rounded border">
                  <div className="flex-1 font-medium">{b.name}</div>
                  <Input
                    type="number"
                    min={0}
                    className="w-40 text-right"
                    value={branchThresholds[b.id] ?? 0}
                    onChange={(e) =>
                      setBranchThresholds((s) => ({ ...s, [b.id]: Number(e.target.value) }))
                    }
                  />
                  <span className="text-xs text-muted-foreground w-12">جنيه</span>
                </div>
              ))}
            </div>
            <Button onClick={saveThresholds} disabled={savingThresholds || branches.length === 0} className="gap-2">
              {savingThresholds ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="targets" className="mt-4">
          <div className="card-elevated p-6 space-y-4 max-w-2xl mx-auto">
            <div className="flex items-start gap-3">
              <Target className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold">هدف المبيعات الشهري (لكل فرع)</h3>
                <p className="text-sm text-muted-foreground">
                  حدّد الهدف الشهري للفرع. هيظهر مؤشر التقدم في لوحة الفرع علشان الفريق يتابع تحقيق الهدف.
                  اكتب صفر لتعطيل الهدف.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {branches.length === 0 && <p className="text-sm text-muted-foreground">لا توجد فروع بعد.</p>}
              {branches.map((b) => (
                <div key={b.id} className="flex items-center gap-3 p-2 rounded border">
                  <div className="flex-1 font-medium">{b.name}</div>
                  <Input
                    type="number" min={0} className="w-40 text-right"
                    value={branchTargets[b.id] ?? 0}
                    onChange={(e) => setBranchTargets((s) => ({ ...s, [b.id]: Number(e.target.value) }))}
                  />
                  <span className="text-xs text-muted-foreground w-12">جنيه</span>
                </div>
              ))}
            </div>
            <Button onClick={saveTargets} disabled={savingTargets || branches.length === 0} className="gap-2">
              {savingTargets ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="backup" className="mt-4">
          <BackupTab />
        </TabsContent>

        <TabsContent value="2fa" className="mt-4">
          <TwoFactorTab />
        </TabsContent>

        <TabsContent value="viewers" className="mt-4">
          <ViewersTab />
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <div className="card-elevated p-6 space-y-4 max-w-md mx-auto">
            <div>
              <Label>كلمة المرور الجديدة</Label>
              <Input type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>تأكيد كلمة المرور</Label>
              <Input type="password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} className="mt-1.5" />
            </div>
            <Button onClick={changePassword} disabled={pwdSaving} className="gap-2">
              {pwdSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              تغيير كلمة المرور
            </Button>
          </div>
        </TabsContent>
        {isAdminOnly && (
          <TabsContent value="data" className="mt-4">
            <div className="card-elevated p-6 space-y-4 max-w-3xl mx-auto border border-destructive/40">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-lg font-bold text-destructive">مسح البيانات التجريبية / إعادة تشغيل بيانات الفروع</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    تحذير: الإجراء يحذف نهائيًا البيانات المحددة من الفرع المختار ولا يمكن التراجع عنه.
                    لا يتم حذف بيانات الإعداد الأساسية (الموظفين، الموردين، المنتجات، التصنيفات).
                  </p>
                </div>
              </div>

              <div>
                <Label>الفرع</Label>
                <Select value={resetBranch} onValueChange={setResetBranch}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر فرع" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">كل الفروع</SelectItem>
                    {branches.map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-2 block">نوع البيانات المراد مسحها</Label>
                <div className="grid sm:grid-cols-2 gap-2">
                  {RESET_OPTIONS.map((o) => (
                    <label key={o.key} className="flex items-center gap-2 p-2 rounded border hover:bg-muted/50 cursor-pointer">
                      <Checkbox checked={!!resetOpts[o.key]} onCheckedChange={(v) => setResetOpts((s) => ({ ...s, [o.key]: !!v }))} />
                      <span className="text-sm">{o.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button variant="destructive" disabled={!resetBranch || selectedKeys.length === 0}
                  onClick={() => { setResetConfirm(""); setResetOpen(true); }}>
                  <Trash2 className="w-4 h-4 ml-1" /> مسح البيانات
                </Button>
              </div>
            </div>
          </TabsContent>
        )}
        </div>
      </Tabs>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> تأكيد مسح البيانات
            </DialogTitle>
            <DialogDescription className="text-foreground/80 pt-2">
              هتمسح: <b>{selectedLabels.join(" + ")}</b> من <b>{branchLabel}</b>.
              <br />
              <span className="text-destructive font-semibold">هذا الإجراء لا يمكن التراجع عنه.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>اكتب كلمة <b>تأكيد</b> للمتابعة</Label>
            <Input value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} placeholder="تأكيد" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetting}>إلغاء</Button>
            <Button variant="destructive" disabled={resetConfirm.trim() !== "تأكيد" || resetting} onClick={runReset}>
              {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : "نفّذ المسح"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
