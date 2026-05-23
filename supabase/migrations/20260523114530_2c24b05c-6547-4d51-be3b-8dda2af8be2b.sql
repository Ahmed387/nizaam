
-- recreate view as security_invoker (Postgres 15+)
DROP VIEW IF EXISTS public.voucher_treasury_balances;
CREATE VIEW public.voucher_treasury_balances WITH (security_invoker=on) AS
SELECT
  branch_id,
  tenant_id,
  payment_method,
  SUM(CASE WHEN type='receipt' THEN amount ELSE 0 END)::numeric(12,2) AS total_in,
  SUM(CASE WHEN type='payment' THEN amount ELSE 0 END)::numeric(12,2) AS total_out,
  (SUM(CASE WHEN type='receipt' THEN amount ELSE 0 END)
   - SUM(CASE WHEN type='payment' THEN amount ELSE 0 END))::numeric(12,2) AS balance
FROM vouchers
WHERE status = 'active'
GROUP BY branch_id, tenant_id, payment_method;
GRANT SELECT ON public.voucher_treasury_balances TO authenticated;

-- Lock down SECURITY DEFINER functions to authenticated only
REVOKE EXECUTE ON FUNCTION public.next_voucher_number(uuid, voucher_type) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.seed_voucher_categories(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_system_category(uuid, voucher_type, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_manual_voucher(uuid, voucher_type, uuid, numeric, text, text, text, numeric, voucher_party_type, uuid, text, text, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_voucher(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_manual_voucher(uuid, voucher_type, uuid, numeric, text, text, text, numeric, voucher_party_type, uuid, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_voucher(uuid, text) TO authenticated;
