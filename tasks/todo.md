# Todo: رأس مال الفروع على الأوعية + رجوع / نقل (SPEC-branch-capital-vessels.md)

## Task 1: التحويل لفرع على وعاء وحسابات
**Description:** `branch_capital_allocations` يتضاف له `from_branch_id`, `kind`, `payment_method`, `from_account`, `to_account` (القديم = خزينة الشركاء / allocate / cash). `allocate_capital_to_branch(..., p_method default 'cash', p_from_account, p_to_account)`: رصيد خزينة الشركاء على الوعاء ده، الحسابين إجباري لو الوعاء عليه حسابات، صف الخروج بـ `transfer_from_account` وصف الدخول بـ `transfer_to_account`.
**Acceptance criteria:**
- [x] 100,000 فودافون من حساب أحمد (خزينة الشركاء) لحساب محمد (عبدالمنعم): رصيد أحمد −100,000، محمد +100,000، رأس مال الفرع +100,000، ليميت أحمد اتحسب
- [x] من غير حساب على وعاء عليه حسابات → مرفوض؛ مبلغ أكبر من رصيد الوعاء في خزينة الشركاء → مرفوض بالمتاح
- [x] كاش من غير حسابات = زي النهارده بالظبط
**Verification:**
- [x] اختبار SQL rolled-back (حسابات تجربة) + خزن = دفاتر، 1910 = 0، صافي الربح ما اتغيرش
**Dependencies:** None
**Files likely touched:** `drizzle/migrations/0250_branch_capital_vessels.sql`
**Estimated scope:** S

## Task 2: «رجّع / انقل رأس مال» + رأس المال الحالي
**Description:** `move_branch_capital(p_from_branch, p_to_branch /* NULL = خزينة الشركاء */, p_amount, p_date, p_method, p_from_account, p_to_account, p_notes)` (المالك / المدير / المحاسب زي التحويل): ممنوع أكتر من رأس مال الفرع الحالي أو رصيد الوعاء فيه؛ صف خروج من الفرع + صف دخول للوجهة (فئة `capital_allocation`) + صف `kind` = return / move. `get_branch_financial_position.allocated_capital` = داخل − طالع.
**Acceptance criteria:**
- [x] رجوع 30,000 → رأس مال الفرع 70,000، خزينة الشركاء +30,000 على الحساب المختار
- [x] نقل 20,000 من عبدالمنعم لسكة → عبدالمنعم 50,000، سكة +20,000، الحسابين اتحركوا
- [x] أكتر من رأس المال / من رصيد الوعاء / نفس الفرع → مرفوض بالمسموح
**Verification:**
- [x] نفس اختبار Task 1 ممتد + `security_exposed_definer_functions()` = 0
**Dependencies:** Task 1
**Files likely touched:** `drizzle/migrations/0250_branch_capital_vessels.sql`
**Estimated scope:** S

## Checkpoint: السيرفر
- [x] كل نقط الـ spec عدّت في الاختبار المتلغي، الربح والخزن = الدفاتر ما اتغيروش

## Task 3: شباك «تحويل رأس مال» بالوعاء والحسابين
**Description:** في `BranchCapital`: اختيار الوعاء (`choosable`)، `VesselAccountSelect sending` لحساب خزينة الشركاء و`VesselAccountSelect` لحساب الفرع لما الوعاء عليه حسابات؛ المتاح في خزينة الشركاء على الوعاء المختار.
**Acceptance criteria:**
- [x] الحسابين بيظهروا بس لو الوعاء عليه حسابات، وإجباريين
- [x] رسالة السيرفر (رصيد / ليميت) بتظهر بالعربي
**Verification:**
- [x] `npx tsc --noEmit -p tsconfig.app.json`، `npx vitest run`
**Dependencies:** Task 1
**Files likely touched:** `src/pages/admin/BranchCapital.tsx`, `src/lib/branchCapital.ts` (+ test)
**Estimated scope:** S

## Task 4: شباك «رجّع / انقل رأس مال» + الجدول
**Description:** زرار جديد: من فرع، إلى (خزينة الشركاء / فرع تاني)، المبلغ (حد أقصى = رأس ماله الحالي)، التاريخ، الوعاء والحسابين، ملاحظة. جدول الحركات: النوع (تحويل / رجوع / نقل)، من → إلى، الوعاء، الحسابين. كارت كل فرع «رأس المال الحالي».
**Acceptance criteria:**
- [x] الاختيارين (خزينة الشركاء / فرع تاني) موجودين
- [x] الجدول بيبيّن كل حركة بنوعها واتجاهها
**Verification:**
- [x] tsc + vitest + تجربة من المتصفح بعد الـ Publish (من غير حفظ)
**Dependencies:** Task 2, Task 3
**Files likely touched:** `src/pages/admin/BranchCapital.tsx`, `src/components/capital/MoveCapitalDialog.tsx`, `src/lib/branchCapital.ts`
**Estimated scope:** M

## Checkpoint: كامل
- [x] AGENTS.md bullet، commit + push، تذكير بالـ Publish، تجربة المتصفح
