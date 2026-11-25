/**
 * «الفرق ده راح فين؟» (migration 0283, owner 2026-11-25): the partners' «موجود بالفعل» capital vs what the books say the
 * company owned on its first day. The owner places the difference: assets on «الأصول الثابتة» (the difference shrinks by
 * itself), a loss before the system, a partner's drawings (his % stays or goes down — his choice each time), or «سيبه زي ما هو».
 */
import { supabase } from "@/integrations/supabase/client";

export type DrawingRow = { partner_id: string; amount: string; keep_share: boolean | null };
export type GapForm = { loss: string; drawings: DrawingRow[] };
export type GapItem = { kind: "loss"; amount: number } | { kind: "drawing"; partner_id: string; amount: number; keep_share: boolean } | { kind: "leave" };
export type GapLine = { account_code: string; debit: number; credit: number; description: string };
export type GapDecision = { id: string; kind: "recognize" | "leave"; capital_total: number; opening_used: number; items: any[]; status: "active" | "cancelled"; cancel_reason: string | null; created_at: string };
export type GapInfo = {
  start_day: string; opening: number; opening_used: number; opening_left: number; capital_new: number; gap: number;
  capital_by_partner: Record<string, number>; partners: { id: string; name: string; capital_new: number }[]; decisions: GapDecision[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => Number(s || 0) || 0;

export function gapLeft(gap: number, f: GapForm): number {
  return r2(gap - num(f.loss) - f.drawings.reduce((s, d) => s + num(d.amount), 0));
}

export function gapItems(f: GapForm): GapItem[] {
  const out: GapItem[] = [];
  if (num(f.loss) > 0) out.push({ kind: "loss", amount: num(f.loss) });
  for (const d of f.drawings) {
    if (d.partner_id && num(d.amount) > 0 && d.keep_share !== null) out.push({ kind: "drawing", partner_id: d.partner_id, amount: num(d.amount), keep_share: d.keep_share });
  }
  return out;
}

/** One line of the entry in words (the owner never sees account codes). */
export function lineText(l: GapLine): string {
  const side = l.debit > 0 ? "بيقل" : "بيزيد";
  switch (l.account_code) {
    case "3950": return "صافي الملك في الدفاتر يوم البداية — بيتنقل لرأس مال الشركاء";
    case "3100": return `${l.description || "رأس مال الشركاء"} (${side})`;
    case "3800": return l.debit > 0 ? "خسائر قبل السيستم — بتتسجل تحت الأرباح المحتجزة بالسالب" : "أرباح محتجزة قبل السيستم (ربح قديم لسه متوزعش)";
    case "3200": return l.description || "مسحوبات قبل السيستم";
    default: return l.description;
  }
}

export async function fetchGapInfo(): Promise<GapInfo> {
  const { data, error } = await (supabase.rpc as any)("partner_capital_gap_info", {});
  if (error) throw error;
  return data as GapInfo;
}
export async function settleGap(items: GapItem[], apply: boolean, notes?: string) {
  const { data, error } = await (supabase.rpc as any)("partner_capital_gap_settle", { p_items: items, p_apply: apply, p_notes: notes || null });
  if (error) throw error;
  return data as { applied: boolean; gap: number; leave: boolean; lines: GapLine[]; balanced?: boolean };
}
export async function cancelGapDecision(id: string, reason: string) {
  const { error } = await (supabase.rpc as any)("partner_capital_gap_cancel", { p_id: id, p_reason: reason });
  if (error) throw error;
}
