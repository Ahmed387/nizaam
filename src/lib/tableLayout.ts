/**
 * Pure rules of the table layer (owner PDF 2026-11-28 «نفذ كل اللى فى PDF», decisions 1–4):
 *  - every column has a minimum width by its kind (check box / actions / number / date / text), not one fixed 60 px;
 *  - ONE flexible column fills what is left of the frame (the column with the LONGEST content, not «the last text column»:
 *    some tables have an empty notes column), so a resized table never leaves an empty space;
 *  - widths saved on a wider screen shrink in proportion on a smaller one (option ج);
 *  - pinned columns stick at the start edge, each after the pinned ones before it;
 *  - «أساسي» / «تفاصيل» groups of the «الأعمدة» menu and its «مختصر» view.
 */
export type ColKind = "check" | "actions" | "number" | "date" | "text";

export const KIND_MIN: Record<ColKind, number> = { check: 28, actions: 44, number: 56, date: 72, text: 80 };

const DATE_RE = /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})/;
const NUM_RE = /^[-−+]?[\d٠-٩,.\s٬٫]+(ج\.?م|%|EGP)?\s*(مدين|دائن)?$/;
const ACTIONS_RE = /^(ال)?إجراءات$/;

/** the kind of a column from its title and a sample of its cells' text */
export function colKind(label: string, samples: string[], opts: { hasCheckbox?: boolean } = {}): ColKind {
  if (opts.hasCheckbox) return "check";
  if (ACTIONS_RE.test(label.trim())) return "actions";
  const vals = samples.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s && s !== "—" && s !== "-");
  if (!vals.length) return "text";
  const share = (re: RegExp) => vals.filter((v) => re.test(v)).length / vals.length;
  if (share(DATE_RE) >= 0.8) return "date";
  if (share(NUM_RE) >= 0.8) return "number";
  return "text";
}

/** average text length of a column's cells (empty cells count as 0) */
export const avgLen = (samples: string[]) =>
  samples.length ? samples.reduce((s, x) => s + x.replace(/\s+/g, " ").trim().length, 0) / samples.length : 0;

/** the flexible column: the TEXT column with the longest content; none when the table has no text column */
export function pickFlex(cols: { label: string; kind: ColKind; avg: number; hidden?: boolean; resized?: boolean }[]): string | null {
  // a column the user sized himself keeps his width: the flexible one is a text column he did not touch; only when he
  // sized them all does the longest one take the leftover again (so the table never shows an empty space)
  const pick = (list: typeof cols) => {
    let best: { label: string; avg: number } | null = null;
    for (const c of list) {
      if (c.hidden || c.kind !== "text") continue;
      if (!best || c.avg > best.avg) best = { label: c.label, avg: c.avg };
    }
    return best?.label ?? null;
  };
  return pick(cols.filter((c) => !c.resized)) ?? pick(cols);
}

/**
 * Option ج: widths saved on a screen whose table box was `savedBox` px shrink in proportion on a smaller box (never below
 * a column's minimum); on the same or a bigger screen they stay as saved.
 */
export function scaleWidths(widths: Record<string, number>, savedBox: number | undefined, box: number, mins: Record<string, number>): Record<string, number> {
  if (!savedBox || !box || box >= savedBox) return { ...widths };
  const f = box / savedBox;
  const out: Record<string, number> = {};
  for (const [k, w] of Object.entries(widths)) out[k] = Math.max(mins[k] ?? 16, Math.round(w * f));
  return out;
}

/** the table's minimum width: every shown column at its width (the flexible one at its own width as its floor) */
export const tableMinWidth = (order: string[], width: (label: string) => number, hidden: string[] = []) =>
  order.reduce((s, l) => s + (hidden.includes(l) ? 0 : width(l)), 0);

/** start offsets of the pinned columns in table order: each sticks right after the pinned ones before it */
export function pinOffsets(order: string[], pinned: string[], width: (label: string) => number, hidden: string[] = []): Record<string, number> {
  const out: Record<string, number> = {};
  let x = 0;
  for (const l of order) {
    if (hidden.includes(l) || !pinned.includes(l)) continue;
    out[l] = x;
    x += width(l);
  }
  return out;
}

/** «أساسي»: what tells the row apart and its money — number, name, amount, balance, date, status, actions */
const ESSENTIAL = [
  /^#$/, /رقم/, /^(ال)?فاتورة$/, /^(ال)?سند$/, /^(ال)?مستند$/, /اسم/, /^(ال)?(عميل|مورد|حساب|طرف|صنف|منتج|موظف|شريك|فرع)$/,
  /(ال)?مبلغ/, /(ال)?إجمالي/, /(ال)?رصيد/, /(ال)?صافي/, /^(ال)?تاريخ/, /^(ال)?حالة$/, /^(ال)?كمية$/, /^(ال)?سعر/, ACTIONS_RE,
];
export const isEssential = (label: string) => ESSENTIAL.some((re) => re.test(label.trim()));

/** «مختصر»: hide every column that is not essential (never all of them) */
export function shortView(labels: string[]): string[] {
  const hide = labels.filter((l) => !isEssential(l));
  return hide.length === labels.length ? [] : hide;
}

/** searching the columns menu: any word in any order, ال / ة / ى / أ spelling forgiven */
const norm = (s: string) => s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/^ال|\sال/g, " ").trim();
export const matchCol = (label: string, q: string) => {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const l = norm(label);
  return words.every((w) => l.includes(w));
};
