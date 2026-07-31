DO $mig$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'process_sale' AND p.pronargs = 12;

  IF v_def IS NULL THEN RAISE EXCEPTION 'process_sale(12 args) not found'; END IF;

  v_def := replace(v_def,
    'SELECT COALESCE(balance, 0) INTO v_prev_balance FROM public.contacts WHERE id = p_customer_id;',
    'SELECT COALESCE(total_balance, 0) INTO v_prev_balance FROM public.v_contact_balances WHERE contact_id = p_customer_id;');

  v_def := replace(v_def,
    'PERFORM public.recalc_contact_balance(p_customer_id);',
    '');

  v_def := replace(v_def,
    'SELECT COALESCE(balance, 0) INTO v_curr_balance FROM public.contacts WHERE id = p_customer_id;',
    'SELECT COALESCE(total_balance, 0) INTO v_curr_balance FROM public.v_contact_balances WHERE contact_id = p_customer_id;');

  IF v_def LIKE '%FROM public.contacts WHERE id = p_customer_id%' THEN
    RAISE EXCEPTION 'stale contacts.balance reference remains';
  END IF;

  EXECUTE v_def;
END
$mig$;