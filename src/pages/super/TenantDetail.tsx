import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeyRound, Loader2, PauseCircle, PlayCircle, Trash2, Power, CheckCircle2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { rpcErrorText } from "@/lib/rpcError";
import { edgeErrorMessage } from "@/lib/edgeError";
import { BUSINESS_TYPES, DEFAULT_BUSINESS_TYPE, suggestPassword } from "@/lib/businessTypes";

interface TenantRow {
  id: string; name: string; slug: string; business_type: string | null; max_branches: number | null;
  is_suspended: boolean; suspension_reason: string | null; is_test: boolean | null; owner_user_id: string | null;
}
interface BranchRow {
  id: string; name: string; code: string; is_active: boolean; platform_paused: boolean;
  platform_paused_reason: string | null; is_system: boolean | null;
}
interface UserRow { id: string; email: string; name: string | null; tenant_id: string | null; roles: string[] }

/** Platform owner: one company — name, type, branch limit, owners, branches (pause / delete-if-empty), pause / delete. */
export default function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { user, profile } = useAuth();
  const [t, setT] = useState<TenantRow | null>(null);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [staff, setStaff] = useState<Record<string, number>>({});
  const [owners, setOwners] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", business_type: DEFAULT_BUSINESS_TYPE as string, max_branches: "3" });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pauseTarget, setPauseTarget] = useState<BranchRow | null>(null);
  const [pauseReason, setPauseReason] = useState("");
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [pwdUser, setPwdUser] = useState<UserRow | null>(null);
  const [pwd, setPwd] = useState("");

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [tRes, bRes, eRes, uRes] = await Promise.all([
      supabase.from("tenants").select("id, name, slug, business_type, max_branches, is_suspended, suspension_reason, is_test, owner_user_id").eq("id", id).maybeSingle(),
      supabase.from("branches").select("id, name, code, is_active, platform_paused, platform_paused_reason, is_system").eq("tenant_id", id).order("created_at"),
      supabase.from("employees").select("branch_id").eq("tenant_id", id),
      supabase.rpc("super_list_users" as any),
    ]);
    const row = (tRes.data as any) as TenantRow | null;
    setT(row);
    if (row) setForm({ name: row.name, business_type: row.business_type ?? DEFAULT_BUSINESS_TYPE, max_branches: String(row.max_branches ?? 3) });
    setBranches(((bRes.data ?? []) as any[]).filter((b) => !b.is_system) as BranchRow[]);
    const c: Record<string, number> = {};
    ((eRes.data ?? []) as any[]).forEach((e) => { if (e.branch_id) c[e.branch_id] = (c[e.branch_id] ?? 0) + 1; });
    setStaff(c);
    const users = ((uRes.data ?? []) as any[]) as UserRow[];
    setOwners(users.filter((u) => u.tenant_id === id && (u.roles ?? []).some((r) => r === "owner" || r === "admin")));
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]);

  const used = branches.length;
  const limitNum = Number(form.max_branches);
  const dirty = useMemo(() => !!t && (form.name.trim() !== t.name || form.business_type.trim() !== (t.business_type ?? "")
    || limitNum !== (t.max_branches ?? 3)), [t, form, limitNum]);

  const save = async () => {
    if (!t) return;
    if (!Number.isInteger(limitNum) || limitNum < 1) return toast.error("عدد الفروع لازم يكون رقم 1 أو أكتر");
    setSaving(true);
    const { error } = await supabase.rpc("super_update_tenant" as any, {
      p_tenant: t.id, p_name: form.name, p_business_type: form.business_type, p_max_branches: limitNum,
    } as any);
    setSaving(false);
    if (error) return toast.error(rpcErrorText(error, "تعديل الشركة"));
    toast.success("اتحفظ");
    load();
  };

  const setPaused = async (b: BranchRow, paused: boolean, reason?: string) => {
    setBusy(b.id);
    const { error } = await supabase.rpc("super_set_branch_paused" as any, { p_branch: b.id, p_paused: paused, p_reason: reason ?? null } as any);
    setBusy(null);
    if (error) return toast.error(rpcErrorText(error, "إيقاف الفرع"));
    toast.success(paused ? `اتوقف فرع ${b.name} — موظفينه مش هيقدروا يدخلوه` : `فرع ${b.name} اشتغل تاني`);
    setPauseTarget(null); setPauseReason("");
    load();
  };

  const deleteBranch = async (b: BranchRow) => {
    setBusy(b.id);
    const { error } = await supabase.rpc("super_delete_branch" as any, { p_branch: b.id } as any);
    setBusy(null);
    if (error) return toast.error(rpcErrorText(error, "حذف الفرع"));
    toast.success(`اتحذف فرع ${b.name}`);
    load();
  };

  const toggleSuspend = async (suspend: boolean) => {
    if (!t) return;
    const payload: any = suspend
      ? { is_suspended: true, suspended_at: new Date().toISOString(), suspension_reason: suspendReason || null }
      : { is_suspended: false, suspended_at: null, suspension_reason: null };
    const { error } = await supabase.from("tenants").update(payload).eq("id", t.id);
    if (error) return toast.error(error.message);
    if (user && profile) {
      await logAudit({ userId: user.id, userName: profile.name, tenantId: t.id, action: "UPDATE", entity: "Tenant", entityId: t.id,
        details: { event: suspend ? "suspend" : "activate", reason: payload.suspension_reason, tenant: t.name } });
    }
    toast.success(suspend ? "اتوقفت الشركة — صاحبها وموظفينها مش هيقدروا يدخلوا" : "الشركة اشتغلت تاني");
    setSuspendOpen(false); setSuspendReason("");
    load();
  };

  const deleteTenant = async () => {
    if (!t) return;
    setBusy("tenant");
    const { error } = await supabase.rpc("super_delete_tenant" as any, { p_tenant: t.id, p_confirm_name: confirmName } as any);
    setBusy(null);
    if (error) return toast.error(rpcErrorText(error, "حذف الشركة"));
    toast.success(`اتحذفت شركة ${t.name}`);
    nav("/super/tenants", { replace: true });
  };

  const setPassword = async () => {
    if (!pwdUser) return;
    if (pwd.length < 8 || !/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd)) return toast.error("الباسورد لازم 8 حروف على الأقل وفيه حرف ورقم");
    setBusy("pwd");
    const { data, error } = await supabase.functions.invoke("super-set-password", { body: { user_id: pwdUser.id, new_password: pwd } });
    setBusy(null);
    if (error || (data as any)?.error) return toast.error((data as any)?.error ?? (await edgeErrorMessage(error, data)) ?? "حصل خطأ");
    try { await navigator.clipboard.writeText(pwd); } catch { /* the password stays on screen to copy by hand */ }
    toast.success("اتغيّر الباسورد واتنسخ — ابعته لصاحب الشركة");
    setPwdUser(null); setPwd("");
  };

  if (loading && !t) {
    return <SuperAdminLayout><div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></SuperAdminLayout>;
  }
  if (!t) {
    return <SuperAdminLayout><div className="card-elevated p-10 text-center text-muted-foreground">الشركة مش موجودة. <Link className="text-primary font-bold" to="/super/tenants">ارجع للشركات</Link></div></SuperAdminLayout>;
  }

  return (
    <SuperAdminLayout>
      <Link to="/super/tenants" className="inline-flex items-center gap-1 text-sm font-semibold text-primary mb-2"><ChevronRight className="w-4 h-4" /> الشركات</Link>
      <PageHeader title={t.name} subtitle={`${t.business_type ?? DEFAULT_BUSINESS_TYPE} • ${used} من ${t.max_branches ?? 3} فروع`} />
      <div className="flex flex-wrap gap-2 mb-4">
        {t.is_suspended ? <Badge className="bg-destructive text-destructive-foreground">موقوفة مؤقتاً</Badge> : <Badge className="bg-success text-success-foreground">شغّالة</Badge>}
        {t.is_test && <Badge variant="outline" className="border-warning text-warning">شركة تجريبية</Badge>}
      </div>

      <section className="card-elevated p-5 mb-5 grid gap-4">
        <h2 className="text-lg font-extrabold">بيانات الشركة</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-1"><Label htmlFor="t-name">اسم الشركة</Label><Input id="t-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid gap-1">
            <Label htmlFor="t-type">النوع</Label>
            <Input id="t-type" list="t-types" value={form.business_type} onChange={(e) => setForm({ ...form, business_type: e.target.value })} />
            <datalist id="t-types">{BUSINESS_TYPES.map((b) => <option key={b} value={b} />)}</datalist>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="t-limit">عدد الفروع المسموح</Label>
            <Input id="t-limit" type="number" min={Math.max(1, used)} dir="ltr" value={form.max_branches} onChange={(e) => setForm({ ...form, max_branches: e.target.value })} />
            <span className="text-xs text-muted-foreground">عندها {used} فروع دلوقتي — العدد ماينفعش يقل عن كده.</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">أصحابها:</span>
          {owners.length === 0 && <span className="text-sm text-muted-foreground">مفيش</span>}
          {owners.map((o) => (
            <span key={o.id} className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1 text-sm font-bold">
              {o.name ?? o.email}
              <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline" onClick={() => { setPwdUser(o); setPwd(suggestPassword()); }}>
                <KeyRound className="w-3.5 h-3.5" /> تغيير الباسورد
              </button>
            </span>
          ))}
          <Button className="mr-auto btn-gradient" disabled={!dirty || saving} onClick={save}>
            {saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />} حفظ
          </Button>
        </div>
      </section>

      <section className="mb-5 grid gap-3">
        <h2 className="text-lg font-extrabold">الفروع ({used} من {t.max_branches ?? 3})</h2>
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="text-start p-3 font-bold">الفرع</th>
                <th className="text-start p-3 font-bold">الكود</th>
                <th className="text-start p-3 font-bold">الموظفين</th>
                <th className="text-start p-3 font-bold">الحالة</th>
                <th className="p-3"><span className="sr-only">إجراءات</span></th>
              </tr>
            </thead>
            <tbody>
              {branches.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">لسه مفيش فروع — صاحب الشركة هو اللي بيضيفها.</td></tr>
              )}
              {branches.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="p-3 font-bold">{b.name}</td>
                  <td className="p-3 font-mono text-muted-foreground" dir="ltr">{b.code}</td>
                  <td className="p-3 tabular-nums">{staff[b.id] ?? 0}</td>
                  <td className="p-3">
                    {b.platform_paused
                      ? <Badge className="bg-destructive text-destructive-foreground" title={b.platform_paused_reason ?? undefined}>موقوف مؤقتاً</Badge>
                      : b.is_active ? <Badge className="bg-success text-success-foreground">شغّال</Badge>
                        : <Badge variant="outline">صاحب الشركة قافله</Badge>}
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      {b.platform_paused ? (
                        <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90" disabled={busy === b.id} onClick={() => setPaused(b, false)}>
                          <PlayCircle className="w-4 h-4 ml-1" /> تشغيل تاني
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled={busy === b.id} onClick={() => { setPauseTarget(b); setPauseReason(""); }}>
                          <PauseCircle className="w-4 h-4 ml-1" /> إيقاف مؤقت
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-destructive border-destructive/40" disabled={busy === b.id}
                        onClick={() => deleteBranch(b)} title="بيتحذف بس لو الفرع فاضي — غير كده يتوقف">
                        <Trash2 className="w-4 h-4 ml-1" /> حذف
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">«حذف» بيشتغل بس لفرع لسه مافيهوش ولا فاتورة ولا فلوس ولا موظفين. اللي فيه شغل بيتوقف بس، وتاريخه بيفضل محفوظ.</p>
      </section>

      <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 grid gap-3">
        <h2 className="text-lg font-extrabold text-destructive">إيقاف أو حذف الشركة</h2>
        <p className="text-sm text-muted-foreground">الإيقاف بيمنع صاحب الشركة وكل موظفينها من الدخول لحد ما تشغّلها تاني. البيانات كلها بتفضل زي ما هي.</p>
        <div className="flex flex-wrap gap-2">
          {t.is_suspended ? (
            <Button className="bg-success text-success-foreground hover:bg-success/90" onClick={() => toggleSuspend(false)}><CheckCircle2 className="w-4 h-4 ml-1" /> تشغيل الشركة تاني</Button>
          ) : (
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => setSuspendOpen(true)}><Power className="w-4 h-4 ml-1" /> إيقاف الشركة مؤقتاً</Button>
          )}
          <Button variant="outline" className="text-destructive border-destructive/40" onClick={() => { setDeleteOpen(true); setConfirmName(""); }}>
            <Trash2 className="w-4 h-4 ml-1" /> حذف الشركة نهائياً
          </Button>
        </div>
      </section>

      <Dialog open={!!pauseTarget} onOpenChange={(o) => !o && setPauseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إيقاف فرع «{pauseTarget?.name}» مؤقتاً</DialogTitle>
            <DialogDescription>موظفين الفرع ده مش هيقدروا يدخلوه، ومحدش هيقدر يسجّل فيه حاجة. صاحب الشركة هيفضل يشوف بياناته. الفروع التانية شغالة عادي.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1"><Label htmlFor="p-reason">السبب (اختياري)</Label><Textarea id="p-reason" value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPauseTarget(null)}>إلغاء</Button>
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={!!busy} onClick={() => pauseTarget && setPaused(pauseTarget, true, pauseReason)}>تأكيد الإيقاف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إيقاف شركة «{t.name}»</DialogTitle>
            <DialogDescription>كل المستخدمين هيتعملهم تسجيل خروج ومش هيقدروا يدخلوا لحد ما تشغّلها تاني. البيانات بتفضل محفوظة.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1"><Label htmlFor="s-reason">السبب (اختياري)</Label><Textarea id="s-reason" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendOpen(false)}>إلغاء</Button>
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => toggleSuspend(true)}>تأكيد الإيقاف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>حذف شركة «{t.name}» نهائياً</DialogTitle>
            <DialogDescription>الحذف مش بيرجع. بيشتغل بس لو الشركة لسه فاضية (مافيهاش فواتير ولا فلوس ولا منتجات ولا موظفين). لو فيها شغل، وقّفها بدل الحذف.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="c-name">اكتب اسم الشركة بالظبط للتأكيد</Label>
            <Input id="c-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={t.name} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>إلغاء</Button>
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={confirmName.trim() !== t.name || busy === "tenant"} onClick={deleteTenant}>
              {busy === "tenant" && <Loader2 className="w-4 h-4 ml-1 animate-spin" />} حذف نهائي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pwdUser} onOpenChange={(o) => { if (!o) { setPwdUser(null); setPwd(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>باسورد جديد لـ {pwdUser?.name ?? pwdUser?.email}</DialogTitle>
            <DialogDescription dir="ltr" className="text-right">{pwdUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input dir="ltr" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" />
            <Button type="button" variant="outline" onClick={() => setPwd(suggestPassword())}>اقتراح</Button>
          </div>
          <p className="text-sm text-muted-foreground">الباسورد القديم هيبطل يشتغل. انسخ الجديد وابعته لصاحب الشركة — مش هيظهر تاني.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdUser(null)}>إلغاء</Button>
            <Button className="btn-gradient" disabled={busy === "pwd"} onClick={setPassword}>{busy === "pwd" && <Loader2 className="w-4 h-4 ml-1 animate-spin" />} حفظ ونسخ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SuperAdminLayout>
  );
}
