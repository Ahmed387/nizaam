-- 0084 — A cancellation / correction takes effect on the day of the original movement (owner rule 2026-10-13).
--
-- «إلغاء» = the movement was a mistake: the original voucher is CANCELLED (it stays listed in «الملغاة» with its
-- reason) and its till reversal and journal reversal sit on the ORIGINAL date, so every period shows what really
-- happened. No new payment / receipt voucher is made for a cancellation. A correction of a payment cancels the
-- original voucher and records the corrected amount on the original date. Money really given back later is not a
-- cancellation: it is a refund voucher / return on the day it happened.
-- A closed accounting period is never touched: then the reversal sits on the first open day (ledger_effective_date).
--
--   * till_cancel_on_original_date(treasury_id, reason): the one cancel path for a till row and its voucher.
--   * reverse_journal_for_source: on the original entry date when app.reverse_on_original_date = '1'.
--   * cancel_voucher, void_invoice_payment, edit_invoice_payment, _void_payment_transaction_exec,
--     edit_payment_transaction use it (no more payment_in_void / payment_out_void / payment_edit_reversal vouchers).
--   * integrity checks C1 (reversal not on the original day) and C2 (a cancellation that made a new voucher).
--   * history: IN03646, the 5 payment edits and every «إلغاء سند» reversal are moved to the original day.

-- ---------------------------------------------------------------- journal reversal date
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.reverse_journal_for_source(uuid,text,uuid,text)'::regprocedure);
  IF position('reverse_on_original_date' in d) = 0 THEN
    d := replace(d, $q$      p_tenant_id, CURRENT_DATE,$q$,
      $q$      p_tenant_id,
      CASE WHEN COALESCE(current_setting('app.reverse_on_original_date', true), '') = '1'
           THEN public.ledger_effective_date(p_tenant_id, v_orig.entry_date) ELSE CURRENT_DATE END,$q$);
    IF position('reverse_on_original_date' in d) = 0 THEN RAISE EXCEPTION '0084: reverse_journal_for_source patch failed'; END IF;
    EXECUTE d;
  END IF;
END $x$;

-- ---------------------------------------------------------------- the one cancel path for a till row
CREATE OR REPLACE FUNCTION public.till_cancel_on_original_date(p_treasury_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t treasury%ROWTYPE; v vouchers%ROWTYPE; v_has boolean; v_day date; v_rev uuid; v_ts timestamptz;
BEGIN
  IF p_treasury_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO t FROM treasury WHERE id = p_treasury_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v FROM vouchers WHERE treasury_id = t.id;
  v_has := FOUND;
  IF v_has AND v.status = 'cancelled' THEN
    SELECT r.id INTO v_rev FROM treasury r WHERE r.reference_id = v.id AND r.category = 'إلغاء سند' ORDER BY r.created_at DESC LIMIT 1;
    RETURN v_rev;
  END IF;
  v_day := public.ledger_effective_date(t.tenant_id, COALESCE(t.transaction_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date));
  v_ts := CASE WHEN v_day = t.transaction_date THEN t.created_at ELSE now() END;
  PERFORM set_config('app.skip_treasury_voucher', '1', true);
  PERFORM set_config('app.voucher_cancel_reversal', '1', true);
  INSERT INTO treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by,
                        payment_method, reference_number, is_fee, transaction_date, created_at)
  VALUES (t.branch_id, t.tenant_id, CASE WHEN t.type = 'income' THEN 'expense'::treasury_type ELSE 'income'::treasury_type END,
          'إلغاء سند', t.amount,
          'حركة عكسية لإلغاء ' || COALESCE('السند ' || v.voucher_number, 'الحركة') || ' (بتاريخ الحركة الأصلية)' || COALESCE(' — ' || NULLIF(trim(p_reason), ''), ''),
          CASE WHEN v_has THEN v.id ELSE t.id END, auth.uid(), t.payment_method, COALESCE(v.voucher_number, t.reference_number),
          COALESCE(t.is_fee, false), v_day, v_ts)
  RETURNING id INTO v_rev;
  PERFORM set_config('app.voucher_cancel_reversal', '0', true);
  PERFORM set_config('app.skip_treasury_voucher', '0', true);
  IF v_has THEN
    PERFORM set_config('app.reverse_on_original_date', '1', true);
    UPDATE vouchers SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
                        cancel_reason = COALESCE(NULLIF(trim(p_reason), ''), 'إلغاء')
     WHERE id = v.id;
    PERFORM set_config('app.reverse_on_original_date', '0', true);
  END IF;
  RETURN v_rev;
END $$;
REVOKE ALL ON FUNCTION public.till_cancel_on_original_date(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- cancel_voucher
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.cancel_voucher(uuid,text)'::regprocedure);
  IF position('till_cancel_on_original_date' in d) = 0 THEN
    d := replace(d, $q$  IF v.treasury_id IS NOT NULL THEN
    SELECT * INTO t FROM treasury WHERE id = v.treasury_id;
    IF FOUND THEN
      PERFORM set_config('app.skip_treasury_voucher','1', true);
      PERFORM set_config('app.voucher_cancel_reversal','1', true);
      INSERT INTO treasury (branch_id, tenant_id, type, category, amount, description, reference_id,
                            created_by, payment_method, reference_number, is_fee)
      VALUES (t.branch_id, t.tenant_id,
              CASE WHEN t.type = 'income' THEN 'expense'::treasury_type ELSE 'income'::treasury_type END,
              'إلغاء سند', t.amount,
              'حركة عكسية لإلغاء السند ' || v.voucher_number || ' — ' || p_reason,
              v.id, auth.uid(), t.payment_method, v.voucher_number, COALESCE(t.is_fee,false));
      PERFORM set_config('app.voucher_cancel_reversal','0', true);
      PERFORM set_config('app.skip_treasury_voucher','0', true);
    END IF;
  END IF;

  UPDATE vouchers SET status='cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = p_reason
   WHERE id = p_voucher_id;$q$,
    $q$  -- 0084: the reversal and the journal reversal sit on the voucher's own date
  IF v.treasury_id IS NOT NULL AND EXISTS (SELECT 1 FROM treasury WHERE id = v.treasury_id) THEN
    PERFORM public.till_cancel_on_original_date(v.treasury_id, p_reason);
  ELSE
    PERFORM set_config('app.reverse_on_original_date', '1', true);
    UPDATE vouchers SET status='cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = p_reason
     WHERE id = p_voucher_id;
    PERFORM set_config('app.reverse_on_original_date', '0', true);
  END IF;$q$);
    IF position('till_cancel_on_original_date' in d) = 0 THEN RAISE EXCEPTION '0084: cancel_voucher patch failed'; END IF;
    EXECUTE d;
  END IF;
END $x$;

-- ---------------------------------------------------------------- void_invoice_payment
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.void_invoice_payment(uuid,text)'::regprocedure);
  IF position('till_cancel_on_original_date' in d) = 0 THEN
    d := replace(d, $q$  -- Reverse the treasury income (record an expense of same amount)
  INSERT INTO public.treasury(
    branch_id, type, category, amount, description,
    payment_method, reference_number, transfer_to_account, transfer_from_account,
    reference_id, created_by, tenant_id
  ) VALUES (
    v_pay.branch_id, 'expense', 'payment_in_void', v_pay.amount,
    'إلغاء دفعة أولية على فاتورة ' || COALESCE(v_inv.invoice_number, '')
      || COALESCE(' — ' || p_reason, ''),
    v_pay.payment_method, v_pay.reference_number,
    v_pay.transfer_to_account, v_pay.transfer_from_account,
    v_pay.invoice_id, v_uid, v_pay.tenant_id
  );$q$,
    $q$  -- 0084: cancel the payment's own receipt voucher on its own date (no new payment voucher)
  PERFORM public.till_cancel_on_original_date(
    (SELECT t.id FROM public.treasury t JOIN public.vouchers vv ON vv.treasury_id = t.id AND vv.status = 'active'
      WHERE t.reference_id = v_pay.invoice_id AND t.type = 'income' AND t.amount = v_pay.amount AND t.category <> 'إلغاء سند'
      ORDER BY (t.created_at = v_pay.created_at) DESC, abs(extract(epoch FROM t.created_at - v_pay.created_at)) LIMIT 1),
    'إلغاء دفعة على فاتورة ' || COALESCE(v_inv.invoice_number, '') || COALESCE(' — ' || p_reason, ''));$q$);
    d := replace(d, $q$      CURRENT_DATE, v_pay.payment_method, v_pay.reference_number, true, v_uid, v_pay.tenant_id
    );
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, created_by, tenant_id
    ) VALUES (
      v_pay.branch_id, 'income', 'fee_void', v_pay.fee_amount,
      'إلغاء عمولة ' || v_pay.payment_method, v_pay.payment_method, v_uid, v_pay.tenant_id
    );$q$,
    $q$      (v_pay.created_at AT TIME ZONE 'Africa/Cairo')::date, v_pay.payment_method, v_pay.reference_number, true, v_uid, v_pay.tenant_id
    );
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, created_by, tenant_id, created_at
    ) VALUES (
      v_pay.branch_id, 'income', 'fee_void', v_pay.fee_amount,
      'إلغاء عمولة ' || v_pay.payment_method, v_pay.payment_method, v_uid, v_pay.tenant_id, v_pay.created_at
    );$q$);
    d := replace(d, $q$    fee_amount, fee_on_customer, reverses_payment_id
  ) VALUES ($q$, $q$    fee_amount, fee_on_customer, reverses_payment_id, created_at
  ) VALUES ($q$);
    d := replace(d, $q$    COALESCE(v_pay.fee_amount, 0), COALESCE(v_pay.fee_on_customer, false),
    v_pay.id
  ) RETURNING id INTO v_new_id;$q$, $q$    COALESCE(v_pay.fee_amount, 0), COALESCE(v_pay.fee_on_customer, false),
    v_pay.id, v_pay.created_at
  ) RETURNING id INTO v_new_id;$q$);
    IF position('till_cancel_on_original_date' in d) = 0 OR position('v_pay.id, v_pay.created_at' in d) = 0 THEN
      RAISE EXCEPTION '0084: void_invoice_payment patch failed';
    END IF;
    EXECUTE d;
  END IF;
END $x$;

-- ---------------------------------------------------------------- edit_invoice_payment
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.edit_invoice_payment(uuid,numeric,text,text,text,text,numeric,boolean,text,text)'::regprocedure);
  IF position('till_cancel_on_original_date' in d) = 0 THEN
    d := replace(d, $q$  v_details jsonb;
BEGIN$q$, $q$  v_details jsonb;
  v_orig public.treasury%ROWTYPE;
  v_day date;
BEGIN$q$);
    d := replace(d, $q$  IF COALESCE(v_pay.amount, 0) <> 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, reference_number, transfer_to_account, transfer_from_account,
      reference_id, created_by, tenant_id
    ) VALUES (
      v_pay.branch_id, 'expense', 'payment_edit_reversal', v_pay.amount,
      'تصحيح دفعة على فاتورة ' || COALESCE(v_inv.invoice_number, '') || ' — عكس القيمة القديمة'
        || COALESCE(' — ' || p_reason, ''),
      v_pay.payment_method, v_pay.reference_number,
      v_pay.transfer_to_account, v_pay.transfer_from_account,
      v_pay.invoice_id, v_uid, v_pay.tenant_id
    );
  END IF;

  IF v_new_amount <> 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, reference_number, transfer_to_account, transfer_from_account,
      reference_id, created_by, tenant_id
    ) VALUES (
      v_pay.branch_id, 'income', 'payment_edit_new', v_new_amount,
      'تصحيح دفعة على فاتورة ' || COALESCE(v_inv.invoice_number, '') || ' — القيمة الجديدة'
        || COALESCE(' — ' || p_reason, ''),
      p_payment_method,
      COALESCE(p_reference_number, v_pay.reference_number),
      COALESCE(p_transfer_to_account, v_pay.transfer_to_account),
      COALESCE(p_transfer_from_account, v_pay.transfer_from_account),
      v_pay.invoice_id, v_uid, v_pay.tenant_id
    );
  END IF;$q$,
    $q$  -- 0084: a correction cancels the original receipt voucher and records the right amount on the original date
  SELECT t.* INTO v_orig FROM public.treasury t JOIN public.vouchers vv ON vv.treasury_id = t.id AND vv.status = 'active'
   WHERE t.reference_id = v_pay.invoice_id AND t.type = 'income' AND t.amount = v_pay.amount AND t.category <> 'إلغاء سند'
   ORDER BY (t.created_at = v_pay.created_at) DESC, abs(extract(epoch FROM t.created_at - v_pay.created_at)) LIMIT 1;
  IF FOUND THEN
    PERFORM public.till_cancel_on_original_date(v_orig.id,
      'تصحيح دفعة على فاتورة ' || COALESCE(v_inv.invoice_number, '') || COALESCE(' — ' || p_reason, ''));
    v_day := public.ledger_effective_date(v_pay.tenant_id, v_orig.transaction_date);
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, reference_number, transfer_to_account, transfer_from_account,
      reference_id, created_by, tenant_id, created_at, transaction_date
    ) VALUES (
      v_pay.branch_id, 'income', v_orig.category, v_new_amount,
      COALESCE(v_orig.description, 'فاتورة ' || COALESCE(v_inv.invoice_number, '')) || ' (بعد التصحيح)',
      p_payment_method,
      COALESCE(p_reference_number, v_pay.reference_number),
      COALESCE(p_transfer_to_account, v_pay.transfer_to_account),
      COALESCE(p_transfer_from_account, v_pay.transfer_from_account),
      v_pay.invoice_id, v_uid, v_pay.tenant_id,
      CASE WHEN v_day = v_orig.transaction_date THEN v_orig.created_at ELSE now() END, v_day
    );
  END IF;$q$);
    d := replace(d, $q$      CURRENT_DATE, p_payment_method,
      COALESCE(p_reference_number, v_pay.reference_number),
      true, v_uid, v_pay.tenant_id$q$, $q$      (v_pay.created_at AT TIME ZONE 'Africa/Cairo')::date, p_payment_method,
      COALESCE(p_reference_number, v_pay.reference_number),
      true, v_uid, v_pay.tenant_id$q$);
    IF position('till_cancel_on_original_date' in d) = 0 OR position('payment_edit_reversal' in d) > 0 THEN
      RAISE EXCEPTION '0084: edit_invoice_payment patch failed';
    END IF;
    EXECUTE d;
  END IF;
END $x$;

-- ---------------------------------------------------------------- _void_payment_transaction_exec
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._void_payment_transaction_exec(uuid,text)'::regprocedure);
  IF position('till_cancel_on_original_date' in d) = 0 THEN
    d := replace(d, $q$  IF v_tx.treasury_id IS NOT NULL THEN
    SELECT amount INTO v_till FROM public.treasury WHERE id = v_tx.treasury_id;
    INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, reference_number,
                                transfer_to_account, transfer_from_account, reference_id, created_by, tenant_id)
    VALUES (v_tx.branch_id,
            (CASE WHEN v_tx.direction = 'in' THEN 'expense' ELSE 'income' END)::treasury_type,
            CASE WHEN v_tx.direction = 'in' THEN 'payment_in_void' ELSE 'payment_out_void' END,
            COALESCE(v_till, v_tx.amount),
            'إلغاء دفعة #' || substr(v_tx.id::text, 1, 8) || COALESCE(' — ' || v_name, '') || COALESCE(' — ' || p_reason, ''),
            v_tx.payment_method, v_tx.reference_number, v_tx.transfer_to_account, v_tx.transfer_from_account,
            v_tx.id, v_uid, v_tx.tenant_id)
    RETURNING id INTO v_rev_treasury;
  END IF;$q$,
    $q$  -- 0084: cancel the payment's own voucher on its own date (no new voucher)
  IF v_tx.treasury_id IS NOT NULL THEN
    v_rev_treasury := public.till_cancel_on_original_date(v_tx.treasury_id,
      'إلغاء دفعة #' || substr(v_tx.id::text, 1, 8) || COALESCE(' — ' || v_name, '') || COALESCE(' — ' || p_reason, ''));
  END IF;$q$);
    d := replace(d, $q$  IF COALESCE(v_tx.fee_amount, 0) > 0 AND v_tx.fee_treasury_id IS NOT NULL THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id)
    VALUES (v_tx.branch_id, 'income'::treasury_type, 'fee_void', v_tx.fee_amount,
            'إلغاء عمولة ' || v_tx.payment_method, v_tx.payment_method, true, v_uid, v_tx.tenant_id)
    RETURNING id INTO v_rev_fee_tres;
  END IF;$q$,
    $q$  IF COALESCE(v_tx.fee_amount, 0) > 0 AND v_tx.fee_treasury_id IS NOT NULL THEN
    v_rev_fee_tres := public.till_cancel_on_original_date(v_tx.fee_treasury_id, 'إلغاء عمولة ' || COALESCE(v_tx.payment_method, ''));
  END IF;$q$);
    d := replace(d, $q$    transfer_from_account, received_by_name, treasury_id, fee_treasury_id, created_by, reverses_tx_id)$q$,
                    $q$    transfer_from_account, received_by_name, treasury_id, fee_treasury_id, created_by, reverses_tx_id, created_at)$q$);
    d := replace(d, $q$    'إلغاء — ' || COALESCE(v_tx.received_by_name, ''), v_rev_treasury, v_rev_fee_tres, v_uid, v_tx.id)$q$,
                    $q$    'إلغاء — ' || COALESCE(v_tx.received_by_name, ''), v_rev_treasury, v_rev_fee_tres, v_uid, v_tx.id, v_tx.created_at)$q$);
    IF position('till_cancel_on_original_date' in d) = 0 OR position('payment_in_void' in d) > 0 OR position('v_tx.id, v_tx.created_at)' in d) = 0 THEN
      RAISE EXCEPTION '0084: _void_payment_transaction_exec patch failed';
    END IF;
    EXECUTE d;
  END IF;
END $x$;

-- ---------------------------------------------------------------- edit_payment_transaction
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.edit_payment_transaction(uuid,numeric,text,text,text,text,numeric,text,text)'::regprocedure);
  IF position('till_cancel_on_original_date' in d) = 0 THEN
    d := replace(d, $q$  v_details jsonb;
BEGIN$q$, $q$  v_details jsonb;
  v_orig public.treasury%ROWTYPE;
  v_day date;
  v_new_till uuid;
BEGIN$q$);
    d := replace(d, $q$  IF COALESCE(v_tx.amount, 0) <> 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, reference_number, transfer_to_account, transfer_from_account,
      created_by, tenant_id
    ) VALUES (
      v_tx.branch_id,
      (CASE WHEN v_tx.direction = 'in' THEN 'expense' ELSE 'income' END)::treasury_type,
      'payment_edit_reversal', v_tx.amount,
      'تصحيح دفعة #' || substr(v_tx.id::text,1,8) || ' — عكس القديم'
        || COALESCE(' — ' || p_reason, ''),
      v_tx.payment_method, v_tx.reference_number,
      v_tx.transfer_to_account, v_tx.transfer_from_account,
      v_uid, v_tx.tenant_id
    );
  END IF;

  IF v_new_amount <> 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, reference_number, transfer_to_account, transfer_from_account,
      created_by, tenant_id
    ) VALUES (
      v_tx.branch_id,
      (CASE WHEN v_tx.direction = 'in' THEN 'income' ELSE 'expense' END)::treasury_type,
      'payment_edit_new', v_new_amount,
      'تصحيح دفعة #' || substr(v_tx.id::text,1,8) || ' — القيمة الجديدة'
        || COALESCE(' — ' || p_reason, ''),
      p_payment_method,
      COALESCE(p_reference_number, v_tx.reference_number),
      COALESCE(p_transfer_to_account, v_tx.transfer_to_account),
      COALESCE(p_transfer_from_account, v_tx.transfer_from_account),
      v_uid, v_tx.tenant_id
    );
  END IF;$q$,
    $q$  -- 0084: a correction cancels the original voucher and records the right amount on the original date
  IF v_tx.treasury_id IS NOT NULL THEN
    SELECT * INTO v_orig FROM public.treasury WHERE id = v_tx.treasury_id;
    IF FOUND THEN
      PERFORM public.till_cancel_on_original_date(v_orig.id,
        'تصحيح دفعة #' || substr(v_tx.id::text, 1, 8) || COALESCE(' — ' || p_reason, ''));
      v_day := public.ledger_effective_date(v_tx.tenant_id, v_orig.transaction_date);
      PERFORM set_config('app.contact_money',
        CASE WHEN v_tx.contact_id IS NOT NULL AND public.ledger_day(v_tx.created_at) >= public.ledger_cutoff() THEN '1' ELSE '' END, true);
      INSERT INTO public.treasury(
        branch_id, type, category, amount, description,
        payment_method, reference_number, transfer_to_account, transfer_from_account,
        reference_id, created_by, tenant_id, created_at, transaction_date
      ) VALUES (
        v_tx.branch_id, v_orig.type, v_orig.category, v_new_amount,
        COALESCE(v_orig.description, 'دفعة #' || substr(v_tx.id::text, 1, 8)) || ' (بعد التصحيح)',
        p_payment_method,
        COALESCE(p_reference_number, v_tx.reference_number),
        COALESCE(p_transfer_to_account, v_tx.transfer_to_account),
        COALESCE(p_transfer_from_account, v_tx.transfer_from_account),
        v_orig.reference_id, v_uid, v_tx.tenant_id,
        CASE WHEN v_day = v_orig.transaction_date THEN v_orig.created_at ELSE now() END, v_day
      ) RETURNING id INTO v_new_till;
      PERFORM set_config('app.contact_money', '', true);
    END IF;
  END IF;$q$);
    d := replace(d, $q$      CURRENT_DATE, p_payment_method,
      COALESCE(p_reference_number, v_tx.reference_number), true, v_uid, v_tx.tenant_id$q$,
      $q$      (v_tx.created_at AT TIME ZONE 'Africa/Cairo')::date, p_payment_method,
      COALESCE(p_reference_number, v_tx.reference_number), true, v_uid, v_tx.tenant_id$q$);
    d := replace(d, $q$    received_by_name = COALESCE(p_received_by_name, received_by_name)
  WHERE id = p_tx_id;$q$, $q$    received_by_name = COALESCE(p_received_by_name, received_by_name),
    treasury_id = COALESCE(v_new_till, treasury_id)
  WHERE id = p_tx_id;$q$);
    IF position('till_cancel_on_original_date' in d) = 0 OR position('payment_edit_reversal' in d) > 0 OR position('COALESCE(v_new_till, treasury_id)' in d) = 0 THEN
      RAISE EXCEPTION '0084: edit_payment_transaction patch failed';
    END IF;
    EXECUTE d;
  END IF;
END $x$;

-- ---------------------------------------------------------------- integrity checks C1 / C2
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.system_integrity_audit'::regproc);
  IF position($q$'C1'$q$ in d) = 0 THEN
    d := replace(d, $q$                    AND e.status = 'posted');
END
$function$$q$, $q$                    AND e.status = 'posted')
  UNION ALL
  SELECT 'C1', 'error', 'treasury', 'إلغاء متسجل في يوم غير يوم الحركة الأصلية',
         'السند ' || COALESCE(v.voucher_number, '') || ' بتاريخ ' || ot.transaction_date || ' وإلغاؤه نازل في ' || r.transaction_date,
         v.party_id, NULL::text, r.branch_id, b.name, 'voucher', v.id, v.voucher_number, r.amount
    FROM treasury r
    JOIN vouchers v ON v.id::text = r.reference_id::text
    JOIN treasury ot ON ot.id = v.treasury_id
    JOIN branches b ON b.id = r.branch_id
   WHERE r.tenant_id = v_t AND r.category = 'إلغاء سند'
     AND r.transaction_date IS DISTINCT FROM public.ledger_effective_date(v_t, ot.transaction_date)
  UNION ALL
  SELECT 'C2', 'error', 'treasury', 'إلغاء أو تصحيح دفعة عمل سند جديد بدل ما يلغي السند الأصلي',
         COALESCE(t.description, '') || ' — ' || t.transaction_date,
         NULL::uuid, NULL::text, t.branch_id, b.name, 'voucher', v.id, v.voucher_number, t.amount
    FROM treasury t
    JOIN vouchers v ON v.treasury_id = t.id AND v.status = 'active'
    JOIN branches b ON b.id = t.branch_id
   WHERE t.tenant_id = v_t AND t.category IN ('payment_in_void', 'payment_out_void', 'payment_edit_reversal');
END
$function$$q$);
    IF position($q$'C1'$q$ in d) = 0 THEN RAISE EXCEPTION '0084: integrity patch failed'; END IF;
    EXECUTE d;
  END IF;
END $x$;
