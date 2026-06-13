
CREATE POLICY "backup_files_read_admin"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'system-backups'
    AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()))
  );
