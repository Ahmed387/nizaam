/**
 * «الجرد الجزئي» (migration 0271): the count holds only the chosen items. Three ways to choose them:
 * words (any words of the name, the sale-screen search rules), items one by one, items that moved between two days.
 */
import { searchMatch } from "@/lib/search";

export type CountMode = "words" | "items" | "moved";
export interface CountScope { mode: CountMode; words?: string; from?: string; to?: string; count?: number }
export interface CountProduct { id: string; name: string; sku?: string | null; quantity?: number | null }

export const COUNT_MODE_LABEL: Record<CountMode, string> = {
  words: "بكلمة في اسم الصنف",
  items: "أصناف بعينها",
  moved: "الأصناف اللي اتحركت في فترة",
};

/** Every item whose name / code has all the typed words (no limit — the whole group goes in the count). */
export function pickByWords<T extends CountProduct>(products: T[], words: string): T[] {
  const q = words.trim();
  if (!q) return [];
  return products.filter((p) => searchMatch(q, p.name, p.sku));
}

/** What the sessions list shows next to a count. */
export function scopeLabel(scope: CountScope | null | undefined): string {
  if (!scope) return "جرد كامل";
  const n = scope.count != null ? ` — ${scope.count} صنف` : "";
  if (scope.mode === "words") return `جرد جزئي: «${scope.words ?? ""}»${n}`;
  if (scope.mode === "moved") return `جرد جزئي: اتحركت من ${scope.from ?? "?"} لـ ${scope.to ?? "?"}${n}`;
  return `جرد جزئي: أصناف مختارة${n}`;
}

/** Why the partial count cannot open yet, or null. */
export function partialProblem(mode: CountMode, ids: string[], s: { words?: string; from?: string; to?: string }): string | null {
  if (mode === "words" && !s.words?.trim()) return "اكتب كلمة من اسم الصنف (مثلاً غسالة)";
  if (mode === "moved" && (!s.from || !s.to)) return "اختار الفترة (من ← إلى)";
  if (mode === "moved" && s.from && s.to && s.to < s.from) return "تاريخ «إلى» قبل «من»";
  if (!ids.length) return "مفيش أصناف — اختار صنف واحد على الأقل";
  return null;
}
