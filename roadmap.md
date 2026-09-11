# خارطة العمل — منظومة النسخ الاحتياطي والاستعادة

- [x] 1. دوال قاعدة البيانات: `backup_table_manifest()` + فلترة المستأجر + `backup_fetch_page()`
- [x] 2. جدول `backup_settings` بسياسات المالك/السوبر أدمن فقط
- [x] 3. دالة `restore_tenant_snapshot(payload jsonb)` ذرّية مع `session_replication_role='replica'`
- [x] 4. ترقية `scheduled-backup`: تدفق كامل + وسائط + `.tar.gz` (data.json + media/ + manifest.json)
- [x] 5. ربط Google Drive + تحديث موضعي `files.update` / `files.create`
- [x] 6. دالة `restore-system-backup` بتحقق المالك
- [x] 7. إعادة بناء `BackupTab.tsx`: حذف تصدير المتصفح، حصر الرتب، ربط Drive، نافذة الاستعادة
- [x] 8. إشعارات للمالك فقط بلا روابط تحميل
- [ ] 9. بناء نظيف + تحقق الأعداد المحمية
