/**
 * Settings → «صاحب الشركة وتليجرام» (migrations 0237 / 0240, owner 2026-11-16): the owner's name / mobile / e-mail,
 * the company's Telegram GROUP (received e-invoices — the owner adds his employees to it in Telegram) and the owner's
 * own Telegram (the daily activity report, which is about the employees, so never the group).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Link2, Unlink, Save, CheckCircle2, AlertTriangle, Copy, MessageCircle, ExternalLink } from "lucide-react";
import { tgInviteCode, tgTimeLeft, tgWhatsappHref } from "@/lib/telegramInvite";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { rpcErrorText } from "@/lib/rpcError";

export interface OwnerContact {
  owner_name: string | null; owner_phone: string | null; owner_email: string | null;
  tg_linked: boolean; tg_username: string | null; tg_linked_at: string | null;
  group_linked: boolean; group_title: string | null; group_linked_at: string | null;
  tg_last_error: string | null; tg_last_error_at: string | null; tg_last_sent_at: string | null;
  bot_ready: boolean; bot_username: string | null; is_owner: boolean;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit" }) : "—";

export default function OwnerContactTelegram() {
  const [data, setData] = useState<OwnerContact | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState<"" | "save" | "link" | "unlink" | "test">("");
  const [waiting, setWaiting] = useState<"" | "owner" | "group">("");
  const poll = useRef<number | null>(null);
  // the personal link once made: shown as buttons the owner taps himself (a phone blocks a window opened after a wait)
  const [invite, setInvite] = useState<{ purpose: "owner" | "group"; url: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!invite) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [invite]);
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`اتنسخ ${what}`); } catch { toast.error("مقدرتش أنسخ — علّم على النص وانسخه بإيدك"); }
  };

  const load = useCallback(async () => {
    const { data: d, error } = await (supabase.rpc as any)("owner_contact_get");
    if (error) { toast.error(rpcErrorText(error)); return null; }
    setData(d as OwnerContact);
    return d as OwnerContact;
  }, []);

  useEffect(() => {
    load().then((d) => d && setForm({ name: d.owner_name ?? "", phone: d.owner_phone ?? "", email: d.owner_email ?? "" }));
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, [load]);

  const save = async () => {
    setBusy("save");
    const { data: d, error } = await (supabase.rpc as any)("owner_contact_save", { p_name: form.name, p_phone: form.phone, p_email: form.email });
    setBusy("");
    if (error) return toast.error(rpcErrorText(error));
    setData(d as OwnerContact);
    toast.success("اتحفظت بيانات صاحب الشركة");
  };

  const link = async (purpose: "owner" | "group") => {
    setBusy("link");
    const { data: d, error } = await (supabase.rpc as any)("tg_link_start", { p_purpose: purpose });
    setBusy("");
    if (error) return toast.error(rpcErrorText(error));
    const url = (d as any).url as string;
    setInvite({ purpose, url, expiresAt: Date.now() + Number((d as any).expires_in ?? 900) * 1000 });
    if (purpose === "group") window.open(url, "_blank", "noopener");
    setWaiting(purpose);
    // wait for the bot to confirm (≤ 15 min, the code's life)
    let n = 0;
    if (poll.current) window.clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      n++;
      const cur = await load();
      const done = purpose === "group" ? cur?.group_linked : cur?.tg_linked;
      if (done || n > 180) {
        if (poll.current) window.clearInterval(poll.current);
        poll.current = null;
        setWaiting("");
        if (done) { setInvite(null); toast.success(purpose === "group" ? "تم ربط جروب الفواتير" : "تم ربط تليجرامك"); }
      }
    }, 5000);
  };

  const unlink = async (which: "owner" | "group") => {
    if (!window.confirm(which === "group" ? "تفك ربط جروب الفواتير؟ الفواتير هتوصل لتليجرامك الشخصي لو مربوط." : "تفك ربط تليجرامك؟ التقرير اليومي مش هيوصلك.")) return;
    setBusy("unlink");
    const { data: d, error } = await (supabase.rpc as any)("tg_unlink", { p_which: which });
    setBusy("");
    if (error) return toast.error(rpcErrorText(error));
    setData(d as OwnerContact);
  };

  const test = async () => {
    setBusy("test");
    const { data: d, error } = await supabase.functions.invoke("telegram", { body: { mode: "test" } });
    setBusy("");
    if (error || !(d as any)?.ok) return toast.error((d as any)?.error ?? rpcErrorText(error));
    toast.success("اتبعتت رسالة تجربة — شوف تليجرام");
    load();
  };

  if (!data) return <div className="flex justify-center p-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  const owner = data.is_owner;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>بيانات صاحب الشركة</CardTitle>
          <CardDescription>الاسم والموبايل والإيميل اللي بنتواصل بيهم مع صاحب الشركة.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div><Label>الاسم</Label><Input value={form.name} disabled={!owner} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>الموبايل</Label><Input dir="ltr" value={form.phone} disabled={!owner} placeholder="01xxxxxxxxx" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><Label>الإيميل</Label><Input dir="ltr" type="email" value={form.email} disabled={!owner} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          {owner && (
            <div className="sm:col-span-3">
              <Button onClick={save} disabled={busy !== ""}>{busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>تنبيهات تليجرام (مجانًا)</CardTitle>
          <CardDescription>
            جروب الفواتير: أي فاتورة إلكترونية أو إشعار دائن / مدين يتقبل (Valid) على المنظومة بينزل فيه بملخصه وملف الـ PDF، وإنت اللي
            بتضيف موظفينك للجروب من تليجرام. تليجرامك الشخصي: تقرير نشاط الموظفين الساعة 11:15 بالليل (ليك لوحدك، مش في الجروب).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!data.bot_ready && (
            <div className="flex items-center gap-2 rounded-md bg-warning/10 p-3 text-warning">
              <AlertTriangle className="w-4 h-4" /> بوت التليجرام لسه مش متجهز من إدارة المنصة.
            </div>
          )}

          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2 font-bold">
              جروب الفواتير الإلكترونية
              {data.group_linked ? <Badge className="bg-success/15 text-success border-success/30">مربوط</Badge> : <Badge variant="outline">مش مربوط</Badge>}
            </div>
            {data.group_linked ? (
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-success" /> «{data.group_title ?? "الجروب"}» من {when(data.group_linked_at)}</div>
            ) : (
              <ol className="list-decimal pr-5 space-y-1 text-muted-foreground">
                <li>اعمل جروب على تليجرام (مثلاً «فواتير الشركة») وضيف فيه الموظفين اللي عاوزهم يشوفوا الفواتير.</li>
                <li>دوس «اربط جروب الفواتير» — تليجرام هيسألك تضيف البوت{data.bot_username ? ` (@${data.bot_username})` : ""} لأنهي جروب: اختار الجروب.</li>
                <li>ارجع هنا — هيظهر «مربوط» لوحده، والبوت هيكتب في الجروب إنه اتربط.</li>
              </ol>
            )}
            {owner && (
              <div className="flex flex-wrap gap-2">
                {!data.group_linked ? (
                  <Button onClick={() => link("group")} disabled={!data.bot_ready || busy !== "" || waiting !== ""}>
                    {waiting === "group" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    {waiting === "group" ? "مستني تختار الجروب في تليجرام…" : "اربط جروب الفواتير"}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => unlink("group")} disabled={busy !== ""}><Unlink className="w-4 h-4" /> فك ربط الجروب</Button>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2 font-bold">
              تليجرامك الشخصي (التقرير اليومي)
              {data.tg_linked ? <Badge className="bg-success/15 text-success border-success/30">مربوط</Badge> : <Badge variant="outline">مش مربوط</Badge>}
            </div>
            {data.tg_linked ? (
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-success" /> مربوط{data.tg_username ? ` بحساب @${data.tg_username}` : ""} من {when(data.tg_linked_at)}</div>
            ) : (
              <div className="space-y-2 text-muted-foreground" data-testid="tg-owner-steps">
                <p>التقرير بيوصل لأي حد يدوس <b>Start</b> باللينك — على الموبايل ده، أو على موبايل صاحب الشركة لو بعتهوله.</p>
                <ol className="list-decimal pr-5 space-y-1">
                  <li>دوس «جهّز لينك الربط» تحت.</li>
                  <li><b>لو التقرير ليك وتليجرام على الموبايل ده:</b> دوس «افتح تليجرام» ← هتفتح محادثة البوت{data.bot_username ? ` (@${data.bot_username})` : ""} ← دوس <b>Start</b> (أو «ابدأ») تحت الشاشة.</li>
                  <li><b>لو التقرير لصاحب الشركة على موبايل تاني:</b> دوس «ابعت اللينك واتساب» (أو «انسخ اللينك» وابعته بأي طريقة) ← يفتحه على موبايله ويدوس <b>Start</b>.</li>
                  <li>اللينك شغال <b>15 دقيقة</b> ولمرة واحدة. لو خلص، دوس «جهّز لينك الربط» تاني.</li>
                  <li>الصفحة هتكتب «مربوط» لوحدها. بعدها دوس «ابعت رسالة تجربة» وتأكد إنها وصلت.</li>
                </ol>
                <p className="text-xs">لو تليجرام اتفتح ومفيش زرار Start: ابعت للبوت الرسالة اللي هتظهر تحت (‎/start‎ والكود) زي ما هي.</p>
              </div>
            )}
            {owner && !data.tg_linked && invite?.purpose === "owner" && (() => {
              const left = tgTimeLeft(invite.expiresAt, now);
              const code = tgInviteCode(invite.url);
              if (!left) return (
                <div className="rounded-md bg-warning/10 p-2 text-warning">اللينك خلص (عدّى 15 دقيقة) — دوس «جهّز لينك الربط» تاني.</div>
              );
              return (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="tg-owner-invite">
                  <div className="text-xs text-muted-foreground">اللينك جاهز — باقي <b className="tabular-nums">{left}</b> دقيقة</div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm"><a href={invite.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" /> افتح تليجرام</a></Button>
                    <Button asChild size="sm" variant="outline" className="border-success text-success hover:bg-success/10">
                      <a href={tgWhatsappHref(invite.url, data.owner_phone)} target="_blank" rel="noopener noreferrer"><MessageCircle className="w-4 h-4" /> ابعت اللينك واتساب</a>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => copy(invite.url, "اللينك")}><Copy className="w-4 h-4" /> انسخ اللينك</Button>
                  </div>
                  <div className="text-xs break-all" dir="ltr">{invite.url}</div>
                  {code && (
                    <div className="flex items-center gap-2 text-xs">
                      <span>لو مفيش Start، ابعت للبوت:</span>
                      <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5">/start {code}</code>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copy(`/start ${code}`, "الرسالة")}><Copy className="w-3.5 h-3.5" /></Button>
                    </div>
                  )}
                </div>
              );
            })()}
            {owner && (
              <div className="flex flex-wrap gap-2">
                {!data.tg_linked ? (
                  <Button variant="outline" onClick={() => link("owner")} disabled={!data.bot_ready || busy !== ""}>
                    {waiting === "owner" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    {waiting === "owner" ? "مستني حد يدوس Start… (جهّز لينك جديد)" : "جهّز لينك الربط"}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => unlink("owner")} disabled={busy !== ""}><Unlink className="w-4 h-4" /> فك الربط</Button>
                )}
              </div>
            )}
          </div>

          <div className="text-muted-foreground">آخر رسالة اتبعتت: {when(data.tg_last_sent_at)}</div>
          {data.tg_last_error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-destructive">
              <AlertTriangle className="w-4 h-4 mt-0.5" />
              <span>آخر رسالة ما وصلتش ({when(data.tg_last_error_at)}): {data.tg_last_error}</span>
            </div>
          )}
          {owner && (data.tg_linked || data.group_linked) && (
            <Button variant="outline" onClick={test} disabled={busy !== ""}>
              {busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} ابعت رسالة تجربة
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
