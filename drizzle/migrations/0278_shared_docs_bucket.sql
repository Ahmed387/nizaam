-- 0278 (owner 2026-11-19 «عاوز PDF من الفاتورة يتبعت في رسالة الواتساب», answer «لينك للـ PDF في الرسالة بس»): a private
-- bucket for the PDF of a document sent to a customer / supplier. One file per document (<tenant>/<kind>-<id>.pdf,
-- replaced on every send); the message carries a signed link valid 7 days. Only PDFs, ≤ 5 MB; a company reads and
-- writes only its own folder.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('shared-docs', 'shared-docs', false, 5242880, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['application/pdf'];

DROP POLICY IF EXISTS "shared-docs read" ON storage.objects;
DROP POLICY IF EXISTS "shared-docs insert" ON storage.objects;
DROP POLICY IF EXISTS "shared-docs update" ON storage.objects;
CREATE POLICY "shared-docs read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'shared-docs' AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id())::text);
CREATE POLICY "shared-docs insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shared-docs' AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id())::text);
CREATE POLICY "shared-docs update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'shared-docs' AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id())::text)
  WITH CHECK (bucket_id = 'shared-docs' AND (storage.foldername(name))[1] = (SELECT public.current_tenant_id())::text);
