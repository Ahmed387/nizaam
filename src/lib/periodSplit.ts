/**
 * Step 2 «وزّع الباقي» with the owner's own % / amounts (0289, owner 2026-11-26). Pure helpers: the % base is what is
 * AVAILABLE for the period; typing a % fills the amount and typing an amount fills the %; the others never move by
 * themselves (owner answer 1); a remainder is the owner's choice on the screen — keep it in the company or spread it on
 * the partners by the ratios he typed (owner 2026-11-26 «خليني انا اللي اقرر بين أ او ب ساعتها»).
 */
export type SplitPartner = {
  partner_id: string; name: string; capital_start: number; capital_end: number;
  suggested: number; in_period: boolean; advances: number;
};
export type SplitPreview = {
  from: string; to: string; net_profit: number; already: number; available: number; pay_missing: boolean; partners: SplitPartner[];
};
export type SplitRow = SplitPartner & { amount: number; pct: number };
export type RestChoice = "keep" | "spread";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** the suggested rows (partners with capital in the period), amounts = suggested × available, rounding on the last one */
export function suggestedRows(p: SplitPreview): SplitRow[] {
  const base = Math.max(Number(p.available) || 0, 0);
  const rows = p.partners.filter((x) => x.in_period).map((x) => ({ ...x, pct: Number(x.suggested) || 0, amount: r2((Number(x.suggested) || 0) * base) }));
  const diff = r2(base - rows.reduce((s, x) => s + x.amount, 0));
  if (rows.length && Math.abs(diff) > 0 && Math.abs(diff) < 1) rows[0] = { ...rows[0], amount: r2(rows[0].amount + diff) };
  return rows;
}

export const setPct = (rows: SplitRow[], id: string, pct: number, available: number): SplitRow[] =>
  rows.map((x) => (x.partner_id === id ? { ...x, pct: Math.max(pct, 0), amount: r2(Math.max(pct, 0) * Math.max(available, 0)) } : x));

export const setAmount = (rows: SplitRow[], id: string, amount: number, available: number): SplitRow[] =>
  rows.map((x) => (x.partner_id === id ? { ...x, amount: r2(Math.max(amount, 0)), pct: available > 0 ? Math.max(amount, 0) / available : 0 } : x));

export function addPartner(rows: SplitRow[], p: SplitPartner): SplitRow[] {
  return rows.some((x) => x.partner_id === p.partner_id) ? rows : [...rows, { ...p, pct: 0, amount: 0 }];
}

export function splitTotals(rows: SplitRow[], available: number) {
  const total = r2(rows.reduce((s, x) => s + (Number(x.amount) || 0), 0));
  const avail = r2(Math.max(available, 0));
  const rest = r2(avail - total);
  return { total, pct: avail > 0 ? total / avail : 0, rest, over: rest < -0.01, under: rest > 0.01, exact: Math.abs(rest) <= 0.01 };
}

/** «وزّع الباقي على الشركا»: every amount × available / total, rounding on the biggest */
export function spreadRest(rows: SplitRow[], available: number): SplitRow[] {
  const { total } = splitTotals(rows, available);
  if (total <= 0 || available <= 0) return rows;
  const k = available / total;
  const out = rows.map((x) => ({ ...x, amount: r2(x.amount * k) }));
  const diff = r2(available - out.reduce((s, x) => s + x.amount, 0));
  if (diff !== 0) {
    const i = out.reduce((b, x, j) => (x.amount > out[b].amount ? j : b), 0);
    out[i] = { ...out[i], amount: r2(out[i].amount + diff) };
  }
  return out.map((x) => ({ ...x, pct: x.amount / available }));
}

/** what is sent to distribute_profits_manual: the screen's rows, or spread to the whole available (choice ب) */
export function finalLines(rows: SplitRow[], available: number, rest: RestChoice): { partner_id: string; amount: number }[] {
  const t = splitTotals(rows, available);
  const use = rest === "spread" && t.under ? spreadRest(rows, available) : rows;
  return use.filter((x) => x.amount > 0).map((x) => ({ partner_id: x.partner_id, amount: r2(x.amount) }));
}

/** why «وزّع» is closed (null = it can go) */
export function splitProblem(p: SplitPreview | null, rows: SplitRow[], rest: RestChoice | null): string | null {
  if (!p) return "اختار الفترة الأول";
  if (p.pay_missing) return "سجّل مرتبات الشركاء للفترة دي (خطوة 1) الأول";
  if (!(p.available > 0)) return "مفيش ربح متاح للتوزيع في الفترة دي";
  const t = splitTotals(rows, p.available);
  if (t.total <= 0) return "اكتب نصيب شريك واحد على الأقل";
  if (t.over) return "الإجمالي أكبر من المتاح — نزّل نسبة حد";
  if (t.under && !rest) return "اختار هتعمل إيه في الباقي";
  return null;
}
