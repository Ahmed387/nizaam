-- 0232 — the company owner may close any open shift of his company, like an admin (owner 2026-11-15: «قفل» in
-- «سجل الورديات»). close_cashier_shift allowed the shift's cashier or the admin / super_admin role only.
DO $m$
DECLARE d text; d0 text;
BEGIN
  d := pg_get_functiondef('public.close_cashier_shift(uuid,numeric,text,boolean,boolean)'::regprocedure);
  d0 := d;
  d := replace(d, $o$     AND NOT public.has_role(auth.uid(), 'super_admin') THEN$o$,
                  $o$     AND NOT public.has_role(auth.uid(), 'super_admin')
     AND NOT public.is_owner(auth.uid()) THEN$o$);
  IF d = d0 THEN RAISE EXCEPTION '0232: close_cashier_shift text not found'; END IF;
  EXECUTE d;
END
$m$;
