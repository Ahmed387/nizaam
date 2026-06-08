# خطة إضافة ميزة جرد المخزن (Stock Inventory Count)

## نظرة عامة
إضافة نظام جرد كامل يربط 3 أدوار: المدير (إنشاء/اعتماد)، أمين المخزن (إدخال الأعداد الفعلية)، المحاسب (مراجعة الفروقات). الجرد يعمل عن طريق **Snapshot** لحظة الفتح، يعني المبيعات والمشتريات اللي تحصل بعدها مش بتأثر على الجرد.

---

## 1. قاعدة البيانات (Migration)

سأنشئ 3 جداول جديدة:

### `inventory_sessions`
- `id, tenant_id, branch_id` (المخزن = الفرع في النظام الحالي)
- `status`: enum `open | counting | reviewing | pending_approval | approved | closed | rejected`
- `created_by, approved_by, accountant_id`
- `notes, created_at, counted_at, reviewed_at, approved_at, closed_at`

### `inventory_session_items`
- `id, session_id, product_id`
- `product_name, product_code, unit` (snapshot — ثابتين)
- `system_quantity` (snapshot — ثابت)
- `actual_quantity` (nullable — أمين المخزن)
- `difference` (computed column: `actual_quantity - system_quantity`)
- `reason, notes` (المحاسب)

### `inventory_adjustments`
- `id, session_id, product_id, adjustment_amount, reason, created_by, created_at`

### دوال (Functions)
- `create_inventory_session(p_branch_id, p_notes)` → ينشئ session + يعمل snapshot لكل المنتجات في الفرع (من جدول `inventory` أو حسب البنية الحالية) في معاملة واحدة.
- `approve_inventory_session(p_session_id)` → يطبق الفروقات على المخزون الفعلي، يسجّل حركات في `stock_adjustments` الحالي + `inventory_adjustments`، ويقفل الجلسة.

### الصلاحيات (RLS + role_permissions)
- إضافة مجموعة جديدة في `PERMISSION_GROUPS`: `inventory_count` بالـactions: `view, create, count, review, approve`.
- RLS على المستوى الـtenant + branch زي باقي الجداول.

---

## 2. الصفحات الجديدة (Frontend)

كلها تحت `src/pages/branch/inventory-count/`:

| ملف | الدور | الوصف |
|---|---|---|
| `Sessions.tsx` | المدير | قائمة الجلسات + زر "بدء جرد جديد" + Badges عربية |
| `NewSession.tsx` | المدير | اختيار المخزن + ملاحظات → ينشئ + يعمل snapshot |
| `CountingSheet.tsx` | أمين المخزن | جدول: كود/اسم/وحدة/إدخال الكمية الفعلية — **بدون عرض كمية النظام**. شريط تقدم. زر "إرسال للمراجعة" |
| `Review.tsx` | المحاسب | جدول كامل بالفروقات + ألوان (أحمر نقص / أخضر زيادة / رمادي مطابق) + إدخال أسباب + "إرسال للاعتماد" |
| `Approval.tsx` | المدير | كروت ملخص + قائمة الفروقات + "اعتماد وتطبيق" / "رفض وإرجاع" |
| `Report.tsx` | الكل (تصدير للمدير) | تقرير كامل + زر تصدير PDF |

### مكونات مساعدة
- `src/components/InventoryStatusBadge.tsx` — Badge عربي ملون لكل حالة.
- `src/lib/inventoryPdf.ts` — توليد PDF عربي RTL باستخدام `jspdf` + `jspdf-autotable` مع خط عربي.

### الـRouting
إضافة المسارات في `src/App.tsx` تحت `/branch/inventory-count/...` مع `ProtectedRoute` و `perm` المناسب لكل صفحة، وعنصر في الـSidebar (`AppShell.tsx`).

---

## 3. الـReal-time
استخدام نفس نمط `useRealtimeRefresh` المستخدم في باقي النظام — اشتراك على الجداول الثلاثة لتحديث القوائم لحظياً بين الأدوار.

---

## 4. تصدير PDF
- مكتبة: `jspdf` + `jspdf-autotable` (خفيفة وتدعم العربية بخط مضاف).
- يحتوي على: هيدر (اسم الشركة من `tenant.name`، اللوجو من `tenant.logo_url`، عنوان "تقرير جرد المخزن"، التاريخ، اسم المخزن، فاتح الجلسة، تاريخ التوليد).
- جدول كامل بكل المنتجات.
- ملخص (إجمالي/مطابق/نقص/زيادة/الحالة/المعتمد).
- Footer: رقم الصفحة + Session ID + وقت التوليد.
- اسم الملف: `جرد-المخزن-[warehouse]-[date].pdf`.
- زر التصدير يعرض spinner أثناء التوليد.

---

## ملاحظات تقنية للمطور

- "Warehouse" في النظام الحالي = `branches`. سأستخدم `branch_id` لتجنب جدول جديد.
- مصدر المخزون الحالي: سأقرأ من جدول `products` أو `inventory` (سأتحقق من البنية قبل كتابة الـmigration).
- الـsnapshot يتم داخل دالة SQL واحدة (atomicity) لضمان أن المبيعات اللي بتحصل بالتوازي لا تؤثر.
- الفروقات تُطبق عند الاعتماد فقط عبر `inventory_adjustments` + تحديث المخزون الفعلي.
- لا أعدّل أي ميزة موجودة — كل شيء جديد.

---

## ترتيب التنفيذ
1. فحص بنية المخزون الحالية (`products` / `inventory` / `stock_adjustments`).
2. Migration للجداول والدوال والـRLS.
3. تثبيت `jspdf` + `jspdf-autotable`.
4. الـ6 صفحات + الـrouting + الـsidebar.
5. مكون PDF.
6. اختبار الـflow الكامل بدور كل مستخدم.

هل أبدأ التنفيذ؟
