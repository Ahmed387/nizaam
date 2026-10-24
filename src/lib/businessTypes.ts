/** Company types the platform owner picks from (or types a new one) — tenants.business_type, migration 0109. */
export const BUSINESS_TYPES = ["أجهزة كهربائية — بيع وشراء", "صيدلية", "مطعم"] as const;
export const DEFAULT_BUSINESS_TYPE = BUSINESS_TYPES[0];

/** "3 من 3" — branches used out of the company's limit. */
export function branchUsage(used: number, limit: number | null | undefined): string {
  return `${used} من ${limit ?? 3}`;
}

/** Suggested password for a new company owner: 12 characters, letters + digits, no look-alikes. */
export function suggestPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const body = Array.from({ length: 9 }, () => pick(letters + digits)).join("");
  return `Nz-${pick(digits)}${body.slice(0, 4)}-${body.slice(4)}`;
}

/** "فرع المعادي" — adds the word «فرع» only when the branch name does not already start with it. */
export function branchLabel(name: string): string {
  const n = (name ?? "").trim();
  return /^فرع(\s|$)/.test(n) ? n : `فرع ${n}`;
}
