/**
 * Platform owner → one company → «تليجرام الشركة» in 4 steps with ✓ (migration 0273, owner 2026-11-19
 * «اقتراحي إن الكارت ده يبقى فيه 4 خطوات … نفذ وجرب واتاكد انه شغال»):
 *  1 the company's group (6-digit code + QR + «/link» fallback, same as the owner's settings page),
 *  2 the company owner's own Telegram — the link goes to his saved mobile on WhatsApp and the card says «اتربط» by
 *    itself when he presses Start,
 *  3 every document to the group, 4 the daily report. One bot for every company; a company has one open code at a time.
 * Server: `super_tg_invite`, `super_tg_docs_set`, `super_tg_daily_set`, `super_tenant_ops_get` (super admin only).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Link2, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { rpcErrorText } from "@/lib/rpcError";
import { tgInviteCode, tgWhatsappHref } from "@/lib/telegramInvite";
import { tgSetupSteps, tgSetupDone, type TgSetupState, type TgStepKey } from "@/lib/telegramSetup";
import { InviteBox, type Invite, type Purpose } from "@/components/settings/OwnerContactTelegram";

type Ops = TgSetupState & { bot_username: string | null; docs_sent_today?: number; docs_failed?: number };

export function TenantTelegramSetup({ tenantId, onChange }: { tenantId: string; onChange?: (ops: any) => void }) {
  const [ops, setOps] = useState<Ops | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState<"" | TgStepKey>("");
  const [now, setNow] = useState(Date.now());
  const poll = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await (supabase.rpc as any)("super_tenant_ops_get", { p_tenant: tenantId });
    if (error) { toast.error(rpcErrorText(error)); return null; }
    setOps(data as Ops);
    onChange?.(data);
    return data as Ops;
  }, [tenantId, onChange]);
  const stopPoll = () => { if (poll.current) window.clearInterval(poll.current); poll.current = null; };
  useEffect(() => { load(); return stopPoll; }, [load]);
  useEffect(() => { if (!invite) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [invite]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`اتنسخ ${what}`); } catch { toast.error("مقدرتش أنسخ — علّم على النص وانسخه بإيدك"); }
  };

  const makeInvite = async (purpose: Purpose) => {
    setBusy(purpose);
    const { data, error } = await (supabase.rpc as any)("super_tg_invite", { p_tenant: tenantId, p_purpose: purpose });
    setBusy("");
    if (error) return toast.error(rpcErrorText(error));
    const url = (data as any).url as string;
    const code = String((data as any).code ?? tgInviteCode(url) ?? "");
    const expiresAt = Date.now() + Number((data as any).expires_in ?? 900) * 1000;
    setInvite({ purpose, url, code, expiresAt });
    stopPoll();
    poll.current = window.setInterval(async () => {
      if (Date.now() > expiresAt) { stopPoll(); return; }
      const { data: d } = await (supabase.rpc as any)("super_tenant_ops_get", { p_tenant: tenantId });
      const done = purpose === "group" ? d?.group_linked : d?.tg_linked;
      if (!done) return;
      stopPoll();
      setInvite(null);
      setOps(d as Ops);
      onChange?.(d);
      toast.success(purpose === "group" ? "✓ الجروب اتربط" : "✓ تليجرام صاحب الشركة اتربط");
    }, 3000);
  };

  const toggle = async (key: "docs" | "daily", on: boolean) => {
    setBusy(key);
    const { data, error } = await (supabase.rpc as any)(key === "docs" ? "super_tg_docs_set" : "super_tg_daily_set", { p_tenant: tenantId, p_enabled: on });
    setBusy("");
    if (error) return toast.error(rpcErrorText(error));
    setOps(data as Ops);
    onChange?.(data);
    toast.success(on ? "اتفتح" : "اتقفل");
  };

  if (!ops) return <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  const steps = tgSetupSteps(ops);
  const bot = ops.bot_username ? `@${ops.bot_username}` : "البوت";

  return (
    <div className="rounded-lg border p-3 space-y-3" data-testid="tg-setup">
      <div className="flex items-center gap-2 font-bold">
        تليجرام الشركة
        <Badge variant="outline" data-testid="tg-setup-progress">{tgSetupDone(ops)} من 4</Badge>
      </div>
      {!ops.bot_ready && (
        <div className="flex items-center gap-2 rounded-md bg-warning/10 p-2 text-warning text-sm">
          <AlertTriangle className="w-4 h-4" /> بوت التليجرام لسه مش متجهز — جهّزه من «نظرة عامة على المنصة».
        </div>
      )}
      <ol className="space-y-2">
        {steps.map((st, i) => (
          <li key={st.key} className="rounded-md border p-3 space-y-2 text-sm" data-testid={`tg-step-${st.key}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                {st.done
                  ? <CheckCircle2 className="w-5 h-5 text-success shrink-0" data-testid="tg-step-done" aria-label="تم" />
                  : <Circle className="w-5 h-5 text-muted-foreground shrink-0" aria-label="لسه" />}
                <div>
                  <div className="font-bold">{i + 1}. {st.title} — <span className={st.done ? "text-success" : "text-muted-foreground"}>{st.detail}</span></div>
                  <div className="text-xs text-muted-foreground">{st.blocked ?? st.hint}</div>
                  {st.key === "docs" && ops.docs_enabled && (
                    <div className="text-xs">اتبعت النهارده: <b className="tabular-nums">{ops.docs_sent_today ?? 0}</b>
                      {(ops.docs_failed ?? 0) > 0 && <span className="text-destructive"> — {ops.docs_failed} ما اتبعتوش بعد 5 محاولات</span>}</div>
                  )}
                </div>
              </div>
              {(st.key === "group" || st.key === "owner") && !st.done && (
                <Button size="sm" variant={st.key === "group" ? "default" : "outline"} disabled={!!st.blocked || busy !== ""}
                  onClick={() => makeInvite(st.key as Purpose)}>
                  {busy === st.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  {invite?.purpose === st.key ? "اعمل كود جديد" : st.key === "group" ? "اعمل كود الجروب" : "اعمل لينك صاحب الشركة"}
                </Button>
              )}
              {(st.key === "docs" || st.key === "daily") && (
                <Switch checked={st.done} disabled={(!!st.blocked && !st.done) || busy !== ""}
                  onCheckedChange={(v) => toggle(st.key as "docs" | "daily", v)} aria-label={st.title} />
              )}
            </div>
            {st.key === "group" && !st.done && invite?.purpose === "group" && (
              <InviteBox invite={invite} now={now} onCopy={copy} fallback={`/link ${invite.code}`}
                fallbackText={`لو ${bot} اتضاف ومكتبش «اتربط»، اكتب جوه الجروب:`} />
            )}
            {st.key === "owner" && !st.done && invite?.purpose === "owner" && (
              <InviteBox invite={invite} now={now} onCopy={copy} whatsapp={tgWhatsappHref(invite.url, ops.owner_phone)}
                fallback={invite.code} fallbackText={`لو مفيش Start، يبعت الرقم ده لـ ${bot}:`} />
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        كود واحد شغال للشركة في نفس الوقت (15 دقيقة): لو عملت كود الجروب وبعده لينك صاحب الشركة، الأول بيبطل — خلّص خطوة خطوة.
      </p>
    </div>
  );
}
