import { useEffect, useState } from "react";
import { PartnerLayout } from "@/components/layout/PartnerLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { withPartnerBalance } from "@/lib/partnerBalances";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";

function pwStrength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++; if (/[A-Z]/.test(pw)) s++; if (/[0-9]/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (s <= 1) return { label: "ضعيفة", color: "text-destructive" };
  if (s <= 2) return { label: "متوسطة", color: "text-warning" };
  return { label: "قوية", color: "text-success" };
}

export default function PartnerProfile() {
  const { user, profile } = useAuth();
  const [partner, setPartner] = useState<any>(null);
  const [allPartners, setAllPartners] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(""); const [np, setNp] = useState(""); const [conf, setConf] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: link } = await supabase.from("partner_users" as any).select("partner_id").eq("user_id", user.id).maybeSingle();
      if (!link) return;
      const { data: p } = await supabase.from("equity_partners" as any).select("*").eq("id", (link as any).partner_id).maybeSingle();
      setPartner(await withPartnerBalance(p as any));
      const { data: list } = await supabase.from("equity_partners" as any)
        .select("id,name,partner_type,capital_share,operating_share,is_active")
        .eq("is_active", true).order("created_at");
      setAllPartners((list ?? []) as any[]);
    })();
  }, [user?.id]);


  const submit = async () => {
    if (np !== conf) return toast.error("كلمة المرور غير متطابقة");
    if (np.length < 8 || !/[A-Za-z]/.test(np) || !/[0-9]/.test(np)) return toast.error("كلمة المرور يجب 8 أحرف + حرف ورقم");
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("partner-change-password", {
      body: { current_password: cur, new_password: np },
    });
    setBusy(false);
    const pErr = await edgeErrorMessage(error, data);
    if (pErr) return toast.error(pErr || "فشل التحديث");
    toast.success("تم تغيير كلمة المرور — سيتم تسجيل خروجك خلال 3 ثوان");
    setTimeout(async () => { await supabase.auth.signOut(); window.location.href = "/login"; }, 3000);
  };

  const strength = pwStrength(np);
  const fmt = (n: number) => Number(n || 0).toLocaleString("en-EG");

  return (
    <PartnerLayout>
      <div dir="rtl" className="text-right space-y-4">
        <PageHeader title="الملف الشخصي" subtitle="بياناتك وإعدادات الأمان" />

        <Card>
          <CardHeader><CardTitle>بياناتي</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-muted-foreground">الاسم</div><div className="font-semibold">{profile?.name ?? "-"}</div></div>
            <div><div className="text-muted-foreground">اسم المستخدم</div><div className="font-mono font-semibold">{profile?.username ?? "-"}</div></div>
            <div><div className="text-muted-foreground">البريد</div><div>{user?.email ?? "-"}</div></div>
            {partner && <>
              <div><div className="text-muted-foreground">حصة رأس المال</div><div className="font-semibold">{(Number(partner.capital_share) * 100).toFixed(2)}%</div></div>
              <div><div className="text-muted-foreground">حصة التشغيل</div><div className="font-semibold">{(Number(partner.operating_share) * 100).toFixed(2)}%</div></div>
              <div><div className="text-muted-foreground">رأس المال المبدئي</div><div className="font-semibold">{fmt(partner.initial_capital)} ج.م</div></div>
              <div><div className="text-muted-foreground">تاريخ الانضمام</div><div>{new Date(partner.created_at).toLocaleDateString("en-EG")}</div></div>
            </>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>نِسب الشركاء</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-right">
                  <th className="p-2">الشريك</th>
                  <th className="p-2">نسبة رأس المال</th>
                  <th className="p-2">نسبة التشغيل</th>
                </tr>
              </thead>
              <tbody>
                {allPartners.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">لا يوجد</td></tr>}
                {allPartners.map((p) => (
                  <tr key={p.id} className={`border-t ${p.id === partner?.id ? "bg-primary/5 font-semibold" : ""}`}>
                    <td className="p-2">{p.name}{p.id === partner?.id ? " (أنا)" : ""}</td>
                    <td className="p-2 font-mono">{(Number(p.capital_share) * 100).toFixed(2)}%</td>
                    <td className="p-2 font-mono">{(Number(p.operating_share) * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="p-3 text-xs text-muted-foreground">
              نسبة التشغيل بتتاخد من صافي الربح مقابل إدارة الشغل قبل ما الباقي يتقسم بنِسب رأس المال — معروضة لكل الشركاء للشفافية.
            </p>
          </CardContent>
        </Card>


        <Card>
          <CardHeader><CardTitle>الأمان</CardTitle></CardHeader>
          <CardContent>
            <Button onClick={() => setOpen(true)}><KeyRound className="w-4 h-4 ml-2" />تغيير كلمة المرور</Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تغيير كلمة المرور</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>كلمة المرور الحالية</Label><Input type="password" value={cur} onChange={e => setCur(e.target.value)} /></div>
            <div><Label>كلمة المرور الجديدة</Label><Input type="password" value={np} onChange={e => setNp(e.target.value)} />
              {np && <p className={`text-xs mt-1 font-semibold ${strength.color}`}>القوة: {strength.label}</p>}
            </div>
            <div><Label>تأكيد كلمة المرور</Label><Input type="password" value={conf} onChange={e => setConf(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin ml-2" />}تحديث</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PartnerLayout>
  );
}
