import { waPhone } from "@/lib/whatsappShare";

/**
 * Personal Telegram link (owner 2026-11-18 «قولي اعمل ايه بالتفصيل … نكتب التفاصيل دي في صفحة الربط»): the link is a
 * one-time code for 15 minutes; whoever presses Start with it gets the daily report — on this phone, or the company
 * owner's phone when the link is sent to him. The bot also accepts the code typed as «/start <code>».
 */

/** the one-time code inside https://t.me/<bot>?start=<code> */
export function tgInviteCode(url: string): string | null {
  const m = /[?&]start(?:group)?=([a-f0-9]{24})\b/.exec(url);
  return m ? m[1] : null;
}

/** «ابعت اللينك واتساب»: to the owner's saved mobile when there is one, else WhatsApp asks whom to send to */
export function tgWhatsappHref(url: string, ownerPhone?: string | null): string {
  const text = `اربط تليجرامك بتقرير السيستم اليومي: افتح اللينك ده ودوس Start (اللينك شغال 15 دقيقة بس)\n${url}`;
  const to = waPhone(ownerPhone ?? null);
  return `https://wa.me/${to ?? ""}?text=${encodeURIComponent(text)}`;
}

/** minutes:seconds left, or null once expired */
export function tgTimeLeft(expiresAt: number, now: number): string | null {
  const s = Math.floor((expiresAt - now) / 1000);
  if (s <= 0) return null;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
