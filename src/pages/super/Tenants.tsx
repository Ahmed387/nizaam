import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Search, Power, Trash2, Building2, AlertOctagon, CheckCircle2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  is_suspended: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  created_at: string;
}

interface Counts { branches: number; users: number; products: number; }

export default function Tenants() {
  const { user, profile } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "suspended">("all");
  const [confirmDel, setConfirmDel] = useState<Tenant | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<Tenant | null>(null);
  const [reason, setReason] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tenants")
      .select("id, name, slug, is_active, is_suspended, suspended_at, suspension_reason, created_at")
      .order("created_at", { ascending: false });
    if (error) { toast.error("فشل تحميل الشركات"); setLoading(false); return; }
    setTenants((data ?? []) as Tenant[]);

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

  useEffect(() => { load(); }, []);

  const toggleSuspend = async (t: Tenant, suspend: boolean) => {
    const payload: any = suspend
      ? { is_suspended: true, suspended_at: new Date().toISOString(), suspension_reason: reason || null }
      : { is_suspended: false, suspended_at: null, suspension_reason: null };
    const { error } = await supabase.from("tenants").update(payload).eq("id", t.id);
    if (error) return toast.error(error.message);
    if (user && profile) {
      await logAudit({
        userId: user.id, userName: profile.name, tenantId: t.id,
        action: suspend ? "UPDATE" : "UPDATE", entity: "Tenant", entityId: t.id,
        details: { event: suspend ? "suspend" : "activate", reason: payload.suspension_reason, tenant: t.name },
      });
    }
    toast.success(suspend ? "تم إيقاف الشركة" : "تم تفعيل الشركة");
    setSuspendTarget(null); setReason("");
    load();
  };

  const removeTenant = async (t: Tenant) => {
    const { error } = await supabase.from("tenants").delete().eq("id", t.id);
    if (error) return toast.error("فشل الحذف: " + error.message);
    toast.success("تم حذف الشركة");
    setConfirmDel(null);
    load();
  };

  const filtered = tenants.filter((t) => {
    if (filter === "active" && t.is_suspended) return false;
    if (filter === "suspended" && !t.is_suspended) return false;
    if (q && !t.name.toLowerCase().includes(q.toLowerCase()) && !t.slug.includes(q.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: tenants.length,
    active: tenants.filter((t) => !t.is_suspended).length,
    suspended: tenants.filter((t) => t.is_suspended).length,
  };

  return (
    <SuperAdminLayout>
      <PageHeader title="إدارة الشركات" subtitle={`إجمالي ${stats.total} • نشطة ${stats.active} • موقوفة ${stats.suspended}`} />

      <div className="card-elevated p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم الشركة أو المعرف..." className="pr-10" />
        </div>
        <div className="flex gap-1 flex-wrap">
          {(["all", "active", "suspended"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
              {f === "all" ? `الكل (${stats.total})` : f === "active" ? `نشطة (${stats.active})` : `موقوفة (${stats.suspended})`}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="card-elevated p-12 text-center text-muted-foreground">
          <Building2 className="w-12 h-12 mx-auto mb-3 opacity-40" />لا توجد شركات
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((t) => {
            const c = counts[t.id] ?? { branches: 0, users: 0, products: 0 };
            return (
              <div key={t.id} className={`card-elevated p-4 flex items-center gap-4 flex-wrap ${t.is_suspended ? "border-destructive/40" : ""}`}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${t.is_suspended ? "bg-destructive/15" : "gradient-primary"}`}>
                  {t.is_suspended ? <AlertOctagon className="w-6 h-6 text-destructive" /> : <Building2 className="w-6 h-6 text-white" />}
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-bold">{t.name}</div>
                    <Badge variant="outline" dir="ltr" className="text-xs">{t.slug}</Badge>
                    {t.is_suspended ? (
                      <Badge className="bg-destructive text-destructive-foreground">موقوف</Badge>
                    ) : (
                      <Badge className="bg-success text-success-foreground">نشطة</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(t.created_at).toLocaleDateString("ar-EG")}
                    {t.is_suspended && t.suspension_reason && <span className="mr-2">• <b>السبب:</b> {t.suspension_reason}</span>}
                  </div>
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="text-center"><div className="font-bold text-primary">{c.users}</div><div className="text-xs text-muted-foreground">مستخدم</div></div>
                  <div className="text-center"><div className="font-bold text-primary">{c.branches}</div><div className="text-xs text-muted-foreground">فرع</div></div>
                  <div className="text-center"><div className="font-bold text-primary">{c.products}</div><div className="text-xs text-muted-foreground">منتج</div></div>
                </div>
                <div className="flex gap-2">
                  {t.is_suspended ? (
                    <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90" onClick={() => toggleSuspend(t, false)}>
                      <CheckCircle2 className="w-4 h-4 ml-1" /> تفعيل
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 border-destructive/40"
                      onClick={() => { setSuspendTarget(t); setReason(""); }}>
                      <Power className="w-4 h-4 ml-1" /> إيقاف
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDel(t)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Suspend dialog */}
      <Dialog open={!!suspendTarget} onOpenChange={(o) => !o && setSuspendTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إيقاف شركة "{suspendTarget?.name}"</DialogTitle>
            <DialogDescription>
              ⚠️ كل المستخدمين هيتم تسجيل خروجهم تلقائياً ولن يقدروا يدخلوا حتى التفعيل. البيانات تبقى محفوظة بالكامل.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">سبب الإيقاف (اختياري)</label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: عدم سداد الاشتراك" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendTarget(null)}>إلغاء</Button>
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => suspendTarget && toggleSuspend(suspendTarget, true)}>
              <Power className="w-4 h-4 ml-1" /> تأكيد الإيقاف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الشركة "{confirmDel?.name}"؟</AlertDialogTitle>
            <AlertDialogDescription>
              تنبيه: لن يحذف بيانات الشركة (الفروع، المنتجات، الفواتير...) — سيحذف فقط سجل الشركة. للحذف الكامل تواصل مع الدعم.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDel && removeTenant(confirmDel)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SuperAdminLayout>
  );
}
