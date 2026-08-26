import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
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
import { fetchPartnerBalances } from "@/lib/partnerBalances";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, KeyRound, Power, Loader2, Plus, FileText, User, Trash2 } from "lucide-react";
import { downloadPartnerStatementPdf } from "@/lib/partnerStatement";
import { confirmAlert } from "@/components/ConfirmDialog";


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

export default function PartnersList({ embedded }: { embedded?: boolean } = {}) {
  const { tenantId, profile } = useAuth();
  const [rows, setRows] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [partnerCashBranchId, setPartnerCashBranchId] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("branches").select("id").eq("tenant_id", tenantId).eq("code", "PARTNER-CASH").maybeSingle()
      .then(({ data }) => setPartnerCashBranchId((data as any)?.id ?? null));
  }, [tenantId]);

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
  const [autoShare, setAutoShare] = useState(true);
  const [recalcing, setRecalcing] = useState(false);
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
    const balances = await fetchPartnerBalances(tenantId);
    const list = ((data ?? []) as any[]).map((p: any) => ({
      ...p,
      current_balance: balances.get(p.id)?.current_balance ?? 0,
    })) as unknown as Partner[];
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
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_transactions", filter: `tenant_id=eq.${tenantId}` }, load)
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

  /** حساب النسب أوتوماتيك من المبالغ المدفوعة (رأس المال) */
  const activePartners = rows.filter(p => p.is_active);
  const newAmount = Number(form.initial_capital) || 0;
  const autoTotalCapital = activePartners.reduce((s, p) => s + Number(p.initial_capital || 0), 0) + newAmount;
  const autoSharesPreview = autoTotalCapital > 0
    ? [
        ...activePartners.map(p => ({ id: p.id, name: p.name, amount: Number(p.initial_capital || 0), share: Number(p.initial_capital || 0) / autoTotalCapital })),
        ...(newAmount > 0 ? [{ id: "__new__", name: form.name || "الشريك الجديد", amount: newAmount, share: newAmount / autoTotalCapital }] : []),
      ]
    : [];
  const autoNewShare = autoTotalCapital > 0 ? newAmount / autoTotalCapital : 0;

  /** إعادة احتساب نسب كل الشركاء من المبالغ (السيرفر بيظبط فروق التقريب) */
  const applyAutoSharesToExisting = async (pendingCapital = 0) => {
    const { error } = await supabase.rpc("rebalance_partner_shares" as any, {
      _tenant_id: tenantId, _pending_capital: pendingCapital,
    });
    if (error) throw error;
  };


  const recalcShares = async () => {
    const total = activePartners.reduce((s, p) => s + Number(p.initial_capital || 0), 0);
    if (total <= 0) return toast.error("مفيش رؤوس أموال مسجلة للشركاء");
    setRecalcing(true);
    try {
      await applyAutoSharesToExisting();
      toast.success("تم إعادة احتساب النسب من رؤوس الأموال");
      load();
    } catch (e: any) {
      toast.error(e.message || "فشل إعادة الاحتساب");
    } finally {
      setRecalcing(false);
    }
  };

  /** تعديل المبلغ المدفوع لشريك موجود + إعادة توزيع النسب */
  const [editCapital, setEditCapital] = useState<{ id: string; name: string; amount: string } | null>(null);
  const [savingCapital, setSavingCapital] = useState(false);
  const saveCapital = async () => {
    if (!editCapital) return;
    const amt = Number(editCapital.amount);
    if (!(amt >= 0)) return toast.error("المبلغ غير صحيح");
    setSavingCapital(true);
    try {
      const { error } = await supabase.rpc("set_partner_capital" as any, {
        _partner_id: editCapital.id, _amount: amt, _rebalance: true,
      });
      if (error) throw error;
      toast.success("تم تعديل رأس المال وإعادة احتساب نسب كل الشركاء");
      setEditCapital(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "فشل التعديل");
    } finally {
      setSavingCapital(false);
    }
  };

  /** تعديل نسب شريك (رأس المال / التشغيل) يدويًا — الأونر هو اللي بيحدد */
  const [editShares, setEditShares] = useState<{ id: string; name: string; cap: string; op: string } | null>(null);
  const [savingShares, setSavingShares] = useState(false);
  const saveShares = async () => {
    if (!editShares) return;
    const cap = Number(editShares.cap) / 100;
    const op = Number(editShares.op) / 100;
    if (!(cap >= 0 && cap <= 1) || !(op >= 0 && op <= 1)) return toast.error("النسب لازم تكون بين 0% و 100%");
    const othersCap = rows
      .filter((r) => r.id !== editShares.id && r.is_active)
      .reduce((s, r) => s + Number(r.capital_share || 0), 0);
    if (othersCap + cap > 1.0001) {
      return toast.error(`مجموع نسب رأس المال هيتعدى 100% — المتاح لك ${((1 - othersCap) * 100).toFixed(2)}%`);
    }
    setSavingShares(true);
    const { error } = await supabase.from("equity_partners" as any)
      .update({ capital_share: cap, operating_share: op }).eq("id", editShares.id);
    setSavingShares(false);
    if (error) return toast.error(error.message);
    toast.success("تم تعديل النسب");
    setEditShares(null);
    load();
  };



  const submit = async () => {
    // validation
    if (!form.name.trim()) return toast.error("أدخل اسم الشريك");
    const cap = autoShare ? Number(autoNewShare.toFixed(6)) : (Number(form.capital_share) || 0);
    const op = Number(form.operating_share) || 0;
    if (autoShare && newAmount <= 0) return toast.error("أدخل المبلغ المدفوع (رأس المال) عشان النظام يحسب النسبة");
    if (cap < 0 || cap > 1 || op < 0 || op > 1) return toast.error("النسب يجب أن تكون بين 0 و 1");
    if (!autoShare) {
      const manualTotal = activePartners.reduce((s, p) => s + Number(p.capital_share || 0), 0) + cap;
      if (Math.abs(manualTotal - 1) > 0.0001) {
        return toast.error(`مجموع نسب الشركاء لازم يكون 100% بالظبط — المجموع كده ${(manualTotal * 100).toFixed(2)}%`);
      }
    }

    if (!form.username.trim()) return toast.error("أدخل اسم المستخدم");
    if (usernameCheck === "taken") return toast.error("اسم المستخدم مستخدم بالفعل");
    if (form.password !== form.confirm) return toast.error("كلمة المرور غير متطابقة");
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      return toast.error("كلمة المرور يجب 8 أحرف على الأقل + حرف ورقم");
    }

    setSubmitting(true);
    try {
      // في الوضع الأوتوماتيك: نظبط نسب الشركاء الحاليين الأول ونسيب مساحة للشريك الجديد
      if (autoShare && activePartners.length) await applyAutoSharesToExisting(newAmount);
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
      // بعد الإضافة: إعادة احتساب نهائية عشان المجموع يبقى 100% بالظبط
      if (autoShare) await applyAutoSharesToExisting(0).catch(() => {});
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

  const removePartner = async (p: Partner) => {
    const ok = await confirmAlert({
      title: `حذف الشريك "${p.name}" نهائياً؟`,
      description: "هيتم مسح الشريك وحساب دخوله من قاعدة البيانات خالص. لو عليه أي حركات مالية (رأس مال / سلف / أرباح) الحذف هيترفض وتقدر تعطّله بدل الحذف.",
      confirmLabel: "أيوه، احذف",
      cancelLabel: "لأ، سيبه",
      tone: "danger",
    });
    if (!ok) return;
    const { data, error } = await supabase.functions.invoke("admin-delete-partner", {
      body: { partner_id: p.id },
    });
    const errMsg = (data as any)?.error ?? error?.message;
    if (errMsg) return toast.error(errMsg);
    toast.success("تم حذف الشريك نهائياً");
    load();
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

  const typeLabel = (t: string) => t === "capital" ? "رأس مال" : t === "operating" ? "تشغيل" : "رأس مال وتشغيل";
  const typeColor = (t: string) => t === "capital" ? "bg-primary/10 text-primary border-primary/20"
    : t === "operating" ? "bg-warning/10 text-warning border-warning/20"
    : "bg-accent/20 text-accent-foreground border-accent/30";
  const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("");
  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 });

  const totalCapital = rows.reduce((s, p) => s + Number(p.initial_capital || 0), 0);
  const totalBalance = rows.reduce((s, p) => s + Number(p.current_balance || 0), 0);
  const activeCount = rows.filter(p => p.is_active).length;

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <div dir="rtl" className="text-right space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {!embedded && <PageHeader title="الشركاء" subtitle="إدارة الشركاء وحقوقهم وحساباتهم" />}
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {partnerCashBranchId && (
              <Button asChild variant="outline" className="w-full sm:w-auto shadow-sm">
                <Link to={`/branch/${partnerCashBranchId}/treasury`}>
                  <FileText className="w-4 h-4 ml-2" />خزينة الشركاء
                </Link>
              </Button>
            )}
            <Button variant="outline" className="w-full sm:w-auto shadow-sm" onClick={recalcShares} disabled={recalcing}>
              {recalcing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}إعادة احتساب النسب من المبالغ
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto shadow-sm">
              <Link to="/admin/financial-position?tab=advances">سلف الشركاء</Link>
            </Button>
            <Button onClick={() => setOpen(true)} className="w-full sm:w-auto shadow-sm">
              <Plus className="w-4 h-4 ml-2" />إضافة شريك جديد
            </Button>

          </div>
        </div>

        {/* Summary strip */}
        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="border-primary/20"><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">عدد الشركاء</div>
              <div className="text-2xl font-bold mt-1">{rows.length}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">النشطون</div>
              <div className="text-2xl font-bold mt-1 text-success">{activeCount}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">إجمالي رأس المال</div>
              <div className="text-2xl font-bold mt-1 font-mono">{fmt(totalCapital)}</div>
            </CardContent></Card>
            <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20"><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">إجمالي الأرصدة الحالية</div>
              <div className="text-2xl font-bold mt-1 text-primary font-mono">{fmt(totalBalance)}</div>
            </CardContent></Card>
          </div>
        )}

        {loading && (
          <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        )}

        {!loading && rows.length === 0 && (
          <Card><CardContent className="p-10 text-center text-muted-foreground">لا يوجد شركاء</CardContent></Card>
        )}

        {/* Unified card grid — all sizes */}
        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {rows.map(p => (
              <Card key={p.id} className="overflow-hidden group hover:shadow-lg hover:border-primary/30 transition-all duration-200">
                {/* Header band */}
                <div className={`h-1.5 ${p.partner_type === "capital" ? "bg-primary" : p.partner_type === "operating" ? "bg-warning" : "bg-gradient-to-l from-primary to-warning"}`} />
                <CardContent className="p-5 space-y-4">
                  {/* Identity row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground flex items-center justify-center text-lg font-bold shrink-0 shadow-md">
                        {initials(p.name)}
                      </div>
                      <div className="min-w-0">
                        <Link to={`/admin/financial-position/partner/${p.id}`}
                          className="font-bold text-lg hover:text-primary transition-colors block truncate">
                          {p.name}
                        </Link>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant="outline" className={`text-[11px] ${typeColor(p.partner_type)}`}>{typeLabel(p.partner_type)}</Badge>
                          {p.is_active
                            ? <Badge className="bg-success/15 text-success border-0 text-[11px]">● نشط</Badge>
                            : <Badge variant="secondary" className="text-[11px]">معطل</Badge>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Current balance — hero */}
                  <div className="rounded-xl bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 border border-primary/20 p-4">
                    <div className="text-xs text-muted-foreground mb-1">الرصيد الحالي</div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-primary font-mono">{fmt(p.current_balance)}</span>
                      <span className="text-sm text-muted-foreground">ج.م</span>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditShares({ id: p.id, name: p.name, cap: String((Number(p.capital_share) * 100).toFixed(2)), op: String((Number(p.operating_share) * 100).toFixed(2)) })}
                      className="rounded-lg bg-muted/40 p-3 text-center hover:bg-muted transition-colors"
                      title="تعديل النسب"
                    >
                      <div className="text-[11px] text-muted-foreground">حصة رأس المال ✎</div>
                      <div className="font-bold text-base mt-0.5">{(Number(p.capital_share) * 100).toFixed(1)}%</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditShares({ id: p.id, name: p.name, cap: String((Number(p.capital_share) * 100).toFixed(2)), op: String((Number(p.operating_share) * 100).toFixed(2)) })}
                      className="rounded-lg bg-muted/40 p-3 text-center hover:bg-muted transition-colors"
                      title="تعديل النسب"
                    >
                      <div className="text-[11px] text-muted-foreground">حصة التشغيل ✎</div>
                      <div className="font-bold text-base mt-0.5">{(Number(p.operating_share) * 100).toFixed(1)}%</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditCapital({ id: p.id, name: p.name, amount: String(p.initial_capital ?? 0) })}
                      className="rounded-lg bg-muted/40 p-3 text-center hover:bg-muted transition-colors"
                      title="تعديل رأس المال وإعادة احتساب النسب"
                    >
                      <div className="text-[11px] text-muted-foreground">رأس المال ✎</div>
                      <div className="font-bold text-base mt-0.5 font-mono">{fmt(p.initial_capital)}</div>
                    </button>

                  </div>

                  {/* Username */}
                  <div className="flex items-center justify-between text-xs pt-1 border-t">
                    <span className="text-muted-foreground">اسم المستخدم</span>
                    <span className="font-mono font-semibold">{userNames[p.id] ?? "-"}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="default" className="flex-1 min-w-[120px]" asChild>
                      <Link to={`/admin/financial-position/partner/${p.id}`}>
                        <User className="w-4 h-4 ml-1.5" />كشف الحساب
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 min-w-[100px]"
                      onClick={() => downloadPartnerStatementPdf({ partnerId: p.id, branchName: "الشركة", userName: profile?.name ?? "-" })}>
                      <FileText className="w-4 h-4 ml-1.5" />تحميل PDF
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setResetPartner(p)} title="إعادة تعيين كلمة المرور">
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => toggleActive(p)} title={p.is_active ? "تعطيل" : "تفعيل"}>
                      <Power className={`w-4 h-4 ${p.is_active ? "text-success" : "text-muted-foreground"}`} />
                    </Button>
                    <Button size="sm" variant="outline" className="border-destructive/30" onClick={() => removePartner(p)} title="حذف نهائي">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>

                </CardContent>
              </Card>
            ))}
          </div>
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
              <div><Label>المبلغ المدفوع / رأس المال المبدئي (ج.م) *</Label><Input type="number" value={form.initial_capital} onChange={e => setForm({ ...form, initial_capital: e.target.value })} placeholder="مثال: 600000" /></div>

              <label className="flex items-center gap-2 text-sm cursor-pointer bg-muted/40 rounded-md p-2">
                <input type="checkbox" checked={autoShare} onChange={e => setAutoShare(e.target.checked)} className="accent-primary w-4 h-4" />
                <span>احسب نسبة كل شريك أوتوماتيك من المبالغ المدفوعة</span>
              </label>

              {autoShare ? (
                <div className="rounded-md border p-3 space-y-1.5 bg-primary/5">
                  <div className="text-xs text-muted-foreground">إجمالي رأس المال بعد الإضافة: <span className="font-mono font-bold">{fmt(autoTotalCapital)}</span> ج.م</div>
                  {autoSharesPreview.length === 0 && <div className="text-xs text-muted-foreground">أدخل المبلغ المدفوع علشان تظهر النسب</div>}
                  {autoSharesPreview.map(s => (
                    <div key={s.id} className={`flex items-center justify-between text-sm ${s.id === "__new__" ? "font-bold text-primary" : ""}`}>
                      <span>{s.name}</span>
                      <span className="font-mono">{fmt(s.amount)} ج.م — {(s.share * 100).toFixed(2)}%</span>
                    </div>
                  ))}
                  <div className="text-[11px] text-muted-foreground pt-1">هتتحدث نسب الشركاء الحاليين تلقائيًا عند الحفظ.</div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>حصة رأس المال (0-1)</Label><Input type="number" step="0.0001" value={form.capital_share} onChange={e => setForm({ ...form, capital_share: e.target.value })} placeholder="مثال: 0.25" /></div>
                  <div><Label>حصة التشغيل (0-1)</Label><Input type="number" step="0.0001" value={form.operating_share} onChange={e => setForm({ ...form, operating_share: e.target.value })} /></div>
                </div>
              )}
              {autoShare && (
                <div><Label>حصة التشغيل (0-1) — اختياري</Label><Input type="number" step="0.0001" value={form.operating_share} onChange={e => setForm({ ...form, operating_share: e.target.value })} /></div>
              )}

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

      {/* Edit partner capital */}
      <Dialog open={!!editCapital} onOpenChange={() => setEditCapital(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تعديل رأس المال — {editCapital?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>المبلغ المدفوع (ج.م)</Label>
              <Input type="number" value={editCapital?.amount ?? ""} onChange={e => setEditCapital(c => c ? { ...c, amount: e.target.value } : c)} />
            </div>
            <p className="text-xs text-muted-foreground">
              هيتسجل الفرق في كشف حساب الشريك (إيداع أو تخفيض)، وهتتعاد نسب كل الشركاء أوتوماتيك من المبالغ ومجموعها 100% بالظبط.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCapital(null)}>إلغاء</Button>
            <Button onClick={saveCapital} disabled={savingCapital}>
              {savingCapital ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}حفظ وإعادة الاحتساب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Edit partner shares */}
      <Dialog open={!!editShares} onOpenChange={() => setEditShares(null)}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">تعديل النسب</DialogTitle>
            <p className="text-sm text-muted-foreground truncate">{editShares?.name}</p>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-2">
              <Label className="text-xs font-bold text-primary">نسبة رأس المال</Label>
              <div className="relative">
                <Input
                  type="number" step="0.01" inputMode="decimal"
                  className="pe-10 text-lg font-bold h-11 bg-background"
                  value={editShares?.cap ?? ""}
                  onChange={e => setEditShares(c => c ? { ...c, cap: e.target.value } : c)}
                />
                <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm font-bold text-primary">%</span>
              </div>
              <p className="text-[11px] text-muted-foreground">نصيبه من الأرباح حسب مساهمته — مجموع كل الشركاء لازم ميعديش 100%.</p>
            </div>

            <div className="rounded-xl border border-success/25 bg-success/5 p-4 space-y-2">
              <Label className="text-xs font-bold text-success">نسبة التشغيل</Label>
              <div className="relative">
                <Input
                  type="number" step="0.01" inputMode="decimal"
                  className="pe-10 text-lg font-bold h-11 bg-background"
                  value={editShares?.op ?? ""}
                  onChange={e => setEditShares(c => c ? { ...c, op: e.target.value } : c)}
                />
                <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm font-bold text-success">%</span>
              </div>
              <p className="text-[11px] text-muted-foreground">مقابل إدارة الشغل، بتتخصم من صافي الربح قبل التوزيع — وكل الشركاء بيشوفوها.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditShares(null)}>إلغاء</Button>
            <Button onClick={saveShares} disabled={savingShares}>
              {savingShares ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}حفظ النسب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


    </ConditionalLayout>
  );
}

