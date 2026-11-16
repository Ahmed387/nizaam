/**
 * Platform owner → the ONE Telegram bot of the platform (migration 0237). The token from BotFather is typed here once,
 * saved in Vault (`super_tg_save_token`) and never shown again; «جهّز البوت» calls the `telegram` edge function
 * (mode 'setup': getMe + webhook). Companies then link their owner's chat from their own settings.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { rpcErrorText } from "@/lib/rpcError";

interface TgStatus { has_token: boolean; bot_username: string | null; ok_at: string | null; last_error: string | null; linked_companies: number }

export function PlatformTelegramCard() {
  const [st, setSt] = useState<TgStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "setup">("");

  const load = useCallback(async () => {
    const { data, error } = await (supabase.rpc as any)("super_tg_status");
    if (error) return toast.error(rpcErrorText(error));
    setSt(data as TgStatus);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setup = async () => {
    setBusy("setup");
    const { data, error } = await supabase.functions.invoke("telegram", { body: { mode: "setup" } });
    setBusy("");
    if (error || !(data as any)?.ok) toast.error((data as any)?.error ?? rpcErrorText(error));
    else toast.success(`البوت جاهز: @${(data as any).bot_username}`);
    load();
  };

  const save = async () => {
    setBusy("save");
    const { error } = await (supabase.rpc as any)("super_tg_save_token", { p_token: token });
    setBusy("");
    if (error) return toast.error(rpcErrorText(error));
    setToken("");
    toast.success("اتحفظ المفتاح");
    await setup();
  };

  return (
    <div className="card-elevated p-4 mb-6 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Send className="w-5 h-5 text-primary" />
        <h3 className="font-bold">بوت تليجرام للتنبيهات</h3>
        {st?.ok_at ? <Badge className="bg-success/15 text-success border-success/30">جاهز — @{st.bot_username}</Badge>
          : st?.has_token ? <Badge variant="outline">المفتاح متحفظ — محتاج تجهيز</Badge> : <Badge variant="outline">مش متجهز</Badge>}
        {st && <span className="text-xs text-muted-foreground">شركات مربوطة: {st.linked_companies}</span>}
      </div>
      <p className="text-sm text-muted-foreground">
        اعمل بوت من <span dir="ltr">@BotFather</span> على تليجرام (أمر <span dir="ltr">/newbot</span>)، انسخ المفتاح اللي بيديهولك
        والزقه هنا. المفتاح بيتحفظ مشفر ومش بيظهر تاني. بعدها كل صاحب شركة يربط تليجرامه من الإعدادات.
      </p>
      {st?.last_error && <div className="text-sm text-destructive">آخر محاولة: {st.last_error}</div>}
      <div className="flex gap-2 flex-wrap">
        <Input dir="ltr" type="password" autoComplete="off" className="max-w-md" placeholder="123456789:AA..." value={token} onChange={(e) => setToken(e.target.value)} />
        <Button onClick={save} disabled={!token.trim() || busy !== ""}>{busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ وتجهيز</Button>
        {st?.has_token && <Button variant="outline" onClick={setup} disabled={busy !== ""}>{busy === "setup" ? <Loader2 className="w-4 h-4 animate-spin" /> : null} جهّز البوت تاني</Button>}
      </div>
    </div>
  );
}
