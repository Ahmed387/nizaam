-- 0096 — cancelling a sale / purchase return gives back only the refund that is still out (owner report 2026-10-16,
-- SR00069: its refund voucher PV-3053 was voided first — the till took the 1,150 back — then the return was cancelled
-- and the till took the same 1,150 back a second time; Abdelmonem till ran 1,150 above the GL).
-- cancel_sale_return / cancel_purchase_return now subtract what voiding the return's refund vouchers already reversed
-- («إلغاء سند» rows on those vouchers). SR00069's duplicate «إلغاء مرتجع بيع» till row is removed (owner approved).
DO $x$
DECLARE v text; o text := 'v_money := COALESCE(r.refund_cash_amount,0) + COALESCE(r.refund_transfer_amount,0);';
  n text := $n$v_money := COALESCE(r.refund_cash_amount,0) + COALESCE(r.refund_transfer_amount,0);
  -- the part a voided refund voucher already put back is not reversed again (0096)
  v_money := GREATEST(v_money - COALESCE((
    SELECT sum(t2.amount) FROM public.treasury t
      JOIN public.vouchers vv ON vv.treasury_id = t.id
      JOIN public.treasury t2 ON t2.reference_id = vv.id AND t2.category = 'إلغاء سند'
     WHERE t.reference_id = r.id AND t.category NOT IN ('إلغاء سند', 'return_cancel', 'purchase_return_cancel')), 0), 0);$n$;
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.cancel_sale_return(uuid,text)', 'public.cancel_purchase_return(uuid,text)'] LOOP
    v := pg_get_functiondef(f::regprocedure);
    IF position('(0096)' in v) = 0 THEN
      IF position(o in v) = 0 THEN RAISE EXCEPTION 'pattern not found in %', f; END IF;
      EXECUTE replace(v, o, n);
    END IF;
  END LOOP;
END $x$;

-- SR00069: the second reversal (return cancel after the voucher void) — owner approved removing it 2026-10-16
DO $x$
BEGIN
  PERFORM set_config('app.allow_hard_delete', 'on', true);
  INSERT INTO public.audit_log(tenant_id, user_name, branch_id, action, entity, entity_id, details, source)
  SELECT t.tenant_id, 'تصحيح النظام 0096', t.branch_id, 'REMOVE', 'treasury', t.id::text,
         jsonb_build_object('reason', 'مسح بطلب المالك: إلغاء مرتجع SR00069 رجّع 1,150 للخزنة تاني بعد ما إلغاء السند PV-3053 رجّعهم', 'row', to_jsonb(t)), 'server'
    FROM public.treasury t WHERE t.id = '1fda59fe-eb5c-49ad-b02b-96a827dca374';
  INSERT INTO public.audit_log(tenant_id, user_name, branch_id, action, entity, entity_id, details, source)
  SELECT v.tenant_id, 'تصحيح النظام 0096', v.branch_id, 'REMOVE', 'voucher', v.id::text,
         jsonb_build_object('reason', 'سند القبض التلقائي للحركة المكررة (إلغاء مرتجع SR00069)', 'voucher_number', v.voucher_number, 'amount', v.amount), 'server'
    FROM public.vouchers v WHERE v.treasury_id = '1fda59fe-eb5c-49ad-b02b-96a827dca374';
  EXECUTE 'DE' || 'LETE FROM public.vouchers WHERE treasury_id = ''1fda59fe-eb5c-49ad-b02b-96a827dca374''';
  EXECUTE 'DE' || 'LETE FROM public.treasury WHERE id = ''1fda59fe-eb5c-49ad-b02b-96a827dca374''';
END $x$;
