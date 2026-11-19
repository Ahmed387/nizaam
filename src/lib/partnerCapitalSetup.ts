import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";

/**
 * «ظبّط رأس مال الشركاء» (migration 0275, owner «نفذ» 2026-11-19): how much of the money that was already in the
 * business when the books started (account 3950 «رصيد افتتاحي») belongs to each partner, plus the partners' money in /
 * out during the year. What is left of 3950 stays as retained earnings. The split of the profit follows the capital.
 */

export type SetupPartner = { id: string; name: string; opening: number; capital: number; capital_share: number };
export type SetupInfo = { start_day: string | null; opening_equity: number; distributed: boolean; partners: SetupPartner[] };
export type MoveKind = "cash" | "supplier" | "withdrawal";
export type SetupMove = {
  key: string; kind: MoveKind; partner_id: string; branch_id: string; amount: string; date: string;
  supplier_id: string; notes: string;
};
export type SetupResultRow = { id: string; name: string; capital_before: number; capital_after: number; share_before: number; share_after: number };
export type SetupResult = {
  start_day: string; opening_equity: number; opening_total: number; kept_as_retained: number;
  partners: SetupResultRow[]; applied: boolean; books_balanced?: boolean;
};

export const MOVE_LABEL: Record<MoveKind, string> = {
  cash: "حط فلوس كاش في الدرج",
  supplier: "دفع لمورد من جيبه",
  withdrawal: "سحب من رأس ماله",
};

let seq = 0;
export function emptyMove(today: string): SetupMove {
  seq += 1;
  return { key: `m${seq}`, kind: "cash", partner_id: "", branch_id: "", amount: "", date: today, supplier_id: "", notes: "" };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Typed boxes → amounts. In percent mode each box is a % of the net worth on the first day. */
export function amountsOf(mode: "amount" | "percent", typed: Record<string, string>, netWorth: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(typed)) {
    const n = Number(v || 0);
    out[id] = mode === "percent" ? r2((netWorth * n) / 100) : r2(n);
  }
  return out;
}

export function openingProblem(amounts: Record<string, number>, netWorth: number): string | null {
  const vals = Object.values(amounts);
  if (vals.some((v) => v < 0)) return "رأس المال مينفعش يبقى بالسالب";
  const total = r2(vals.reduce((s, v) => s + v, 0));
  if (total <= 0) return "اكتب رأس مال شريك واحد على الأقل";
  if (total > netWorth + 0.01) return `المجموع ${formatEGP(total)} أكبر من صافي الملك يوم البداية ${formatEGP(netWorth)}`;
  return null;
}

export function moveProblem(m: SetupMove, startDay: string, today: string): string | null {
  if (!m.partner_id) return "اختار الشريك";
  if (!m.branch_id) return "اختار الفرع";
  if (!(Number(m.amount) > 0)) return "المبلغ لازم يكون أكبر من صفر";
  if (!m.date) return "اختار اليوم";
  if (m.date < startDay) return "التاريخ قبل بداية الدفاتر — ده جزء من رأس المال الافتتاحي";
  if (m.date > today) return "التاريخ في المستقبل";
  if (m.kind === "supplier" && !m.supplier_id) return "اختار المورد";
  return null;
}

export function setupPayload(partners: { id: string }[], amounts: Record<string, number>, moves: SetupMove[], apply: boolean) {
  return {
    p_openings: partners.map((p) => ({ partner_id: p.id, amount: r2(amounts[p.id] ?? 0) })),
    p_moves: moves.map((m) => ({
      kind: m.kind, partner_id: m.partner_id, branch_id: m.branch_id, amount: r2(Number(m.amount)), date: m.date,
      ...(m.kind === "supplier" ? { supplier_id: m.supplier_id } : {}), method: "cash", notes: m.notes.trim() || null,
    })),
    p_apply: apply,
  };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchSetupInfo = () => rpc<SetupInfo>("partner_capital_setup_info", {});
export const runSetup = (payload: ReturnType<typeof setupPayload>) => rpc<SetupResult>("partner_capital_setup", payload);
