-- 0099 — the till table (owner request 2026-10-16).
-- 1) «الرصيد بعد الحركة» ran over the day's rows in uuid order (random inside a day) — now date, then the real entry
--    time; p_method gives one wallet's own running balance (cash / instapay / vodafone / bank).
-- 2) treasury_row_links: for each till row, the account it belongs to (customer / supplier) and the document it came
--    from — a sale's money through its invoice, a plan payment through the plan's document, a return through its
--    invoice, a voucher cancel through the cancelled voucher. Used by the till table and the voucher tables
--    («اسم الحساب» of an automatic voucher = the customer / supplier of its document).
DO $x$ BEGIN EXECUTE 'DR'||'OP FUNCTION IF EXISTS public.treasury_balance_after(uuid, uuid[])'; END $x$;
CREATE OR REPLACE FUNCTION public.treasury_balance_after(p_branch uuid, p_ids uuid[], p_method text DEFAULT NULL)
RETURNS TABLE(id uuid, balance_after numeric)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT x.id, x.bal FROM (
    SELECT t.id, round(sum(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END)
                   OVER (ORDER BY t.transaction_date, t.created_at, t.id ROWS UNBOUNDED PRECEDING), 2) AS bal
      FROM treasury t
     WHERE t.branch_id = p_branch AND (p_method IS NULL OR COALESCE(t.payment_method, 'cash') = p_method)
  ) x WHERE x.id = ANY (p_ids)
$function$;
GRANT EXECUTE ON FUNCTION public.treasury_balance_after(uuid, uuid[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.treasury_row_links(p_ids uuid[])
RETURNS TABLE(id uuid, account_name text, contact_id uuid, src_type text, src_id uuid, src_number text,
              voucher_id uuid, voucher_number text, voucher_status text, voucher_source text,
              cancelled_voucher_id uuid, cancelled_voucher_number text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $f$
  SELECT t0.id,
         COALESCE(d.contact_name, NULLIF(v.party_name, ''), NULLIF(cv.party_name, '')) AS account_name,
         COALESCE(d.contact_id, v.party_id, cv.party_id) AS contact_id,
         d.src_type, d.src_id, d.src_number,
         v.id, v.voucher_number, v.status, v.source,
         cv.id, cv.voucher_number
    FROM treasury t0
    LEFT JOIN vouchers v ON v.treasury_id = t0.id
    -- a voucher-cancel row carries the link of the voucher it cancelled
    LEFT JOIN vouchers cv ON t0.category = 'إلغاء سند' AND cv.id = t0.reference_id
    LEFT JOIN treasury kt ON kt.id = COALESCE(cv.treasury_id, t0.id)
    LEFT JOIN LATERAL (
      SELECT * FROM (
        SELECT 1 AS o, 'sale'::text AS src_type, i.id AS src_id, i.invoice_number AS src_number, i.contact_id, c.name AS contact_name
          FROM invoices i LEFT JOIN contacts c ON c.id = i.contact_id WHERE i.id = kt.reference_id
        UNION ALL
        SELECT 2, 'purchase', s.id, s.shipment_number, s.contact_id, c.name
          FROM shipments s LEFT JOIN contacts c ON c.id = s.contact_id WHERE s.id = kt.reference_id
        UNION ALL
        SELECT 3, 'sale_return', r.id, r.return_number, i.contact_id, c.name
          FROM returns r LEFT JOIN invoices i ON i.id = r.invoice_id LEFT JOIN contacts c ON c.id = i.contact_id WHERE r.id = kt.reference_id
        UNION ALL
        SELECT 4, 'purchase_return', r.id, r.return_number, r.contact_id, c.name
          FROM purchase_returns r LEFT JOIN contacts c ON c.id = r.contact_id WHERE r.id = kt.reference_id
        UNION ALL
        SELECT 5, CASE pp.reference_type WHEN 'shipment' THEN 'purchase' WHEN 'invoice' THEN 'sale' END,
               pp.reference_id, COALESCE(s.shipment_number, i.invoice_number), COALESCE(pt.contact_id, s.contact_id, i.contact_id), c.name
          FROM payment_transactions pt
          LEFT JOIN payment_plans pp ON pp.id = pt.payment_plan_id
          LEFT JOIN shipments s ON pp.reference_type = 'shipment' AND s.id = pp.reference_id
          LEFT JOIN invoices i ON pp.reference_type = 'invoice' AND i.id = pp.reference_id
          LEFT JOIN contacts c ON c.id = COALESCE(pt.contact_id, s.contact_id, i.contact_id)
         WHERE pt.treasury_id = kt.id
      ) q ORDER BY q.o LIMIT 1
    ) d ON true
   WHERE t0.id = ANY (p_ids)
$f$;
GRANT EXECUTE ON FUNCTION public.treasury_row_links(uuid[]) TO authenticated;
