import { payMethodLabel } from "@/lib/treasuryLinks";

/** the 4 vessels every company has; any other key is a vessel made in «وسائل الدفع» (paymob, safe, old_drawer …) */
export const BUILTIN_VESSELS = ["cash", "vodafone", "instapay", "bank"] as const;
const BUILTIN_WORDS: Record<string, string> = { كاش: "cash", محفظة: "vodafone", انستاباي: "instapay", بنكي: "bank" };

export const isBuiltinVessel = (m: string) => (BUILTIN_VESSELS as readonly string[]).includes(m);

/**
 * «طريقة الدفع» of a till row in words. Built-ins keep their short words (كاش / محفظة / انستاباي / بنكي); a vessel made
 * in the settings shows its own name — before 0287 PayMob / الخزينة / درج النقدية القديم all showed as «كاش».
 */
export function vesselWord(m: string | null | undefined, custom: Record<string, string>): string {
  const v = String(m ?? "cash");
  if (isBuiltinVessel(v)) return payMethodLabel(v);
  const generic = payMethodLabel(v);
  if (generic !== "كاش") return generic; // e.g. «etisalat_wallet» → محفظة, «credit» → من تحت الحساب
  return custom[v] || v;
}

/** the vessel key behind a word of the «طريقة الدفع» column (null = not a vessel word) */
export function methodOfWord(w: string | null | undefined, custom: Record<string, string>): string | null {
  if (!w) return null;
  if (BUILTIN_WORDS[w]) return BUILTIN_WORDS[w];
  const hit = Object.entries(custom).find(([k, l]) => !isBuiltinVessel(k) && (l === w || k === w));
  return hit ? hit[0] : null;
}

/** what a vessel card shows, in words (owner 2026-11-26: «وسائل أخرى … مفيش فيها اي توضيح») */
export function vesselMeaning(method: string, label: string, kind?: string | null): string {
  switch (method) {
    case "cash": return "الكاش اللي دخل درج الفرع واللي طلع منه في الفترة اللي فوق.";
    case "vodafone": return "اللي اتحوّل على محافظ الفرع (فودافون كاش وغيرها) واللي اتبعت منها في الفترة اللي فوق.";
    case "instapay": return "اللي دخل على انستاباي واللي اتبعت منه في الفترة اللي فوق.";
    case "bank": return "اللي دخل الحساب البنكي واللي طلع منه في الفترة اللي فوق.";
  }
  if (kind === "virtual")
    return `«${label}» وعاء حسابي، مش فلوس في درج أو محفظة: بيتسجّل عليه اللي بيتخصم أو بيتحسب كعرض. هنا اللي اتسجّل عليه وطلع منه في الفترة اللي فوق.`;
  return `«${label}» وعاء اتعمل من الإعدادات (وسائل الدفع). هنا اللي دخله وطلع منه في الفترة اللي فوق.`;
}

/** a click on a treasury card / account row → what «حركات الخزنة» shows (0287) */
export type TreasuryDetail =
  | { kind: "balance" } | { kind: "income" } | { kind: "expense" } | { kind: "net" }
  | { kind: "channel"; method: string; label: string }
  | { kind: "account"; method: string; methodLabel: string; accountId: string | null; accountName: string };

export interface DetailFilter {
  /** the banner: «بتعرض: …» */
  label: string;
  type: "all" | "income" | "expense";
  method: string | null;
  /** clear the period (the balance is from the first day) */
  allTime: boolean;
  /** a number of a vessel: its id, or null for the rows before the accounts */
  account?: { id: string | null };
}

export function detailFilter(d: TreasuryDetail): DetailFilter {
  switch (d.kind) {
    case "balance": return { label: "كل حركات الخزنة من أول يوم (كل الأوعية)", type: "all", method: null, allTime: true };
    case "income": return { label: "اللي دخل الخزنة بس في الفترة دي", type: "income", method: null, allTime: false };
    case "expense": return { label: "اللي خرج من الخزنة بس في الفترة دي", type: "expense", method: null, allTime: false };
    case "net": return { label: "كل حركات الفترة دي (دخل وخرج)", type: "all", method: null, allTime: false };
    case "channel": return { label: `حركات «${d.label}» في الفترة دي`, type: "all", method: d.method, allTime: false };
    case "account": return {
      label: `حركات «${d.accountName}» على ${d.methodLabel} من أول يوم`, type: "all", method: d.method, allTime: true,
      account: { id: d.accountId },
    };
  }
}
