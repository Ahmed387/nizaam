-- 0247 — a vessel transfer between two accounts of ONE vessel (0244) hit the old CHECK (from_method <> to_method):
-- `vessel_transfers.from_account / to_account` are stored, and the check allows one vessel when the two accounts differ.
ALTER TABLE public.vessel_transfers ADD COLUMN IF NOT EXISTS from_account text, ADD COLUMN IF NOT EXISTS to_account text;
ALTER TABLE public.vessel_transfers DROP CONSTRAINT IF EXISTS vessel_transfers_check;
ALTER TABLE public.vessel_transfers ADD CONSTRAINT vessel_transfers_check CHECK (
  from_method <> to_method
  OR (from_account IS NOT NULL AND to_account IS NOT NULL
      AND public.vessel_account_key(from_account) IS DISTINCT FROM public.vessel_account_key(to_account)));
DO $m$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.transfer_between_vessels(uuid,text,text,numeric,text,numeric,date,text,text,text)'::regprocedure);
  n := replace(d, $a$transfer_date, notes, created_by)
  VALUES (v_t, p_branch, p_from, p_to, round(p_amount, 2), coalesce(p_fee_mode, 'none'), coalesce(p_fee_value, 0), v_fee,
          v_day, v_note, v_uid)$a$, $b$transfer_date, notes, created_by, from_account, to_account)
  VALUES (v_t, p_branch, p_from, p_to, round(p_amount, 2), coalesce(p_fee_mode, 'none'), coalesce(p_fee_value, 0), v_fee,
          v_day, v_note, v_uid, v_fa, v_ta)$b$);
  IF n = d THEN RAISE EXCEPTION '0247: anchor'; END IF;
  EXECUTE n;
END $m$;
