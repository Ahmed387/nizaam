-- 0143: a received stock transfer finds the product of the receiving branch by its CODE (owner «نفذ», 2026-10-30)
--
-- One product = one row per branch with the same code (0119). Receiving a transfer looked for the product by NAME and,
-- when it found none, created a new one with a random code «T-xxxxxxxx» — so a product whose name was typed a little
-- differently in the other branch became a second product with a strange code.
--   Example: عبدالمنعم sends 1 «مروحة سقف نوفا NCF-56D» (SKU-109607) to سكة; سكة has it as «مروحة سقف نوفا NCF56D»
--   → before: a new product «T-3f9a1c2b»; now: سكة's SKU-109607 row gets the piece.
-- Now: by code first, then by name (products with no code), and a missing product is created with the SAME code.
-- The search screen (any words, ة = ه, codes one or two letters away) is in src/lib/codeSuggest.ts.

DO $mig$
DECLARE d text := pg_get_functiondef('public.partial_confirm_transfer(uuid,integer)'::regprocedure);
  o1 text := $o$    SELECT id INTO dest_id
      FROM public.products
     WHERE branch_id = t.to_branch_id AND name = src.name
     LIMIT 1;$o$;
  n1 text := $n$    -- 0143: the receiving branch's row of the same product = same CODE; by name only for a product with no code
    SELECT id INTO dest_id
      FROM public.products
     WHERE branch_id = t.to_branch_id AND nullif(src.sku, '') IS NOT NULL AND sku = src.sku
     ORDER BY archived_at NULLS FIRST
     LIMIT 1;
    IF dest_id IS NULL THEN
      SELECT id INTO dest_id
        FROM public.products
       WHERE branch_id = t.to_branch_id AND name = src.name
       LIMIT 1;
    END IF;$n$;
  o2 text := $o$      new_sku := 'T-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);$o$;
  n2 text := $n$      -- 0143: a missing product is created with the SAME code (a random «T-…» only when the sender has none)
      new_sku := coalesce(nullif(src.sku, ''), 'T-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));$n$;
BEGIN
  IF position('0143' IN d) > 0 THEN RETURN; END IF;
  IF position(o1 IN d) = 0 OR position(o2 IN d) = 0 THEN RAISE EXCEPTION '0143: partial_confirm_transfer not the expected version'; END IF;
  EXECUTE replace(replace(d, o1, n1), o2, n2);
END
$mig$;
