-- 0151: after the go-live wipe (0150) the owner also removes the supplier price lists, the audit log («سجل العمليات») and
-- every old backup (owner 2026-11-04 «امسح دول قوايم الأسعار، وسجل العمليات … النسخ الاحتياطية القديمة … امسحها مش
-- عاوزها»). The backup files themselves (bucket `system-backups`) are removed through the Storage API by the one-time
-- edge function `purge-old-files`; this empties their bookkeeping rows. Nothing else changes; new rows start from empty.
TRUNCATE public.price_list_items, public.price_list_sources, public.audit_log,
         public.system_backups, public.backup_cron_parts, public.backup_cron_runs;
