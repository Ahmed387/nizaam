-- 0265 (permissions 2026-11-18): «استرجاع صنف مؤرشف» follows the same switch as archiving it — «المخزون ← يلغي»
-- (archive_product, 0261). It read «المخزون ← يعدل», so the warehouse keeper could restore what he may not archive.
CREATE OR REPLACE FUNCTION pg_temp.rep(src text, a text, b text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(a IN src) = 0 THEN RAISE EXCEPTION 'anchor not found: %', left(a, 80); END IF;
  RETURN replace(src, a, b);
END $$;
DO $m$
DECLARE d text := pg_get_functiondef('public.restore_product(uuid)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$PERFORM public.guard_read_product(_product_id, 'inventory.update');$a$,
                      $b$PERFORM public.guard_read_product(_product_id, 'inventory.delete');  -- 0265: same switch as archiving$b$);
  EXECUTE d;
END $m$;
