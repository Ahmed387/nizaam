import { formatEGP } from "@/lib/format";

/**
 * رأس مال الفروع (migration 0250): every `branch_capital_allocations` row = capital moved FROM a place TO a place
 * (the partners' treasury is the system branch PARTNER-CASH). kind: allocate (partners → branch), return (branch →
 * partners), move (branch → branch). A branch's capital = Σ in − Σ out — same rule as SQL `branch_capital_now`.
 */
export type CapitalKind = "allocate" | "return" | "move";
export interface CapitalRow { branch_id: string; from_branch_id: string | null; amount: number; kind: CapitalKind | string }

export function capitalOfBranch(rows: CapitalRow[], branchId: string): number {
  let s = 0;
  for (const r of rows) {
    if (r.branch_id === branchId) s += Number(r.amount || 0);
    if (r.from_branch_id === branchId) s -= Number(r.amount || 0);
  }
  return Math.round(s * 100) / 100;
}

export function capitalKindLabel(kind: string): string {
  return kind === "return" ? "رجوع لخزينة الشركاء" : kind === "move" ? "نقل لفرع تاني" : "تحويل رأس مال";
}

/** A vessel's balance from till rows (income − expense; an empty method = cash). */
export function vesselBalance(rows: { type: string; amount: number; payment_method: string | null }[], method: string): number {
  let s = 0;
  for (const r of rows) if ((r.payment_method || "cash") === method) s += r.type === "income" ? Number(r.amount || 0) : -Number(r.amount || 0);
  return Math.round(s * 100) / 100;
}

/** Checks before sending (the server checks the same again). Returns an Arabic problem or null. */
export function capitalProblem(f: {
  from: string; to: string; amount: number; capital: number; balance: number; needsAccounts: boolean;
  fromAccount: string; toAccount: string; fromIsPartners: boolean;
}): string | null {
  if (!f.from) return "اختار الفرع اللي رأس المال طالع منه";
  if (!f.to) return "اختار رأس المال رايح فين";
  if (f.from === f.to) return "اختار مكانين مختلفين";
  if (!(f.amount > 0)) return "اكتب المبلغ";
  if (!f.fromIsPartners && f.amount > f.capital) return `رأس مال الفرع الحالي ${formatEGP(Math.max(0, f.capital))} بس — رأس المال بس اللي يطلع`;
  if (f.amount > f.balance) return `الوعاء ده مفيهوش غير ${formatEGP(Math.max(0, f.balance))} — المتاح أقل من المبلغ`;
  if (f.needsAccounts && !f.fromAccount) return "اختار الحساب اللي هيتحول منه";
  if (f.needsAccounts && !f.toAccount) return "اختار الحساب اللي هيوصل عليه";
  return null;
}
