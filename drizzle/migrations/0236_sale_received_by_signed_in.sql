-- 0236 — «الموظف اللي استلم الفلوس» on a NEW sale = the signed-in account that makes the invoice
-- (owner 2026-11-16 «خليها اوتوماتيك اللي استلم الفلوس هوا صاحب الاكونت اللي بيطلع منه الفاتورة»).
-- process_sale used the name typed in the payment line and fell back to the user's name; now the user's name wins
-- and the typed text is only a fallback (a server call with no profile). The screen shows the field read-only.
-- Editing a payment later (EditPaymentDialog) is unchanged. No stored row is changed.
DO $mig$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.process_sale(uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb,numeric,numeric,date)'::regprocedure);
  n := replace(d, $a$COALESCE(NULLIF(v_pay->>'received_by_name',''), v_user_name)$a$,
                  $b$COALESCE(v_user_name, NULLIF(v_pay->>'received_by_name',''))$b$);
  IF n = d THEN
    IF strpos(d, $b$COALESCE(v_user_name, NULLIF(v_pay->>'received_by_name',''))$b$) > 0 THEN RETURN; END IF;  -- already applied
    RAISE EXCEPTION '0236: received_by line not found in process_sale';
  END IF;
  EXECUTE n;
END $mig$;
