// Telegram alerts to the company owner (migrations 0237 / 0238, owner 2026-11-16). verify_jwt is OFF: every call is
// checked here.
//  * Telegram's webhook (header X-Telegram-Bot-Api-Secret-Token = platform_telegram.webhook_secret): «/start <code>»
//    links the owner's private chat (daily report) or the company's GROUP (e-invoices, 0240) — `tg_link_finish`;
//    a group moved to a supergroup / the bot removed from it → `tg_group_migrated` / `tg_group_left`.
//  * mode 'setup'  — the platform owner (JWT, super admin): getMe + setWebhook, result in `tg_record_setup`.
//  * mode 'test'   — the company owner (JWT): one test message to his chat.
//  * mode 'send'   — cron «telegram-send» (x-cron-secret = system_cron_tokens 'telegram'): the waiting e-invoices
//                    (Valid, `tg_eta_pending`) → summary + the ETA PDF, then `tg_eta_mark`.
//  * mode 'daily'  — cron «telegram-daily-report»: `daily_activity_report(tenant, day)` → A4 PDF → the owner's chat
//                    (`tg_daily_mark`; no activity → nothing is sent). Nothing is stored.
// The bot token never leaves the server (Vault → `tg_bot_token`, service role).
import { createClient } from "npm:@supabase/supabase-js@2";
import { etaMessage, linkCodeOf, reportCaption } from "./format.ts";
import type { EtaPending } from "./format.ts";
import { buildReportPdf } from "./report.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FONT_URLS = {
  regular: "https://raw.githubusercontent.com/google/fonts/main/ofl/tajawal/Tajawal-Regular.ttf",
  bold: "https://raw.githubusercontent.com/google/fonts/main/ofl/tajawal/Tajawal-Bold.ttf",
};
// fontkit (Babel output) sets classes' parents with `x.__proto__ = y`; Deno removes that setter, so Arabic shaping
// failed («this.shaper.plan is not a function»). Put it back, then load pdf-lib / fontkit (only for the daily report).
async function pdfLibs() {
  Object.defineProperty(Object.prototype, "__proto__", {
    get() { return Object.getPrototypeOf(this); },
    set(p) { if (p === null || typeof p === "object" || typeof p === "function") Object.setPrototypeOf(this, p); },
    configurable: true,
  });
  const lib = await import("npm:pdf-lib@1.17.1");
  const fontkit = (await import("npm:@pdf-lib/fontkit@1.1.1")).default;
  return { lib, fontkit };
}

let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;
async function fonts() {
  if (fontCache) return fontCache;
  const get = async (u: string) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`مش قادر أجيب الخط (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const [regular, bold] = await Promise.all([get(FONT_URLS.regular), get(FONT_URLS.bold)]);
  fontCache = { regular, bold };
  return fontCache;
}

const ETA_HOSTS = {
  prod: { id: "https://id.eta.gov.eg", api: "https://api.invoicing.eta.gov.eg" },
  preprod: { id: "https://id.preprod.eta.gov.eg", api: "https://api.preprod.invoicing.eta.gov.eg" },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: bot } = await admin.rpc("tg_bot_token");
  const token: string | null = bot?.token ?? null;

  const tg = async (method: string, body: unknown): Promise<any> => {
    if (!token) throw new Error("بوت التليجرام مش متجهز");
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) return j.result;
      if (r.status === 429 && i === 0) { await sleep(Math.min(10, Number(j?.parameters?.retry_after ?? 3)) * 1000); continue; }
      throw new Error(tgError(j?.description ?? `Telegram ${r.status}`));
    }
  };
  const tgFile = async (chat: number, name: string, bytes: Uint8Array, caption?: string) => {
    if (!token) throw new Error("بوت التليجرام مش متجهز");
    const form = new FormData();
    form.append("chat_id", String(chat));
    form.append("document", new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }), name);
    if (caption) { form.append("caption", caption.slice(0, 1000)); form.append("parse_mode", "HTML"); }
    const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
    const j = await r.json().catch(() => ({}));
    if (!j?.ok) throw new Error(tgError(j?.description ?? `Telegram ${r.status}`));
  };

  // ------------------------------------------------------------ webhook from Telegram
  const hookSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (hookSecret) {
    if (!bot?.webhook_secret || hookSecret !== bot.webhook_secret) return new Response("forbidden", { status: 403 });
    const upd = await req.json().catch(() => ({}));
    const msg = upd?.message;
    const chat = msg?.chat?.id;
    const type = String(msg?.chat?.type ?? "");
    const text = String(msg?.text ?? "").trim();
    if (!chat) return json({ ok: true });
    const isGroup = type === "group" || type === "supergroup";
    const botId = Number(String(token ?? "").split(":")[0]);
    try {
      // a group that became a supergroup has a new id; the bot taken out of the group
      if (msg?.migrate_to_chat_id) { await admin.rpc("tg_group_migrated", { p_old: chat, p_new: msg.migrate_to_chat_id }); return json({ ok: true }); }
      if (isGroup && msg?.left_chat_member?.id === botId) { await admin.rpc("tg_group_left", { p_chat: chat }); return json({ ok: true }); }
      const m = linkCodeOf(text, isGroup);
      if (m && m !== "bare") {
        const { data: res } = await admin.rpc("tg_link_finish", {
          p_code: m.code, p_chat: chat, p_username: msg?.from?.username ?? null, p_chat_type: type, p_title: msg?.chat?.title ?? null,
        });
        const company = String(res?.company ?? "").replace(/[<>&]/g, "");
        await tg("sendMessage", {
          chat_id: chat, parse_mode: "HTML",
          text: res?.ok
            ? (res.group
                ? `✅ الجروب ده اتربط بشركة <b>${company}</b>.\nأي فاتورة إلكترونية أو إشعار دائن / مدين يتقبل على المنظومة هينزل هنا، وكل اللي في الجروب يشوفه.`
                : `✅ تم ربط تليجرامك بشركة <b>${company}</b>.\nهيوصلك هنا تقرير النشاط اليومي (ولو مفيش جروب، الفواتير الإلكترونية كمان).`)
            : res?.reason === "need_group" ? `الكود ده لربط جروب، مش لمحادثة خاصة. اكتبه جوه الجروب كده: /link ${m.code}`
            : res?.reason === "need_private" ? "الكود ده لتليجرامك الشخصي، مش للجروب. ابعته للبوت في محادثة خاصة (مش في الجروب)."
            : res?.reason === "too_many" ? "اتبعت أكواد غلط كتير. استنى ساعة، وبعدين اعمل كود جديد من صفحة الربط وابعته."
            : "الكود ده غلط أو خلص (الكود شغال 15 دقيقة ولمرة واحدة). اعمل كود جديد من صفحة الربط في السيستم وابعته هنا.",
        });
      } else if (m === "bare") {
        await tg("sendMessage", {
          chat_id: chat, parse_mode: "HTML",
          text: isGroup
            ? "👋 عشان تربط الجروب ده: افتح السيستم ← الإعدادات ← «صاحب الشركة وتليجرام» ← «اربط الجروب»، وبعدين اكتب هنا:\n<code>/link الكود</code>\n(الكود 6 أرقام ظاهر في الصفحة)"
            : "👋 أهلاً! ابعتلي هنا <b>الكود</b> اللي ظاهر في صفحة الربط في السيستم (6 أرقام) وخلاص.\nمكانه: الإعدادات ← «صاحب الشركة وتليجرام» ← «اربط تليجرامك».",
        });
      } else if (!isGroup) {
        await tg("sendMessage", { chat_id: chat, text: "البوت ده للتنبيهات بس. لو عاوز تربط: ابعتلي الكود (6 أرقام) اللي ظاهر في السيستم ← الإعدادات ← «صاحب الشركة وتليجرام»." });
      }
    } catch (e) { console.error("webhook", errText(e)); }
    return json({ ok: true });
  }

  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode ?? "");

  // ------------------------------------------------------------ who
  const cron = req.headers.get("x-cron-secret") ?? "";
  let viaCron = false;
  if (cron.length >= 16) {
    const { data: tok } = await admin.from("system_cron_tokens").select("token").eq("name", "telegram").maybeSingle();
    viaCron = !!tok?.token && tok.token === cron;
  }
  let uid: string | null = null;
  if (!viaCron) {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const authClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: claims } = await authClient.auth.getClaims(auth.replace("Bearer ", ""));
    uid = (claims?.claims?.sub as string | undefined) ?? null;
    if (!uid) return json({ error: "Unauthorized" }, 401);
  }

  // ------------------------------------------------------------ setup (platform owner)
  if (mode === "setup") {
    if (viaCron || !uid) return json({ error: "Unauthorized" }, 401);
    const { data: sup } = await admin.from("user_roles").select("role").eq("user_id", uid).eq("role", "super_admin").maybeSingle();
    if (!sup) return json({ ok: false, error: "لإدارة المنصة بس" }, 403);
    try {
      const me = await tg("getMe", {});
      await tg("setWebhook", {
        url: `${url}/functions/v1/telegram`, secret_token: bot.webhook_secret,
        allowed_updates: ["message"], drop_pending_updates: true,
      });
      await tg("setMyDescription", { description: "تنبيهات «نظام» لصاحب الشركة: الفواتير الإلكترونية وتقرير النشاط اليومي." }).catch(() => {});
      await admin.rpc("tg_record_setup", { p_ok: true, p_username: me?.username ?? null, p_error: null });
      return json({ ok: true, bot_username: me?.username });
    } catch (e) {
      await admin.rpc("tg_record_setup", { p_ok: false, p_username: null, p_error: errText(e) });
      return json({ ok: false, error: errText(e) });
    }
  }

  // ------------------------------------------------------------ pdfcheck (platform owner / server): build a day's report, send nothing
  if (mode === "pdfcheck") {
    if (!viaCron) {
      const { data: sup } = await admin.from("user_roles").select("role").eq("user_id", uid).eq("role", "super_admin").maybeSingle();
      if (!sup) return json({ ok: false, error: "لإدارة المنصة بس" }, 403);
    }
    try {
      const { data: rep, error } = await admin.rpc("daily_activity_report", { p_tenant: String(body?.tenant_id ?? ""), p_day: String(body?.day ?? "") });
      if (error) throw new Error(error.message);
      const { lib, fontkit } = await pdfLibs();
      const pdf = await buildReportPdf(lib, fontkit, await fonts(), rep);
      return json({ ok: true, bytes: pdf.length, has_activity: rep?.has_activity });
    } catch (e) { return json({ ok: false, error: errText(e) }); }
  }

  // ------------------------------------------------------------ test (company owner)
  if (mode === "test") {
    if (viaCron || !uid) return json({ error: "Unauthorized" }, 401);
    const { data: roles } = await admin.from("user_roles").select("tenant_id").eq("user_id", uid).eq("role", "owner");
    const tenants = [...new Set((roles ?? []).map((r: any) => r.tenant_id).filter(Boolean))];
    if (tenants.length !== 1) return json({ ok: false, error: "للمالك بس" }, 403);
    const { data: chat } = await admin.rpc("tg_chat_of", { p_tenant: tenants[0] });
    const { data: group } = await admin.rpc("tg_group_of", { p_tenant: tenants[0] });
    if (!chat && !group) return json({ ok: false, error: "تليجرام مش مربوط لسه" });
    try {
      if (chat) await tg("sendMessage", { chat_id: chat, text: "👋 رسالة تجربة من السيستم — تليجرامك الشخصي مربوط (هنا التقرير اليومي)." });
      if (group) await tg("sendMessage", { chat_id: group, text: "👋 رسالة تجربة من السيستم — الجروب مربوط (هنا الفواتير الإلكترونية)." });
      await admin.rpc("tg_record_send", { p_tenant: tenants[0], p_ok: true, p_error: null, p_what: "تجربة" });
      return json({ ok: true });
    } catch (e) {
      await admin.rpc("tg_record_send", { p_tenant: tenants[0], p_ok: false, p_error: errText(e), p_what: "رسالة تجربة" });
      return json({ ok: false, error: errText(e) });
    }
  }

  if (!viaCron) return json({ error: "Unauthorized" }, 401);

  // ------------------------------------------------------------ e-invoices (cron)
  if (mode === "send") {
    const { data: pend } = await admin.rpc("tg_eta_pending", { p_limit: 10 });
    const docs: (EtaPending & { tenant_id: string; eta_uuid: string; chat: number; has_detail: boolean })[] = pend ?? [];
    const appUrl = (Deno.env.get("APP_URL") ?? "https://nizaam.lovable.app").replace(/\/$/, "");
    const etaTokens = new Map<string, { host: string; token: string } | null>();
    let sent = 0, failed = 0;
    for (const d of docs) {
      try {
        // ETA token per company (to read the lines and the PDF); without it the text still goes
        if (!etaTokens.has(d.tenant_id)) etaTokens.set(d.tenant_id, await etaToken(admin, d.tenant_id).catch(() => null));
        const eta = etaTokens.get(d.tenant_id) ?? null;
        if (eta && !d.has_detail) {
          const r = await fetch(`${eta.host}/api/v1.0/documents/${d.eta_uuid}/raw`, { headers: { Authorization: `Bearer ${eta.token}`, Accept: "application/json" } });
          if (r.ok) {
            const raw = await r.json();
            let doc = raw?.document ?? raw;
            if (typeof doc === "string") { try { doc = JSON.parse(doc); } catch { /* keep */ } }
            d.detail = { document: doc, validation: raw?.validationResults?.status ?? null };
            await admin.rpc("eta_save_detail", { p_tenant: d.tenant_id, p_uuid: d.eta_uuid, p_detail: d.detail });
          }
          await sleep(2100);
        }
        await tg("sendMessage", { chat_id: d.chat, parse_mode: "HTML", text: etaMessage(d, appUrl), disable_web_page_preview: true });
        if (eta) {
          const r = await fetch(`${eta.host}/api/v1.0/documents/${d.eta_uuid}/pdf`, { headers: { Authorization: `Bearer ${eta.token}`, Accept: "application/pdf" } });
          if (r.ok) await tgFile(d.chat, `${(d.internal_id ?? d.eta_uuid).replace(/[^\w.-]+/g, "_")}.pdf`, new Uint8Array(await r.arrayBuffer()));
          await sleep(2100);
        }
        await admin.rpc("tg_eta_mark", { p_doc: d.id, p_ok: true, p_error: null });
        sent++;
      } catch (e) {
        await admin.rpc("tg_eta_mark", { p_doc: d.id, p_ok: false, p_error: errText(e) });
        failed++;
      }
    }
    return json({ ok: true, sent, failed });
  }

  // ------------------------------------------------------------ daily report (cron)
  if (mode === "daily") {
    const tenantId = String(body?.tenant_id ?? "");
    const day = String(body?.day ?? "");
    if (!/^[0-9a-f-]{36}$/.test(tenantId) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "bad input" }, 400);
    try {
      const { data: rep, error } = await admin.rpc("daily_activity_report", { p_tenant: tenantId, p_day: day });
      if (error) throw new Error(error.message);
      if (!rep?.has_activity) {
        await admin.rpc("tg_daily_mark", { p_tenant: tenantId, p_day: day, p_ok: false, p_error: "no activity" });
        return json({ ok: true, skipped: "no activity" });
      }
      const { data: chat } = await admin.rpc("tg_chat_of", { p_tenant: tenantId });
      if (!chat) throw new Error("تليجرامك الشخصي مش مربوط — التقرير اليومي بيروح لصاحب الشركة بس");
      const { lib, fontkit } = await pdfLibs();
      const pdf = await buildReportPdf(lib, fontkit, await fonts(), rep);
      await tgFile(chat, `نشاط-${day}.pdf`, pdf, reportCaption(rep));
      await admin.rpc("tg_daily_mark", { p_tenant: tenantId, p_day: day, p_ok: true, p_error: null });
      return json({ ok: true, bytes: pdf.length });
    } catch (e) {
      await admin.rpc("tg_daily_mark", { p_tenant: tenantId, p_day: day, p_ok: false, p_error: errText(e) });
      return json({ ok: false, error: errText(e) });
    }
  }

  return json({ error: "mode?" }, 400);
});

function tgError(desc: string): string {
  if (/blocked by the user/i.test(desc)) return "صاحب الشركة قفل البوت على تليجرام — يفتحه ويدوس Start";
  if (/chat not found|kicked|not a member/i.test(desc)) return "الشات أو الجروب مش موجود أو البوت اتشال منه — اربط من جديد";
  if (/Unauthorized/i.test(desc)) return "مفتاح البوت غلط أو اتغير";
  return desc;
}

async function etaToken(admin: any, tenant: string): Promise<{ host: string; token: string } | null> {
  const { data: cred } = await admin.rpc("eta_credentials", { p_tenant: tenant });
  if (!cred?.client_id || !cred?.client_secret) return null;
  const host = ETA_HOSTS[(cred.env === "preprod" ? "preprod" : "prod") as keyof typeof ETA_HOSTS];
  const r = await fetch(`${host.id}/connect/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: cred.client_id, client_secret: cred.client_secret, scope: "InvoicingAPI" }),
  });
  if (!r.ok) return null;
  const t = (await r.json())?.access_token;
  return t ? { host: host.api, token: t } : null;
}
