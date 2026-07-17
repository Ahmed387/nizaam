## الفكرة

بدل ما نسجّل قيد عكسي + دفعة جديدة، هنعدّل الصف الأصلي مباشرة ونسجّل في `audit_log` القيمة القديمة والجديدة عشان يفضل History كامل.

## اللي هيتنفذ

### 1) Migration — RPCs جديدة

**`edit_invoice_payment(_payment_id, _amount, _payment_method, _reference_number, _transfer_to_account, _reason)`**

بيعمل:
- يقرأ الصف القديم من `invoice_payments`.
- يعكس أثر القيم القديمة على `treasury` (يخصم القديم من الخزنة القديمة).
- يعمل `UPDATE` مباشر بالقيم الجديدة على نفس الصف.
- يطبّق أثر القيم الجديدة على `treasury` (يضيف الجديد للخزنة الجديدة).
- لو الفاتورة فيها خطة/قسط → يحدّث `payment_plans.paid_amount` و`payment_installments`.
- يعدّل رصيد العميل في `contacts` لو فيه فرق.
- يسجّل صف في `audit_log` نوعه `payment_edited` مع `details = { old: {...}, new: {...}, reason }`.

**`edit_payment_transaction(_tx_id, _amount, _payment_method, _reference_number, _transfer_to_account, _fee_amount, _reason)`**

نفس المنطق بس لجدول `payment_transactions` (الدفعات اللي على خطة أقساط).

### 2) UI — `InvoicePaymentsDialog.tsx`

- زرار **«إلغاء»** الأحمر يتشال ويتحل مكانه زرار **«تعديل»** أزرق جنب كل دفعة نشطة.
- الضغط عليه يفتح ديالوج فيه:
  - الرقم الحالي وطريقة الدفع الحالية.
  - inputs للقيم الجديدة (amount / method / reference / account / fee).
  - textarea إجباري لسبب التعديل.
  - زرار «حفظ».
- بعد الحفظ الـ Realtime بيحدّث الصف مباشرة.
- زرار **«إضافة دفعة جديدة»** يفضل زي ما هو (مفيدة لو العميل دفع مبلغ إضافي فعلاً).

### 3) History Tab في نفس الديالوج

Tab جديد جنب «الدفعات» اسمه **«سجل التعديلات»** بيعرض قراءة من `audit_log`:
- التاريخ + المستخدم.
- إيه اللي اتغير (مثلاً: `المبلغ: 2,000 → 2,500`, `الطريقة: cash → instapay`).
- سبب التعديل.

## ملاحظات

- الأعمدة `voided_at / voided_by / void_reason / reverses_*` هنسيبها في الجداول (مش هنمسحها) عشان الدفعات القديمة اللي اتلغت بالفعل تفضل ظاهرة صح.
- التعديل بيحصل داخل transaction واحدة، لو أي خطوة فشلت كل حاجة بترجع لحالتها الأصلية.
- الحسابات (الخزنة، رصيد العميل، الخطة، الأقساط) مضمون إنها تفضل مظبوطة لأن الـ RPC بيعكس القديم ويطبّق الجديد في نفس المعاملة.

## بعد الموافقة

هعمل الـ migration الأول، وبعد ما توافق عليها هحدّث `InvoicePaymentsDialog.tsx` والـ UI.
