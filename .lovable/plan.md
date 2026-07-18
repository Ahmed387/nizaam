# تعديل الفاتورة: لا حفظ إلا بعد «حفظ التعديلات»

## المشكلة الحالية
في صفحة تعديل الفاتورة، أغلب الأقسام (بيانات العميل، البنود، الخصم، الضريبة) بتتخزن محلياً ولا تنفذ إلا عند الضغط على «حفظ التعديلات». **لكن** قسم «طرق الدفع والأقساط» — أي عبر `InvoicePaymentsPanel` — بيستدعي RPCs مباشرة (`add_invoice_payment`, `edit_invoice_payment`, `edit_payment_transaction`, `void_invoice_payment`, `void_payment_transaction`, `record_payment_transaction`)، فتنعكس التغييرات على الخزنة/الحسابات في ثواني حتى لو ضغط المستخدم «إلغاء».

كذلك `EditableInvoiceDate` في الترويسة بيحفظ التاريخ فور تغييره.

## الهدف
لا شيء يُحفظ في قاعدة البيانات إلا لما المستخدم يدوس «حفظ التعديلات». الضغط على «إلغاء» أو الخروج من الصفحة = تجاهل كل التعديلات (بما فيها تعديلات الدفعات وتاريخ الفاتورة).

## خطوات التنفيذ

### 1. تحويل `InvoicePaymentsPanel` إلى وضع Staging
- إضافة prop جديد `mode: "live" | "staged"` (افتراضي `live` للمحافظة على الاستخدام الحالي في `InvoiceView`).
- في `staged`:
  - يستقبل من الأب `stagedOps` و `onStagedChange(ops)`.
  - كل زر «إضافة/تعديل/حذف دفعة» ما يستدعيش Supabase؛ بيضيف عملية في مصفوفة `stagedOps` في state الأب.
  - العمليات المرحّلة تظهر في الجدول بشارة «معلّق – لم يُحفظ» بلون تحذيري، مع زر «تراجع» يمسحها من الـ staging.
  - ملخص «المدفوع/المتبقي/الإجمالي» يُحسب من الدفعات الفعلية + الـ staged ops (إضافات موجبة، تعديلات تحل محل القيم، حذف يخصم).

### 2. تعريف نوع العمليات المرحّلة
```text
StagedPaymentOp =
  | { type: "add_invpay",  data: {...} }
  | { type: "edit_invpay", id, data: {...}, original }
  | { type: "delete_invpay", id, original, reason }
  | { type: "add_tx",  data: {...} }
  | { type: "edit_tx", id, data: {...}, original }
  | { type: "delete_tx", id, original, reason }
```

### 3. تعديل `EditSaleInvoice.tsx`
- إضافة state `stagedPaymentOps` مع setter، وتمريره للـ Panel.
- في دالة `handleSave` (بعد نجاح `edit_invoice`): تنفيذ العمليات المرحّلة بالترتيب باستدعاء نفس الـ RPCs الموجودة حالياً. لو فشلت أي عملية → عرض خطأ + إيقاف السلسلة (الفاتورة بالفعل اتحفظت، بس الدفعات تفضل مرحّلة عشان يعيد المحاولة).
- في حساب الـ diff toast: تضمين ملخص عمليات الدفع المرحّلة («+ دفعة نقدي 500 ج.م»، «تعديل دفعة #3: 200→350 ج.م»، «حذف دفعة #5»).
- زر «إلغاء» / الخروج: يستخدم `useUnsavedChanges` الموجود ليحذر لو فيه staged ops، وعند التأكيد يرمي كل الـ staging بدون أي كتابة.

### 4. تحييد الحفظ التلقائي لتاريخ الفاتورة
- في صفحة التعديل فقط، استبدال `EditableInvoiceDate` بحقل `InvoiceDateInput` عادي مربوط بـ state (`editedInvoiceDate`)، ويُرسل ضمن `edit_invoice` عند الحفظ.
- بقية الصفحات (سجل المبيعات، عرض الفاتورة) تفضل تستخدم `EditableInvoiceDate` كما هي.

### 5. علامة «تغييرات غير محفوظة»
- زر «حفظ التعديلات» يفضل معطّل لو مفيش تغييرات (نفس المنطق الحالي)، ويتفعل لو `stagedPaymentOps.length > 0` كمان.
- Badge بجوار عنوان قسم الدفعات: «# تعديلات معلّقة» لما فيه staged ops.

## ملاحظات فنية
- الـ RPCs نفسها ما تتغيرش — بس مكان استدعاءها بينتقل من الـ Panel إلى `handleSave`.
- Realtime listeners داخل الـ Panel تفضل شغالة عشان تعرض أي تحديث من مصدر تاني، لكن staged ops هتُحسب كطبقة فوق الداتا اللايف.
- `InvoicePaymentsDialog` (الاستخدام في `InvoiceView`) يبقى على وضعه `live` — التغيير يخص صفحة التعديل فقط.

## المخرجات
- تعديل: `src/components/InvoicePaymentsPanel.tsx`، `src/pages/branch/EditSaleInvoice.tsx`.
- لا يحتاج migration.
- لا يحتاج حزم جديدة.
