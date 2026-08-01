/**
 * Heuristic extraction of variant attributes (brand / model / color / type / capacity)
 * out of legacy product names + SKUs.
 *
 * Used by the "استخراج خصائص المنتجات" admin tool to backfill products that were
 * created before brand & model became first-class columns. Everything returned here
 * is a *suggestion* — the user reviews and edits before applying.
 */

import type { VariantAttrs } from "@/lib/productVariant";

/** Known brands: canonical Arabic name -> spellings found in product names. */
export const BRAND_ALIASES: Record<string, string[]> = {
  "توشيبا": ["توشيبا", "توشيبه", "toshiba"],
  "تورنيدو": ["تورنيدو", "تورنادو", "tornado"],
  "شارب": ["شارب", "sharp"],
  "كريازي": ["كريازي", "كريازى", "kiriazi"],
  "فريش": ["فريش", "fresh"],
  "يونيون اير": ["يونيون اير", "يونيونير", "union air", "unionaire"],
  "سامسونج": ["سامسونج", "سامسونغ", "samsung"],
  "إل جي": ["ال جي", "إل جي", "lg"],
  "زانوسي": ["زانوسي", "زانوسى", "zanussi"],
  "إلكترولوكس": ["الكترولوكس", "إلكترولوكس", "electrolux"],
  "بيكو": ["بيكو", "beko"],
  "وايت ويل": ["وايت ويل", "وايت ويست", "white whale", "whitewhale"],
  "ايديال": ["ايديال", "إيديال", "ideal"],
  "جولدي": ["جولدي", "جولدى", "goldi"],
  "باناسونيك": ["باناسونيك", "panasonic"],
  "هيتاشي": ["هيتاشي", "هيتاشى", "hitachi"],
  "دايو": ["دايو", "daewoo"],
  "ميديا": ["ميديا", "midea"],
  "كاريير": ["كاريير", "كارير", "carrier"],
  "هاير": ["هاير", "haier"],
  "بوش": ["بوش", "bosch"],
  "بلاك اند ديكر": ["بلاك اند ديكر", "black and decker", "black & decker"],
  "براون": ["براون", "braun"],
  "فيليبس": ["فيليبس", "philips"],
  "أوليمبيك": ["اوليمبيك", "أوليمبيك", "olympic"],
  "بيسيل": ["بيسيل", "bissell"],
  "ترست": ["ترست", "trust"],
  "بريما": ["بريما", "prima"],
  "بريمير": ["بريمير", "premier"],
  "أوليمبك إلكتريك": ["اوليمبك اليكتريك", "اوليمبك إلكتريك", "اوليمبك"],
  "سولتير": ["سولتير"],
};

/** Product types (النوع) keyed by canonical label -> spellings. */
export const TYPE_ALIASES: Record<string, string[]> = {
  "ثلاجة": ["ثلاجة", "ثلاجه"],
  "ديب فريزر": ["ديب فريزر", "ديب فريز"],
  "هوم فريزر": ["هوم فريزر", "هوم فريز"],
  "غسالة أطباق": ["غسالة اطباق", "غسالة أطباق", "غساله اطباق"],
  "غسالة": ["غسالة", "غساله"],
  "مجفف": ["مجفف", "دراير"],
  "سخان": ["سخان"],
  "تكييف": ["تكييف", "مكيف"],
  "بوتاجاز": ["بوتاجاز", "بوتجاز"],
  "فرن": ["فرن"],
  "شاشة": ["شاشة", "شاشه", "تلفزيون", "تليفزيون"],
  "مروحة": ["مروحة", "مروحه"],
  "ميكروويف": ["ميكروويف", "مايكروويف"],
  "مكنسة": ["مكنسة", "مكنسه"],
  "خلاط": ["خلاط"],
  "مضرب": ["مضرب"],
  "كبة": ["كبة", "كبه"],
  "غلاية": ["غلاية", "غلايه"],
  "مكواة": ["مكواة", "مكواه"],
  "دفاية": ["دفاية", "دفايه"],
  "شفاط": ["شفاط"],
  "محضر طعام": ["محضر طعام"],
  "عصارة": ["عصارة", "عصاره"],
};

/** Colors: canonical -> spellings (including marketing names like سلفر / شامبين). */
export const COLOR_ALIASES: Record<string, string[]> = {
  "فضي": ["فضي", "فضى", "سلفر", "سيلفر", "silver"],
  "استانلس": ["استانلس", "إستانلس", "ستانلس", "stainless"],
  "شامبين": ["شامبين", "شمبين", "champagne"],
  "أبيض": ["ابيض", "أبيض", "white"],
  "أسود": ["اسود", "أسود", "black"],
  "رمادي": ["رمادي", "رمادى", "جراي", "grey", "gray"],
  "ذهبي": ["ذهبي", "ذهبى", "جولد", "gold"],
  "أحمر": ["احمر", "أحمر", "red"],
  "أزرق": ["ازرق", "أزرق", "blue"],
  "أخضر": ["اخضر", "أخضر", "green"],
  "أصفر": ["اصفر", "أصفر", "yellow"],
  "بني": ["بني", "بنى", "brown"],
  "بيج": ["بيج", "beige"],
  "شفاف": ["شفاف"],
};

const normalize = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function matchAlias(haystack: string, table: Record<string, string[]>): string | null {
  const h = normalize(haystack);
  let best: { canonical: string; len: number } | null = null;
  for (const [canonical, aliases] of Object.entries(table)) {
    for (const alias of aliases) {
      const a = normalize(alias);
      if (a && h.includes(a) && (!best || a.length > best.len)) best = { canonical, len: a.length };
    }
  }
  return best?.canonical ?? null;
}

/** `355 لتر`, `7 كجم`, `1.5 حصان`, `32 بوصة` */
function extractCapacity(name: string): string | null {
  const patterns: [RegExp, (n: string) => string][] = [
    [/(\d+(?:[.,]\d+)?)\s*(?:لتر|لترات|ltr|liter|l\b)/i, (n) => `${n} لتر`],
    [/(\d+(?:[.,]\d+)?)\s*(?:kg|كجم|كيلو|ك\b)/i, (n) => `${n} كجم`],
    [/(\d+(?:[.,]\d+)?)\s*(?:حصان|hp)/i, (n) => `${n} حصان`],
    [/(\d+(?:[.,]\d+)?)\s*(?:بوصة|بوصه|inch|")/i, (n) => `${n} بوصة`],
    [/(\d+(?:[.,]\d+)?)\s*(?:وات|واط|watt|w\b)/i, (n) => `${n} وات`],
  ];
  for (const [re, fmt] of patterns) {
    const m = name.match(re);
    if (m) return fmt(m[1].replace(",", "."));
  }
  return null;
}

const MODEL_RE = /[A-Z0-9]{2,}(?:[-/][A-Z0-9]+(?:\([A-Z0-9]+\))?)+|\b[A-Z]{1,3}\d{2,}[A-Z0-9]*\b/;

function extractModel(name: string, sku?: string | null): string | null {
  const fromName = name.toUpperCase().match(MODEL_RE)?.[0];
  if (fromName) return fromName.trim();
  const s = (sku || "").trim();
  if (s && !/^SKU-/i.test(s) && MODEL_RE.test(s.toUpperCase())) return s;
  return null;
}

export interface ExtractedAttrs extends VariantAttrs {}

/** Suggest brand / model / color / type / capacity from a product name + sku. */
export function extractAttributes(name: string, sku?: string | null): ExtractedAttrs {
  const hay = `${name} ${sku ?? ""}`;
  return {
    brand: matchAlias(hay, BRAND_ALIASES),
    model: extractModel(name, sku),
    color: matchAlias(name, COLOR_ALIASES),
    product_type: matchAlias(name, TYPE_ALIASES),
    capacity: extractCapacity(name),
    size: null,
  };
}

/** Only the attributes that are still empty on the product — never overwrite manual data. */
export function fillableAttrs(current: VariantAttrs, suggested: ExtractedAttrs, overwrite = false): Partial<VariantAttrs> {
  const out: Partial<VariantAttrs> = {};
  (Object.keys(suggested) as (keyof VariantAttrs)[]).forEach((k) => {
    const val = (suggested[k] ?? "") as string;
    if (!val) return;
    const cur = String(current[k] ?? "").trim();
    if (overwrite || !cur) out[k] = val;
  });
  return out;
}
