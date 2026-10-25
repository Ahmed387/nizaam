-- 0117: the server itself refuses big / non-WebP product photos (owner 2026-10-25: «ما نهلكش السيرفر»).
-- The app shrinks every product photo on the device first (src/lib/imagePolicy.ts: 800 px, WebP, ≤ 200 KB);
-- this is the guard for any other path (old app version, a script, the storage API): ≤ 256 KB, WebP or JPEG only
-- (JPEG = the browser's fallback when it can't write WebP).
UPDATE storage.buckets
   SET file_size_limit = 262144,
       allowed_mime_types = ARRAY['image/webp', 'image/jpeg']
 WHERE id = 'product-images';
