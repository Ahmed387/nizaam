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
  direction: SettleDirection; amount: number; reason: string; status: "active" | "cancelled"; cancel_reason?: string | null;
};

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

export async function settleContactWithoutMoney(contactId: string, i: SettleInput) {
  const { data, error } = await (supabase.rpc as any)("settle_contact_without_money", {
    p_branch: i.branchId, p_contact: contactId, p_side: i.side, p_direction: i.direction,
    p_amount: Math.round(i.amount * 100) / 100, p_date: i.date, p_reason: i.reason.trim(),
  });
  if (error) throw error;
  return data as { settlement_number?: string } | null;
}

export async function cancelContactSettlement(id: string, reason: string) {
  const { error } = await (supabase.rpc as any)("cancel_contact_settlement", { p_id: id, p_reason: reason.trim() });
  if (error) throw error;
}

export async function fetchContactSettlements(contactId: string): Promise<ContactSettlement[]> {
  const { data, error } = await (supabase.from as any)("contact_settlements")
    .select("id, settlement_number, settlement_date, branch_id, side, direction, amount, reason, status, cancel_reason")
    .eq("contact_id", contactId).order("settlement_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ContactSettlement[];
}
