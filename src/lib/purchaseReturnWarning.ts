/**
 * A purchase return «على حساب المورد» is saved as the cashier chose (migration 0274). When what goes on his account is
 * more than we owe him in this branch, he ends up owing us — ask first (owner 2026-11-19).
 * owed = his supplier balance in the branch (+ = we owe him).
 */
export function onAccountWarning(balancePart: number, owed: number): string | null {
  const extra = Math.round((balancePart - Math.max(owed, 0)) * 100) / 100;
  if (balancePart <= 0.009 || extra <= 0.009) return null;
  return `المورد هيبقى مدين لكم ${extra.toLocaleString("en-US", { maximumFractionDigits: 2 })} — متأكد؟`;
}
