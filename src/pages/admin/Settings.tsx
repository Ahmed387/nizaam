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
import { Loader2, Save, Building2, Receipt, Boxes, KeyRound, AlertTriangle, Trash2 } from "lucide-react";

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

  const RESET_OPTIONS: { key: string; label: string }[] = [
    { key: "sales", label: "المبيعات والفواتير" },
    { key: "inventory", label: "المخزون (الكميات فقط — مش المنتجات نفسها)" },
    { key: "shipments", label: "الشحنات" },
    { key: "returns", label: "المرتجعات" },
    { key: "expenses", label: "المصروفات" },
    { key: "treasury", label: "بيانات الخزينة" },
    { key: "stock_movements", label: "سجل حركات المخزون" },
    { key: "customers", label: "بيانات العملاء" },
    { key: "payroll", label: "الرواتب وطلبات السلف" },
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
      const { data } = await supabase.from("settings").select("*");
      for (const row of data ?? []) {
        if (row.key === "company") setCompany(row.value as any);
        if (row.key === "invoice") setInvoice(row.value as any);
        if (row.key === "inventory") setInventory(row.value as any);
      }
      setLoading(false);
    })();
  }, []);

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

      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company"><Building2 className="w-4 h-4 ml-1" /> بيانات الشركة</TabsTrigger>
          <TabsTrigger value="invoice"><Receipt className="w-4 h-4 ml-1" /> الفواتير</TabsTrigger>
          <TabsTrigger value="inventory"><Boxes className="w-4 h-4 ml-1" /> المخزون</TabsTrigger>
          <TabsTrigger value="security"><KeyRound className="w-4 h-4 ml-1" /> كلمة المرور</TabsTrigger>
          {isAdminOnly && <TabsTrigger value="data" className="text-destructive"><Trash2 className="w-4 h-4 ml-1" /> إدارة البيانات</TabsTrigger>}
        </TabsList>

        <TabsContent value="company" className="mt-4">
          <div className="card-elevated p-6 space-y-4 max-w-2xl">
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
          <div className="card-elevated p-6 space-y-4 max-w-2xl">
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
          <div className="card-elevated p-6 space-y-4 max-w-2xl">
            <div>
              <Label>حد التنبيه الافتراضي للمخزون المنخفض</Label>
              <Input type="number" min={0} value={inventory.default_low_stock_alert}
                onChange={(e) => setInventory({ ...inventory, default_low_stock_alert: Number(e.target.value) })}
                className="mt-1.5" />
              <p className="text-xs text-muted-foreground mt-1">القيمة المستخدمة عند إنشاء منتج جديد</p>
            </div>
            <Button onClick={() => saveKey("inventory", inventory)} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <div className="card-elevated p-6 space-y-4 max-w-md">
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
            <div className="card-elevated p-6 space-y-4 max-w-3xl border border-destructive/40">
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
