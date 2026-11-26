-- 0289b: the suggested split was read from partner_split_by_month(…, 1), whose amounts are rounded to 0.01 — so every
-- suggestion came out in whole percents (88% / 9% / 3% instead of 88.36% / 8.55% / 3.11%). Read it on 1,000,000,000.
DO $patch$
DECLARE f text; d text; n text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.period_split_preview(date, date)', 'public.distribute_profits_manual(date, date, jsonb, text, text)'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, 'partner_split_by_month(v_t, p_from, p_to, 1)', 'partner_split_by_month(v_t, p_from, p_to, 1000000000)');
    IF n = d THEN RAISE EXCEPTION '0289b: text not found in %', f; END IF;
    EXECUTE n;
  END LOOP;
END $patch$;
