/**
 * Settings → «صاحب الشركة وتليجرام» (migrations 0237 / 0240, owner 2026-11-16): the owner's name / mobile / e-mail,
 * the company's Telegram GROUP (the owner adds his employees to it in Telegram) and the owner's own Telegram (the daily
 * activity report, which is about the employees, so never the group).
 * Linking (0266, owner 2026-11-18 «حوار الربط مدوخني … نفذه بالكامل مع وضع الخطوات»): one box per link with a QR (scan
 * it with the phone camera when the page is on a computer), the 6-digit code in big letters (typed to the bot when the
 * link opens with no Start), open / WhatsApp / copy, a countdown, and the page notices the link by itself
 * (`tg_link_status` every 3 s).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Send, Link2, Unlink, Save, CheckCircle2, AlertTriangle, Copy, MessageCircle, ExternalLink } from "lucide-react";
import { tgCodeShown, tgInviteCode, tgTimeLeft, tgWhatsappHref } from "@/lib/telegramInvite";
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

type Purpose = "owner" | "group";
interface Invite { purpose: Purpose; url: string; code: string; expiresAt: number }

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit" }) : "—";

export default function OwnerContactTelegram() {
  const [data, setData] = useState<OwnerContact | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState<"" | "save" | "link" | "unlink" | "test">("");
  const poll = useRef<number | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  // 0268: every document to the group (one PDF each, its own vouchers inside, «اتلغى» on cancel)
  const [docs, setDocs] = useState<{ enabled: boolean; today: number; failed: number } | null>(null);
  const loadDocs = useCallback(async () => {
    const { data: s } = await (supabase.rpc as any)("tg_link_status");
    if (s) setDocs({ enabled: !!s.docs_enabled, today: Number(s.docs_sent_today ?? 0), failed: Number(s.docs_failed ?? 0) });
  }, []);
  useEffect(() => { loadDocs(); }, [loadDocs]);
  const setDocsOn = async (on: boolean) => {
    const { error } = await (supabase.rpc as any)("tg_docs_set", { p_enabled: on });
    if (error) return toast.error(rpcErrorText(error));
    toast.success(on ? "هيتبعت على الجروب كل مستند جديد" : "وقفت إرسال المستندات على الجروب");
    loadDocs();
  };
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

  const stopPoll = () => { if (poll.current) window.clearInterval(poll.current); poll.current = null; };
  useEffect(() => {
    load().then((d) => d && setForm({ name: d.owner_name ?? "", phone: d.owner_phone ?? "", email: d.owner_email ?? "" }));
    return stopPoll;
  }, [load]);

  const save = async () => {
    setBusy("save");
    const { data: d, error } = await (supabase.rpc as any)("owner_contact_save", { p_name: form.name, p_phone: form.phone, p_email: form.email });
    setBusy("");
    if (error) return toast.error(rpcErrorText(error));
    setData(d as OwnerContact);
    toast.success("اتحفظت بيانات صاحب الشركة");
  };

  const link = async (purpose: Purpose) => {
    setBusy("link");
    const { data: d, error } = await (supabase.rpc as any)("tg_link_start", { p_purpose: purpose });
    setBusy("");
    if (error) return toast.error(rpcErrorText(error));
    const url = (d as any).url as string;
    const code = String((d as any).code ?? tgInviteCode(url) ?? "");
    const expiresAt = Date.now() + Number((d as any).expires_in ?? 900) * 1000;
    setInvite({ purpose, url, code, expiresAt });
    // wait for the bot (small read every 3 s, until linked or the code's 15 minutes are over)
    stopPoll();
    poll.current = window.setInterval(async () => {
      if (Date.now() > expiresAt) { stopPoll(); return; }
      const { data: s } = await (supabase.rpc as any)("tg_link_status");
      const done = purpose === "group" ? s?.group_linked : s?.owner_linked;
      if (!done) return;
      stopPoll();
      setInvite(null);
      await load();
      toast.success(purpose === "group" ? "✓ الجروب اتربط" : "✓ تليجرامك اتربط");
    }, 3000);
  };

  const unlink = async (which: Purpose) => {
    if (!window.confirm(which === "group" ? "تفك ربط الجروب؟" : "تفك ربط تليجرامك؟ التقرير اليومي مش هيوصلك.")) return;
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
  const bot = data.bot_username ? `@${data.bot_username}` : "البوت";

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
            الجروب: تنبيهات الشركة لكل اللي فيه (إنت بتضيف موظفينك للجروب من تليجرام). تليجرامك الشخصي: تقرير نشاط الموظفين
            الساعة 11:15 بالليل (ليك لوحدك).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!data.bot_ready && (
            <div className="flex items-center gap-2 rounded-md bg-warning/10 p-3 text-warning">
              <AlertTriangle className="w-4 h-4" /> بوت التليجرام لسه مش متجهز من إدارة المنصة.
            </div>
          )}

          {/* ---------------- the group */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2 font-bold">
              جروب الشركة
              {data.group_linked ? <Badge className="bg-success/15 text-success border-success/30">مربوط</Badge> : <Badge variant="outline">مش مربوط</Badge>}
            </div>
            {data.group_linked ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2" data-testid="tg-group-done"><CheckCircle2 className="w-4 h-4 text-success" /> «{data.group_title ?? "الجروب"}» من {when(data.group_linked_at)}</div>
                {docs && (
                  <div className="rounded-md bg-muted/40 p-2 space-y-1" data-testid="tg-docs">
                    <label className="flex items-center gap-2 font-medium">
                      <Switch checked={docs.enabled} disabled={!owner} onCheckedChange={setDocsOn} aria-label="ابعت كل المستندات على الجروب" />
                      ابعت كل المستندات على الجروب
                    </label>
                    <p className="text-xs text-muted-foreground">
                      كل فاتورة بيع وشراء ومرتجع وسند قبض وصرف بتنزل في الجروب كملف PDF (اسمه رقم المستند والفرع والموظف) في خلال دقيقة أو اتنين.
                      السند اللي اتعمل مع الفاتورة بيكون جوه ملفها، ولما مستند يتلغي بتنزل رسالة «اتلغى».
                    </p>
                    {docs.enabled && <p className="text-xs">اتبعت النهارده: <b className="tabular-nums">{docs.today}</b>{docs.failed > 0 ? <span className="text-destructive"> — {docs.failed} ما اتبعتوش بعد 5 محاولات</span> : null}</p>}
                  </div>
                )}
              </div>
            ) : (
              <ol className="list-decimal pr-5 space-y-1 text-muted-foreground" data-testid="tg-group-steps">
                <li>اعمل جروب على تليجرام (مثلاً «الشركة») وضيف فيه الموظفين اللي عاوزهم يشوفوا التنبيهات. لازم تكون إنت أدمن الجروب.</li>
                <li>دوس «اربط الجروب» تحت.</li>
                <li><b>لو الصفحة دي على كمبيوتر:</b> صوّر الكود (QR) اللي هيظهر بكاميرا موبايلك. <b>لو على الموبايل:</b> دوس «افتح تليجرام».</li>
                <li>تليجرام هيسألك: تضيف {bot} لأنهي جروب؟ ← اختار الجروب ← «إضافة».</li>
                <li>الصفحة هتكتب «مربوط» لوحدها، والبوت هيكتب في الجروب إنه اتربط.</li>
                <li>لو البوت اتضاف ومكتبش حاجة: اكتب جوه الجروب <b>‎/link‎</b> ومعاها الكود (6 أرقام) اللي هيظهر هنا.</li>
              </ol>
            )}
            {owner && !data.group_linked && invite?.purpose === "group" && (
              <InviteBox invite={invite} now={now} onCopy={copy} fallback={`/link ${invite.code}`}
                fallbackText="لو البوت اتضاف ومكتبش «اتربط»، اكتب جوه الجروب:" />
            )}
            {owner && (
              <div className="flex flex-wrap gap-2">
                {!data.group_linked ? (
                  <Button onClick={() => link("group")} disabled={!data.bot_ready || busy !== ""}>
                    {busy === "link" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    {invite?.purpose === "group" ? "اعمل كود جديد" : "اربط الجروب"}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => unlink("group")} disabled={busy !== ""}><Unlink className="w-4 h-4" /> فك ربط الجروب</Button>
                )}
              </div>
            )}
          </div>

          {/* ---------------- the owner's own Telegram */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2 font-bold">
              تليجرامك الشخصي (التقرير اليومي)
              {data.tg_linked ? <Badge className="bg-success/15 text-success border-success/30">مربوط</Badge> : <Badge variant="outline">مش مربوط</Badge>}
            </div>
            {data.tg_linked ? (
              <div className="flex items-center gap-2" data-testid="tg-owner-done"><CheckCircle2 className="w-4 h-4 text-success" /> مربوط{data.tg_username ? ` بحساب @${data.tg_username}` : ""} من {when(data.tg_linked_at)}</div>
            ) : (
              <ol className="list-decimal pr-5 space-y-1 text-muted-foreground" data-testid="tg-owner-steps">
                <li>دوس «اربط تليجرامك» تحت — هيظهر كود QR ورقم من 6 أرقام.</li>
                <li><b>لو الصفحة دي على كمبيوتر:</b> صوّر الكود (QR) بكاميرا موبايلك ← تليجرام هيفتح ← دوس <b>Start</b> (أو «ابدأ»).</li>
                <li><b>لو على الموبايل:</b> دوس «افتح تليجرام» ← <b>Start</b>.</li>
                <li><b>لو التقرير لصاحب الشركة على موبايل تاني:</b> دوس «ابعت اللينك واتساب» ← يفتحه ويدوس Start.</li>
                <li><b>لو تليجرام اتفتح ومفيش Start:</b> اكتب للبوت الـ 6 أرقام اللي ظاهرين وابعتهم.</li>
                <li>الكود شغال 15 دقيقة ولمرة واحدة. الصفحة هتكتب «مربوط» لوحدها، وبعدها دوس «ابعت رسالة تجربة».</li>
              </ol>
            )}
            {owner && !data.tg_linked && invite?.purpose === "owner" && (
              <InviteBox invite={invite} now={now} onCopy={copy} whatsapp={tgWhatsappHref(invite.url, data.owner_phone)}
                fallback={invite.code} fallbackText={`لو مفيش Start، ابعت الرقم ده لـ ${bot}:`} />
            )}
            {owner && (
              <div className="flex flex-wrap gap-2">
                {!data.tg_linked ? (
                  <Button variant="outline" onClick={() => link("owner")} disabled={!data.bot_ready || busy !== ""}>
                    {busy === "link" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    {invite?.purpose === "owner" ? "اعمل كود جديد" : "اربط تليجرامك"}
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

/** QR + the code in big digits + open / WhatsApp / copy + countdown, while the page waits for the bot */
function InviteBox({ invite, now, onCopy, whatsapp, fallback, fallbackText }: {
  invite: Invite; now: number; onCopy: (t: string, what: string) => void; whatsapp?: string; fallback: string; fallbackText: string;
}) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(invite.url, { width: 200, margin: 1 }).then((u: string) => live && setQr(u)).catch(() => live && setQr(null));
    return () => { live = false; };
  }, [invite.url]);
  const left = tgTimeLeft(invite.expiresAt, now);
  if (!left) return (
    <div className="rounded-md bg-warning/10 p-2 text-warning">الكود خلص (عدّى 15 دقيقة) — دوس «اعمل كود جديد».</div>
  );
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3" data-testid={`tg-invite-${invite.purpose}`}>
      <div className="flex flex-wrap items-start gap-4">
        {qr && <img src={qr} alt="كود QR للربط — صوّره بكاميرا الموبايل" width={160} height={160} className="rounded bg-white p-1" data-testid="tg-qr" />}
        <div className="space-y-2 min-w-[14rem] flex-1">
          <div className="text-xs text-muted-foreground">الكود — باقي <b className="tabular-nums">{left}</b> دقيقة</div>
          <div dir="ltr" className="text-3xl font-bold tracking-widest tabular-nums text-primary" data-testid="tg-code">{tgCodeShown(invite.code)}</div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm"><a href={invite.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" /> افتح تليجرام</a></Button>
            {whatsapp && (
              <Button asChild size="sm" variant="outline" className="border-success text-success hover:bg-success/10">
                <a href={whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle className="w-4 h-4" /> ابعت اللينك واتساب</a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onCopy(invite.url, "اللينك")}><Copy className="w-4 h-4" /> انسخ اللينك</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>{fallbackText}</span>
            <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5">{fallback}</code>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onCopy(fallback, "الكود")}><Copy className="w-3.5 h-3.5" /></Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> مستني الربط… الصفحة هتتحدث لوحدها</div>
        </div>
      </div>
    </div>
  );
}
