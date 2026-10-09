import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PersonalExpensesAccessTab } from "@/components/settings/PersonalExpensesAccessTab";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { toast } from "sonner";
import { Loader2, Save, Building2, Receipt, Boxes, KeyRound, AlertTriangle, Wallet, BellRing, DatabaseBackup, ShieldCheck, Target, Eye, BookOpen, ShieldCheck as Shield2, Users2, Percent, Clock } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PaymentFeesTab } from "@/components/PaymentFeesTab";
import { BackupTab } from "@/components/BackupTab";
import { TwoFactorTab } from "@/components/TwoFactorTab";
import { ViewersTab } from "@/components/ViewersTab";
import { VoucherCategoriesTab } from "@/components/VoucherCategoriesTab";
import { RolePermissionsTab } from "@/components/RolePermissionsTab";
import { UserPermissionsTab } from "@/components/UserPermissionsTab";
import { OrphanedBatchesCheck } from "@/components/OrphanedBatchesCheck";

import { BranchSchedulesTab } from "@/components/BranchSchedulesTab";
import { ShiftSchedulesTab } from "@/components/ShiftSchedulesTab";
import { invalidateReceiptSettings } from "@/components/ThermalReceiptPrint";

interface CompanySettings { name: string; address: string; phone: string; tax_number: string; logo_url: string }
interface InvoiceSettings { footer_note: string; show_logo: boolean }
interface InventorySettings { default_low_stock_alert: number }

export default function Settings() {
  const { user, profile, branches, roles, isOwner } = useAuth();
  const canManageAdminTools = roles.includes("admin") || roles.includes("super_admin");
  // النسخ الاحتياطي والاستعادة: المالك والسوبر أدمن فقط — محجوب عن رتبة admin
  const canManageBackup = isOwner || roles.includes("super_admin");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [company, setCompany] = useState<CompanySettings>({ name: "", address: "", phone: "", tax_number: "", logo_url: "" });
  const [logoError, setLogoError] = useState(false);
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [pwdSaving, setPwdSaving] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceSettings>({ footer_note: "", show_logo: true });
  const [vat, setVat] = useState<{ enabled: boolean; rate: number }>({ enabled: false, rate: 14 });
  const [inventory, setInventory] = useState<InventorySettings>({ default_low_stock_alert: 5 });
  const [branchThresholds, setBranchThresholds] = useState<Record<string, number>>({});
  const [branchTargets, setBranchTargets] = useState<Record<string, number>>({});
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);

  // === Discount policy ===
  const [discMode, setDiscMode] = useState<"global" | "per_branch">("global");
  const [discGlobalPct, setDiscGlobalPct] = useState<number>(10);
  const [minPriceFloor, setMinPriceFloor] = useState<"cost" | "market" | "none">("cost");
  const [discBranchPct, setDiscBranchPct] = useState<Record<string, number>>({});
  const [savingDiscount, setSavingDiscount] = useState(false);

  // === Return-window policy (owner-only) ===
  const [returnWindowDays, setReturnWindowDays] = useState<number>(20);
  const [savingReturnPolicy, setSavingReturnPolicy] = useState(false);


  useEffect(() => {
    (async () => {
      const [{ data }, { data: brs }] = await Promise.all([
        supabase.from("settings").select("*"),
        supabase.from("branches").select("id, low_balance_threshold, monthly_sales_target, code").eq("is_system", false),
      ]);
      for (const row of data ?? []) {
        if (row.key === "company") setCompany(row.value as any);
        if (row.key === "invoice") setInvoice(row.value as any);
        if (row.key === "inventory") setInventory(row.value as any);
        if (row.key === "vat") {
          const v: any = row.value ?? {};
          setVat({ enabled: !!v.enabled, rate: Number(v.rate ?? 14) });
        }
        if (row.key === "discount_policy_global") {
          const v: any = row.value ?? {};
          if (typeof v.percent === "number") setDiscGlobalPct(v.percent);
          if (v.min_price_floor) setMinPriceFloor(v.min_price_floor);
        }
        if (row.key === "discount_policy_branches") {
          const v: any = row.value ?? {};
          if (v.mode === "per_branch") setDiscMode("per_branch");
          if (v.branches && typeof v.branches === "object") setDiscBranchPct(v.branches);
        }
        if (row.key === "return_policy") {
          const v: any = row.value ?? {};
          const n = Number(v.days);
          if (Number.isFinite(n) && n >= 1) setReturnWindowDays(Math.min(365, Math.max(1, Math.floor(n))));
        }
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

  const saveDiscountPolicy = async () => {
    setSavingDiscount(true);
    try {
      if (discMode === "global") {
        await supabase.from("settings").upsert({ key: "discount_policy_global", value: { mode: "global", percent: Number(discGlobalPct) || 0, min_price_floor: minPriceFloor } as any, updated_by: user!.id, updated_at: new Date().toISOString() });
        await supabase.from("settings").upsert({ key: "discount_policy_branches", value: { mode: "global" } as any, updated_by: user!.id, updated_at: new Date().toISOString() });
      } else {
        const cleaned: Record<string, number> = {};
        for (const b of branches) cleaned[b.id] = Number(discBranchPct[b.id] ?? 0) || 0;
        await supabase.from("settings").upsert({ key: "discount_policy_branches", value: { mode: "per_branch", branches: cleaned } as any, updated_by: user!.id, updated_at: new Date().toISOString() });
        await supabase.from("settings").upsert({ key: "discount_policy_global", value: { mode: "per_branch", percent: Number(discGlobalPct) || 0, min_price_floor: minPriceFloor } as any, updated_by: user!.id, updated_at: new Date().toISOString() });
      }
      await logAudit({ userId: user!.id, userName: profile?.name ?? "", action: "UPDATE", entity: "discount_policy", details: { mode: discMode, global: discGlobalPct, branches: discBranchPct } });
      toast.success("تم حفظ إعدادات الخصم");
    } catch (e: any) { toast.error(e.message ?? "خطأ"); }
    finally { setSavingDiscount(false); }
  };

  const saveReturnPolicy = async () => {
    if (!isOwner) return toast.error("هذا الإعداد للمالك فقط");
    const n = Math.min(365, Math.max(1, Math.floor(Number(returnWindowDays) || 20)));
    setSavingReturnPolicy(true);
    try {
      await supabase.from("settings").upsert({
        key: "return_policy",
        value: { days: n } as any,
        updated_by: user!.id,
        updated_at: new Date().toISOString(),
      });
      await logAudit({ userId: user!.id, userName: profile?.name ?? "", action: "UPDATE", entity: "return_policy", details: { days: n } });
      setReturnWindowDays(n);
      toast.success("تم حفظ سياسة الإرجاع");
    } catch (e: any) { toast.error(e.message ?? "خطأ"); }
    finally { setSavingReturnPolicy(false); }
  };



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
      // نفضّي كاش إعدادات الطباعة عشان ملاحظة التذييل واللوجو يظهروا فورًا
      invalidateReceiptSettings();
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
            { v: "discount", icon: Percent, label: "إعدادات الخصم" },
            ...(isOwner || canManageAdminTools ? [{ v: "branch-hours", icon: BellRing, label: "مواعيد الفروع والإجازات" }] : []),
            ...(isOwner || canManageAdminTools ? [{ v: "shift-schedules", icon: Clock, label: "مواعيد الورديات" }] : []),
            ...(isOwner ? [{ v: "return-policy", icon: AlertTriangle, label: "سياسة الإرجاع" }] : []),
            { v: "2fa", icon: ShieldCheck, label: "المصادقة الثنائية" },
            { v: "viewers", icon: Eye, label: "حسابات المراقبة" },
            { v: "security", icon: KeyRound, label: "كلمة المرور" },
            ...(canManageBackup ? [{ v: "backup", icon: DatabaseBackup, label: "نسخة احتياطية" }] : []),
            
            ...(canManageAdminTools ? [{ v: "permissions", icon: Users2, label: "صلاحيات الأدوار" }] : []),
            ...(canManageAdminTools ? [{ v: "user-permissions", icon: Users2, label: "صلاحيات موظف بعينه" }] : []),
            ...(isOwner ? [{ v: "personal-access", icon: Wallet, label: "المصاريف الشخصية" }] : []),
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


        <TabsContent value="shift-schedules" className="mt-4">
          <ShiftSchedulesTab />
        </TabsContent>

        <TabsContent value="branch-hours" className="mt-4">
          <BranchSchedulesTab />
        </TabsContent>

        <TabsContent value="permissions" className="mt-4">
          <RolePermissionsTab />
        </TabsContent>

        {isOwner && (
          <TabsContent value="personal-access" className="mt-4">
            <PersonalExpensesAccessTab />
          </TabsContent>
        )}

        <TabsContent value="user-permissions" className="mt-4">
          <UserPermissionsTab />
        </TabsContent>


        <TabsContent value="discount" className="mt-4">
          <div className="card-elevated p-6 space-y-5 max-w-3xl mx-auto">
            <div className="flex items-start gap-3">
              <Percent className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold">إعدادات الخصم</h3>
                <p className="text-sm text-muted-foreground">حدّد أقصى نسبة خصم يقدر الكاشير يطبّقها بدون موافقة. أي تجاوز يتم إرساله للأدمن.</p>
              </div>
            </div>

            <RadioGroup value={discMode} onValueChange={(v) => setDiscMode(v as any)} className="grid sm:grid-cols-2 gap-2">
              <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${discMode === "global" ? "border-primary bg-primary/5" : ""}`}>
                <RadioGroupItem value="global" />
                <span>نسبة موحدة لكل الفروع</span>
              </label>
              <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${discMode === "per_branch" ? "border-primary bg-primary/5" : ""}`}>
                <RadioGroupItem value="per_branch" />
                <span>نسبة مختلفة لكل فرع</span>
              </label>
            </RadioGroup>

            {discMode === "global" ? (
              <div className="max-w-md">
                <Label>أقصى نسبة خصم لجميع الفروع</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <Input type="number" min={0} max={100} step={0.5} value={discGlobalPct}
                    onChange={(e) => setDiscGlobalPct(Number(e.target.value))} className="text-right" />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {branches.length === 0 && <p className="text-sm text-muted-foreground">لا توجد فروع.</p>}
                {branches.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 p-2 rounded border">
                    <div className="flex-1 font-medium">{b.name} — أقصى خصم مسموح</div>
                    <Input type="number" min={0} max={100} step={0.5} className="w-32 text-right"
                      value={discBranchPct[b.id] ?? 0}
                      onChange={(e) => setDiscBranchPct((s) => ({ ...s, [b.id]: Number(e.target.value) }))} />
                    <span className="text-xs text-muted-foreground w-6">%</span>
                  </div>
                ))}
              </div>
            )}

            <div className="max-w-md pt-2 border-t">
              <Label>الحد الأدنى لسعر البيع (للكاشير)</Label>
              <p className="text-xs text-muted-foreground mt-1">
                الكاشير مش هيقدر يبيع بأقل من الحد ده حتى لو عمل خصم.
              </p>
              <RadioGroup value={minPriceFloor} onValueChange={(v) => setMinPriceFloor(v as any)} className="grid sm:grid-cols-3 gap-2 mt-2">
                <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${minPriceFloor === "cost" ? "border-primary bg-primary/5" : ""}`}>
                  <RadioGroupItem value="cost" /> <span className="text-sm">سعر التكلفة</span>
                </label>
                <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${minPriceFloor === "market" ? "border-primary bg-primary/5" : ""}`}>
                  <RadioGroupItem value="market" /> <span className="text-sm">سعر السوق</span>
                </label>
                <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${minPriceFloor === "none" ? "border-primary bg-primary/5" : ""}`}>
                  <RadioGroupItem value="none" /> <span className="text-sm">بدون حد</span>
                </label>
              </RadioGroup>
            </div>

            <Button onClick={saveDiscountPolicy} disabled={savingDiscount} className="gap-2">
              {savingDiscount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ
            </Button>
          </div>
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
              <Input
                dir="ltr"
                className="text-right mt-1.5"
                placeholder="https://i.ibb.co/xxxxx/logo.png"
                value={company.logo_url}
                onChange={(e) => { setCompany({ ...company, logo_url: e.target.value }); setLogoError(false); }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                ارفع اللوجو على imgbb.com ثم اضغط على الصورة → انسخ <b>Direct link</b> (يبدأ بـ <code>https://i.ibb.co/</code> وينتهي بـ .png أو .jpg). لا تستخدم رابط الصفحة <code>https://ibb.co/...</code>
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="w-[60px] h-[60px] rounded-full border border-border overflow-hidden bg-muted flex items-center justify-center shrink-0">
                  {company.logo_url && !logoError ? (
                    <img
                      key={company.logo_url}
                      src={company.logo_url}
                      alt="logo preview"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={() => setLogoError(true)}
                    />
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  )}
                </div>
                {company.logo_url && logoError ? (
                  <span className="text-xs text-destructive">تعذر تحميل الصورة — تأكد أنه Direct Link لصورة (ينتهي بـ .png/.jpg)</span>
                ) : (
                  <span className="text-xs text-muted-foreground">معاينة الشعار كما سيظهر في الفاتورة</span>
                )}
              </div>
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
            <div className="text-xs text-muted-foreground p-3 rounded-lg bg-surface-2 border border-border">
              💡 شعار الشركة بيظهر تلقائياً في الفاتورة طالما فيه رابط للشعار في تبويب «بيانات الشركة».
              لو الرابط فاضي، اسم الشركة بس هو اللي بيظهر.
            </div>


            <Button onClick={() => saveKey("invoice", invoice)} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ
            </Button>

            <div className="pt-6 mt-2 border-t border-border space-y-3">
              <div>
                <h3 className="font-bold">ضريبة القيمة المضافة</h3>
                <p className="text-xs text-muted-foreground">عند تفعيلها هتظهر كأوبشن في شاشة إصدار الفاتورة، وتقدر تعدّل النسبة من هنا.</p>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-surface-2">
                <Label className="cursor-pointer">تفعيلها افتراضياً</Label>
                <Switch checked={vat.enabled} onCheckedChange={(v) => setVat({ ...vat, enabled: v })} />
              </div>
              <div>
                <Label>نسبة الضريبة %</Label>
                <Input type="number" min={0} max={100} step="0.01"
                  value={vat.rate}
                  onChange={(e) => setVat({ ...vat, rate: Number(e.target.value) || 0 })}
                  className="mt-1.5" />
              </div>
              <Button onClick={() => saveKey("vat", vat)} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ إعدادات الضريبة
              </Button>
            </div>
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
                const { error: upErr } = await (supabase.rpc as any)("apply_low_stock_default", {
                  p_value: Number(inventory.default_low_stock_alert) || 0,
                });
                if (upErr) toast.error("تم حفظ الإعداد لكن فشل التطبيق على المنتجات: " + upErr.message);
                else toast.success("تم التطبيق على كل المنتجات");
              }}
              disabled={saving}
              className="gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ وتطبيق على الكل
            </Button>
            <div className="pt-4 border-t">
              <OrphanedBatchesCheck />
            </div>
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
                <h3 className="font-bold">هدف صافي الربح الشهري (لكل فرع)</h3>
                <p className="text-sm text-muted-foreground">
                  حدّد هدف صافي الربح الشهري للفرع (مش المبيعات). المرتجعات بتتخصم تلقائياً من المحقق.
                  هيظهر مؤشر التقدم في لوحة الفرع. اكتب صفر لتعطيل الهدف.
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

        {canManageBackup && (
          <TabsContent value="backup" className="mt-4">
            <BackupTab />
          </TabsContent>
        )}

        {isOwner && (
          <TabsContent value="return-policy" className="mt-4">
            <div className="card-elevated p-6 space-y-4 max-w-2xl mx-auto">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-warning shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-lg font-bold">سياسة الإرجاع</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    حدد عدد الأيام المسموح فيها بإرجاع المبيعات. بعد انتهاء الفترة يتم منع الكاشير والمدير من عمل مرتجع،
                    ويسمح <b>للمالك فقط</b> بالتجاوز مع تسجيل السبب في سجل التدقيق.
                    <br />
                    <span className="text-xs">استثناءات (لا يتم تطبيق الفترة عليها): الفواتير المرتبطة بخطط تقسيط، الحجوزات المكتملة، معاملات الشركاء.</span>
                  </p>
                </div>
              </div>

              <div className="max-w-xs">
                <Label>عدد الأيام المسموح بها</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <Input
                    type="number" min={1} max={365} className="text-right"
                    value={returnWindowDays}
                    onChange={(e) => setReturnWindowDays(Number(e.target.value))}
                  />
                  <span className="text-xs text-muted-foreground w-12">يوم</span>
                </div>
              </div>

              <Button onClick={saveReturnPolicy} disabled={savingReturnPolicy} className="gap-2">
                {savingReturnPolicy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ
              </Button>
            </div>
          </TabsContent>
        )}

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

        </div>
      </Tabs>


    </AdminLayout>
  );
}
