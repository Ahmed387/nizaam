REVOKE ALL ON FUNCTION public.edit_partner_transaction(uuid, text, numeric, text, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edit_partner_transaction(uuid, text, numeric, text, text, timestamp with time zone) FROM anon;
GRANT EXECUTE ON FUNCTION public.edit_partner_transaction(uuid, text, numeric, text, text, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_partner_transaction(uuid, text, numeric, text, text, timestamp with time zone) TO service_role;