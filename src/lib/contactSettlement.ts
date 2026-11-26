/**
 * «تسوية رصيد بدون فلوس» (migration 0148, button owner 2026-11-04 «عاوز زرار في ملف العميل/المورد للمالك بس»).
 * Lowers what we owe him / what he owes us against «أرباح السنين اللي فاتت» (3800): two vouchers in the book vessel
 * «خصومات / عروض الشركات», the real tills never move, and 2026 profit does not change.
 * Example: شركة كريازي, 661,343.01 on 31/3, «نقلل اللي علينا ليه» → we owe كريازي 661,343.01 less; till as it is.
 */
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";

export type SettleSide = "customer" | "supplier";
export type SettleDirection = "we_owe_less" | "he_owes_less";
export type SettleInput = {
  branchId: string | null; side: SettleSide; direction: SettleDirection | null; amount: number; date: string; reason: string;
};
export type ContactSettlement = {
  id: string; settlement_number: string; settlement_date: string; branch_id: string; side: SettleSide;
  direction: SettleDirection | "we_owe_more" | "he_owes_more"; amount: number; reason: string; status: "active" | "cancelled";
  cancel_reason?: string | null;
  /** 0291: 'prior_years' = «بدون فلوس» on 3800; 'profit_loss' = «تسوية برصيد», the difference a 2026 gain / loss */
  kind?: "prior_years" | "profit_loss"; result?: "gain" | "loss" | null; balance_before?: number | null; balance_after?: number | null;
};

/** 0291: his two sides in every branch (contact_settle_info). customer + = he owes us; supplier + = we owe him. */
export type BranchBalance = { branch_id: string; branch: string; customer: number; supplier: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function sideNet(info: BranchBalance[], branchId: string | null, side: SettleSide): number {
  const b = info.find((x) => x.branch_id === branchId);
  return b ? r2(Number(b[side]) || 0) : 0;
}

/** Only the branches where that side has a balance — a settlement elsewhere would make an opposite balance. */
export function branchesWithBalance(info: BranchBalance[], side: SettleSide): BranchBalance[] {
  return info.filter((b) => Math.abs(Number(b[side]) || 0) >= 0.01);
}

/** His balance in words: «عليه 3,600.00» / «ليه عندنا 250.00» / «علينا ليه 17,100.00». */
export function balanceText(side: SettleSide, net: number): string {
  if (Math.abs(net) < 0.01) return "مفيش رصيد";
  const x = formatEGP(Math.abs(net));
  if (side === "customer") return net > 0 ? `عليه ${x}` : `ليه عندنا ${x}`;
  return net > 0 ? `علينا ليه ${x}` : `عليه لينا ${x}`;
}

/** The direction has to match the balance (the server refuses the other one). */
export function directionAllowed(side: SettleSide, direction: SettleDirection, net: number): boolean {
  if (Math.abs(net) < 0.01) return false;
  if (side === "supplier") return direction === "we_owe_less" && net > 0;
  return direction === "he_owes_less" ? net > 0 : net < 0;
}

/** The amount is above his balance — the owner chooses «لحد الصفر بس» or «كمّل ويقلب». */
export function overBalance(net: number, amount: number): boolean {
  return amount > Math.abs(net) + 0.005;
}

/** His balance after the settlement (the sign flips when the amount is above it). */
export function balanceAfter(net: number, amount: number): number {
  return r2(net > 0 ? net - amount : net + amount);
}

/** «تسوية برصيد»: from his balance to the one typed — the difference, and whether it is a gain or a loss. */
export function toBalanceResult(side: SettleSide, net: number, target: number): { result: "gain" | "loss"; amount: number; flips: boolean } | null {
  const diff = r2(net - target);
  if (!Number.isFinite(diff) || Math.abs(diff) < 0.01) return null;
  const flips = Math.abs(target) >= 0.01 && Math.sign(target) !== Math.sign(net);
  const result = (side === "customer") === (diff > 0) ? "loss" : "gain";
  return { result, amount: Math.abs(diff), flips };
}

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export function monthName(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : "";
}

/** One line before saving: «الفرق خسارة 1,600.00 في ربح نوفمبر 2026 …». */
export function toBalanceEffect(side: SettleSide, net: number, target: number, day: string): string {
  const r = toBalanceResult(side, net, target);
  if (!r) return "";
  const where = r.result === "loss" ? "على حساب «خسائر تسوية أرصدة» (بيقلل الربح)" : "على «إيرادات أخرى» (بيزوّد الربح)";
  return `الرصيد من ${balanceText(side, net)} لـ ${balanceText(side, target)} — الفرق ${r.result === "loss" ? "خسارة" : "ربح"} ${formatEGP(r.amount)} `
    + `في ربح ${monthName(day)} ${where}. الخزن الحقيقية ما تتحركش.`;
}

export type ToBalanceInput = { branchId: string | null; net: number; target: number; date: string; reason: string };
export function toBalanceProblem(i: ToBalanceInput, today: string): string | null {
  if (!i.branchId) return "اختار الفرع";
  if (Math.abs(i.net) < 0.01) return "ملوش رصيد في الفرع ده";
  if (!Number.isFinite(i.target)) return "اكتب الرصيد اللي اتفقتوا عليه";
  if (Math.abs(i.net - i.target) < 0.01) return "ده رصيده دلوقتي — مفيش فرق يتسوّى";
  if (!i.date || i.date < "2026-01-01") return "التاريخ لازم يكون 2026 أو بعده";
  if (i.date > today) return "التاريخ لسه ماجاش";
  if (!i.reason.trim()) return "اكتب السبب";
  return null;
}

/** What one settlement did, for the list. */
export function settleKindText(s: Pick<ContactSettlement, "side" | "direction"> & { kind?: string | null; result?: string | null }): string {
  if (s.kind === "profit_loss") return `تسوية برصيد · ${s.result === "gain" ? "ربح" : "خسارة"}`;
  return `${s.side === "customer" ? "عميل" : "مورد"} · ${s.direction === "he_owes_less" ? "قلّ اللي عليه" : "قلّ اللي علينا"}`;
}

/** The directions allowed on a side — a supplier never «owes less» here (that is a purchase return). */
export function settleDirections(side: SettleSide): { value: SettleDirection; label: string }[] {
  return side === "supplier"
    ? [{ value: "we_owe_less", label: "نقلل اللي علينا ليه" }]
    : [{ value: "he_owes_less", label: "نقلل اللي عليه" }, { value: "we_owe_less", label: "نقلل اللي ليه عندنا (تحت حسابه)" }];
}

/** One line: what the settlement does, shown before saving. */
export function settleEffect(side: SettleSide, direction: SettleDirection | null, amount: number): string {
  if (!direction || !(amount > 0)) return "";
  const x = formatEGP(amount);
  const who = side === "supplier"
    ? `اللي علينا للمورد يقل ${x}`
    : direction === "he_owes_less" ? `اللي على العميل يقل ${x}` : `اللي للعميل عندنا (تحت حسابه) يقل ${x}`;
  return `${who} — الخزنة الحقيقية ما تتحركش، وربح 2026 ما يتغيرش (الفرق على «أرباح السنين اللي فاتت»)`;
}

/** The first problem with what was typed, or null. */
export function settleProblem(i: SettleInput, today: string): string | null {
  if (!i.branchId) return "اختار الفرع";
  if (!i.direction) return "اختار: نقلل اللي علينا ليه ولا اللي عليه";
  if (i.side === "supplier" && i.direction === "he_owes_less") return "المورد مينفعش «نقلل اللي عليه» هنا — ده مرتجع شراء";
  if (!(i.amount > 0)) return "اكتب المبلغ";
  if (!i.date || i.date < "2026-01-01") return "التاريخ لازم يكون 2026 أو بعده";
  if (i.date > today) return "التاريخ لسه ماجاش";
  if (!i.reason.trim()) return "اكتب السبب";
  return null;
}

export async function settleContactWithoutMoney(contactId: string, i: SettleInput, allowFlip = false) {
  const { data, error } = await (supabase.rpc as any)("settle_contact_without_money", {
    p_branch: i.branchId, p_contact: contactId, p_side: i.side, p_direction: i.direction,
    p_amount: Math.round(i.amount * 100) / 100, p_date: i.date, p_reason: i.reason.trim(), p_allow_flip: allowFlip,
  });
  if (error) throw error;
  return data as { settlement_number?: string } | null;
}

export async function fetchSettleInfo(contactId: string): Promise<BranchBalance[]> {
  const { data, error } = await (supabase.rpc as any)("contact_settle_info", { p_contact: contactId });
  if (error) throw error;
  return ((data ?? []) as BranchBalance[]).map((b) => ({ ...b, customer: Number(b.customer) || 0, supplier: Number(b.supplier) || 0 }));
}

export async function settleContactToBalance(contactId: string, i: { branchId: string; side: SettleSide; target: number; date: string; reason: string },
                                             allowFlip = false) {
  const { data, error } = await (supabase.rpc as any)("settle_contact_to_balance", {
    p_branch: i.branchId, p_contact: contactId, p_side: i.side, p_target: r2(i.target), p_date: i.date, p_reason: i.reason.trim(),
    p_allow_flip: allowFlip,
  });
  if (error) throw error;
  return data as { settlement_number?: string; result?: "gain" | "loss"; amount?: number } | null;
}

export async function cancelContactSettlement(id: string, reason: string) {
  const { error } = await (supabase.rpc as any)("cancel_contact_settlement", { p_id: id, p_reason: reason.trim() });
  if (error) throw error;
}

export async function fetchContactSettlements(contactId: string): Promise<ContactSettlement[]> {
  const { data, error } = await (supabase.from as any)("contact_settlements")
    .select("id, settlement_number, settlement_date, branch_id, side, direction, amount, reason, status, cancel_reason, kind, result, balance_before, balance_after")
    .eq("contact_id", contactId).order("settlement_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ContactSettlement[];
}
