// The fee of one payment (owner 2026-11-25 «اللي بيعمل العملية بيحدد العمولة نسبة او رقم ثابت … ماعدا الكاش»):
// the person doing the operation types it — none / a fixed amount / a percent of the operation — and a hint says exactly
// where it goes before he saves. Cash never has a fee. The settings no longer hold a fee per vessel.
export type FeeMode = "none" | "fixed" | "percent";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** The fee in pounds; never below 0, never on cash. */
export function feeOf(method: string, amount: number, mode: FeeMode | undefined, value: number | string | undefined): number {
  if (!method || method === "cash") return 0;
  const v = Math.max(Number(value) || 0, 0);
  if (mode === "fixed") return r2(v);
  if (mode === "percent") return r2((Math.max(Number(amount) || 0, 0) * v) / 100);
  return 0;
}

const fmt = (n: number) => `${r2(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} ج.م`;

/**
 * Where the fee goes, in words.
 * direction: "in" = money comes to us (sale, receipt) · "out" = money leaves us (purchase, payment, salary, advance)
 *            "both" = between two of our branches · "none" = no side known.
 */
export function feeHint(p: {
  fee: number; amount: number; vessel: string; direction: "in" | "out" | "both" | "none"; onCustomer?: boolean; party?: string;
}): string {
  const { fee, amount, vessel, direction, onCustomer } = p;
  const party = p.party || (direction === "in" ? "العميل" : "الطرف التاني");
  if (!(fee > 0)) return "مفيش عمولة — مفيش أي مصروف بيتسجل.";
  if (direction === "in" && onCustomer) {
    return `${party} يدفع ${fmt(amount + fee)}: ${fmt(amount)} تتحسب له، و${fmt(fee)} تدخل «إيرادات أخرى» وتزود ربح الشهر.`;
  }
  if (direction === "in") {
    return `${vessel} يزيد ${fmt(amount - fee)} بس: حساب ${party} بينزل ${fmt(amount)} كاملة، و${fmt(fee)} مصروف «عمولات تحويل» بيقلل ربح الشهر.`;
  }
  if (direction === "both") {
    return `هيطلع ${fmt(amount + fee)} من ${vessel} الفرع ده: ${fmt(amount)} للفرع التاني و${fmt(fee)} مصروف «عمولات تحويل» على الفرع ده (بيقلل ربح الشهر). لو اترفض التحويل الـ ${fmt(amount)} بترجع والعمولة بتفضل مصروف.`;
  }
  if (direction === "out") {
    return `هيطلع ${fmt(amount + fee)} من ${vessel}: ${fmt(amount)} لـ${party} و${fmt(fee)} مصروف «عمولات تحويل» بيقلل ربح الشهر.`;
  }
  return `${fmt(fee)} مصروف «عمولات تحويل» من ${vessel} — بيقلل ربح الشهر.`;
}
