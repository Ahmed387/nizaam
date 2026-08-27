// كل الأرقام في النظام بتتكتب بالأرقام الإنجليزية (1,234.56) عشان تبقى واضحة ومقروءة
const AR = "ar-EG-u-nu-latn";

export const formatEGP = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  const txt = new Intl.NumberFormat(AR, {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(v);
  return `${txt} ج.م`;
};

export const formatNumber = (n: number | string | null | undefined) =>
  new Intl.NumberFormat(AR, { maximumFractionDigits: 2 }).format(Number(n ?? 0));

export const formatDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(AR, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
};

export const formatDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(AR, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};


export const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Unified balance label.
 * Convention (matches `contacts.balance` usage across the app):
 *   balance > 0 → لينا رصيد عند الطرف الآخر (we are owed / credit in our favor)
 *   balance < 0 → علينا للطرف الآخر (we owe them)
 *   balance = 0 → لا توجد مديونية
 */
export const balanceLabel = (
  balance: number | null | undefined,
): { label: string; amount: number; tone: "good" | "bad" | "neutral" } => {
  const v = Number(balance ?? 0);
  if (v > 0) return { label: "ليك رصيد عنده", amount: Math.abs(v), tone: "good" };
  if (v < 0) return { label: "عليك له", amount: Math.abs(v), tone: "bad" };
  return { label: "لا توجد مديونية", amount: 0, tone: "neutral" };
};

