/** Helpers for the platform owner's plans / subscriptions screens (migration 0239). */

export interface Feature { key: string; label: string; section: string; parent: string | null; kind: "page" | "service" }
export interface Plan {
  id: string | null; name: string; description: string | null;
  monthly_price: number; yearly_price: number; monthly_discount_pct: number; yearly_discount_pct: number;
  max_branches: number | null; max_users: number | null; max_invoices_month: number | null;
  all_features: boolean; is_active: boolean; sort: number; features: string[]; companies: number;
}
export type Cycle = "monthly" | "yearly" | "unlimited";

export const afterDiscount = (price: number, pct: number) => Math.round(Number(price || 0) * (1 - Number(pct || 0) / 100) * 100) / 100;

export const limitText = (n: number | null | undefined) => (n == null ? "بلا حد" : String(n));

export function statusLabel(s: string | null | undefined): string {
  switch (s) {
    case "active": return "شغال";
    case "ending": return "قرب يخلص";
    case "grace": return "فترة سماح";
    case "expired": return "خلص — للعرض بس";
    default: return "مفيش اشتراك";
  }
}

/** Sections in catalogue order, tabs right under their page. */
export function groupFeatures(features: Feature[]): { section: string; items: Feature[] }[] {
  const out: { section: string; items: Feature[] }[] = [];
  for (const f of features) {
    let g = out.find((x) => x.section === f.section);
    if (!g) { g = { section: f.section, items: [] }; out.push(g); }
    if (!f.parent) g.items.push(f);
  }
  for (const f of features) {
    if (!f.parent) continue;
    const g = out.find((x) => x.section === f.section)!;
    const at = g.items.findIndex((x) => x.key === f.parent);
    // after the parent and its tabs already placed
    let i = at + 1;
    while (i < g.items.length && g.items[i].parent === f.parent) i++;
    g.items.splice(at < 0 ? g.items.length : i, 0, f);
  }
  return out;
}

/** The end day of a period that starts on `start` (YYYY-MM-DD): a month / a year later, minus one day. */
export function periodEnd(start: string, cycle: Cycle): string | null {
  if (cycle === "unlimited" || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const [y, m, d] = start.split("-").map(Number);
  const t = new Date(Date.UTC(cycle === "yearly" ? y + 1 : y, cycle === "yearly" ? m - 1 : m, d));
  // a 31st into a shorter month rolls over (Postgres keeps the last day): clamp like Postgres
  const wantMonth = (cycle === "yearly" ? m - 1 : m) % 12;
  if (t.getUTCMonth() !== wantMonth) t.setUTCDate(0);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** «باقي 12 يوم» / «خلص من 3 يوم» / «بيخلص النهارده». */
export function countdownText(daysLeft: number | null | undefined): string {
  if (daysLeft == null) return "مفتوح";
  if (daysLeft > 0) return `باقي ${daysLeft} يوم`;
  if (daysLeft === 0) return "بيخلص النهارده";
  return `خلص من ${-daysLeft} يوم`;
}
