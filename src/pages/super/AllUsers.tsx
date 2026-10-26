import { useEffect, useState } from "react";
import { PermTable } from "@/components/PermTable";
import { supabase } from "@/integrations/supabase/client";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeyRound, Loader2, Search, User, AlertTriangle } from "lucide-react";
import { ROLE_LABELS, AppRole } from "@/lib/roles";
import { rpcErrorText } from "@/lib/rpcError";
import { edgeErrorMessage } from "@/lib/edgeError";
import { toast } from "sonner";

/** One Auth account (super_list_users, migration 0076): the real login email + company + roles. */
interface Row {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  roles: string[];
  is_active: boolean;
  email_confirmed: boolean;
  last_sign_in_at: string | null;
  created_at: string;
  has_profile: boolean;
  is_partner_login: boolean;
}

export default function AllUsers() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pwdFor, setPwdFor] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase.rpc("super_list_users" as any);
    if (error) { setErr(rpcErrorText(error, "قائمة المستخدمين")); setRows([]); }
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const s = q.trim().toLowerCase();
  const filtered = rows.filter((r) => !s || [r.name, r.username, r.email, r.tenant_name].some((v) => (v ?? "").toLowerCase().includes(s)));

  return (
    <SuperAdminLayout>
      <PageHeader title="كل مستخدمي المنصة" subtitle={`${rows.length} مستخدم`} />

      <div className="card-elevated p-4 mb-4">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم، الإيميل، أو الشركة..." className="pr-10" />
        </div>
      </div>

      {err && <div className="card-elevated p-4 mb-4 text-destructive text-sm">{err}</div>}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (
        <div className="card-elevated overflow-hidden">
          <div className="overflow-x-auto">
            <PermTable className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-right p-3">المستخدم</th>
                  <th className="text-right p-3">إيميل الدخول</th>
                  <th className="text-right p-3">الشركة</th>
                  <th className="text-right p-3">الأدوار</th>
                  <th className="text-right p-3">الحالة</th>
                  <th className="text-right p-3">آخر دخول</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center"><User className="w-4 h-4" /></div>
                        <div>
                          <div className="font-medium">{r.name ?? "—"}</div>
                          {r.username && <div className="text-xs text-muted-foreground" dir="ltr">{r.username}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-xs" dir="ltr">
                      {r.email}
                      {r.is_partner_login && <div className="text-[10px] text-muted-foreground" dir="rtl">حساب شريك — بيدخل بـ «{r.username}»</div>}
                    </td>
                    <td className="p-3">
                      {r.tenant_name ? <span className="font-medium">{r.tenant_name}</span>
                        : <span className="text-destructive text-xs flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> مش مربوط بشركة</span>}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1 flex-wrap">
                        {r.roles.map((role) => (
                          <Badge key={role} variant="outline" className="text-xs">{ROLE_LABELS[role as AppRole] ?? role}</Badge>
                        ))}
                        {r.roles.length === 0 && <span className="text-destructive text-xs">من غير دور</span>}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "نشط" : "معطل"}</Badge>
                      {!r.has_profile && <div className="text-[10px] text-destructive mt-1">مفيش ملف مستخدم</div>}
                    </td>
                    <td className="p-3 text-muted-foreground text-xs">
                      {r.last_sign_in_at ? new Date(r.last_sign_in_at).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "لم يدخل"}
                    </td>
                    <td className="p-3">
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => setPwdFor(r)}><KeyRound className="w-3.5 h-3.5" /> كلمة مرور جديدة</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </PermTable>
            {filtered.length === 0 && !err && <div className="text-center py-12 text-muted-foreground">لا توجد نتائج</div>}
          </div>
        </div>
      )}

      {pwdFor && <SetPasswordDialog row={pwdFor} onClose={() => setPwdFor(null)} onDone={() => { setPwdFor(null); load(); }} />}
    </SuperAdminLayout>
  );
}

function SetPasswordDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [pwd, setPwd] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (pwd.length < 8 || !/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd)) return toast.error("كلمة المرور لازم 8 حروف على الأقل وفيها حرف ورقم");
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("super-set-password", { body: { user_id: row.id, new_password: pwd } });
    setSaving(false);
    if (error || (data as any)?.error) return toast.error((data as any)?.error ?? (await edgeErrorMessage(error, data)) ?? "حصل خطأ");
    toast.success("اتغيرت كلمة المرور — الحساب مفعّل ويقدر يدخل دلوقتي");
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>كلمة مرور جديدة لـ {row.name ?? row.email}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            بيدخل بـ <b dir="ltr">{row.is_partner_login ? row.username : row.email}</b>. الحساب هيتفعّل كمان لو كان موقوف أو الإيميل مش متأكد.
          </p>
          <div><Label>كلمة المرور الجديدة</Label><Input type="text" dir="ltr" value={pwd} onChange={(e) => setPwd(e.target.value)} className="mt-1.5" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "..." : "حفظ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
