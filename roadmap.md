# خارطة العمل — منظومة النسخ الاحتياطي والاستعادة

- [ ] 1. دوال قاعدة البيانات: `backup_table_manifest()` + فلترة المستأجر + `backup_fetch_page()`
- [ ] 2. جدول `backup_settings` بسياسات المالك/السوبر أدمن فقط
- [ ] 3. دالة `restore_tenant_snapshot(payload jsonb)` ذرّية مع `session_replication_role='replica'`
- [ ] 4. ترقية `scheduled-backup`: تدفق كامل + وسائط + `.tar.gz` (data.json + media/ + manifest.json)
- [ ] 5. ربط Google Drive + تحديث موضعي `files.update` / `files.create`
- [ ] 6. دالة `restore-system-backup` بتحقق المالك
- [ ] 7. إعادة بناء `BackupTab.tsx`: حذف تصدير المتصفح، حصر الرتب، ربط Drive، نافذة الاستعادة
- [ ] 8. إشعارات للمالك فقط بلا روابط تحميل
- [ ] 9. بناء نظيف + تحقق الأعداد المحمية
- [ ] ربط Google Drive في الـ workspace الجديد
