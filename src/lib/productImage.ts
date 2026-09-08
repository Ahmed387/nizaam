import { extractPath, getSignedUrl, isDirect, invalidateSigned, removeStorageFile } from "@/lib/storageImage";

export const PRODUCT_BUCKET = "product-images";

/** يستخرج مسار الملف داخل حاوية صور المنتجات من قيمة مخزّنة (لينك قديم أو مسار). */
export function extractStoragePath(value: string | null | undefined): string | null {
  return extractPath(PRODUCT_BUCKET, value);
}

/** لينك خارجي/data/blob بيتعرض زي ما هو من غير توقيع */
export function isDirectlyRenderable(value: string | null | undefined): boolean {
  return isDirect(PRODUCT_BUCKET, value);
}

/** يرجّع Signed URL مؤقت لصورة منتج (مع كاش في الذاكرة وتجديد تلقائي). */
export async function getSignedProductImageUrl(
  value: string | null | undefined,
  opts: { force?: boolean } = {},
): Promise<string | null> {
  return getSignedUrl(PRODUCT_BUCKET, value, opts);
}

/** إبطال الكاش لصورة منتج */
export function invalidateProductImage(value: string | null | undefined) {
  invalidateSigned(PRODUCT_BUCKET, value);
}

/** حذف ملف صورة المنتج فعلياً من التخزين */
export function removeProductImageFile(value: string | null | undefined) {
  return removeStorageFile(PRODUCT_BUCKET, value);
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
