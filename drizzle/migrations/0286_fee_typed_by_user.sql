-- 0286 — the fee of every payment is typed by whoever does it (owner 2026-11-25 «سواء التحويل بين الفروع او عمل اي عملية
-- فيها دفع فلوس او قبض فلوس بيبقي فيها عمولة واللي بيحددها اللي بيعمل العملية نفسه … ماعدا الكاش»، «الخانة اللي في
-- الاعدادات مش عاوزها»، «اللي يعمل العملية يقدر يغيرها»). Until now every money RPC threw away the fee the screen sent and
-- recomputed it from the settings (H-08, `calculate_payment_fee`). Now the screen sends the fee the person chose (none / fixed
-- / percent → an amount) and the server only checks it: `payment_fee_of(method, amount, fee)` = 0 on cash and on a book
-- vessel, never below 0, never above the payment. Where it goes is unchanged: on the company → a «عمولة تحويل» expense
-- row in the same vessel (Dr 5800); on the customer → «إيرادات أخرى» (0139). An edit that sends no fee keeps the old one.
-- Daily wages and «تحويل لنقدي» have no fee field: they keep `calculate_payment_fee` (0 once the settings hold no fee).
CREATE OR REPLACE FUNCTION pg_temp.rep(p_fn regprocedure, p_old text, p_new text) RETURNS void LANGUAGE plpgsql AS $r$
DECLARE d text := pg_get_functiondef(p_fn);
BEGIN
  IF position(p_old IN d) = 0 THEN RAISE EXCEPTION 'anchor not found in %: %', p_fn, left(p_old, 80); END IF;
  EXECUTE replace(d, p_old, p_new);
END $r$;

CREATE OR REPLACE FUNCTION public.payment_fee_of(p_method text, p_amount numeric, p_fee numeric)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN coalesce(nullif(p_method, ''), 'cash') = 'cash' THEN 0
    WHEN EXISTS (SELECT 1 FROM public.transfer_fees f WHERE f.tenant_id = public.current_tenant_id()
                   AND f.payment_method = p_method AND f.kind = 'virtual') THEN 0
    ELSE least(greatest(round(coalesce(p_fee, 0), 2), 0), greatest(coalesce(p_amount, 0), 0))
  END
$function$;
REVOKE ALL ON FUNCTION public.payment_fee_of(text, numeric, numeric) FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.add_invoice_payment(uuid,text,numeric,text,text,text,numeric,boolean,text)',
    'public.create_manual_voucher(uuid,voucher_type,uuid,numeric,text,text,text,numeric,voucher_party_type,uuid,text,text,date,text)',
    'public.disburse_employee_advance(uuid,numeric,numeric,text,text,text,text,text,numeric)',
    'public.record_contact_payment(uuid,uuid,text,numeric,text,text,text,text,numeric,text,boolean,text,text,uuid)',
    'public.record_payment_transaction(uuid,uuid,numeric,text,text,text,text,numeric,text,boolean,text,text,date)']
  LOOP
    PERFORM pg_temp.rep(f::regprocedure,
      'p_fee_amount := public.calculate_payment_fee(p_payment_method, p_amount);',
      'p_fee_amount := public.payment_fee_of(p_payment_method, p_amount, p_fee_amount);  -- 0286: typed by the user');
  END LOOP;
END $do$;

SELECT pg_temp.rep('public.edit_invoice_payment(uuid,numeric,text,text,text,text,numeric,boolean,text,text)'::regprocedure,
  $$p_fee_amount := COALESCE((SELECT x.fee_amount FROM public.invoice_payments x WHERE x.id = p_payment_id AND x.payment_method IS NOT DISTINCT FROM p_payment_method AND x.amount = p_amount), public.calculate_payment_fee(p_payment_method, p_amount));$$,
  $$p_fee_amount := public.payment_fee_of(p_payment_method, p_amount, COALESCE(p_fee_amount, (SELECT x.fee_amount FROM public.invoice_payments x WHERE x.id = p_payment_id)));  -- 0286$$);
SELECT pg_temp.rep('public.edit_payment_transaction(uuid,numeric,text,text,text,text,numeric,text,text)'::regprocedure,
  $$p_fee_amount := COALESCE((SELECT x.fee_amount FROM public.payment_transactions x WHERE x.id = p_tx_id AND x.payment_method IS NOT DISTINCT FROM p_payment_method AND x.amount = p_amount), public.calculate_payment_fee(p_payment_method, p_amount));$$,
  $$p_fee_amount := public.payment_fee_of(p_payment_method, p_amount, COALESCE(p_fee_amount, (SELECT x.fee_amount FROM public.payment_transactions x WHERE x.id = p_tx_id)));  -- 0286$$);
SELECT pg_temp.rep('public.edit_voucher(uuid,uuid,numeric,text,date,voucher_party_type,uuid,text,text,text,text,text,numeric,text)'::regprocedure,
  $$p_fee_amount := COALESCE((SELECT x.fee_amount FROM public.vouchers x WHERE x.id = p_voucher_id AND x.payment_method IS NOT DISTINCT FROM p_payment_method AND x.amount = p_amount), public.calculate_payment_fee(p_payment_method, p_amount));$$,
  $$p_fee_amount := public.payment_fee_of(p_payment_method, p_amount, COALESCE(p_fee_amount, (SELECT x.fee_amount FROM public.vouchers x WHERE x.id = p_voucher_id)));  -- 0286$$);
SELECT pg_temp.rep('public.pay_employee_salary(uuid,text,numeric,numeric,numeric,text,text,text,text,numeric,text)'::regprocedure,
  $$v_fee := CASE WHEN v_net > 0 THEN public.calculate_payment_fee(p_payment_method, v_net) ELSE 0 END;$$,
  $$v_fee := CASE WHEN v_net > 0 THEN public.payment_fee_of(p_payment_method, v_net, p_fee_amount) ELSE 0 END;  -- 0286$$);
SELECT pg_temp.rep('public.process_sale_once(uuid,uuid,uuid,numeric,numeric,numeric,text,numeric,text,jsonb,jsonb,numeric,numeric,date,text,text,numeric,text)'::regprocedure,
  $$public.calculate_payment_fee(COALESCE(e.v->>'payment_method', 'cash'), COALESCE((e.v->>'amount')::numeric, 0))$$,
  $$public.payment_fee_of(COALESCE(e.v->>'payment_method', 'cash'), COALESCE((e.v->>'amount')::numeric, 0), nullif(e.v->>'fee_amount', '')::numeric)$$);

-- the settings no longer hold a fee per vessel: every stored value is cleared so nothing computes one behind the screen
UPDATE public.transfer_fees SET fee_value = 0 WHERE coalesce(fee_value, 0) <> 0;
