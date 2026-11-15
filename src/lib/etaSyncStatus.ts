// The status card on «الفواتير الإلكترونية الواردة» (migration 0225, owner 2026-11-15): when the last pull from the ETA
// was, when the next automatic one runs, whether «اسحب دلوقتي» can be pressed yet (eta_sync_now allows one every 2 min),
// and — when the pull failed or stopped — the reason in plain words and what to do about it.
import type { EtaSettings } from "./etaWizard";

export type EtaSyncSettings = Pick<EtaSettings, "enabled" | "last_sync_at" | "last_error" | "is_owner"> & {
  next_sync_at?: string | null;
  manual_ready_at?: string | null;
};

const TZ = "Africa/Cairo";
const STALE_MS = 2 * 3600_000 + 10 * 60_000; // hourly job: two missed runs (+10 min slack) means it stopped

const cairoDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
export const clock = (d: Date) => d.toLocaleTimeString("ar-EG", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

/** «النهارده 10:07 ص» / «امبارح 11:07 م» / «13/11 — 9:07 ص» (Cairo time). */
export function whenLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "لسه";
  const d = new Date(iso);
  const today = cairoDay(now);
  const yesterday = cairoDay(new Date(now.getTime() - 86_400_000));
  const day = cairoDay(d);
  if (day === today) return `النهارده ${clock(d)}`;
  if (day === yesterday) return `امبارح ${clock(d)}`;
  const [, m, dd] = day.split("-");
  return `${dd}/${m} — ${clock(d)}`;
}

/** Seconds left before «اسحب دلوقتي» can be pressed again (0 = now). */
export function manualWait(readyAt: string | null | undefined, now: Date = new Date()): number {
  if (!readyAt) return 0;
  return Math.max(0, Math.ceil((new Date(readyAt).getTime() - now.getTime()) / 1000));
}
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export type EtaProblem = { reason: string; todo: string };

/** The last error of a pull (as eta-sync wrote it) → the reason in plain words and what the user should do. */
export function etaErrorAdvice(err: string, next: string, isOwner: boolean): EtaProblem {
  const e = err.toLowerCase();
  const settingsTodo = isOwner
    ? "ادخل «إعدادات الربط» واكتب Client ID و Client Secret تاني زي ما هما على بوابة الضرايب، وبعدين دوس «اختبر الاتصال»."
    : "كلّم مالك الشركة يدخل «إعدادات الربط» ويكتب Client ID و Client Secret تاني.";
  if (err.includes("احفظ Client ID"))
    return { reason: "بيانات الربط مش محفوظة.", todo: settingsTodo };
  if (err.includes("Client ID أو Client Secret غلط"))
    return { reason: "منظومة الضرايب رفضت بيانات الدخول (Client ID أو Client Secret غلط، أو اتغيروا على البوابة، أو البيئة غلط).", todo: settingsTodo };
  if (err.includes("مالوش صلاحية") || /\b403\b/.test(e))
    return {
      reason: "الدخول نجح، بس نظام الـ ERP على بوابة الضرايب مالوش صلاحية يقرا الفواتير.",
      todo: isOwner
        ? "ادخل بوابة الضرايب ← «أنظمة الـ ERP» ← افتح النظام وفعّل صلاحية قراءة المستندات، وبعدين دوس «اسحب دلوقتي»."
        : "كلّم مالك الشركة يفعّل صلاحية قراءة المستندات لنظام الـ ERP على بوابة الضرايب.",
    };
  if (/\b429\b/.test(e))
    return { reason: "منظومة الضرايب وقفت الطلبات مؤقتاً عشان كترت ورا بعض.", todo: `استنى شوية — السيستم هيحاول تاني لوحده ${next}.` };
  if (/\b401\b/.test(e))
    return { reason: "مفتاح الدخول للمنظومة خلص في النص.", todo: `مفيش حاجة مطلوبة — دوس «اسحب دلوقتي» أو استنى السحب الجاي ${next}.` };
  if (err.includes("مش قادرين نوصل") || /\b5\d\d\b/.test(e) || e.includes("fetch") || e.includes("timeout") || e.includes("network"))
    return {
      reason: "منظومة الضرايب مش بترد دلوقتي — المشكلة عندهم مش عندك.",
      todo: `مفيش حاجة مطلوبة منك — السيستم هيحاول تاني لوحده ${next}. لو مستعجل دوس «اسحب دلوقتي» بعد شوية.`,
    };
  return { reason: err, todo: "دوس «اسحب دلوقتي». لو نفس الرسالة رجعت، كلّم الدعم وابعتله الرسالة دي زي ما هي." };
}

export type EtaSyncView = {
  tone: "ok" | "warn" | "error" | "off";
  last: string;          // «النهارده 10:07 ص»
  next: string | null;   // «11:07 ص»
  problem: EtaProblem | null;
};

export function etaSyncView(s: EtaSyncSettings, now: Date = new Date()): EtaSyncView {
  const last = whenLabel(s.last_sync_at, now);
  const nextAt = s.next_sync_at ? new Date(s.next_sync_at) : null;
  const next = nextAt ? clock(nextAt) : null;
  const nextWords = next ? `الساعة ${next}` : "في السحب الجاي";
  if (!s.enabled)
    return {
      tone: "off", last, next: null,
      problem: {
        reason: "الاستقبال من منظومة الضرايب متوقف، فمفيش فواتير جديدة بتتسحب.",
        todo: s.is_owner ? "شغّله من «إعدادات الربط»." : "كلّم مالك الشركة يشغّله من «إعدادات الربط».",
      },
    };
  if (s.last_error) return { tone: "error", last, next, problem: etaErrorAdvice(s.last_error, nextWords, s.is_owner) };
  if (!s.last_sync_at)
    return { tone: "warn", last, next, problem: { reason: "لسه محصلش أي سحب من المنظومة.", todo: `دوس «اسحب دلوقتي» أو استنى السحب التلقائي ${nextWords}.` } };
  if (now.getTime() - new Date(s.last_sync_at).getTime() > STALE_MS)
    return {
      tone: "warn", last, next,
      problem: {
        reason: "السحب التلقائي واقف — المفروض يشتغل كل ساعة، وآخر مرة اشتغل كانت من أكتر من ساعتين.",
        todo: "دوس «اسحب دلوقتي». لو آخر سحب ماتغيرش بعد دقيقتين، كلّم الدعم.",
      },
    };
  return { tone: "ok", last, next, problem: null };
}
