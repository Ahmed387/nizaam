import { supabase } from "@/integrations/supabase/client";

export const PRODUCT_BUCKET = "product-images";

/**
 * يستخرج مسار الملف داخل الـ bucket من قيمة مخزّنة في قاعدة البيانات.
 * بيتعامل مع الشكلين:
 *  - لينك قديم عام: https://xxx.supabase.co/storage/v1/object/public/product-images/<path>
 *  - مسار مباشر: <tenant>/<branch>/123.jpg
 * بيرجّع null لو القيمة لينك خارجي (مش من التخزين بتاعنا).
 */
export function extractStoragePath(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;

  const marker = `/${PRODUCT_BUCKET}/`;
  const idx = v.indexOf(marker);
  if (idx !== -1) {
    const path = v.slice(idx + marker.length).split("?")[0];
    return decodeURIComponent(path);
  }

  // لينك خارجي (مش تخزيننا) → مايتوقّعش توقيع
  if (/^(https?:)?\/\//i.test(v) || v.startsWith("data:") || v.startsWith("blob:")) return null;

  return v.replace(/^\/+/, "");
}

/** لينك خارجي/data/blob بيتعرض زي ما هو من غير توقيع */
export function isDirectlyRenderable(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = String(value).trim();
  if (v.startsWith("data:") || v.startsWith("blob:")) return true;
  return /^(https?:)?\/\//i.test(v) && extractStoragePath(v) === null;
}

const SIGN_TTL = 60 * 60; // ساعة
const cache = new Map<string, { url: string; exp: number }>();
const inflight = new Map<string, Promise<string | null>>();

/** يرجّع Signed URL مؤقت لصورة منتج (مع كاش في الذاكرة). */
export async function getSignedProductImageUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (isDirectlyRenderable(value)) return String(value);

  const path = extractStoragePath(value);
  if (!path) return null;

  const now = Date.now();
  const hit = cache.get(path);
  if (hit && hit.exp > now + 30_000) return hit.url;

  const existing = inflight.get(path);
  if (existing) return existing;

  const p = (async () => {
    const { data, error } = await supabase.storage.from(PRODUCT_BUCKET).createSignedUrl(path, SIGN_TTL);
    inflight.delete(path);
    if (error || !data?.signedUrl) return null;
    cache.set(path, { url: data.signedUrl, exp: now + SIGN_TTL * 1000 });
    return data.signedUrl;
  })();

  inflight.set(path, p);
  return p;
}

/** يوقّع مجموعة صور مرة واحدة (للجداول والقوايم). */
export async function signManyProductImages(values: (string | null | undefined)[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    Array.from(new Set(values.filter(Boolean) as string[])).map(async (v) => {
      const url = await getSignedProductImageUrl(v);
      if (url) out[v] = url;
    })
  );
  return out;
}
