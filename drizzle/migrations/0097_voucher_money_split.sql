-- 0097 — the receipt / payment voucher tables show what each voucher paid (owner request 2026-10-16: same columns as
-- the sale table): «اتخصم من فواتير» (its active allocations to invoices / purchase invoices, with their numbers) and
-- «متبقي مقدم» (what is still on account). Read from the unified ledger: the voucher's money movement is the one on
-- its till row. SECURITY INVOKER — the ledger's own RLS (company + branch) decides what a user sees.
CREATE OR REPLACE FUNCTION public.voucher_money_split(p_ids uuid[])
RETURNS TABLE(voucher_id uuid, in_ledger boolean, allocated numeric, on_account numeric, docs text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH m AS (
    SELECT v.id AS voucher_id, mm.id AS movement_id, mm.amount, mm.effect
      FROM vouchers v
      JOIN money_movements mm ON mm.treasury_id = v.treasury_id AND mm.status = 'active'
     WHERE v.id = ANY (p_ids)
  ), a AS (
    SELECT m.voucher_id, pa.amount, pa.debt_type, pa.debt_id
      FROM m JOIN payment_allocations pa ON pa.movement_id = m.movement_id AND pa.status = 'active'
  )
  SELECT v.id,
         EXISTS (SELECT 1 FROM m WHERE m.voucher_id = v.id),
         COALESCE((SELECT round(sum(a.amount), 2) FROM a WHERE a.voucher_id = v.id), 0),
         GREATEST(COALESCE((SELECT sum(m.amount) FROM m WHERE m.voucher_id = v.id AND m.effect = 'settle'), 0)
                - COALESCE((SELECT sum(a.amount) FROM a WHERE a.voucher_id = v.id), 0), 0),
         (SELECT string_agg(DISTINCT COALESCE(i.invoice_number, s.shipment_number), '، ')
            FROM a LEFT JOIN invoices i ON a.debt_type = 'invoice' AND i.id = a.debt_id
                   LEFT JOIN shipments s ON a.debt_type = 'shipment' AND s.id = a.debt_id
           WHERE a.voucher_id = v.id)
    FROM vouchers v WHERE v.id = ANY (p_ids)
$function$;
REVOKE ALL ON FUNCTION public.voucher_money_split(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voucher_money_split(uuid[]) TO authenticated;

INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('voucher_money_split', '0097', 'read: what each receipt / payment voucher paid (invoices it settled, what is still on account)')
ON CONFLICT DO NOTHING;

-- the till table's «الرصيد بعد الحركة»: the branch till after each row, in the table's own order (date, id)
CREATE OR REPLACE FUNCTION public.treasury_balance_after(p_branch uuid, p_ids uuid[])
RETURNS TABLE(id uuid, balance_after numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  SELECT x.id, x.bal FROM (
    SELECT t.id, round(sum(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END)
                   OVER (ORDER BY t.transaction_date, t.id ROWS UNBOUNDED PRECEDING), 2) AS bal
      FROM treasury t WHERE t.branch_id = p_branch
  ) x WHERE x.id = ANY (p_ids)
$function$;
REVOKE ALL ON FUNCTION public.treasury_balance_after(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.treasury_balance_after(uuid, uuid[]) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('treasury_balance_after', '0097', 'read: the branch till balance after each till row on screen')
ON CONFLICT DO NOTHING;
