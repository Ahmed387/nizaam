# Implementation Plan: رأس مال الفروع على الأوعية + رجوع / نقل رأس المال

Source spec: SPEC-branch-capital-vessels.md (approved 2026-11-17)

## Overview
تحويل رأس المال من خزينة الشركاء لفرع بقى على وعاء وحسابات (0244 / 0246)، وفيه عملية جديدة «رجّع / انقل رأس مال» من فرع لخزينة الشركاء أو لفرع تاني. رأس مال الفرع = اللي دخله − اللي طلع منه. لا إيراد ولا مصروف — الربح ما يتغيرش.

## Architecture Decisions
- **صف واحد = حركة رأس مال من مكان لمكان.** `branch_capital_allocations` يتضاف له `from_branch_id` (خزينة الشركاء = فرع النظام `PARTNER-CASH`)، `kind` ('allocate' | 'return' | 'move')، `payment_method`، `from_account`، `to_account`. القديم: `from_branch_id` = خزينة الشركاء، `kind = 'allocate'`، `payment_method = 'cash'`.
  رأس مال فرع X = Σ amount حيث `branch_id = X` − Σ amount حيث `from_branch_id = X`. نفس المعادلة لكل الأنواع، ورأس مال خزينة الشركاء مش بيتحسب (هي المصدر).
- **نفس فئة الخزنة `capital_allocation`** للأنواع التلاتة — `map_treasury_to_category_key` و`post_voucher_journal` و`voucher_flow_class_of` بيعاملوها أصلًا كتحويل داخلي من غير سند ومن غير ربح؛ فئة جديدة كانت هتحتاج تعديل الأربعة.
- **القيد = `post_treasury_transfer_leg`** لكل صف خزنة (زي 0205): خروج Dr 1910 / Cr النقدية، دخول Dr النقدية / Cr 1910 → 1910 = صفر بعد العملية، والحسابات (1100 / 1110) بتمشي مع الوعاء.
- **دالة واحدة جديدة** `move_branch_capital(p_from_branch, p_to_branch /* NULL = خزينة الشركاء */, p_amount, p_date, p_method, p_from_account, p_to_account, p_notes)`؛ و`allocate_capital_to_branch` يتضاف لها `p_method / p_from_account / p_to_account` (بقيم افتراضية، فالشاشة القديمة تفضل شغالة).
- الحساب / الليميت / الربط بالحساب بيحصلوا لوحدهم من الـ triggers (0244 / 0246) لما صف الخروج يبقى عليه `transfer_from_account` وصف الدخول `transfer_to_account`.

## Task List

### Phase 1: السيرفر
- [x] Task 1: التحويل لفرع على وعاء وحسابات (migration 0250 أ)
- [x] Task 2: «رجّع / انقل رأس مال» + رأس المال الحالي في `get_branch_financial_position` (migration 0250 ب)

### Checkpoint: السيرفر
- [x] اختبار rolled-back للست نقط في الـ spec + الربح والخزن = الدفاتر ما اتغيروش + `security_exposed_definer_functions()` = 0

### Phase 2: الشاشة
- [x] Task 3: شباك «تحويل رأس مال» بالوعاء والحسابين
- [x] Task 4: شباك «رجّع / انقل رأس مال» + جدول الحركات بالنوع والوعاء والحسابات + «رأس المال الحالي»

### Checkpoint: كامل
- [x] `npx vitest run` + `npx tsc --noEmit -p tsconfig.app.json`، bullet في AGENTS.md، رفع، Publish، تجربة من المتصفح من غير حفظ

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| تغيير توقيع `allocate_capital_to_branch` يحتاج DROP + CREATE (Supabase هيسأل المالك) | Med | معاملات جديدة بقيم افتراضية؛ dry-run الأول؛ grant + allowlist في نفس الـ migration |
| رأس مال فرع يطلع بالسالب من حركات قديمة | Low | الرجوع / النقل ممنوع فوق رأس المال الحالي؛ مفيش حركات قديمة عند A&N (0 صف) |
| رصيد الوعاء في الفرع مش كفاية | Med | نفس شيك `transfer_treasury_atomic` (الرصيد على الوعاء) والرسالة فيها المتاح |
| ليميت حساب الإرسال | Low | الـ trigger (0246) بيرفض ويقول المسموح — نفس الرسالة بتظهر في الشاشة |

## Open Questions
- مفيش.
