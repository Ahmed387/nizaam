import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Search, Power, Trash2, Building2, Pencil } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const PLAN_PRESETS: Record<string, { max_branches: number; max_products: number; max_users: number }> = {
  free: { max_branches: 1, max_products: 100, max_users: 3 },
  pro: { max_branches: 5, max_products: 1000, max_users: 15 },
  enterprise: { max_branches: 999, max_products: 100000, max_users: 999 },
};

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  max_branches: number;
  max_products: number;
  max_users: number;
}

interface Counts {
  branches: number;
  users: number;
  products: number;
}

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [confirmDel, setConfirmDel] = useState<Tenant | null>(null);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [editForm, setEditForm] = useState({ plan: "free", max_branches: 1, max_products: 100, max_users: 3 });
  const [saving, setSaving] = useState(false);

  const openEdit = (t: Tenant) => {
    setEditing(t);
    setEditForm({
      plan: t.plan,
      max_branches: t.max_branches,
      max_products: t.max_products,
      max_users: t.max_users,
    });
  };

  const applyPreset = (plan: string) => {
    const p = PLAN_PRESETS[plan];
    if (p) setEditForm({ plan, ...p });
    else setEditForm((f) => ({ ...f, plan }));
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({
        plan: editForm.plan,
        max_branches: editForm.max_branches,
        max_products: editForm.max_products,
        max_users: editForm.max_users,
      })
      .eq("id", editing.id);
    setSaving(false);
    if (error) return toast.error("فشل الحفظ: " + error.message);
    toast.success("تم تحديث الباقة");
    setEditing(null);
    load();
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tenants")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("فشل تحميل الشركات");
      setLoading(false);
      return;
    }
    setTenants((data ?? []) as Tenant[]);

    // counts per tenant
    const ids = (data ?? []).map((t: any) => t.id);
    if (ids.length) {
      const [br, us, pr] = await Promise.all([
        supabase.from("branches").select("tenant_id"),
        supabase.from("profiles").select("tenant_id"),
        supabase.from("products").select("tenant_id"),
      ]);
      const c: Record<string, Counts> = {};
      ids.forEach((id) => (c[id] = { branches: 0, users: 0, products: 0 }));
      (br.data ?? []).forEach((r: any) => r.tenant_id && c[r.tenant_id] && c[r.tenant_id].branches++);
      (us.data ?? []).forEach((r: any) => r.tenant_id && c[r.tenant_id] && c[r.tenant_id].users++);
      (pr.data ?? []).forEach((r: any) => r.tenant_id && c[r.tenant_id] && c[r.tenant_id].products++);
      setCounts(c);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const toggleActive = async (t: Tenant) => {
    const { error } = await supabase
      .from("tenants")
      .update({ is_active: !t.is_active })
      .eq("id", t.id);
    if (error) return toast.error("فشل التحديث");
    toast.success(t.is_active ? "تم تعطيل الشركة" : "تم تفعيل الشركة");
    load();
  };

  const removeTenant = async (t: Tenant) => {
    const { error } = await supabase.from("tenants").delete().eq("id", t.id);
    if (error) return toast.error("فشل الحذف: " + error.message);
    toast.success("تم حذف الشركة");
    setConfirmDel(null);
    load();
  };

  const filtered = tenants.filter(
    (t) => t.name.toLowerCase().includes(q.toLowerCase()) || t.slug.includes(q.toLowerCase())
  );

  return (
    <SuperAdminLayout>
      <PageHeader title="إدارة الشركات" subtitle={`إجمالي ${tenants.length} شركة`} />

      <div className="card-elevated p-4 mb-4">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث باسم الشركة أو المعرف..."
            className="pr-10"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-elevated p-12 text-center text-muted-foreground">
          <Building2 className="w-12 h-12 mx-auto mb-3 opacity-40" />
          لا توجد شركات
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((t) => {
            const c = counts[t.id] ?? { branches: 0, users: 0, products: 0 };
            return (
              <div key={t.id} className="card-elevated p-4 flex items-center gap-4 flex-wrap">
                <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center shrink-0">
                  <Building2 className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-bold">{t.name}</div>
                    <Badge variant="outline" dir="ltr" className="text-xs">{t.slug}</Badge>
                    <Badge variant={t.is_active ? "default" : "secondary"}>
                      {t.is_active ? "نشطة" : "معطلة"}
                    </Badge>
                    <Badge variant="outline">{t.plan}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(t.created_at).toLocaleDateString("ar-EG")}
                  </div>
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="text-center">
                    <div className="font-bold text-primary">{c.users}</div>
                    <div className="text-xs text-muted-foreground">مستخدم</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-primary">{c.branches}</div>
                    <div className="text-xs text-muted-foreground">فرع</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-primary">{c.products}</div>
                    <div className="text-xs text-muted-foreground">منتج</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
                    <Pencil className="w-4 h-4 ml-1" /> الباقة
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => toggleActive(t)}>
                    <Power className="w-4 h-4 ml-1" />
                    {t.is_active ? "تعطيل" : "تفعيل"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmDel(t)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الشركة "{confirmDel?.name}"؟</AlertDialogTitle>
            <AlertDialogDescription>
              تنبيه: هذا الإجراء لن يحذف بيانات الشركة (الفروع، المنتجات، الفواتير...) — سيحذف فقط
              سجل الشركة. المستخدمون لن يستطيعوا الدخول. للحذف الكامل تواصل مع الدعم.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDel && removeTenant(confirmDel)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل باقة "{editing?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>الباقة</Label>
              <Select value={editForm.plan} onValueChange={applyPreset}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                  <SelectItem value="custom">مخصصة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">حد الفروع</Label>
                <Input
                  type="number" min={1} className="mt-1.5"
                  value={editForm.max_branches}
                  onChange={(e) => setEditForm((f) => ({ ...f, max_branches: +e.target.value || 1 }))}
                />
              </div>
              <div>
                <Label className="text-xs">حد المنتجات</Label>
                <Input
                  type="number" min={1} className="mt-1.5"
                  value={editForm.max_products}
                  onChange={(e) => setEditForm((f) => ({ ...f, max_products: +e.target.value || 1 }))}
                />
              </div>
              <div>
                <Label className="text-xs">حد المستخدمين</Label>
                <Input
                  type="number" min={1} className="mt-1.5"
                  value={editForm.max_users}
                  onChange={(e) => setEditForm((f) => ({ ...f, max_users: +e.target.value || 1 }))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              الحدود تُطبَّق فوراً عند إنشاء عناصر جديدة. العناصر الموجودة لا تتأثر.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button onClick={saveEdit} disabled={saving} className="btn-gradient">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SuperAdminLayout>
  );
}
