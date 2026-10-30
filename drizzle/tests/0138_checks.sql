-- 0138 checks — rollback-only (ends with RAISE). Run after migration 0138 (or with its text pasted above for a dry-run).
-- The owner gives د/نور ناصر an advance of 1,000 cash in عبدالمنعم, then cancels it: the advance is «ملغية» with
-- nothing left to deduct, its voucher is «ملغي», the till and the journal net to zero, and the browser can neither
-- update nor delete a salary / advance row.
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_emp uuid := 'b5dd1aa2-0371-4ddf-9d5f-64b4efc472ad';
  v_seq jsonb; v_seq_after jsonb; r record; v_res jsonb; v_adv uuid; a record;
  v_till numeric; v_gl numeric; v_vstat text; c_upd text; c_del text; c_twice text; c_cashier text; v_cashier uuid;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  v_res := public.disburse_employee_advance(v_emp, 1000, 250, '0138 check', 'cash');
  v_adv := (v_res->>'advance_id')::uuid;
  PERFORM public.cancel_employee_advance(v_adv, 'غلط في المبلغ');
  SELECT * INTO a FROM public.advances WHERE id = v_adv;
  SELECT status INTO v_vstat FROM public.vouchers WHERE treasury_id = (v_res->>'treasury_id')::uuid;
  SELECT coalesce(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) INTO v_till
    FROM public.treasury WHERE reference_id = v_adv
       OR reference_id IN (SELECT id FROM public.vouchers WHERE treasury_id = (v_res->>'treasury_id')::uuid);
  SELECT coalesce(sum(abs(x.v)), 0) INTO v_gl FROM (
    SELECT l.account_id, sum(l.debit - l.credit) AS v FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id
     WHERE e.source_id IN (SELECT id FROM public.vouchers WHERE treasury_id = (v_res->>'treasury_id')::uuid)
        OR e.source_id = (v_res->>'treasury_id')::uuid
     GROUP BY 1) x;

  BEGIN PERFORM public.cancel_employee_advance(v_adv, 'تاني'); EXCEPTION WHEN OTHERS THEN c_twice := SQLERRM; END;

  -- the browser (authenticated role) cannot touch the rows
  SET LOCAL ROLE authenticated;
  BEGIN UPDATE public.advances SET amount = 1 WHERE id = v_adv; c_upd := 'allowed'; EXCEPTION WHEN OTHERS THEN c_upd := SQLERRM; END;
  BEGIN DELETE FROM public.salaries WHERE false; c_del := 'allowed'; EXCEPTION WHEN OTHERS THEN c_del := SQLERRM; END;
  RESET ROLE;

  -- a cashier cannot cancel an advance
  SELECT ur.user_id INTO v_cashier FROM public.user_roles ur WHERE ur.role = 'cashier'
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id AND x.role IN ('owner', 'admin')) LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cashier, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.cancel_employee_advance(v_adv, 'x'); c_cashier := 'allowed'; EXCEPTION WHEN OTHERS THEN c_cashier := SQLERRM; END;

  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text
       AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';

  RAISE EXCEPTION '0138 CHECKS %', jsonb_build_object(
    'C1_advance_cancelled', a.status = 'cancelled' AND a.remaining = 0, 'C2_voucher_cancelled', v_vstat = 'cancelled',
    'C3_till_nets_zero', v_till = 0, 'C4_journal_nets_zero', v_gl = 0, 'C5_second_cancel_refused', c_twice,
    'C6_browser_update', c_upd, 'C7_browser_delete', c_del, 'C8_cashier', c_cashier,
    'C9_sequences_same', v_seq = v_seq_after, 'voucher', v_res->>'voucher_number');
END
$t$;
