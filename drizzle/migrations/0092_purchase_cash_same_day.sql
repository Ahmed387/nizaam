-- 0092 — «التصنيف» of a purchase invoice (owner decision 2026-10-16): a payment of the invoice's OWN plan dated the
-- invoice's own day is paid «with the invoice» = نقدي, also when the invoice was entered later with an old date.
-- Before, only a payment saved in the same 5 seconds as the invoice counted, so a backdated invoice paid on its day
-- (PO01224, PO00279 …) stayed «آجل». Only the classification changes: till, ledger, journal and supplier balances
-- are untouched.
CREATE OR REPLACE FUNCTION public.ledger_settlement_rows(p_doc_type text, p_ids uuid[])
 RETURNS TABLE(doc_id uuid, bucket text, method text, amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ok AS (
    SELECT i.id, i.created_at AS made, i.invoice_date AS dated FROM invoices i
     WHERE p_doc_type = 'invoice' AND i.id = ANY (p_ids)
    UNION ALL
    SELECT s.id, s.created_at, COALESCE(s.invoice_date::timestamptz, s.created_at) FROM shipments s
     WHERE p_doc_type = 'shipment' AND s.id = ANY (p_ids)
  ),
  ledger AS (
    SELECT pa.debt_id AS doc_id,
           CASE
             WHEN pa.mode = 'explicit' THEN 'account'
             WHEN mv.kind = 'return_credit' THEN 'return'
             WHEN mv.source_table = 'invoice_payments' AND EXISTS (
                    SELECT 1 FROM invoice_payments ip WHERE ip.id = mv.source_id
                       AND (abs(extract(epoch FROM ip.created_at - ok.made)) < 5 OR ip.created_at = ok.dated)) THEN 'at_sale'
             WHEN mv.source_table = 'payment_transactions' AND p_doc_type = 'shipment' AND EXISTS (
                    SELECT 1 FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id
                     WHERE pt.id = mv.source_id
                       AND (abs(extract(epoch FROM pt.created_at - ok.made)) < 5
                            OR (pp.reference_id = ok.id AND public.ledger_day(pt.created_at) = public.ledger_day(ok.dated)))) THEN 'at_sale'
             ELSE 'later' END AS bucket,
           CASE WHEN pa.mode = 'explicit' OR mv.kind = 'return_credit' THEN NULL ELSE COALESCE(mv.method, 'cash') END AS method,
           pa.amount
      FROM payment_allocations pa
      JOIN ok ON ok.id = pa.debt_id
      JOIN money_movements mv ON mv.id = pa.movement_id
     WHERE pa.status = 'active' AND pa.debt_type = p_doc_type
  ),
  old_inv AS (
    SELECT ip.invoice_id AS doc_id,
           CASE WHEN ip.payment_method IN ('credit_balance', 'credit_applied') THEN 'account'
                WHEN abs(extract(epoch FROM ip.created_at - ok.made)) < 5 OR ip.created_at = ok.dated THEN 'at_sale'
                ELSE 'later' END AS bucket,
           CASE WHEN ip.payment_method IN ('credit_balance', 'credit_applied') THEN NULL ELSE ip.payment_method END AS method,
           ip.amount
      FROM invoice_payments ip JOIN ok ON ok.id = ip.invoice_id
     WHERE p_doc_type = 'invoice' AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL AND ip.amount > 0
       AND ip.payment_method <> 'settlement'
       AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.doc_id = ip.invoice_id)
       AND public.ledger_day(ok.dated) < public.ledger_cutoff()
  ),
  old_ship AS (
    SELECT pp.reference_id AS doc_id,
           CASE WHEN pt.payment_method = 'credit_balance' THEN 'account'
                WHEN abs(extract(epoch FROM pt.created_at - ok.made)) < 5
                     OR public.ledger_day(pt.created_at) = public.ledger_day(ok.dated) THEN 'at_sale' ELSE 'later' END AS bucket,
           CASE WHEN pt.payment_method = 'credit_balance' THEN NULL ELSE pt.payment_method END AS method,
           pt.amount
      FROM payment_transactions pt
      JOIN payment_plans pp ON pp.id = pt.payment_plan_id AND pp.reference_type = 'shipment'
      JOIN ok ON ok.id = pp.reference_id
     WHERE p_doc_type = 'shipment' AND pt.direction = 'out' AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL
       AND pt.amount > 0 AND pt.payment_method <> 'settlement'
       AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.doc_id = pp.reference_id)
       AND public.ledger_day(ok.dated) < public.ledger_cutoff()
  )
  SELECT x.doc_id, x.bucket, x.method, round(sum(x.amount), 2)
    FROM (SELECT * FROM ledger UNION ALL SELECT * FROM old_inv UNION ALL SELECT * FROM old_ship) x
   GROUP BY 1, 2, 3;
$function$;

-- refresh the stored classification of every purchase invoice
DO $r$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_ids FROM public.shipments;
  PERFORM public.ledger_settlement_refresh('shipment', v_ids);
END $r$;
