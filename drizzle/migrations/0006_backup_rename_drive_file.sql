-- تحديث اسم ملف النسخ الاحتياطي على Google Drive
UPDATE public.backup_settings
SET drive_file_name = 'A&N.tar',
    updated_at = now()
WHERE drive_file_name IN (
  'AL_SHOROUK_ERP_MASTER_BACKUP.tar',
  'AL_SHOROUK_ERP_MASTER_BACKUP.tar.gz'
);

ALTER TABLE public.backup_settings
ALTER COLUMN drive_file_name SET DEFAULT 'A&N.tar';