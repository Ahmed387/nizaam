/**
 * WhatsApp button with no usable mobile (owner 2026-11-19 «يظهر Alert بالمشكلة و ينقله بخفة ولذاذه لصفحة المورد او
 * العميل عشان يدخل رقم التيليفون … ويبعت رسالة علي الواتساب»): the button explains the problem, takes the user to the
 * account's page with the phone field open (`?fix=phone&back=…`), and after a mobile is saved brings him back to the
 * document (`?wa=ready`), where the button is pointed out — WhatsApp itself opens only from a click (a browser blocks a
 * window opened by a page load).
 */
import { waPhone } from "./whatsappShare";

export interface PhoneProblem { kind: "missing" | "not_mobile"; text: string }

export function phoneProblem(phone: string | null | undefined): PhoneProblem | null {
  if (waPhone(phone)) return null;
  const raw = String(phone ?? "").trim();
  if (!raw) return { kind: "missing", text: "مفيش رقم موبايل متسجل في ملفه." };
  return { kind: "not_mobile", text: `الرقم المتسجل في ملفه (${raw}) مش رقم موبايل، فالواتساب مش هيفتح عليه.` };
}

export function contactFixPath({ branchId, contactId, back }: { branchId: string | null | undefined; contactId: string; back: string }): string {
  const base = branchId ? `/branch/${branchId}/contacts/${contactId}` : `/admin/contacts/${contactId}`;
  return `${base}?fix=phone&back=${encodeURIComponent(back)}`;
}

/** only an in-app path is followed back (never another site) */
const safeBack = (b: string | null): string | null => (b && b.startsWith("/") && !b.startsWith("//") ? b : null);

export function fixParams(search: string): { fixPhone: boolean; back: string | null } {
  const p = new URLSearchParams(search);
  return { fixPhone: p.get("fix") === "phone", back: safeBack(p.get("back")) };
}

/** where to go once the account is saved: back to the document, marked ready — only for a real mobile */
export function afterPhoneSaved(fix: { fixPhone: boolean; back: string | null }, phone: string | null | undefined): string | null {
  if (!fix.fixPhone || !fix.back || !waPhone(phone)) return null;
  return fix.back + (fix.back.includes("?") ? "&" : "?") + "wa=ready";
}

export const waReady = (search: string): boolean => new URLSearchParams(search).get("wa") === "ready";

export function withoutWaReady(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("wa");
  return p.toString();
}
