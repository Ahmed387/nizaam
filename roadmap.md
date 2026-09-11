# خارطة العمل — منظومة النسخ الاحتياطي والاستعادة

- [x] 1. دوال قاعدة البيانات: `backup_table_manifest()` + فلترة المستأجر + `backup_fetch_page()`
- [x] 2. جدول `backup_settings` بسياسات المالك/السوبر أدمن فقط
- [x] 3. دالة `restore_tenant_snapshot(payload jsonb)` ذرّية مع `session_replication_role='replica'`
- [x] 4. ترقية `scheduled-backup`: تدفق كامل + وسائط + `.tar.gz` (data.json + media/ + manifest.json)
- [x] 5. ربط Google Drive + تحديث موضعي `files.update` / `files.create`
- [x] 6. دالة `restore-system-backup` بتحقق المالك
- [x] 7. إعادة بناء `BackupTab.tsx`: حذف تصدير المتصفح، حصر الرتب، ربط Drive، نافذة الاستعادة
- [x] 8. إشعارات للمالك فقط بلا روابط تحميل
- [x] 9. إصلاح خطأ `column ctid does not exist` بفحص وجود العمود النظامي والتراجع لـ `ORDER BY 1`
- [x] 10. تحسين التدفق: تقليل حجم الصفحة إلى 500 سجل + إعادة محاولة RPC بتراجع exponential
- [x] 11. إضافة توضيحات Tooltip لأزرار فحص / تنزيل / استعادة / حذف في سجل النسخ
- [x] 12. بناء نظيف + تحقق الأعداد المحمية
- [x] 13. إعادة ربط Google Drive في مساحة العمل الجديدة (workspace move)
- [x] 14. تحسين استهلاك CPU: جلب صفحات خام + رفع أرشيف غير مضغوط (.tar) + دعم الاستعادة للنسختين
- [x] 15. ربط Google Drive من جديد في مساحة العمل الحالية (workspace move)
- [x] 16. ربط Google Drive في مساحة العمل الجديدة الحالية (workspace move)
- [x] 17. أتمتة إنشاء مجلد Google Drive منفصل لكل شركة وربطه بسجل النسخ الاحتياطي
- [x] 18. ربط Google Drive من مساحة العمل الجديدة والتحقق من جاهزيته للنسخ الاحتياطي
