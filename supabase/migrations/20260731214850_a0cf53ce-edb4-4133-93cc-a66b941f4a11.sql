CREATE OR REPLACE FUNCTION public.recalc_contact_balance(p_contact_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- Balances are derived live from public.v_contact_balances; nothing to recalculate.
  RETURN;
END $$;
REVOKE ALL ON FUNCTION public.recalc_contact_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_contact_balance(uuid) TO authenticated, service_role;