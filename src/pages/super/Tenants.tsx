import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Search, Power, Building2, AlertOctagon, CheckCircle2, Plus, Copy, ChevronLeft } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { BUSINESS_TYPES, DEFAULT_BUSINESS_TYPE, branchUsage, suggestPassword } from "@/lib/businessTypes";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  is_suspended: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  created_at: string;
  business_type: string | null;
  max_branches: number | null;
  is_test: boolean | null;
}

interface Counts { branches: number; users: number; products: number; }

export default function Tenants() {
  const { user, profile } = useAuth();
  const nav = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "suspended">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const emptyForm = {
    company_name: "", slug: "", admin_name: "", admin_email: "", admin_password: "", branch_name: "",
    business_type: DEFAULT_BUSINESS_TYPE as string, max_branches: "3", is_test: false,
  };
  const [form, setForm] = useState(emptyForm);
  const [suspendTarget, setSuspendTarget] = useState<Tenant | null>(null);
  const [reason, setReason] = useState("");
  // The owner's login is shown ONCE after creating the company (passwords are never stored readable).
  const [createdCreds, setCreatedCreds] = useState<{ company: string; email: string; password: string; limit: number } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tenants")
      .select("id, name, slug, is_active, is_suspended, suspended_at, suspension_reason, created_at, business_type, max_branches, is_test")
      .order("created_at", { ascending: false });
    if (error) { toast.error("فشل تحميل الشركات"); setLoading(false); return; }
    setTenants((data ?? []) as Tenant[]);

    const ids = (data ?? []).map((t: any) => t.id);
    if (ids.length) {
      const [br, us, pr] = await Promise.all([
        supabase.from("branches").select("tenant_id").eq("is_system", false),
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

  // Companies are never deleted (SEC-002): suspension keeps all data. New companies and their
  // owner account are created here only, through the bootstrap-tenant function (super admin only).
  const createTenant = async () => {
    const f = { ...form, slug: form.slug.trim().toLowerCase() };
    if (!f.company_name.trim() || !f.slug || !f.admin_name.trim() || !f.admin_email.trim() || !f.admin_password || !f.business_type.trim()) {
      return toast.error("كل الحقول مطلوبة ما عدا الفرع الأول");
    }
    const limit = Number(f.max_branches);
    if (!Number.isInteger(limit) || limit < 1) return toast.error("عدد الفروع المسموح لازم يكون رقم 1 أو أكتر");
    if (!/^[a-z0-9-]{3,40}$/.test(f.slug)) return toast.error("المعرف: حروف إنجليزية صغيرة وأرقام و- (3 إلى 40)");
    if (f.admin_password.length < 8) return toast.error("كلمة مرور المالك 8 أحرف على الأقل");
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("bootstrap-tenant", {
      body: {
        company_name: f.company_name.trim(), slug: f.slug,
        admin_name: f.admin_name.trim(), admin_email: f.admin_email.trim(), admin_password: f.admin_password,
        branches: f.branch_name.trim() ? [{ name: f.branch_name.trim() }] : [],
        business_type: f.business_type.trim(), max_branches: limit, is_test: f.is_test,
      },
    });
    setCreating(false);
    const errMsg = error?.message || (data as any)?.error;
    if (errMsg) return toast.error("فشل إنشاء الشركة: " + errMsg);
    if (user && profile) {
      await logAudit({
        userId: user.id, userName: profile.name, tenantId: (data as any)?.tenant_id,
        action: "CREATE", entity: "Tenant", entityId: (data as any)?.tenant_id,
        details: { event: "create", tenant: f.company_name.trim(), owner_email: f.admin_email.trim() },
      });
    }
    toast.success(`تم إنشاء شركة "${f.company_name.trim()}" وحساب المالك`);
    setCreatedCreds({ company: f.company_name.trim(), email: f.admin_email.trim(), password: f.admin_password, limit });
    setCreateOpen(false); setForm(emptyForm);
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
      <PageHeader title="إدارة الشركات" subtitle={`إجمالي ${stats.total} • نشطة ${stats.active} • موقوفة ${stats.suspended}`}
        actions={<Button className="btn-gradient" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 ml-1" /> إنشاء شركة جديدة</Button>} />

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
                    {t.is_test && <Badge variant="outline" className="text-xs border-warning text-warning">تجريبية</Badge>}
                    {t.is_suspended ? (
                      <Badge className="bg-destructive text-destructive-foreground">موقوف</Badge>
                    ) : (
                      <Badge className="bg-success text-success-foreground">نشطة</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t.business_type ?? DEFAULT_BUSINESS_TYPE} • {new Date(t.created_at).toLocaleDateString("ar-EG")}
                    {t.is_suspended && t.suspension_reason && <span className="mr-2">• <b>السبب:</b> {t.suspension_reason}</span>}
                  </div>
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="text-center"><div className="font-bold text-primary">{c.users}</div><div className="text-xs text-muted-foreground">مستخدم</div></div>
                  <div className="text-center"><div className="font-bold text-primary tabular-nums">{branchUsage(c.branches, t.max_branches)}</div><div className="text-xs text-muted-foreground">فرع مسموح</div></div>
                  <div className="text-center"><div className="font-bold text-primary">{c.products}</div><div className="text-xs text-muted-foreground">منتج</div></div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => nav(`/super/tenants/${t.id}`)}>
                    فتح الشركة <ChevronLeft className="w-4 h-4 mr-1" />
                  </Button>
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

      {/* Create company + owner (super admin only) */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!creating) setCreateOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إنشاء شركة جديدة</DialogTitle>
            <DialogDescription>بتعمل الشركة وحساب صاحبها. صاحب الشركة هو اللي بيضيف الفروع والموظفين، في حدود عدد الفروع اللي هتحدده.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1"><Label>اسم الشركة</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></div>
            <div className="grid gap-1"><Label>المعرف (slug)</Label><Input dir="ltr" placeholder="nile-trading" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="new-type">نوع الشركة</Label>
                <Input id="new-type" list="business-types" value={form.business_type} onChange={(e) => setForm({ ...form, business_type: e.target.value })} />
                <datalist id="business-types">{BUSINESS_TYPES.map((b) => <option key={b} value={b} />)}</datalist>
                <span className="text-xs text-muted-foreground">اختار من القائمة أو اكتب نوع جديد.</span>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="new-limit">عدد الفروع المسموح</Label>
                <Input id="new-limit" type="number" min={1} dir="ltr" value={form.max_branches} onChange={(e) => setForm({ ...form, max_branches: e.target.value })} />
                <span className="text-xs text-muted-foreground">تقدر تغيّره بعدين.</span>
              </div>
            </div>
            <div className="grid gap-1"><Label>اسم الفرع الأول (اختياري)</Label><Input value={form.branch_name} placeholder="سيبه فاضي لو صاحب الشركة هيضيف الفروع بنفسه" onChange={(e) => setForm({ ...form, branch_name: e.target.value })} /></div>
            <div className="grid gap-1"><Label>اسم المالك</Label><Input value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} /></div>
            <div className="grid gap-1"><Label>إيميل المالك</Label><Input dir="ltr" type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} /></div>
            <div className="grid gap-1">
              <Label>كلمة مرور المالك</Label>
              <div className="flex gap-2">
                <Input dir="ltr" type="text" autoComplete="new-password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} />
                <Button type="button" variant="outline" onClick={() => setForm({ ...form, admin_password: suggestPassword() })}>اقتراح باسورد</Button>
              </div>
              <span className="text-xs text-muted-foreground">8 حروف على الأقل. هتظهرلك مرة واحدة بعد الحفظ عشان تبعتها له.</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_test} onChange={(e) => setForm({ ...form, is_test: e.target.checked })} />
              شركة تجريبية (للاختبار بس)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={creating} onClick={() => setCreateOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" disabled={creating} onClick={createTenant}>
              {creating ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Plus className="w-4 h-4 ml-1" />} إنشاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* The owner's login, shown once */}
      <Dialog open={!!createdCreds} onOpenChange={(o) => !o && setCreatedCreds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-success" /> اتعملت شركة «{createdCreds?.company}»</DialogTitle>
            <DialogDescription>ابعت البيانات دي لصاحب الشركة. هيقدر يضيف لحد {createdCreds?.limit} فروع.</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2 rounded-xl border bg-muted/40 p-4">
            <div className="flex gap-3"><dt className="w-20 text-muted-foreground">الإيميل</dt><dd dir="ltr" className="font-bold">{createdCreds?.email}</dd></div>
            <div className="flex gap-3"><dt className="w-20 text-muted-foreground">الباسورد</dt><dd dir="ltr" className="font-extrabold tracking-wide">{createdCreds?.password}</dd></div>
          </dl>
          <p className="text-sm text-warning">الباسورد ده مش هيظهر تاني. لو اتنسى، افتح الشركة واضغط «تغيير باسورد صاحبها».</p>
          <DialogFooter>
            <Button onClick={async () => {
              if (!createdCreds) return;
              try {
                await navigator.clipboard.writeText(`الإيميل: ${createdCreds.email}\nالباسورد: ${createdCreds.password}`);
                toast.success("اتنسخ");
              } catch { toast.error("مقدرتش أنسخ — انسخهم بإيدك"); }
            }}><Copy className="w-4 h-4 ml-1" /> نسخ الإيميل والباسورد</Button>
            <Button variant="outline" onClick={() => setCreatedCreds(null)}>تمام</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SuperAdminLayout>
  );
}
