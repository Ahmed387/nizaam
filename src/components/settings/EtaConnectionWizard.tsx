// «الربط مع منظومة الفاتورة الإلكترونية» — step-by-step wizard (migrations 0220 / 0221, owner 2026-11-15 «ويكون في رسالة
// بتوجهنا في كل خطوة … ده saas system»). Every company connects ITS OWN ETA account: the settings row is per tenant, the
// secret goes to Supabase Vault and never comes back to the browser. Receive only — nothing is sent to the ETA.
// Steps: 1 open the portal · 2 register an ERP system · 3 paste Client ID / Secret · 4 test the connection · 5 switch on.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { CheckCircle2, Circle, ExternalLink, Loader2, PlugZap, ShieldAlert, Info } from "lucide-react";
import { rpcErrorText } from "@/lib/rpcError";
import { etaStepState, ETA_PORTAL, type EtaSettings } from "@/lib/etaWizard";

const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }) : "لسه");

function Tip({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" | "ok" | "err" }) {
  const cls = {
    info: "bg-primary/5 border-primary/20",
    warn: "bg-warning/10 border-warning/30",
    ok: "bg-success/10 border-success/30 text-success",
    err: "bg-destructive/10 border-destructive/30 text-destructive",
  }[tone];
  const Icon = tone === "warn" || tone === "err" ? ShieldAlert : tone === "ok" ? CheckCircle2 : Info;
  return <div className={`flex gap-2 rounded-md border p-3 text-sm leading-6 ${cls}`}><Icon className="w-4 h-4 mt-1 shrink-0" /><div>{children}</div></div>;
}

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-4 ${active ? "border-primary shadow-sm" : done ? "opacity-90" : "opacity-60"}`}>
      <div className="flex items-center gap-2 font-semibold mb-2">
        {done ? <CheckCircle2 className="w-5 h-5 text-success" /> : <Circle className={`w-5 h-5 ${active ? "text-primary" : "text-muted-foreground"}`} />}
        <span>الخطوة {n}: {title}</span>
      </div>
      {(active || done) && <div className="space-y-3 pr-7">{children}</div>}
    </div>
  );
}

export function EtaConnectionWizard({ onChanged }: { onChanged?: () => void }) {
  const { tenantId } = useAuth();
  const [s, setS] = useState<EtaSettings | null>(null);
  const [portalOpened, setPortalOpened] = useState(false);
  const [erpDone, setErpDone] = useState(false);
  const [form, setForm] = useState({ client_id: "", client_secret: "", env: "prod" as "prod" | "preprod" });
  const [busy, setBusy] = useState<"" | "save" | "test" | "enable">("");

  const load = async () => {
    const { data, error } = await supabase.rpc("eta_settings_get" as any);
    if (error) { toast.error(rpcErrorText(error)); return; }
    const v = data as EtaSettings;
    setS(v);
    setForm(f => ({ ...f, client_id: v.client_id ?? "", env: v.env, client_secret: "" }));
  };
  useEffect(() => { if (tenantId) load(); }, [tenantId]);

  if (!s) return <div className="p-6 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  if (!s.is_owner) return <Tip tone="warn">الربط مع منظومة الضرايب بيعمله مالك الشركة بس.</Tip>;

  const st = etaStepState(s, { portalOpened, erpDone });
  const portal = ETA_PORTAL[form.env];

  const save = async (enabled: boolean, kind: "save" | "enable") => {
    setBusy(kind);
    const { error } = await supabase.rpc("eta_save_settings" as any, {
      p_client_id: form.client_id, p_client_secret: form.client_secret || null, p_env: form.env, p_enabled: enabled,
    });
    setBusy("");
    if (error) { toast.error(rpcErrorText(error)); return false; }
    await load(); onChanged?.();
    return true;
  };

  const test = async () => {
    setBusy("test");
    const { data, error } = await supabase.functions.invoke("eta-sync", { body: { mode: "test" } });
    setBusy("");
    if (error) toast.error("الاختبار ماكملش — جرّب تاني");
    else if ((data as any)?.ok) toast.success("الاتصال نجح ✓");
    else toast.error((data as any)?.error ?? "الاتصال فشل");
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PlugZap className="w-5 h-5" />الربط مع منظومة الفاتورة الإلكترونية (استقبال بس)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tip>
          الربط ده بيخلي السيستم يشوف كل فاتورة مورد اتسجلت على منظومة الضرايب باسم شركتك، ويبعتلك إشعار بيها.
          <b> السيستم مش بيبعت أي حاجة للضرايب</b> ومش بيغيّر خزنة ولا مخزون ولا حسابات. كل شركة على السيستم بتربط حسابها هي بس.
        </Tip>

        <Step n={1} title="ادخل بوابة الفاتورة الإلكترونية" done={st.done[1]} active={st.current === 1}>
          <div className="space-y-2">
            <Label>هتربط على أنهي بيئة؟</Label>
            <RadioGroup value={form.env} onValueChange={v => setForm({ ...form, env: v as "prod" | "preprod" })} className="flex gap-6">
              <label className="flex items-center gap-2"><RadioGroupItem value="prod" />الحقيقية (الفواتير الفعلية)</label>
              <label className="flex items-center gap-2"><RadioGroupItem value="preprod" />التجريبية (للتجربة بس)</label>
            </RadioGroup>
          </div>
          <Tip>
            افتح البوابة وادخل بحساب الشركة اللي عليه صلاحية <b>المسؤول (Admin)</b> — نفس الحساب اللي بتسجّل بيه الفواتير.
            لو معندكش حساب، المحاسب أو المفوّض عن الشركة هو اللي معاه.
          </Tip>
          <Button variant="outline" asChild onClick={() => setPortalOpened(true)}>
            <a href={portal} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4 ml-2" />افتح البوابة ({portal.replace("https://", "")})</a>
          </Button>
          {!st.done[1] && <Button variant="ghost" size="sm" onClick={() => setPortalOpened(true)}>دخلت خلاص ← الخطوة اللي بعدها</Button>}
        </Step>

        <Step n={2} title="سجّل «نظام ERP» جديد على البوابة" done={st.done[2]} active={st.current === 2}>
          <ol className="list-decimal pr-5 text-sm space-y-1 leading-6">
            <li>من فوق اضغط على اسم الشركة ← <b>بيانات الممول (Taxpayer Profile)</b>.</li>
            <li>افتح تبويب <b>أنظمة ERP</b> واضغط <b>تسجيل ERP (Register ERP)</b>.</li>
            <li>اكتب اسم النظام: <b>نظام</b> — والمدة اللي يفضل فيها شغّال (اختار أطول مدة متاحة).</li>
            <li>احفظ، والبوابة هتظهرلك <b>Client ID</b> و <b>Client Secret</b>.</li>
          </ol>
          <Tip tone="warn">
            الـ <b>Client Secret بيظهر مرة واحدة بس</b> — انسخه فورًا. لو ضاع، من نفس الصفحة اعمل «توليد سر جديد» (Regenerate) وحطّ الجديد هنا.
            متبعتوش لحد في شات أو واتساب أو إيميل.
          </Tip>
          {!st.done[2] && <Button variant="ghost" size="sm" onClick={() => setErpDone(true)}>معايا الـ Client ID والـ Secret ← الخطوة اللي بعدها</Button>}
        </Step>

        <Step n={3} title="حطّ Client ID و Client Secret هنا" done={st.done[3]} active={st.current === 3}>
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label>Client ID</Label><Input dir="ltr" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} placeholder="مثال: 0a1b2c3d-…" /></div>
            <div>
              <Label>Client Secret {s.has_secret && <span className="text-muted-foreground text-xs">(محفوظ — سيبه فاضي لو مش هتغيّره)</span>}</Label>
              <Input dir="ltr" type="password" autoComplete="new-password" value={form.client_secret} onChange={e => setForm({ ...form, client_secret: e.target.value })} />
            </div>
          </div>
          <Tip>الـ Secret بيتحفظ مشفّر ومحدش يقدر يشوفه تاني ولا حتى من السيستم — بيتستخدم بس عشان نكلّم الضرايب.</Tip>
          <Button onClick={() => save(false, "save")} disabled={!!busy || !form.client_id || (!s.has_secret && !form.client_secret)}>
            {busy === "save" && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}احفظ
          </Button>
        </Step>

        <Step n={4} title="اختبر الاتصال" done={st.done[4]} active={st.current === 4}>
          <Tip>هنكلّم منظومة الضرايب بالبيانات اللي حفظتها ونتأكد إن الدخول شغّال وإن النظام يقدر يقرا الفواتير الواردة. مش هيتسجّل أي حاجة.</Tip>
          <Button onClick={test} disabled={!!busy}>{busy === "test" && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}اختبر الاتصال</Button>
          {s.connection_ok_at && <Tip tone="ok">الاتصال نجح ({when(s.connection_ok_at)}).</Tip>}
          {!s.connection_ok_at && s.connection_error && (
            <Tip tone="err">
              <div>الاختبار فشل: {s.connection_error}</div>
              <div className="text-foreground mt-1">راجع إن الـ Client ID والـ Secret منسوخين صح من غير مسافات، وإن البيئة (حقيقية / تجريبية) هي نفس اللي سجّلت فيها النظام، وبعدين احفظ واختبر تاني.</div>
            </Tip>
          )}
        </Step>

        <Step n={5} title="شغّل الاستقبال" done={st.done[5]} active={st.current === 5}>
          <div className="flex items-center gap-3">
            <Switch checked={s.enabled} disabled={!!busy || !s.connection_ok_at} onCheckedChange={async v => {
              if (await save(v, "enable")) toast.success(v ? "الاستقبال اشتغل — أول تحديث خلال ساعة" : "الاستقبال اتوقف");
            }} />
            <Label>استقبل الفواتير الواردة كل ساعة وابعتلي إشعار بكل فاتورة جديدة</Label>
          </div>
          {s.enabled && (
            <Tip tone="ok">
              شغّال. آخر تحديث: {when(s.last_sync_at)} — الفواتير اللي وصلت: {s.documents}.
              {" "}<Link className="underline" to="/admin/eta-invoices">افتح الفواتير الواردة</Link>
              {s.last_error && <div className="text-destructive mt-1">آخر مشكلة في التحديث: {s.last_error}</div>}
            </Tip>
          )}
          <Tip>أول مرة بيجيب فواتير آخر 30 يوم، وبعد كده كل ساعة بيجيب الجديد ويحدّث حالة اللي اتلغت أو اترفضت.</Tip>
        </Step>
      </CardContent>
    </Card>
  );
}
