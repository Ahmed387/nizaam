import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, KeyRound, Power, Loader2, Plus, FileText, User } from "lucide-react";
import { downloadPartnerStatementPdf } from "@/lib/partnerStatement";

type Partner = {
  id: string; name: string; partner_type: string;
  capital_share: number; operating_share: number;
  initial_capital: number; current_balance: number;
  is_active: boolean;
};

function passwordStrength(pw: string): { level: "ضعيفة" | "متوسطة" | "قوية"; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { level: "ضعيفة", color: "text-destructive" };
  if (score <= 2) return { level: "متوسطة", color: "text-warning" };
  return { level: "قوية", color: "text-success" };
}

export default function PartnersList() {
  const { tenantId } = useAuth();
  const [rows, setRows] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("data");
  const [form, setForm] = useState({
    name: "", partner_type: "capital",
    capital_share: "", operating_share: "",
    initial_capital: "",
    username: "", password: "", confirm: "",
    email: "", phone: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successCreds, setSuccessCreds] = useState<{ username: string; password: string } | null>(null);
  const [usernameCheck, setUsernameCheck] = useState<"idle" | "checking" | "taken" | "free">("idle");

  const [resetPartner, setResetPartner] = useState<Partner | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase.from("equity_partners" as any)
      .select("*").eq("tenant_id", tenantId).order("created_at");
    const list = (data ?? []) as unknown as Partner[];
    setRows(list);

    // fetch usernames via partner_users -> profiles
    if (list.length) {
      const { data: links } = await supabase.from("partner_users" as any)
        .select("partner_id, user_id, profiles(username)")
        .in("partner_id", list.map(p => p.id));
      const map: Record<string, string> = {};
      (links ?? []).forEach((l: any) => { map[l.partner_id] = l.profiles?.username ?? "-"; });
      setUserNames(map);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [tenantId]);

  // realtime
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase.channel(`partners-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "equity_partners", filter: `tenant_id=eq.${tenantId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId]);

  // username real-time check
  useEffect(() => {
    if (!form.username || !tenantId) { setUsernameCheck("idle"); return; }
    setUsernameCheck("checking");
    const t = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("id")
        .eq("tenant_id", tenantId).eq("username", form.username).maybeSingle();
      setUsernameCheck(data ? "taken" : "free");
    }, 400);
    return () => clearTimeout(t);
  }, [form.username, tenantId]);

  const submit = async () => {
    // validation
    if (!form.name.trim()) return toast.error("أدخل اسم الشريك");
    const cap = Number(form.capital_share) || 0;
    const op = Number(form.operating_share) || 0;
    if (cap < 0 || cap > 1 || op < 0 || op > 1) return toast.error("النسب يجب أن تكون بين 0 و 1");
    if (!form.username.trim()) return toast.error("أدخل اسم المستخدم");
    if (usernameCheck === "taken") return toast.error("اسم المستخدم مستخدم بالفعل");
    if (form.password !== form.confirm) return toast.error("كلمة المرور غير متطابقة");
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      return toast.error("كلمة المرور يجب 8 أحرف على الأقل + حرف ورقم");
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-partner", {
        body: {
          tenant_id: tenantId,
          partner_name: form.name,
          partner_type: form.partner_type,
          capital_share: cap,
          operating_share: op,
          initial_capital: Number(form.initial_capital) || 0,
          username: form.username,
          password: form.password,
          email: form.email || null,
          phone: form.phone || null,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setSuccessCreds({ username: form.username, password: form.password });
      setForm({ name: "", partner_type: "capital", capital_share: "", operating_share: "", initial_capital: "", username: "", password: "", confirm: "", email: "", phone: "" });
      setTab("data");
      load();
    } catch (e: any) {
      toast.error(e.message || "فشل إنشاء الشريك");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (p: Partner) => {
    const { error } = await supabase.from("equity_partners" as any)
      .update({ is_active: !p.is_active }).eq("id", p.id);
    if (error) toast.error(error.message);
    else { toast.success(p.is_active ? "تم تعطيل الشريك" : "تم تفعيل الشريك"); load(); }
  };

  const doReset = async () => {
    if (!resetPartner) return;
    if (resetPw !== resetConfirm) return toast.error("كلمة المرور غير متطابقة");
    if (resetPw.length < 8 || !/[A-Za-z]/.test(resetPw) || !/[0-9]/.test(resetPw)) {
      return toast.error("كلمة المرور يجب 8 أحرف على الأقل + حرف ورقم");
    }
    const { data, error } = await supabase.functions.invoke("admin-reset-partner-password", {
      body: { partner_id: resetPartner.id, new_password: resetPw },
    });
    if (error || (data as any)?.error) {
      toast.error(error?.message || (data as any)?.error || "فشل التحديث");
    } else {
      toast.success("تم تحديث كلمة المرور. شاركها مع الشريك يدوياً.");
      setResetPartner(null); setResetPw(""); setResetConfirm("");
    }
  };

  const strength = passwordStrength(form.password);

  const typeLabel = (t: string) => t === "capital" ? "رأس مال" : t === "operating" ? "تشغيل" : "الاثنين";
  const typeColor = (t: string) => t === "capital" ? "bg-primary/10 text-primary border-primary/20"
    : t === "operating" ? "bg-warning/10 text-warning border-warning/20"
    : "bg-accent/20 text-accent-foreground border-accent/30";
  const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("");

  return (
    <AdminLayout>
      <div dir="rtl" className="text-right space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <PageHeader title="الشركاء" subtitle="إدارة الشركاء وحقوقهم وحساباتهم" />
          <Button onClick={() => setOpen(true)} className="w-full sm:w-auto">
            <Plus className="w-4 h-4 ml-2" />إضافة شريك جديد
          </Button>
        </div>

        {loading && (
          <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        )}

        {!loading && rows.length === 0 && (
          <Card><CardContent className="p-10 text-center text-muted-foreground">لا يوجد شركاء</CardContent></Card>
        )}

        {/* Mobile / tablet: card grid */}
        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:hidden gap-3">
            {rows.map(p => (
              <Card key={p.id} className="overflow-hidden hover:shadow-md transition-shadow">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0">
                        {initials(p.name)}
                      </div>
                      <div className="min-w-0">
                        <Link to={`/admin/financial-position/partner/${p.id}`} className="font-semibold hover:underline block truncate">{p.name}</Link>
                        <Badge variant="outline" className={`mt-1 text-[10px] ${typeColor(p.partner_type)}`}>{typeLabel(p.partner_type)}</Badge>
                      </div>
                    </div>
                    {p.is_active
                      ? <Badge className="bg-success/15 text-success border-0 shrink-0">نشط</Badge>
                      : <Badge variant="secondary" className="shrink-0">معطل</Badge>}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md bg-muted/40 p-2">
                      <div className="text-muted-foreground">حصة رأس المال</div>
                      <div className="font-semibold text-sm">{(Number(p.capital_share) * 100).toFixed(2)}%</div>
                    </div>
                    <div className="rounded-md bg-muted/40 p-2">
                      <div className="text-muted-foreground">حصة التشغيل</div>
                      <div className="font-semibold text-sm">{(Number(p.operating_share) * 100).toFixed(2)}%</div>
                    </div>
                    <div className="rounded-md bg-muted/40 p-2">
                      <div className="text-muted-foreground">رأس المال</div>
                      <div className="font-semibold text-sm">{Number(p.initial_capital).toLocaleString()}</div>
                    </div>
                    <div className="rounded-md bg-primary/5 border border-primary/10 p-2">
                      <div className="text-muted-foreground">الرصيد الحالي</div>
                      <div className="font-bold text-sm text-primary">{Number(p.current_balance).toLocaleString()}</div>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    <span className="opacity-70">اسم المستخدم: </span>
                    <span className="font-mono">{userNames[p.id] ?? "-"}</span>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1" asChild>
                      <Link to={`/admin/financial-position/partner/${p.id}`}>عرض</Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setResetPartner(p)} title="إعادة تعيين كلمة المرور">
                      <KeyRound className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => toggleActive(p)} title={p.is_active ? "تعطيل" : "تفعيل"}>
                      <Power className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Desktop: table */}
        {!loading && rows.length > 0 && (
          <Card className="hidden xl:block">
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-right">
                    <th className="p-3 font-semibold">الاسم</th>
                    <th className="p-3 font-semibold">النوع</th>
                    <th className="p-3 font-semibold">حصة رأس المال</th>
                    <th className="p-3 font-semibold">حصة التشغيل</th>
                    <th className="p-3 font-semibold">رأس المال</th>
                    <th className="p-3 font-semibold">الرصيد الحالي</th>
                    <th className="p-3 font-semibold">اسم المستخدم</th>
                    <th className="p-3 font-semibold">الحالة</th>
                    <th className="p-3 font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => (
                    <tr key={p.id} className="border-t hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-semibold">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                            {initials(p.name)}
                          </div>
                          <Link className="hover:underline" to={`/admin/financial-position/partner/${p.id}`}>{p.name}</Link>
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={typeColor(p.partner_type)}>{typeLabel(p.partner_type)}</Badge>
                      </td>
                      <td className="p-3 font-mono">{(Number(p.capital_share) * 100).toFixed(2)}%</td>
                      <td className="p-3 font-mono">{(Number(p.operating_share) * 100).toFixed(2)}%</td>
                      <td className="p-3 font-mono">{Number(p.initial_capital).toLocaleString()}</td>
                      <td className="p-3 font-mono font-semibold text-primary">{Number(p.current_balance).toLocaleString()}</td>
                      <td className="p-3 font-mono text-xs">{userNames[p.id] ?? "-"}</td>
                      <td className="p-3">{p.is_active ? <Badge className="bg-success/15 text-success border-0">نشط</Badge> : <Badge variant="secondary">معطل</Badge>}</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" asChild><Link to={`/admin/financial-position/partner/${p.id}`}>عرض</Link></Button>
                          <Button size="sm" variant="outline" onClick={() => setResetPartner(p)} title="كلمة المرور"><KeyRound className="w-3 h-3" /></Button>
                          <Button size="sm" variant="outline" onClick={() => toggleActive(p)} title={p.is_active ? "تعطيل" : "تفعيل"}><Power className="w-3 h-3" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add partner dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader><DialogTitle>إضافة شريك جديد</DialogTitle></DialogHeader>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="data" className="flex-1">بيانات الشريك</TabsTrigger>
              <TabsTrigger value="creds" className="flex-1">بيانات الدخول</TabsTrigger>
            </TabsList>
            <TabsContent value="data" className="space-y-3 mt-4">
              <div><Label>الاسم *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>النوع *</Label>
                <Select value={form.partner_type} onValueChange={v => setForm({ ...form, partner_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="capital">شريك رأس مال</SelectItem>
                    <SelectItem value="operating">شريك تشغيل</SelectItem>
                    <SelectItem value="both">الاثنين</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>حصة رأس المال (0-1)</Label><Input type="number" step="0.0001" value={form.capital_share} onChange={e => setForm({ ...form, capital_share: e.target.value })} placeholder="مثال: 0.25" /></div>
                <div><Label>حصة التشغيل (0-1)</Label><Input type="number" step="0.0001" value={form.operating_share} onChange={e => setForm({ ...form, operating_share: e.target.value })} /></div>
              </div>
              <div><Label>رأس المال المبدئي (ج.م)</Label><Input type="number" value={form.initial_capital} onChange={e => setForm({ ...form, initial_capital: e.target.value })} /></div>
              <div className="flex justify-end">
                <Button onClick={() => setTab("creds")}>التالي: بيانات الدخول</Button>
              </div>
            </TabsContent>
            <TabsContent value="creds" className="space-y-3 mt-4">
              <div>
                <Label>اسم المستخدم *</Label>
                <Input value={form.username} onChange={e => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, "_") })} />
                {usernameCheck === "checking" && <p className="text-xs text-muted-foreground mt-1">جاري التحقق...</p>}
                {usernameCheck === "taken" && <p className="text-xs text-destructive mt-1">اسم المستخدم مستخدم بالفعل</p>}
                {usernameCheck === "free" && <p className="text-xs text-success mt-1">✓ متاح</p>}
              </div>
              <div>
                <Label>كلمة المرور *</Label>
                <div className="relative">
                  <Input type={showPw ? "text" : "password"} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute left-2 top-1/2 -translate-y-1/2">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {form.password && <p className={`text-xs mt-1 font-semibold ${strength.color}`}>القوة: {strength.level}</p>}
              </div>
              <div><Label>تأكيد كلمة المرور *</Label><Input type={showPw ? "text" : "password"} value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>البريد (اختياري)</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                <div><Label>الهاتف (اختياري)</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              إنشاء الشريك
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success credentials */}
      <Dialog open={!!successCreds} onOpenChange={() => setSuccessCreds(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle className="text-success">✅ تم إنشاء حساب الشريك بنجاح</DialogTitle></DialogHeader>
          {successCreds && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">شارك بيانات الدخول مع الشريك يدوياً — لن نعرضها مرة أخرى.</p>
              <div className="p-3 bg-muted rounded flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">اسم المستخدم</div>
                  <div className="font-mono font-bold">{successCreds.username}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(successCreds.username); toast.success("تم النسخ"); }}><Copy className="w-3 h-3" /></Button>
              </div>
              <div className="p-3 bg-muted rounded flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">كلمة المرور</div>
                  <div className="font-mono font-bold">{showPw ? successCreds.password : "•".repeat(successCreds.password.length)}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setShowPw(!showPw)}>{showPw ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}</Button>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(successCreds.password); toast.success("تم النسخ"); }}><Copy className="w-3 h-3" /></Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={() => { setSuccessCreds(null); setOpen(false); }}>تم</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={!!resetPartner} onOpenChange={() => setResetPartner(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>إعادة تعيين كلمة المرور — {resetPartner?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>كلمة المرور الجديدة</Label><Input type="password" value={resetPw} onChange={e => setResetPw(e.target.value)} /></div>
            <div><Label>تأكيد</Label><Input type="password" value={resetConfirm} onChange={e => setResetConfirm(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPartner(null)}>إلغاء</Button>
            <Button onClick={doReset}>تحديث</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
