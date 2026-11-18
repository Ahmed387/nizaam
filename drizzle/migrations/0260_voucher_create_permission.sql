-- 0260 (owner 2026-11-18 «ايه المشكلة في سندات القبض والصرف … لما بسمح بيها لشخص … مش قادرين ينفذوا اي سند»،
--       «موافق إن المديرين يتقفل عليهم في الفروع اللي صلاحية السندات فيها مقفولة»):
-- create_manual_voucher asked only «owner / admin / branch manager?» and never read the permission set in settings, so a
-- cashier / warehouse keeper given «سندات القبض / الصرف ← إضافة» saw the button and got «ليس لديك صلاحية لإضافة سند», and a
-- manager could still add vouchers in a branch where it is closed. It now calls assert_access(branch,
-- 'receipt_vouchers.create' | 'payment_vouchers.create') — company, suspension, paused branch, the person in the branch,
-- then perm_resolve (owner always; «عرض فقط» branch never; his rule per branch, then every branch; role / template / defaults).
-- Check: drizzle/tests/0260_voucher_permission_checks.sql (rollback-only).

CREATE OR REPLACE FUNCTION pg_temp.rep(src text, a text, b text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(a IN src) = 0 THEN RAISE EXCEPTION 'anchor not found: %', left(a, 80); END IF;
  RETURN replace(src, a, b);
END $$;

DO $m$
DECLARE d text := pg_get_functiondef('public.create_manual_voucher(uuid,voucher_type,uuid,numeric,text,text,text,numeric,voucher_party_type,uuid,text,text,date,text)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$  IF NOT (
    is_admin(auth.uid())
    OR (user_in_branch(auth.uid(), p_branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
    OR is_super_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لإضافة سند';
  END IF;$a$, $b$  -- 0260: the permission set in settings, per person and branch
  PERFORM public.assert_access(p_branch_id, NULL);
  IF NOT public.perm_resolve(auth.uid(), CASE WHEN p_type = 'receipt' THEN 'receipt_vouchers.create' ELSE 'payment_vouchers.create' END, p_branch_id) THEN
    RAISE EXCEPTION 'مش مسموحلك تعمل سند % في الفرع ده — الصلاحية بتتفتح من الإعدادات ← الموظفين', CASE WHEN p_type = 'receipt' THEN 'قبض' ELSE 'صرف' END
      USING ERRCODE = '42501';
  END IF;$b$);
  EXECUTE d;
END $m$;
