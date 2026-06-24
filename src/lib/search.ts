// Universal search helpers — case-insensitive, digit-tolerant (Arabic/English),
// and forgiving of common Arabic letter variants & diacritics.

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;

export function normalizeForSearch(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // unify digits
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  s = s.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  // remove diacritics & tatweel
  s = s.replace(DIACRITICS, "").replace(TATWEEL, "");
  // unify alef / yaa / taa marbuta variants
  s = s.replace(/[إأآا]/g, "ا").replace(/[ىي]/g, "ي").replace(/ة/g, "ه");
  return s.toLowerCase().trim();
}

/** True if `needle` is found anywhere in any of the haystack fields (case-insensitive). */
export function searchMatch(needle: string, ...haystacks: unknown[]): boolean {
  const q = normalizeForSearch(needle);
  if (!q) return true;
  return haystacks.some((h) => normalizeForSearch(h).includes(q));
}
