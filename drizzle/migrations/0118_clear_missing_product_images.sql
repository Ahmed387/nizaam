-- 0118 — products whose photo file is not in storage get no photo (owner «نفذ» 2026-10-25).
-- Why: a product pointing to a missing file makes every screen ask storage for it (a wasted request per
-- employee); a product with no photo asks nothing. After the 753-photo upload 21 products (7 items × 3
-- branches: the 6 big photos the owner dropped + the Toshiba fridge photo that was never found) pointed
-- to missing files. Dry-run: 21 cleared, 0 missing after, 2,257 products keep their photo.
-- Only the image field changes; the file of any photo that exists is never touched.
UPDATE public.products p
   SET image = NULL
 WHERE COALESCE(p.image, '') <> ''
   AND p.image !~* '^https?:'
   AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'product-images' AND o.name = p.image);
