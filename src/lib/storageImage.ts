import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/compressImage";
import { shrinkProductImage } from "@/lib/imagePolicy";
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

// A missing file (the bucket lost its files in the 2026-10-18 move) is remembered for 30 minutes, so a list of 800
// products doesn't ask again on every render / reload (2026-10-25: 10,600 failed requests in one day → 429 / 504 and
// the whole app felt disconnected).
const MISSING_TTL = 30 * 60 * 1000;
const missing = new Map<string, number>();

// Requests made in the same moment are signed together: one call for up to 100 files instead of one call per file.
type Waiter = { path: string; resolve: (u: string | null) => void };
const queues = new Map<string, Waiter[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const BATCH = 100;

async function flush(bucket: string) {
  timers.delete(bucket);
  const all = queues.get(bucket) ?? [];
  queues.delete(bucket);
  for (let i = 0; i < all.length; i += BATCH) {
    const part = all.slice(i, i + BATCH);
    const paths = Array.from(new Set(part.map((w) => w.path)));
    const now = Date.now();
    let byPath = new Map<string, string | null>();
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGN_TTL);
      if (error) throw error;
      (data ?? []).forEach((d: any) => byPath.set(d.path, d.error || !d.signedUrl ? null : d.signedUrl));
    } catch {
      // the whole call failed (network / limit): don't remember anything, the next render may try again
      byPath = new Map();
      part.forEach((w) => { inflight.delete(key(bucket, w.path)); w.resolve(null); });
      continue;
    }
    part.forEach((w) => {
      const k = key(bucket, w.path);
      const u = byPath.get(w.path) ?? null;
      inflight.delete(k);
      if (u) cache.set(k, { url: u, exp: now + SIGN_TTL * 1000 });
      else missing.set(k, now + MISSING_TTL);
      w.resolve(u);
    });
  }
}

function signLater(bucket: string, path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const q = queues.get(bucket) ?? [];
    q.push({ path, resolve });
    queues.set(bucket, q);
    if (!timers.has(bucket)) timers.set(bucket, setTimeout(() => { void flush(bucket); }, 25));
  });
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

  // a file we know is missing: no request (even on «force» — the image's own retry), until the 30 minutes pass
  const gone = missing.get(k);
  if (gone && gone > now) return null;

  if (opts.force) {
    cache.delete(k);
    inflight.delete(k);
  } else {
    const hit = cache.get(k);
    if (hit && hit.exp > now + 60_000) return hit.url;
    const pending = inflight.get(k);
    if (pending) return pending;
  }

  const p = signLater(bucket, path);
  inflight.set(k, p);
  return p;
}

/** إبطال الكاش لملف معيّن (بعد الاستبدال أو الحذف). */
export function invalidateSigned(bucket: string, value: string | null | undefined) {
  const path = extractPath(bucket, value);
  if (!path) return;
  cache.delete(key(bucket, path));
  inflight.delete(key(bucket, path));
  missing.delete(key(bucket, path));
}

/** رفع صورة مضغوطة لأي حاوية داخل مجلد الشركة، ويرجّع المسار المخزّن. */
export async function uploadImageToBucket(bucket: string, file: File, folder: string): Promise<string> {
  // صور المنتجات: سياسة واحدة صارمة لكل صورة مهما كان حجمها (800px، WebP 0.75، أقصى 200 KB — imagePolicy.ts)
  // باقي الحاويات: ضغط مركزي WebP بحد أقصى 800px وجودة 0.8 (مع رجوع تلقائي لـ JPEG لو غير مدعوم)
  const blob = bucket === "product-images"
    ? await shrinkProductImage(file, file.name)
    : await compressImage(file, { maxDim: 800, quality: 0.8, mimeType: "image/webp", sizeThreshold: 80 * 1024 });
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

/** يرفع صورة منتج مصغّرة على مسار محدد (نفس المسار اللي المنتج مستنيه) — للرفع بالجملة. */
export async function uploadProductImageAt(path: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  invalidateSigned("product-images", path);
}
