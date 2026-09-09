import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/compressImage";
import { tenantStoragePath } from "@/lib/attachmentPath";

/** مدة صلاحية الرابط الموقّع (ساعة) */
export const SIGN_TTL = 60 * 60;

type CacheEntry = { url: string; exp: number };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

const key = (bucket: string, path: string) => `${bucket}::${path}`;

/** استخراج المسار داخل الحاوية من قيمة مخزّنة (لينك قديم أو مسار مباشر). */
export function extractPath(bucket: string, value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;

  const marker = `/${bucket}/`;
  const idx = v.indexOf(marker);
  if (idx !== -1) return decodeURIComponent(v.slice(idx + marker.length).split("?")[0]);

  if (/^(https?:)?\/\//i.test(v) || v.startsWith("data:") || v.startsWith("blob:")) return null;
  return v.replace(/^\/+/, "");
}

/** قيمة تُعرض مباشرة بدون توقيع (لينك خارجي / data / blob). */
export function isDirect(bucket: string, value: string | null | undefined): boolean {
  if (!value) return false;
  const v = String(value).trim();
  if (v.startsWith("data:") || v.startsWith("blob:")) return true;
  return /^(https?:)?\/\//i.test(v) && extractPath(bucket, v) === null;
}

/** رابط موقّع مؤقت لأي حاوية، مع كاش وتجديد تلقائي عند الطلب. */
export async function getSignedUrl(
  bucket: string,
  value: string | null | undefined,
  opts: { force?: boolean } = {},
): Promise<string | null> {
  if (!value) return null;
  if (isDirect(bucket, value)) return String(value);

  const path = extractPath(bucket, value);
  if (!path) return null;

  const k = key(bucket, path);
  const now = Date.now();

  if (opts.force) {
    cache.delete(k);
    inflight.delete(k);
  } else {
    const hit = cache.get(k);
    if (hit && hit.exp > now + 60_000) return hit.url;
    const pending = inflight.get(k);
    if (pending) return pending;
  }

  const p = (async () => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGN_TTL);
    inflight.delete(k);
    if (error || !data?.signedUrl) return null;
    cache.set(k, { url: data.signedUrl, exp: now + SIGN_TTL * 1000 });
    return data.signedUrl;
  })();

  inflight.set(k, p);
  return p;
}

/** إبطال الكاش لملف معيّن (بعد الاستبدال أو الحذف). */
export function invalidateSigned(bucket: string, value: string | null | undefined) {
  const path = extractPath(bucket, value);
  if (!path) return;
  cache.delete(key(bucket, path));
  inflight.delete(key(bucket, path));
}

/** رفع صورة مضغوطة لأي حاوية داخل مجلد الشركة، ويرجّع المسار المخزّن. */
export async function uploadImageToBucket(bucket: string, file: File, folder: string): Promise<string> {
  // ضغط مركزي: WebP بحد أقصى 800px وجودة 0.8 (مع رجوع تلقائي لـ JPEG لو غير مدعوم)
  const blob = await compressImage(file, { maxDim: 800, quality: 0.8, mimeType: "image/webp", sizeThreshold: 80 * 1024 });
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  const sub = (folder || "shared").replace(/^\/+|\/+$/g, "") || "shared";
  const path = await tenantStoragePath(`${sub}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { upsert: false, contentType: blob.type });
  if (error) throw error;
  return path;
}

/** حذف الملف الفعلي من الحاوية (يتجاهل الروابط الخارجية). */
export async function removeStorageFile(bucket: string, value: string | null | undefined): Promise<void> {
  const path = extractPath(bucket, value);
  if (!path) return;
  invalidateSigned(bucket, value);
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}
