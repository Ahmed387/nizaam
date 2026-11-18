-- 0262 (owner 2026-11-18 «اوبشن عملاء لوحديهم وموردين لوحدين خليهم اوبشن واحد»، «الكاشير يشوف ويضيف الاتنين»،
--       «يعدل … أخليه يتفتح لأي موظف إنت تحدده»):
-- (1) ONE permission «العملاء والموردين»: `suppliers.<action>` is read as `customers.<action>` in perm_resolve (the app's
--     checkPermission does the same — keep them identical); the role rows of `suppliers.*` are removed, so every role
--     follows its `customers.*` row (the cashier now views / adds suppliers too). No person / template had a suppliers rule.
-- (2) save_contact: adding = «العملاء والموردين ← يضيف» in the account's branch; editing the details = «… ← يعدل» (it was
--     owner / admin only, the switch did nothing). delete_contact / restore_contact (أرشفة / استرجاع) = «… ← يلغي».
--     perm_resolve decides (owner always; a manager can be closed by the owner; «عرض فقط» branch never writes).
-- Check: drizzle/tests/0262_checks.sql (rollback-only).

CREATE OR REPLACE FUNCTION pg_temp.rep(src text, a text, b text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(a IN src) = 0 THEN RAISE EXCEPTION 'anchor not found: %', left(a, 80); END IF;
  RETURN replace(src, a, b);
END $$;

-- 1) one switch for customers and suppliers
DO $m$
DECLARE d text := pg_get_functiondef('public.perm_resolve(uuid,text,uuid)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$  IF _uid IS NULL OR _key IS NULL THEN RETURN false; END IF;$a$,
    $b$  IF _uid IS NULL OR _key IS NULL THEN RETURN false; END IF;
  -- 0262: «العملاء والموردين» is one switch — suppliers.* reads customers.*
  IF _key LIKE 'suppliers.%' THEN _key := 'customers.' || substr(_key, 11); END IF;$b$);
  EXECUTE d;
END $m$;
DELETE FROM public.role_permissions WHERE permission_key LIKE 'suppliers.%';

-- 2) save_contact: add / edit by the switch, in the account's branch
DO $m$
DECLARE d text := pg_get_functiondef('public.save_contact(uuid,jsonb)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$    IF NOT v_admin AND NOT (
         (v_type IN ('customer', 'both') AND public.effective_permission(v_uid, 'customers.create'))
      OR (v_type IN ('supplier', 'both') AND public.effective_permission(v_uid, 'suppliers.create'))) THEN
      RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية إضافة %', CASE WHEN v_type = 'supplier' THEN 'الموردين' ELSE 'العملاء' END
        USING ERRCODE = '42501';$a$,
    $b$    IF NOT public.perm_resolve(v_uid, 'customers.create', NULLIF(p_data->>'branch_id', '')::uuid) THEN
      RAISE EXCEPTION 'مش مسموحلك تضيف حسابات — الصلاحية «العملاء والموردين ← يضيف» بتتفتح من الإعدادات ← الموظفين'
        USING ERRCODE = '42501';$b$);
  d := pg_temp.rep(d, $a$  IF NOT v_admin THEN
    RAISE EXCEPTION 'تعديل بيانات جهة التعامل للإدارة فقط — مدير الفرع يرسل طلب موافقة' USING ERRCODE = '42501';
  END IF;$a$,
    $b$  IF NOT public.perm_resolve(v_uid, 'customers.update', c.branch_id) THEN
    RAISE EXCEPTION 'مش مسموحلك تعدّل بيانات الحسابات — الصلاحية «العملاء والموردين ← يعدل» بتتفتح من الإعدادات ← الموظفين'
      USING ERRCODE = '42501';
  END IF;$b$);
  EXECUTE d;
END $m$;

-- 3) archive / restore = «… ← يلغي»
DO $m$
DECLARE d text := pg_get_functiondef('public.delete_contact(uuid)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$  IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'أرشفة جهة التعامل للإدارة فقط — مدير الفرع يرسل طلب موافقة' USING ERRCODE = '42501';
  END IF;$a$,
    $b$  IF NOT public.perm_resolve(v_uid, 'customers.delete', (SELECT gc.branch_id FROM public.contacts gc WHERE gc.id = p_id)) THEN
    RAISE EXCEPTION 'مش مسموحلك تأرشف حسابات — الصلاحية «العملاء والموردين ← يلغي» بتتفتح من الإعدادات ← الموظفين' USING ERRCODE = '42501';
  END IF;$b$);
  EXECUTE d;
  d := pg_get_functiondef('public.restore_contact(uuid)'::regprocedure);
  d := pg_temp.rep(d, $a$  IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'استرجاع حساب مؤرشف للإدارة فقط' USING ERRCODE = '42501';
  END IF;$a$,
    $b$  IF NOT public.perm_resolve(v_uid, 'customers.delete', (SELECT gc.branch_id FROM public.contacts gc WHERE gc.id = p_id)) THEN
    RAISE EXCEPTION 'مش مسموحلك تسترجع حسابات — الصلاحية «العملاء والموردين ← يلغي» بتتفتح من الإعدادات ← الموظفين' USING ERRCODE = '42501';
  END IF;$b$);
  EXECUTE d;
END $m$;

-- 4) defaults: the warehouse keeper had view / add / edit on suppliers → the same on the one switch (src/lib/roles.ts too)
DO $m$
DECLARE d text := pg_get_functiondef('public.role_permission_default(text,text)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$      'suppliers.view','suppliers.create','suppliers.update',
      'employees.view','employees.create','employees.update',
      'advances.view','advances.create',$a$,
    $b$      'suppliers.view','suppliers.create','suppliers.update',
      'customers.view','customers.create','customers.update',
      'employees.view','employees.create','employees.update',
      'advances.view','advances.create',$b$);
  EXECUTE d;
END $m$;
