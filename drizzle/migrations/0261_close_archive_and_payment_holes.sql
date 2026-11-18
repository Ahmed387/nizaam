-- 0261 (owner 2026-11-18 «أقفل الثغرتين الأول»):
-- (1) archive_product(_product_id) had NO check: any signed-in user, of any company, could archive any product by id.
--     Now: assert_access(product's branch, 'inventory.delete') — same company, branch not paused, the person in the
--     branch, and «المخزون ← يلغي» there (owner always; «عرض فقط» never).
-- (2) add_invoice_payment(...) checked only the company: any employee could add a payment to an invoice of any branch,
--     also one where he is «عرض فقط». Now: assert_access(invoice's branch, NULL) + user_can_write_branch.
-- Check: drizzle/tests/0261_checks.sql (rollback-only).

CREATE OR REPLACE FUNCTION pg_temp.rep(src text, a text, b text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(a IN src) = 0 THEN RAISE EXCEPTION 'anchor not found: %', left(a, 80); END IF;
  RETURN replace(src, a, b);
END $$;

DO $m$
DECLARE d text := pg_get_functiondef('public.archive_product(uuid)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$  IF NOT FOUND THEN RAISE EXCEPTION 'المنتج غير موجود'; END IF;$a$,
    $b$  IF NOT FOUND THEN RAISE EXCEPTION 'المنتج غير موجود'; END IF;
  -- 0261: «المخزون ← يلغي» in the product's branch
  PERFORM public.assert_access(v_product.branch_id, NULL);
  IF NOT public.perm_resolve(auth.uid(), 'inventory.delete', v_product.branch_id) THEN
    RAISE EXCEPTION 'مش مسموحلك تأرشف أصناف في الفرع ده — الصلاحية «المخزون ← يلغي» بتتفتح من الإعدادات ← الموظفين'
      USING ERRCODE = '42501';
  END IF;$b$);
  EXECUTE d;
END $m$;

DO $m$
DECLARE d text := pg_get_functiondef('public.add_invoice_payment(uuid,text,numeric,text,text,text,numeric,boolean,text)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;$a$,
    $b$  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  -- 0261: only someone who writes in the invoice's branch
  PERFORM public.assert_access(v_inv.branch_id, NULL);
  IF NOT public.is_super_admin(v_uid) AND NOT public.user_can_write_branch(v_uid, v_inv.branch_id) THEN
    RAISE EXCEPTION 'مش مسموحلك تضيف دفعات في الفرع ده — إنت «عرض فقط» فيه' USING ERRCODE = '42501';
  END IF;$b$);
  EXECUTE d;
END $m$;
