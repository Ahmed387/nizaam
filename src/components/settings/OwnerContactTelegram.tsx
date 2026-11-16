/**
 * Settings → «بيانات صاحب الشركة وتليجرام» (migration 0237, owner 2026-11-16): the owner's name / mobile / e-mail
 * and the link of his Telegram to the platform bot. The bot then sends him the received e-invoices (Valid) and the
 * daily activity report (when the platform owner switched it on for the company).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Link2, Unlink, Save, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { rpcErrorText } from "@/lib/rpcError";

export interface OwnerContact {
  owner_name: string | null; owner_phone: string | null; owner_email: string | null;
  tg_linked: boolean; tg_username: string | null; tg_linked_at: string | null;
  tg_last_error: string | null; tg_last_error_at: string | null; tg_last_sent_at: string | null;
  bot_ready: boolean; bot_username: string | null; is_owner: boolean;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit" }) : "—";

export default function OwnerContactTelegram() {
  const [data, setData] = useState<OwnerContact | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState<"" | "save" | "link" | "unlink" | "test">("");
  const [waiting, setWaiting] = useState(false);
  const poll = useRef<number | null>(null);

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

  const link = async () => {
    setBusy("link");
    const { data: d, error } = await (supabase.rpc as any)("tg_link_start");
    setBusy("");
    if (error) return toast.error(rpcErrorText(error));
    window.open((d as any).url, "_blank", "noopener");
    setWaiting(true);
    // wait for the bot to confirm (≤ 15 min, the code's life)
    let n = 0;
    if (poll.current) window.clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      n++;
      const cur = await load();
      if (cur?.tg_linked || n > 180) {
        if (poll.current) window.clearInterval(poll.current);
        poll.current = null;
        setWaiting(false);
        if (cur?.tg_linked) toast.success("تم ربط تليجرام");
      }
    }, 5000);
  };

  const unlink = async () => {
    if (!window.confirm("تفك ربط تليجرام؟ مش هيوصلك أي تنبيه لحد ما تربط تاني.")) return;
    setBusy("unlink");
    const { data: d, error } = await (supabase.rpc as any)("tg_unlink");
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
          <CardTitle className="flex items-center gap-2">
            تنبيهات تليجرام
            {data.tg_linked ? <Badge className="bg-success/15 text-success border-success/30">مربوط</Badge> : <Badge variant="outline">مش مربوط</Badge>}
          </CardTitle>
          <CardDescription>
            هيوصلك على تليجرام (مجانًا): كل فاتورة إلكترونية أو إشعار دائن / مدين يتقبل (Valid) على المنظومة بملخصه وملف الـ PDF،
            وتقرير نشاط كل الموظفين الساعة 11:15 بالليل (لو مفعّل لشركتك). التنبيهات لصاحب الشركة بس.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!data.bot_ready && (
            <div className="flex items-center gap-2 rounded-md bg-warning/10 p-3 text-warning">
              <AlertTriangle className="w-4 h-4" /> بوت التليجرام لسه مش متجهز من إدارة المنصة.
            </div>
          )}
          {data.tg_linked ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-success" /> مربوط{data.tg_username ? ` بحساب @${data.tg_username}` : ""} من {when(data.tg_linked_at)}</div>
              <div className="text-muted-foreground">آخر رسالة اتبعتت: {when(data.tg_last_sent_at)}</div>
            </div>
          ) : (
            <ol className="list-decimal pr-5 space-y-1 text-muted-foreground">
              <li>دوس «اربط تليجرام» — هيفتح تليجرام على بوت السيستم{data.bot_username ? ` (@${data.bot_username})` : ""}.</li>
              <li>دوس «Start» في تليجرام.</li>
              <li>ارجع هنا — هيظهر «مربوط» لوحده خلال ثواني.</li>
            </ol>
          )}
          {data.tg_last_error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-destructive">
              <AlertTriangle className="w-4 h-4 mt-0.5" />
              <span>آخر رسالة ما وصلتش ({when(data.tg_last_error_at)}): {data.tg_last_error}</span>
            </div>
          )}
          {owner && (
            <div className="flex flex-wrap gap-2">
              {!data.tg_linked && (
                <Button onClick={link} disabled={!data.bot_ready || busy !== ""}>
                  {busy === "link" || waiting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  {waiting ? "مستني تدوس Start في تليجرام…" : "اربط تليجرام"}
                </Button>
              )}
              {data.tg_linked && (
                <>
                  <Button variant="outline" onClick={test} disabled={busy !== ""}>
                    {busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} ابعت رسالة تجربة
                  </Button>
                  <Button variant="ghost" onClick={unlink} disabled={busy !== ""}><Unlink className="w-4 h-4" /> فك الربط</Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
