-- 0086 — Changing a sale invoice's date moves the money paid WITH it (owner rule 2026-10-14).
--
-- update_invoice_date_sovereign moved the invoice and its journal but left the payment made at the sale and its
-- receipt voucher on the day the invoice was typed in: the «نقدي» card (by invoice date) and the automatic receipt
-- vouchers (by voucher date) fell in different months (IN04853: invoice 10/3, receipt 6/10).
-- Now the payments of the invoice's own day (and their till rows / receipt vouchers / plan mirrors) move to the new
-- date; payments made on later days stay on their own day.

CREATE OR REPLACE FUNCTION public.invoice_move_sale_payments(p_invoice_id uuid, p_from_day date, p_new_ts timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_day date := (p_new_ts AT TIME ZONE 'Africa/Cairo')::date; v_tenant uuid; n int := 0; m int := 0;
BEGIN
  IF p_from_day IS NULL OR p_new_ts IS NULL OR p_from_day = v_day THEN RETURN 0; END IF;
  SELECT tenant_id INTO v_tenant FROM invoices WHERE id = p_invoice_id;
  IF public.ledger_period_closed(v_tenant, p_from_day) OR public.ledger_period_closed(v_tenant, v_day) THEN
    RAISE EXCEPTION 'دفعات الفاتورة في فترة محاسبية مقفولة — مينفعش تتنقل';
  END IF;

  -- receipt vouchers first (their trigger moves the till row's transaction_date and the voucher journal)
  UPDATE vouchers v SET voucher_date = v_day
    FROM treasury t
   WHERE v.treasury_id = t.id AND t.reference_id = p_invoice_id AND t.type = 'income'
     AND t.category <> 'إلغاء سند' AND t.transaction_date = p_from_day;
  UPDATE treasury t SET created_at = p_new_ts, transaction_date = v_day
   WHERE t.reference_id = p_invoice_id AND t.type = 'income' AND t.category <> 'إلغاء سند'
     AND (t.transaction_date = p_from_day OR t.transaction_date = v_day AND public.ledger_day(t.created_at) = p_from_day);
  GET DIAGNOSTICS m = ROW_COUNT;

  -- plan mirrors of those payments and their till rows
  UPDATE vouchers v SET voucher_date = v_day
    FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id
   WHERE pp.reference_type = 'invoice' AND pp.reference_id = p_invoice_id AND v.treasury_id = pt.treasury_id
     AND pt.voided_at IS NULL AND public.ledger_day(pt.created_at) = p_from_day;
  UPDATE treasury t SET created_at = p_new_ts, transaction_date = v_day
    FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id
   WHERE pp.reference_type = 'invoice' AND pp.reference_id = p_invoice_id AND t.id = pt.treasury_id
     AND pt.voided_at IS NULL AND public.ledger_day(pt.created_at) = p_from_day;
  UPDATE payment_transactions pt SET created_at = p_new_ts
    FROM payment_plans pp
   WHERE pp.id = pt.payment_plan_id AND pp.reference_type = 'invoice' AND pp.reference_id = p_invoice_id
     AND pt.voided_at IS NULL AND public.ledger_day(pt.created_at) = p_from_day;

  -- the payments themselves (money and advance use at the sale)
  UPDATE invoice_payments ip SET created_at = p_new_ts
   WHERE ip.invoice_id = p_invoice_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
     AND public.ledger_day(ip.created_at) = p_from_day;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n + m;
END $$;
REVOKE ALL ON FUNCTION public.invoice_move_sale_payments(uuid, date, timestamptz) FROM PUBLIC, anon, authenticated;

DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.update_invoice_date_sovereign(uuid,timestamp with time zone,text)'::regprocedure);
  IF position('invoice_move_sale_payments' in d) = 0 THEN
    d := replace(d, $q$  UPDATE public.invoices
     SET invoice_date = p_new_date
   WHERE id = v_invoice.id;$q$, $q$  UPDATE public.invoices
     SET invoice_date = p_new_date
   WHERE id = v_invoice.id;

  -- 0086: the money paid with the invoice (its own day) moves with it; later payments stay on their day
  PERFORM public.invoice_move_sale_payments(v_invoice.id, public.ledger_day(v_invoice.invoice_date), p_new_date);$q$);
    IF position('invoice_move_sale_payments' in d) = 0 THEN RAISE EXCEPTION '0086: update_invoice_date_sovereign patch failed'; END IF;
    EXECUTE d;
  END IF;
END $x$;
