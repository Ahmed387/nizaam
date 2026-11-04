/**
 * Partners (migration 0137): the five cards, the money door and the labels every partner screen shares.
 *
 *  المساهمات − المسحوبات من رأس المال = رأس المال لحد النهارده
 *  صافي الربح = what was given to him (shares, operating share, salary from profit) − what he took from it − what paid back his advances
 *  السلف = advances still open
 *
 * A withdrawal «من الربح» above his profit becomes an advance by itself: profit 150,000, he takes 200,000 → 150,000 from profit,
 * 50,000 advance; the next distribution pays the advance back first.
 */
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";

export type PartnerTxType =
  | "contribution" | "capital_withdrawal" | "profit_share" | "operating_share" | "salary_share"
  | "profit_withdrawal" | "advance_settle" | "drawing" | "capital_adjustment";

export type PartnerInfo = {
  id: string; name: string; role_kind: "partner" | "employee_partner"; employee_id: string | null;
  capital_share: number; operating_share: number; is_active: boolean;
  salary_mode: "none" | "fixed" | "percent"; salary_amount: number; salary_percent: number;
  salary_base: "company" | "branch"; salary_branch_id: string | null; salary_when: "before" | "after";
  start_date: string | null; notes: string | null; initial_capital: number;
};

export type PartnerMovement = {
  id: string; type: PartnerTxType; amount: number; date: string; created_at: string; description: string | null;
  branch_id: string | null; method: string | null; void: boolean; cancel_reason: string | null;
  distribution_id: string | null; treasury_id: string | null; editable: boolean; cancellable: boolean;
};

export type PartnerAdvance = { id: string; amount: number; remaining: number; date: string; status: string; reason: string | null; paid_back: number };

export type PartnerCards = {
  partner: PartnerInfo;
  contributions: number; capital_withdrawals: number; capital: number;
  profit: number; profit_in: number; profit_out: number; advances: number;
  movements?: PartnerMovement[]; advances_list?: PartnerAdvance[];
};

/** The card a movement belongs to (clicking a card filters the movements to it). */
export type CardKey = "contributions" | "capital_withdrawals" | "capital" | "profit" | "advances";

export const TX_LABEL: Record<PartnerTxType, string> = {
  contribution: "مساهمة في رأس المال",
  capital_withdrawal: "سحب من رأس المال",
  profit_share: "نصيبه من توزيع الأرباح",
  operating_share: "حصة تشغيل",
  salary_share: "مرتب من الربح",
  profit_withdrawal: "سحب من الربح",
  advance_settle: "سداد سلفة من نصيبه",
  drawing: "مسحوبات (قديم)",
  capital_adjustment: "تسوية رأس مال (قديم)",
};

/** + adds to what he has in the company (capital + profit), − takes from it. Advances are not movements. */
export function txSign(type: string): 1 | -1 {
  return ["capital_withdrawal", "profit_withdrawal", "advance_settle", "drawing"].includes(type) ? -1 : 1;
}

export function txCard(type: string): CardKey {
  if (type === "contribution" || type === "capital_adjustment") return "contributions";
  if (type === "capital_withdrawal") return "capital_withdrawals";
  return "profit";
}

/** Movements under a card: «رأس المال» = both capital cards; «السلف» = withdrawals that opened an advance and what paid them back. */
export function movementsOfCard(card: CardKey | null, list: PartnerMovement[], advanceTreasuryIds: Set<string> = new Set()): PartnerMovement[] {
  if (!card) return list;
  if (card === "capital") return list.filter((m) => ["contributions", "capital_withdrawals"].includes(txCard(m.type)));
  if (card === "advances") return list.filter((m) => m.type === "advance_settle" || (m.treasury_id != null && advanceTreasuryIds.has(m.treasury_id)));
  return list.filter((m) => txCard(m.type) === card);
}

export type WithdrawSource = "capital" | "profit" | "split";

/** How a withdrawal splits before it is sent (the server decides again with the same rule). */
export function splitWithdrawal(amount: number, source: WithdrawSource, capitalPart: number, cards: { capital: number; profit: number }) {
  const a = round2(amount);
  const cap = source === "capital" ? a : source === "profit" ? 0 : round2(Math.min(Math.max(capitalPart || 0, 0), a));
  const fromProfit = round2(a - cap);
  const take = round2(Math.min(fromProfit, Math.max(cards.profit, 0)));
  return { capital: cap, profit: take, advance: round2(fromProfit - take) };
}

/** The first thing wrong with a money form, or null. */
export function partnerMoneyProblem(input: {
  kind: "contribution" | "withdrawal"; amount: number; branchId: string | null; date: string; today: string;
  source?: WithdrawSource; capitalPart?: number; cards?: { capital: number; profit: number };
}): string | null {
  if (!(input.amount > 0)) return "اكتب المبلغ";
  if (!input.branchId) return "اختار الفرع اللي الفلوس هتدخل / تطلع منه";
  if (!input.date) return "اختار التاريخ";
  if (input.date > input.today) return "التاريخ في المستقبل";
  if (input.kind === "withdrawal" && input.cards) {
    const s = splitWithdrawal(input.amount, input.source ?? "capital", input.capitalPart ?? 0, input.cards);
    if (input.source === "split" && !((input.capitalPart ?? 0) > 0 && (input.capitalPart ?? 0) < input.amount)) {
      return "اكتب جزء رأس المال (أكبر من صفر وأقل من المبلغ)";
    }
    if (s.capital > round2(input.cards.capital) + 0.005) return `رأس ماله ${formatEGP(input.cards.capital)} بس`;
  }
  return null;
}

/** The sentence under the withdrawal form: what will happen. */
export function withdrawalSentence(s: { capital: number; profit: number; advance: number }): string {
  const parts: string[] = [];
  if (s.capital > 0) parts.push(`${formatEGP(s.capital)} من رأس المال`);
  if (s.profit > 0) parts.push(`${formatEGP(s.profit)} من الربح`);
  if (s.advance > 0) parts.push(`${formatEGP(s.advance)} سلفة (أكتر من ربحه — بتتخصم من التوزيع الجاي)`);
  return parts.join(" + ");
}

export const pct = (fraction: number) => `${round2(Number(fraction || 0) * 100)}%`;
export const toFraction = (percentText: string | number) => round4(Number(percentText || 0) / 100);

/** How he is paid, in one line. */
export function salaryText(p: Pick<PartnerInfo, "role_kind" | "salary_mode" | "salary_amount" | "salary_percent" | "salary_base" | "salary_when">, branchName?: string): string {
  if (p.role_kind !== "employee_partner" || p.salary_mode === "none") return "مالوش مرتب";
  if (p.salary_mode === "fixed") return `مرتب ثابت ${formatEGP(p.salary_amount)} في الشهر (مع مرتبات الموظفين)`;
  const base = p.salary_base === "branch" ? `صافي ربح ${branchName ?? "الفرع"}` : "صافي ربح الشركة";
  const when = p.salary_when === "after" ? "بعد حصص التشغيل" : "قبل حصص التشغيل";
  return `${pct(p.salary_percent)} من ${base} (${when})`;
}

export function round2(n: number) { return Math.round(Number(n || 0) * 100) / 100; }
function round4(n: number) { return Math.round(Number(n || 0) * 10000) / 10000; }

// ── server calls ─────────────────────────────────────────────────────────────

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchPartnersOverview = () => rpc<PartnerCards[]>("partners_overview", {});
export const fetchPartnerCards = (partnerId: string) => rpc<PartnerCards>("partner_cards", { p_partner: partnerId });

export function partnerMoney(input: {
  partnerId: string; kind: "contribution" | "withdrawal"; amount: number; source?: WithdrawSource; capitalPart?: number;
  branchId: string; method: string; date: string; notes?: string;
}) {
  return rpc<{ treasury_id: string; capital: number; profit: number; advance: number }>("partner_money", {
    p_partner: input.partnerId, p_kind: input.kind, p_amount: input.amount, p_source: input.source ?? "capital",
    p_capital_part: input.source === "split" ? input.capitalPart ?? 0 : null, p_branch: input.branchId, p_method: input.method,
    p_date: input.date, p_notes: input.notes || null,
  });
}

export const editPartnerContribution = (txId: string, amount: number, notes?: string) =>
  rpc<unknown>("edit_partner_contribution", { p_tx: txId, p_amount: amount, p_notes: notes || null });
export const cancelPartnerTransaction = (txId: string, reason: string) =>
  rpc<{ voided: number; amount: number }>("cancel_partner_transaction", { p_tx: txId, p_reason: reason });

export type SharesRow = {
  key: string; partner_id: string; name: string; kind: "operating_share" | "salary_share"; percent: number; base: number;
  branch_id: string | null; amount: number; typed: boolean; needs_owner: boolean; salary_base?: string; salary_when?: string;
};
export type SharesPreview = { from: string; to: string; net_before: number; rows: SharesRow[]; total: number; already: boolean };

export const previewPeriodShares = (from: string, to: string, overrides: Record<string, number>) =>
  rpc<SharesPreview>("partner_period_shares_preview", { p_from: from, p_to: to, p_overrides: overrides });
export const postPeriodShares = (from: string, to: string, overrides: Record<string, number>) =>
  rpc<{ posted: number }>("post_partner_period_shares", { p_from: from, p_to: to, p_overrides: overrides });
export const cancelPeriodShares = (from: string, to: string, reason: string) =>
  rpc<{ voided: number }>("cancel_partner_period_shares", { p_from: from, p_to: to, p_reason: reason });

export type PartnerForm = {
  id?: string; name: string; role_kind: "partner" | "employee_partner"; employee_id: string | null;
  operating_on: boolean; operating_percent: string;
  salary_mode: "none" | "fixed" | "percent"; salary_amount: string; salary_percent: string;
  salary_base: "company" | "branch"; salary_branch_id: string | null; salary_when: "before" | "after";
  start_date: string; notes: string;
};

/** The form → the server's jsonb (percent boxes are typed as 10 for 10%). */
export function partnerPayload(f: PartnerForm): Record<string, unknown> {
  const salaried = f.role_kind === "employee_partner";
  return {
    ...(f.id ? { id: f.id } : {}),
    name: f.name.trim(),
    role_kind: f.role_kind,
    employee_id: f.employee_id || null,
    operating_share: f.operating_on ? toFraction(f.operating_percent) : 0,
    salary_mode: salaried ? f.salary_mode : "none",
    salary_amount: salaried && f.salary_mode === "fixed" ? Number(f.salary_amount || 0) : 0,
    salary_percent: salaried && f.salary_mode === "percent" ? toFraction(f.salary_percent) : 0,
    salary_base: f.salary_base,
    salary_branch_id: f.salary_base === "branch" ? f.salary_branch_id : null,
    salary_when: f.salary_when,
    start_date: f.start_date || null,
    notes: f.notes,
  };
}

/** The first thing wrong with the partner form, or null. */
export function partnerFormProblem(f: PartnerForm): string | null {
  if (f.role_kind === "employee_partner" && !f.employee_id) return "اختار الموظف";
  if (f.role_kind === "partner" && !f.employee_id && !f.name.trim()) return "اكتب اسم الشريك";
  if (f.operating_on && !(Number(f.operating_percent) > 0 && Number(f.operating_percent) <= 100)) return "اكتب نسبة التشغيل (من 1 لـ 100)";
  if (f.role_kind === "employee_partner") {
    if (f.salary_mode === "fixed" && !(Number(f.salary_amount) > 0)) return "اكتب المرتب الثابت";
    if (f.salary_mode === "percent") {
      if (!(Number(f.salary_percent) > 0 && Number(f.salary_percent) <= 100)) return "اكتب نسبة المرتب (من 1 لـ 100)";
      if (f.salary_base === "branch" && !f.salary_branch_id) return "اختار الفرع اللي المرتب نسبة من ربحه";
    }
  }
  return null;
}

export function formFromPartner(p: PartnerInfo): PartnerForm {
  return {
    id: p.id, name: p.name, role_kind: p.role_kind, employee_id: p.employee_id,
    operating_on: Number(p.operating_share) > 0, operating_percent: Number(p.operating_share) > 0 ? String(round2(p.operating_share * 100)) : "",
    salary_mode: p.salary_mode, salary_amount: p.salary_amount ? String(p.salary_amount) : "",
    salary_percent: p.salary_percent ? String(round2(p.salary_percent * 100)) : "",
    salary_base: p.salary_base, salary_branch_id: p.salary_branch_id, salary_when: p.salary_when,
    start_date: p.start_date ?? "", notes: p.notes ?? "",
  };
}

export const savePartner = (f: PartnerForm) => rpc<string>("save_partner", { p: partnerPayload(f) });

/** Branches money can move in: the shops first, then «خزينة الشركاء»; never the main till (contact deposits). */
export async function fetchMoneyBranches(): Promise<{ id: string; name: string; code: string | null }[]> {
  const { data } = await supabase.from("branches").select("id, name, code, is_system, is_active").order("name");
  const rows = ((data ?? []) as any[]).filter((b) => b.is_active !== false && b.code !== "MAIN-TREASURY");
  return [...rows.filter((b) => !b.is_system), ...rows.filter((b) => b.is_system)].map((b) => ({ id: b.id, name: b.name, code: b.code }));
}
