-- 0096 — cancelling a return gives back only the refund money that is still out (owner report 2026-10-16, SR00069:
-- the refund voucher PV-3053 was voided first — its void put the 1,150 back in the till — then the return was
-- cancelled and put the 1,150 back a second time; the till stood 1,150 above the books).
-- cancel_sale_return / cancel_purchase_return now net the return's own till rows and the voids of its refund
-- vouchers before writing the reversal; nothing left out → no reversal row.
-- The duplicate row of SR00069 (treasury 1fda59fe…) was removed on the owner's approval (audit_log REMOVE, 0096).
DO $x$
DECLARE v text;
  n_s text := $n$-- only what is still out: the return's till rows minus the voids of its refund vouchers (0096)
  v_money := LEAST(v_money, GREATEST(0,
      COALESCE((SELECT sum(CASE WHEN t.type = 'expense' THEN t.amount ELSE -t.amount END)
                  FROM public.treasury t WHERE t.reference_id = r.id), 0)
    - COALESCE((SELECT sum(CASE WHEN t2.type = 'income' THEN t2.amount ELSE -t2.amount END)
                  FROM public.treasury t JOIN public.vouchers v ON v.treasury_id = t.id
                  JOIN public.treasury t2 ON t2.reference_id = v.id AND t2.category = 'إلغاء سند'
                 WHERE t.reference_id = r.id), 0)));
  IF v_money > 0 THEN$n$;
  n_p text := $n$-- only what is still in: the return's till rows minus the voids of its refund vouchers (0096)
  v_money := LEAST(v_money, GREATEST(0,
      COALESCE((SELECT sum(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END)
                  FROM public.treasury t WHERE t.reference_id = r.id), 0)
    - COALESCE((SELECT sum(CASE WHEN t2.type = 'expense' THEN t2.amount ELSE -t2.amount END)
                  FROM public.treasury t JOIN public.vouchers v ON v.treasury_id = t.id
                  JOIN public.treasury t2 ON t2.reference_id = v.id AND t2.category = 'إلغاء سند'
                 WHERE t.reference_id = r.id), 0)));
  IF v_money > 0 THEN$n$;
BEGIN
  v := pg_get_functiondef('public.cancel_sale_return(uuid,text)'::regprocedure);
  IF position('(0096)' in v) = 0 THEN EXECUTE replace(v, 'IF v_money > 0 THEN', n_s); END IF;
  v := pg_get_functiondef('public.cancel_purchase_return(uuid,text)'::regprocedure);
  IF position('(0096)' in v) = 0 THEN EXECUTE replace(v, 'IF v_money > 0 THEN', n_p); END IF;
END $x$;
