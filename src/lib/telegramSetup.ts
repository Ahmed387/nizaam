/**
 * The platform owner's Telegram setup of ONE company (migration 0273, owner 2026-11-19 «4 خطوات بعلامة ✓»):
 * 1 the company's group, 2 the company owner's own Telegram (link sent on WhatsApp), 3 every document to the group,
 * 4 the daily report to the owner. One bot for every company; each company has its own group and owner chat.
 */
export interface TgSetupState {
  bot_ready: boolean;
  group_linked: boolean; group_title: string | null;
  tg_linked: boolean; tg_username: string | null;
  docs_enabled: boolean; daily_report_enabled: boolean;
  owner_phone: string | null; plan_daily_report: boolean;
}

export type TgStepKey = "group" | "owner" | "docs" | "daily";
export interface TgStep {
  key: TgStepKey; title: string; done: boolean;
  /** what is true now, once done */
  detail: string;
  /** why it can't be done yet, else null */
  blocked: string | null;
  /** a short line under the step */
  hint: string;
}

const NO_BOT = "جهّز البوت الأول من «نظرة عامة»";

export function tgSetupSteps(s: TgSetupState): TgStep[] {
  return [
    {
      key: "group", title: "اربط جروب الشركة", done: s.group_linked,
      detail: s.group_linked ? `مربوط: «${s.group_title ?? "الجروب"}»` : "مش مربوط",
      blocked: s.bot_ready ? null : NO_BOT,
      hint: "اعمل جروب على تليجرام وضيف فيه صاحب الشركة، وبعدين اعمل الكود وصوّر الـQR بموبايلك واختار الجروب.",
    },
    {
      key: "owner", title: "اربط تليجرام صاحب الشركة", done: s.tg_linked,
      detail: s.tg_linked ? `اتربط${s.tg_username ? ` @${s.tg_username}` : ""}` : "مش مربوط",
      blocked: s.bot_ready ? null : NO_BOT,
      hint: s.owner_phone
        ? `اعمل اللينك وابعته واتساب على ${s.owner_phone} — هو يفتحه ويدوس Start، والكارت هيكتب «اتربط» لوحده.`
        : "مفيش موبايل متسجل لصاحب الشركة — الواتساب هيسألك تبعته لمين (أو سجّل موبايله من إعدادات الشركة).",
    },
    {
      key: "docs", title: "ابعت كل المستندات على الجروب", done: s.docs_enabled,
      detail: s.docs_enabled ? "شغال" : "مقفول",
      blocked: s.group_linked ? null : "اربط الجروب الأول",
      hint: "كل فاتورة ومرتجع وسند بينزل في الجروب PDF في خلال دقيقة أو اتنين، والإلغاء بينزل «اتلغى».",
    },
    {
      key: "daily", title: "التقرير اليومي لصاحب الشركة", done: s.daily_report_enabled,
      detail: s.daily_report_enabled ? "شغال (11:15 بالليل)" : "مقفول",
      blocked: !s.tg_linked ? "اربط تليجرام صاحب الشركة الأول" : !s.plan_daily_report ? "باقة الشركة مافيهاش التقرير اليومي" : null,
      hint: "PDF بكل موظف عمل إيه — لصاحب الشركة بس، ولو مفيش نشاط مش بيتبعت.",
    },
  ];
}

export const tgSetupDone = (s: TgSetupState): number => tgSetupSteps(s).filter((x) => x.done).length;
