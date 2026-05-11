import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { toast } from "sonner";
import { Loader2, Save, Building2, Receipt, Boxes, KeyRound } from "lucide-react";

interface CompanySettings { name: string; address: string; phone: string; tax_number: string; logo_url: string }
interface InvoiceSettings { footer_note: string; show_logo: boolean }
interface InventorySettings { default_low_stock_alert: number }

export default function Settings() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [company, setCompany] = useState<CompanySettings>({ name: "", address: "", phone: "", tax_number: "" });
  const [invoice, setInvoice] = useState<InvoiceSettings>({ footer_note: "", show_logo: true });
  const [inventory, setInventory] = useState<InventorySettings>({ default_low_stock_alert: 5 });

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
        </TabsList>

        <TabsContent value="company" className="mt-4">
          <div className="card-elevated p-6 space-y-4 max-w-2xl">
            <div>
              <Label>اسم الشركة *</Label>
              <Input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} className="mt-1.5" />
              <p className="text-xs text-muted-foreground mt-1">يظهر في الفواتير ورأس التقارير</p>
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
      </Tabs>
    </AdminLayout>
  );
}
