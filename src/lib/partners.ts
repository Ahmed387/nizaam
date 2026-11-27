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
  /** 0295b: archived (هو كمان is_active = false) */
  archived_at?: string | null; archive_reason?: string | null;
  /** 0296: the maximum open advances (NULL = no limit) */
  max_advance?: number | null;
};

export type PartnerMovement = {
  id: string; type: PartnerTxType; amount: number; date: string; created_at: string; description: string | null;
  branch_id: string | null; method: string | null; void: boolean; cancel_reason: string | null;
  distribution_id: string | null; treasury_id: string | null; editable: boolean; cancellable: boolean;
  /** 0280: «موجود بالفعل» — capital with no till row and no entry */
  existing?: boolean;
  /** 0288: «اتدفعت إمتى» (information only), who edited / cancelled, what it replaced, proof files */
  deposited_on?: string | null; edited_at?: string | null; edited_by?: string | null; edit_reason?: string | null;
  cancelled_at?: string | null; cancelled_by?: string | null; replaces?: string | null; replaced_by?: string | null;
  replaces_amount?: number | null; files?: number;
  /** 0295: the month it counts in his capital and % from (the 1st of that month) */
  counts_from?: string | null;
};

export type RepayMode = "profit" | "salary" | "both";
export type AdvancePayment = { id: string; amount: number; date: string; method: "treasury" | "profit_deduction" | "manual" | "cash_till" | "capital" | "salary";
  ref_type: string | null; ref: string | null; status: string };
export type PartnerAdvance = { id: string; amount: number; remaining: number; date: string; status: string; reason: string | null; paid_back: number;
  /** 0296 */ repay_mode?: RepayMode; monthly?: number | null; payments?: AdvancePayment[] };

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

/**
 * The % of the profit each partner takes (the card shows it). Active partners only. When anybody has capital it follows
 * the capital (5M + 5M → 50 / 50); with no capital recorded yet it is 0 for everybody (the distribution splits by
 * capital only — `partner_shares_for_month`), flagged `fromCapital: false` so the screen says «لسه مفيش رأس مال متسجل».
 */
export function profitShares(rows: Pick<PartnerCards, "partner" | "capital">[]): Record<string, { share: number; fromCapital: boolean }> {
  const active = rows.filter((r) => r.partner.is_active);
  const total = active.reduce((s, r) => s + Math.max(Number(r.capital) || 0, 0), 0);
  const out: Record<string, { share: number; fromCapital: boolean }> = {};
  for (const r of rows) {
    if (!r.partner.is_active) { out[r.partner.id] = { share: 0, fromCapital: total > 0 }; continue; }
    out[r.partner.id] = total > 0
      ? { share: round4(Math.max(Number(r.capital) || 0, 0) / total), fromCapital: true }
      : { share: 0, fromCapital: false };
  }
  return out;
}

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
  /** 0245: the vessel account the money came to / left from */
  account?: string | null;
  /** 0295: «يتحسب من بداية شهر» (the 1st of a month) — the owner's choice */
  countsFrom?: string | null;
}) {
  return rpc<{ treasury_id: string; capital: number; profit: number; advance: number; advance_id?: string | null; counts_from?: string }>("partner_money", {
    p_partner: input.partnerId, p_kind: input.kind, p_amount: input.amount, p_source: input.source ?? "capital",
    p_capital_part: input.source === "split" ? input.capitalPart ?? 0 : null, p_branch: input.branchId, p_method: input.method,
    p_date: input.date, p_notes: input.notes || null,
    ...(input.account ? { p_account: input.account } : {}),
    ...(input.countsFrom ? { p_counts_from: input.countsFrom } : {}),
  });
}

// ── «يتحسب من بداية شهر» (owner 2026-11-27) ──────────────────────────────────
// money IN counts from the month AFTER the day it came in; money OUT stops counting in the month it went out (the
// month it left is not counted for it). The owner may choose another month: then a warning only (owner «تنبيه بس»).
export type MoneyDir = "in" | "out";
const FIRST_MONTH = "2026-01-01";
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const addMonth = (m1: string, n: number) => {
  const [y, m] = m1.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};
/** the month the rule suggests (never before January 2026, when the split starts) */
export function suggestCountsFrom(dir: MoneyDir, day: string): string {
  if (!day) return "";
  const m = dir === "in" ? addMonth(monthStart(day), 1) : monthStart(day);
  return m < FIRST_MONTH ? FIRST_MONTH : m;
}
/** a warning when the chosen month is against the rule, else null */
export function countsFromWarning(dir: MoneyDir, day: string, chosen: string): string | null {
  if (!day || !chosen) return null;
  const s = suggestCountsFrom(dir, day);
  if (dir === "in" && chosen < s) return `الفلوس دخلت يوم ${shortDayText(day)} — لو اتحسبت من ${monthLabel(chosen)} هياخد ربح عن أيام قبل ما الفلوس تدخل. القاعدة: من ${monthLabel(s)}.`;
  if (dir === "out" && chosen > s) return `الفلوس طلعت يوم ${shortDayText(day)} — لو اتحسبت من ${monthLabel(chosen)} هياخد ربح ${monthLabel(s)} على فلوس خرجت. القاعدة: من ${monthLabel(s)}.`;
  return null;
}
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export function monthLabel(m1: string): string {
  if (!m1) return "";
  const [y, m] = m1.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
const shortDayText = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
/** months to choose from: January 2026 → the month after today (and the current value, if outside) */
export function monthChoices(today: string, current?: string | null): string[] {
  const out: string[] = [];
  const last = addMonth(monthStart(today), 1);
  for (let m = FIRST_MONTH; m <= last; m = addMonth(m, 1)) out.push(m);
  if (current && !out.includes(monthStart(current))) out.push(monthStart(current));
  return out.sort();
}

// ── delete / archive a partner (0295) ────────────────────────────────────────
/** «حذف» only for a partner with nothing at all (the server checks movements / advances / logins too) */
export function canDeletePartner(c: Pick<PartnerCards, "contributions" | "capital_withdrawals" | "capital" | "profit" | "profit_in" | "profit_out" | "advances">): boolean {
  return [c.contributions, c.capital_withdrawals, c.capital, c.profit, c.profit_in, c.profit_out, c.advances].every((v) => Math.abs(Number(v) || 0) < 0.005);
}
/** why «أرشفة» is not possible yet, or null */
export function archiveProblem(c: Pick<PartnerCards, "capital" | "profit" | "advances">): string | null {
  if (Math.abs(Number(c.capital) || 0) > 0.005) return `رأس ماله ${formatEGP(Number(c.capital))} — اسحبه الأول`;
  if (Math.abs(Number(c.profit) || 0) > 0.005) return `صافي ربحه ${formatEGP(Number(c.profit))} — صفّيه الأول`;
  if ((Number(c.advances) || 0) > 0.005) return `عليه سلف ${formatEGP(Number(c.advances))} — اتسدّ الأول`;
  return null;
}
export const deletePartner = (partnerId: string, reason: string) => rpc<{ name: string }>("delete_partner", { p_partner: partnerId, p_reason: reason });
export const setPartnerArchived = (partnerId: string, archived: boolean, reason?: string) =>
  rpc<{ name: string; archived: boolean }>("set_partner_archived", { p_partner: partnerId, p_archived: archived, p_reason: reason ?? null });

export const editPartnerContribution = (txId: string, amount: number, notes?: string) =>
  rpc<unknown>("edit_partner_contribution", { p_tx: txId, p_amount: amount, p_notes: notes || null });
export const cancelPartnerTransaction = (txId: string, reason: string) =>
  rpc<{ voided: number; amount: number }>("cancel_partner_transaction", { p_tx: txId, p_reason: reason });

export type SharesRow = {
  key: string; partner_id: string; name: string; kind: "operating_share" | "salary_share"; percent: number; base: number;
  branch_id: string | null; amount: number; typed: boolean; needs_owner: boolean; salary_base?: string; salary_when?: string; computed?: number;
};
export type SharesMonth = {
  month: string; from: string; to: string; net_before: number; pay: number;
  lines: { partner_id: string; name: string; kind: "fixed" | "percent"; amount: number; percent?: number; percent_base?: PayBase; base?: number }[];
};
export type SharesPreview = { from: string; to: string; net_before: number; rows: SharesRow[]; total: number; already: boolean; months?: SharesMonth[] };

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

// ── «مرتب الشريك» (migration 0280): per month, fixed / % / both — the owner chooses ─────────────────────────────
export type PayBase = "all" | "after_fixed";
export type PayRule = { fixed: number; percent: number; base: PayBase };
export type PayRuleRow = { id: string; partner_id: string; from_month: string; fixed_amount: number; percent: number; percent_base: PayBase; notes: string | null };

/** What he takes, in words: «مرتب ثابت 10,000 ج.م + 10% من الربح بعد المرتبات الثابتة». */
export function payRuleText(r: PayRule | null | undefined): string {
  if (!r || (Number(r.fixed) <= 0 && Number(r.percent) <= 0)) return "مالوش مرتب";
  const parts: string[] = [];
  if (Number(r.fixed) > 0) parts.push(`مرتب ثابت ${formatEGP(Number(r.fixed))}`);
  if (Number(r.percent) > 0) parts.push(`${pct(r.percent)} من الربح ${r.base === "all" ? "كله" : "بعد المرتبات الثابتة"}`);
  return parts.join(" + ");
}

/** The rule in force in a month = the last one that started on / before it (same as `partner_pay_rule_for`). */
export function ruleForMonth(rows: PayRuleRow[], partnerId: string, month: string): PayRule | null {
  const m = `${month.slice(0, 7)}-01`;
  const r = rows.filter((x) => x.partner_id === partnerId && x.from_month <= m).sort((a, b) => (a.from_month < b.from_month ? 1 : -1))[0];
  return r ? { fixed: Number(r.fixed_amount), percent: Number(r.percent), base: r.percent_base } : null;
}

/**
 * One month's split, like the server: 1) every fixed salary (paid in a loss month too), 2) each % — of the whole profit or of
 * what is left after the fixed ones, 0 when that is not positive, 3) what is left by capital share.
 * Example 300,000, محمد 10,000 + 10% after fixed, 50 / 50 → محمد 10,000 + 29,000 + 130,500 = 169,500, الحاج ناصر 130,500.
 */
export function payExample(profit: number, partners: { id: string; name: string; share: number; rule: PayRule | null }[]) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const fixedAll = partners.reduce((s, p) => s + (p.rule ? Math.max(Number(p.rule.fixed) || 0, 0) : 0), 0);
  const pctOf = (p: (typeof partners)[number]) => {
    if (!p.rule || !(Number(p.rule.percent) > 0)) return 0;
    const base = p.rule.base === "all" ? profit : profit - fixedAll;
    return r2(Math.max(base, 0) * Number(p.rule.percent));
  };
  const pctAll = partners.reduce((s, p) => s + pctOf(p), 0);
  const left = r2(profit - fixedAll - pctAll);
  const byId: Record<string, { name: string; fixed: number; percent: number; capital: number; total: number }> = {};
  for (const p of partners) {
    const fixed = p.rule ? Math.max(Number(p.rule.fixed) || 0, 0) : 0;
    const percent = pctOf(p);
    const capital = r2(left * (Number(p.share) || 0));
    byId[p.id] = { name: p.name, fixed, percent, capital, total: r2(fixed + percent + capital) };
  }
  return { fixedAll, pctAll, left, byId };
}

export async function fetchPayRules(): Promise<PayRuleRow[]> {
  const { data, error } = await (supabase.from as any)("partner_pay_rules").select("id, partner_id, from_month, fixed_amount, percent, percent_base, notes").order("from_month");
  if (error) throw error;
  return (data ?? []) as PayRuleRow[];
}

export async function setPayRule(partnerId: string, month: string, rule: PayRule, notes?: string) {
  const { error } = await (supabase.rpc as any)("set_partner_pay_rule", {
    p_partner: partnerId, p_from_month: `${month.slice(0, 7)}-01`, p_fixed: Number(rule.fixed) || 0,
    p_percent: Number(rule.percent) || 0, p_percent_base: rule.base, p_notes: notes || null,
  });
  if (error) throw error;
}

/** «موجود بالفعل»: counts in his capital from the month of `day` — no till row, no journal entry. */
export async function addExistingCapital(partnerId: string, amount: number, day: string, notes?: string, deposited?: string) {
  const { data, error } = await (supabase.rpc as any)("partner_existing_capital", {
    p_partner: partnerId, p_amount: amount, p_day: day, p_notes: notes || null, p_deposited_on: deposited || null,
  });
  if (error) throw error;
  return data as string;
}

/** 0288: edit «رأس مال موجود بالفعل» (any time, reason required) → the new movement's id */
export const editExistingCapital = (txId: string, v: { amount: number; day: string; deposited?: string; notes?: string | null; reason: string }) =>
  rpc<string>("edit_existing_capital", {
    p_tx: txId, p_amount: v.amount, p_day: v.day, p_deposited_on: v.deposited || null, p_notes: v.notes ?? null, p_reason: v.reason,
  });

/** 0288: edit a contribution / capital withdrawal that went through the till (cancel on its day + the corrected one) */
export const editPartnerCapitalMove = (txId: string, v: { amount: number; date: string; notes?: string | null; reason: string; countsFrom?: string | null }) =>
  rpc<{ old: string; new: string; difference: number }>("edit_partner_capital_move", {
    p_tx: txId, p_amount: v.amount, p_date: v.date, p_notes: v.notes ?? null, p_reason: v.reason,
    ...(v.countsFrom ? { p_counts_from: v.countsFrom } : {}),
  });

/** which edit a movement takes: «موجود بالفعل» (no till) or a till capital movement; null = none */
export function editKindOf(m: Pick<PartnerMovement, "editable" | "existing" | "type" | "void">): "existing" | "till" | null {
  if (!m.editable || m.void) return null;
  // «موجود بالفعل» and «سحب قبل السيستم» (0290) are edited in the same no-till form
  if (m.existing && (m.type === "capital_adjustment" || m.type === "capital_withdrawal" || m.type === "profit_withdrawal")) return "existing";
  if (m.type === "contribution" || m.type === "capital_withdrawal") return "till";
  return null;
}

/** «اتدفعت إمتى» against «بيتحسب من»: an error stops the save, a warning only shows (owner 2026-11-26) */
export function depositCheck(day: string, deposited: string, today: string): { error?: string; warning?: string } {
  if (!deposited) return {};
  if (deposited > today) return { error: "تاريخ الإيداع مينفعش يكون بعد النهارده" };
  if (day && deposited > day) return { warning: "تاريخ الإيداع بعد «بيتحسب من» — يعني بياخد ربح عن فترة قبل ما يدفع. اتأكد إن ده مقصود." };
  return {};
}

const shortDay = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
/** the status line of a movement: cancelled / edited, by whom, when, why */
export function moveStatusText(m: PartnerMovement): string {
  if (m.void) {
    const who = [m.cancelled_by, shortDay(m.cancelled_at)].filter(Boolean).join(" — ");
    const what = m.replaced_by ? "اتعدلت" : "ملغية";
    const why = (m.cancel_reason ?? "").replace(/^اتعدلت: /, "");
    return [what, who, why].filter(Boolean).join(" — ");
  }
  if (m.replaces) {
    const before = m.replaces_amount != null ? ` (كانت ${formatEGP(Number(m.replaces_amount))})` : "";
    const who = [m.edited_by, shortDay(m.edited_at)].filter(Boolean).join(" — ");
    return [`معدلة${before}`, who, m.edit_reason ?? ""].filter(Boolean).join(" — ");
  }
  return "شغالة";
}

// ===== 0289: step 2 with the owner's own % / amounts, the distributions list, «اعكس التوزيع» =====
export type DistributionLine = { partner_id: string; name: string; amount: number; pct: number; suggested: number | null };
export type DistributionRow = {
  id: string; day: string; from: string | null; to: string | null; total: number; status: string; mode: "manual" | "auto";
  rest: "keep" | "spread" | null; available: number | null; notes: string | null; by: string | null; lines: DistributionLine[];
};
export const fetchSplitPreview = (from: string, to: string) =>
  rpc<import("./periodSplit").SplitPreview>("period_split_preview", { p_from: from, p_to: to });
export const distributeManual = (from: string, to: string, lines: { partner_id: string; amount: number }[], rest: "keep" | "spread", notes?: string) =>
  rpc<{ distribution_id: string; total_amount: number; available: number; kept: number; advances_settled: number; day: string }>(
    "distribute_profits_manual", { p_from: from, p_to: to, p_lines: lines, p_notes: notes || null, p_rest: rest });
export const fetchDistributions = () => rpc<DistributionRow[]>("profit_distributions_list", {});
export const reverseDistribution = (id: string, reason: string) => rpc<null>("reverse_period_distribution", { p_id: id, p_reason: reason });
export const lockDistributedPeriod = (from: string, to: string, reason?: string) =>
  rpc<unknown>("lock_distributed_period", { p_from: from, p_to: to, p_reason: reason || null });

// ===== 0290: «سحب قبل السيستم» and the «الملغاة» tab =====
/** money a partner took before the system: no till, no entry; 'capital' lowers his capital and %, 'profit' keeps his % */
export const addPreSystemWithdrawal = (partnerId: string, v: { amount: number; day: string; mode: "capital" | "profit"; withdrawnOn?: string; notes?: string }) =>
  rpc<string>("partner_pre_system_withdrawal", {
    p_partner: partnerId, p_amount: v.amount, p_day: v.day, p_mode: v.mode, p_withdrawn_on: v.withdrawnOn || null, p_notes: v.notes || null,
  });

/** the movement in words: the no-till kinds have their own names */
export function moveLabel(m: Pick<PartnerMovement, "type" | "existing">): string {
  if (m.existing) {
    if (m.type === "capital_adjustment") return "رأس مال موجود بالفعل";
    if (m.type === "capital_withdrawal") return "سحب قبل السيستم (من رأس المال)";
    if (m.type === "profit_withdrawal") return "سحب قبل السيستم (من الربح)";
  }
  return TX_LABEL[m.type] ?? m.type;
}

/** a capital-tab row: capital movements and every no-till one (a pre-system profit withdrawal too) */
export const isCapitalMove = (m: Pick<PartnerMovement, "type" | "existing">) =>
  ["contribution", "capital_withdrawal", "capital_adjustment"].includes(m.type) || !!m.existing;

/** «الشغالة» / «الملغاة»: a cancelled row and the old side of an edit go to «الملغاة» */
export function splitMoves<T extends Pick<PartnerMovement, "void">>(rows: T[]): { live: T[]; cancelled: T[] } {
  return { live: rows.filter((m) => !m.void), cancelled: rows.filter((m) => m.void) };
}

// ── 0296: advances — how they are paid back ─────────────────────────────────────────────────────────────────────────
export const REPAY_MODE_LABEL: Record<RepayMode, string> = { profit: "من الربح", salary: "من المرتب", both: "من المرتب والربح" };
export const PAY_METHOD_LABEL: Record<AdvancePayment["method"], string> = {
  cash_till: "رد كاش", capital: "من رأس ماله", salary: "خصم من المرتب", profit_deduction: "من توزيع الأرباح", treasury: "خزنة (قديم)", manual: "يدوي (قديم)",
};
/** a payment the owner can cancel here (cash into a till / from his capital), with the reference to send */
export const cancellableRepay = (x: AdvancePayment) => x.status === "active" && (x.method === "cash_till" || x.method === "capital") && !!x.ref;
/** why a withdrawal of `advance` more would pass his limit, or null */
export function advanceLimitProblem(maxAdvance: number | null | undefined, openNow: number, advance: number): string | null {
  if (maxAdvance == null || !(advance > 0)) return null;
  if (openNow + advance > maxAdvance + 0.005) return `حد السلفة ${formatEGP(maxAdvance)} — عليه ${formatEGP(openNow)}، والسحب ده هيعمل سلفة ${formatEGP(advance)}`;
  return null;
}
/** «تتسد إزاي؟» check before sending */
export function repayProblem(mode: RepayMode, monthly: number, remaining: number, isEmployee: boolean): string | null {
  if (mode === "profit") return null;
  if (!isEmployee) return "مش موظف — مالوش مرتب يتخصم منه";
  if (!(monthly > 0)) return "اكتب القسط اللي يتخصم من المرتب كل شهر";
  if (monthly > remaining + 0.005) return `القسط أكبر من الباقي (${formatEGP(remaining)})`;
  return null;
}
/** months to finish at that instalment */
export const monthsToRepay = (remaining: number, monthly: number) => (monthly > 0 ? Math.ceil(round2(remaining) / monthly - 1e-9) : 0);
export const repayAdvanceCash = (v: { partnerId: string; amount: number; branchId: string; method: string; date: string; notes?: string; account?: string | null }) =>
  rpc<{ treasury_id: string; paid: number; left: number }>("partner_advance_repay", { p_partner: v.partnerId, p_amount: v.amount, p_branch: v.branchId,
    p_method: v.method, p_date: v.date, p_notes: v.notes || null, ...(v.account ? { p_account: v.account } : {}) });
export const repayAdvanceFromCapital = (partnerId: string, amount: number, date: string, reason?: string) =>
  rpc<{ tx_id: string; paid: number; left: number }>("partner_advance_from_capital", { p_partner: partnerId, p_amount: amount, p_date: date, p_reason: reason || null });
export const cancelAdvanceRepay = (ref: string, reason: string) => rpc<{ kind: string; amount: number }>("cancel_partner_advance_repay", { p_ref: ref, p_reason: reason });
export const setPartnerAdvanceLimit = (partnerId: string, max: number | null) => rpc<{ max_advance: number | null }>("set_partner_advance_limit", { p_partner: partnerId, p_max: max });
export const setPartnerAdvanceRepay = (advanceId: string, mode: RepayMode, monthly?: number | null) =>
  rpc<{ mode: RepayMode }>("set_partner_advance_repay", { p_advance: advanceId, p_mode: mode, p_monthly: mode === "profit" ? null : monthly ?? null });
