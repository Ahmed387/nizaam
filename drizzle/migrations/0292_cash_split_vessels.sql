-- 0292 (owner 2026-11-26 «أصلّح تسجيل السندات في الدفاتر وأعمل قيد تصحيح واحد بالفرق … نفذ»):
-- cash in the books = 1100 «النقدية» (vessel cash) + 1110 «البنك والمحافظ» (every other vessel, ledger_cash_account).
-- Customer / supplier money already followed that rule; these paths wrote 1100 whatever the vessel:
--   * post_voucher_journal (expenses, other income, fees, settlement offsets) — the big part
--   * sale / purchase return refunds by transfer, partner_money, record_prior_year_return
-- and «تحويل بين الأوعية» posted NO entry, so cash ↔ wallet left 1100 / 1110 apart.
-- Totals per branch were right (1100 + 1110 = the tills); only the split was wrong.
-- Fix: every path uses ledger_cash_account(vessel); a vessel transfer posts Dr to / Cr from when the two differ
-- (reversed on its day when cancelled); the 5 returns are re-synced on their day; the old vouchers get ONE
-- correcting entry per branch (today), and their later reversal follows the corrected account (cash_split_fixed_entries).

-- ---------- 1. the posting paths ----------
DO $$
DECLARE d text; n int;
BEGIN
  -- post_voucher_journal: 4 × '1100'
  d := pg_get_functiondef('public.post_voucher_journal(uuid)'::regprocedure);
  n := (SELECT count(*) FROM regexp_matches(d, 'jsonb_build_object\(''account_code'',''1100'',', 'g'));
  IF n <> 4 THEN RAISE EXCEPTION '0292: post_voucher_journal has % × 1100 (expected 4)', n; END IF;
  EXECUTE replace(d, 'jsonb_build_object(''account_code'',''1100'',', 'jsonb_build_object(''account_code'',public.ledger_cash_account(v.payment_method),');

  -- partner_money: 2 × '1100'
  d := pg_get_functiondef('public.partner_money(uuid, text, numeric, text, numeric, uuid, text, date, text, text)'::regprocedure);
  n := (SELECT count(*) FROM regexp_matches(d, '''account_code'', ''1100''', 'g'));
  IF n <> 2 THEN RAISE EXCEPTION '0292: partner_money has % × 1100 (expected 2)', n; END IF;
  EXECUTE replace(d, '''account_code'', ''1100''', '''account_code'', public.ledger_cash_account(p_method)');

  -- record_prior_year_return: 1 × '1100'
  d := pg_get_functiondef('public.record_prior_year_return(uuid, uuid, date, jsonb, text, text, text)'::regprocedure);
  n := (SELECT count(*) FROM regexp_matches(d, '''account_code'', ''1100''', 'g'));
  IF n <> 1 THEN RAISE EXCEPTION '0292: record_prior_year_return has % × 1100 (expected 1)', n; END IF;
  EXECUTE replace(d, '''account_code'', ''1100''', '''account_code'', public.ledger_cash_account(p_method)');

  -- sale return: cash part → 1100, transfer part → 1110
  d := pg_get_functiondef('public.sync_sale_return_journal(uuid)'::regprocedure);
  IF position('COALESCE(rt.refund_balance_amount,0) AS balance_amt' IN d) = 0
     OR position($x$IF v_cash > 0 THEN v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1100','debit',0,'credit',v_cash,'description','مرتجع مبيعات '||r.return_number||' — نقدي')); END IF;$x$ IN d) = 0 THEN
    RAISE EXCEPTION '0292: sync_sale_return_journal text not found';
  END IF;
  d := replace(d, $x$IF v_cash > 0 THEN v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1100','debit',0,'credit',v_cash,'description','مرتجع مبيعات '||r.return_number||' — نقدي')); END IF;$x$,
    $x$IF v_cash > 0 AND r.cash_amt > 0 THEN v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1100','debit',0,'credit',r.cash_amt,'description','مرتجع مبيعات '||r.return_number||' — نقدي')); END IF;
  IF v_cash > 0 AND r.transfer_amt > 0 THEN v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1110','debit',0,'credit',r.transfer_amt,'description','مرتجع مبيعات '||r.return_number||' — تحويل')); END IF;$x$);
  EXECUTE d;

  -- purchase return: cash part → 1100, transfer part → 1110
  d := pg_get_functiondef('public.sync_purchase_return_journal(uuid)'::regprocedure);
  IF position($x$  IF v_cash > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1100','debit',v_cash,'credit',0,'description','مرتجع مشتريات '||r.return_number||' — استرداد نقدي'));
  END IF;$x$ IN d) = 0 THEN RAISE EXCEPTION '0292: sync_purchase_return_journal text not found'; END IF;
  EXECUTE replace(d, $x$  IF v_cash > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1100','debit',v_cash,'credit',0,'description','مرتجع مشتريات '||r.return_number||' — استرداد نقدي'));
  END IF;$x$, $x$  IF v_cash > 0 AND r.cash_amt > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1100','debit',r.cash_amt,'credit',0,'description','مرتجع مشتريات '||r.return_number||' — استرداد نقدي'));
  END IF;
  IF v_cash > 0 AND r.transfer_amt > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1110','debit',r.transfer_amt,'credit',0,'description','مرتجع مشتريات '||r.return_number||' — استرداد تحويل'));
  END IF;$x$);
END $$;

-- ---------- 2. «تحويل بين الأوعية» reaches the books when cash ↔ wallet ----------
CREATE OR REPLACE FUNCTION public.post_vessel_transfer_journal(p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE x public.vessel_transfers%ROWTYPE; a_from text; a_to text; v_id uuid;
BEGIN
  SELECT * INTO x FROM public.vessel_transfers WHERE id = p_id;
  IF NOT FOUND OR x.status = 'cancelled' THEN RETURN NULL; END IF;
  a_from := public.ledger_cash_account(x.from_method); a_to := public.ledger_cash_account(x.to_method);
  IF a_from = a_to THEN RETURN NULL; END IF;  -- wallet ↔ wallet: the same account, nothing to post
  IF EXISTS (SELECT 1 FROM public.journal_entries WHERE source_type = 'vessel_transfer' AND source_id = x.id AND status = 'posted' AND reversed_by IS NULL) THEN
    RETURN NULL;
  END IF;
  v_id := public.post_journal(x.tenant_id, x.transfer_date, 'تحويل بين الأوعية: ' || x.from_method || ' → ' || x.to_method, 'vessel_transfer', x.id,
    jsonb_build_array(
      jsonb_build_object('account_code', a_to, 'debit', x.amount, 'credit', 0, 'description', 'تحويل وارد من ' || x.from_method),
      jsonb_build_object('account_code', a_from, 'debit', 0, 'credit', x.amount, 'description', 'تحويل صادر إلى ' || x.to_method)));
  IF v_id IS NOT NULL THEN UPDATE public.journal_entries SET branch_id = x.branch_id WHERE id = v_id; END IF;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.post_vessel_transfer_journal(uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.transfer_between_vessels(uuid, text, text, numeric, text, numeric, date, text, text, text)'::regprocedure);
  IF position('  UPDATE public.vessel_transfers SET out_treasury_id = v_out, in_treasury_id = v_in, fee_treasury_id = v_fee_row WHERE id = v_id;' IN d) = 0 THEN
    RAISE EXCEPTION '0292: transfer_between_vessels text not found';
  END IF;
  EXECUTE replace(d, '  UPDATE public.vessel_transfers SET out_treasury_id = v_out, in_treasury_id = v_in, fee_treasury_id = v_fee_row WHERE id = v_id;',
    '  UPDATE public.vessel_transfers SET out_treasury_id = v_out, in_treasury_id = v_in, fee_treasury_id = v_fee_row WHERE id = v_id;
  PERFORM public.post_vessel_transfer_journal(v_id);  -- 0292');

  d := pg_get_functiondef('public.cancel_vessel_transfer(uuid, text)'::regprocedure);
  IF position('  UPDATE public.vessel_transfers SET status = ''cancelled''' IN d) = 0 THEN RAISE EXCEPTION '0292: cancel_vessel_transfer text not found'; END IF;
  EXECUTE replace(d, '  UPDATE public.vessel_transfers SET status = ''cancelled''',
    '  PERFORM set_config(''app.reverse_on_original_date'', ''1'', true);  -- 0292: its entry goes back on its own day
  PERFORM public.reverse_journal_for_source(x.tenant_id, ''vessel_transfer'', x.id, ''إلغاء تحويل بين الأوعية'');
  PERFORM set_config(''app.reverse_on_original_date'', '''', true);
  UPDATE public.vessel_transfers SET status = ''cancelled''');
END $$;

-- ---------- 3. a reversal of a corrected voucher entry follows the corrected account ----------
CREATE TABLE IF NOT EXISTS public.cash_split_fixed_entries (
  entry_id uuid PRIMARY KEY REFERENCES public.journal_entries(id),
  tenant_id uuid NOT NULL,
  amount_1100 numeric NOT NULL,           -- what the entry had on 1100 (moved to 1110 by the correction)
  correction_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cash_split_fixed_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_split_fixed_entries FROM anon, authenticated;

DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.reverse_journal_for_source(uuid, text, uuid, text)'::regprocedure);
  IF (SELECT count(*) FROM regexp_matches(d, '''account_code'', a\.code,', 'g')) <> 1 THEN RAISE EXCEPTION '0292: reverse_journal_for_source text not found'; END IF;
  EXECUTE replace(d, '''account_code'', a.code,',
    '''account_code'', CASE WHEN a.code = ''1100'' AND EXISTS (SELECT 1 FROM public.cash_split_fixed_entries f WHERE f.entry_id = v_orig.id) THEN ''1110'' ELSE a.code END,  -- 0292');
END $$;

-- ---------- 4. the past ----------
-- 4a. the five sale returns refunded by transfer: their entry is rebuilt on their own day
DO $$ DECLARE r uuid; BEGIN
  FOR r IN SELECT id FROM public.returns WHERE status = 'active' AND coalesce(refund_transfer_amount, 0) > 0 LOOP
    PERFORM public.sync_sale_return_journal(r);
  END LOOP;
  FOR r IN SELECT id FROM public.purchase_returns WHERE status = 'active' AND coalesce(refund_transfer_amount, 0) > 0 LOOP
    PERFORM public.sync_purchase_return_journal(r);
  END LOOP;
END $$;

-- 4b. every active cash ↔ wallet vessel transfer gets its entry on its own day
DO $$ DECLARE r uuid; BEGIN
  FOR r IN SELECT id FROM public.vessel_transfers WHERE status <> 'cancelled'
            AND public.ledger_cash_account(from_method) <> public.ledger_cash_account(to_method) ORDER BY transfer_date, created_at LOOP
    PERFORM public.post_vessel_transfer_journal(r);
  END LOOP;
END $$;

-- 4c. the vouchers written on 1100 for another vessel: ONE correcting entry per branch, today
DO $$
DECLARE b record; v_id uuid;
BEGIN
  CREATE TEMP TABLE _wrong ON COMMIT DROP AS
  SELECT e.id entry_id, e.tenant_id, e.branch_id, e.source_type, e.reversed_by, sum(l.debit - l.credit) amt
    FROM public.journal_entries e
    JOIN public.journal_entry_lines l ON l.entry_id = e.id
    JOIN public.chart_of_accounts a ON a.id = l.account_id AND a.code = '1100'
    JOIN public.vouchers v ON v.id = e.source_id
   WHERE e.status = 'posted' AND e.source_type IN ('voucher', 'voucher_reversal')
     AND public.ledger_cash_account(v.payment_method) = '1110'
   GROUP BY 1, 2, 3, 4, 5;
  FOR b IN SELECT w.tenant_id, w.branch_id, br.name, round(sum(w.amt), 2) amt FROM _wrong w JOIN public.branches br ON br.id = w.branch_id
            GROUP BY 1, 2, 3 HAVING abs(round(sum(w.amt), 2)) >= 0.01 LOOP
    v_id := public.post_journal(b.tenant_id, public.cairo_today(),
      'تصحيح: سندات المحافظ / البنك / الأوعية اتسجلت على «النقدية» — نقلها لـ «البنك والمحافظ» (' || b.name || ')',
      'cash_split_correction', b.branch_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1110', 'debit', greatest(b.amt, 0), 'credit', greatest(-b.amt, 0),
                           'description', 'سندات اتدفعت / اتقبضت من محفظة أو بنك أو وعاء غير الكاش'),
        jsonb_build_object('account_code', '1100', 'debit', greatest(-b.amt, 0), 'credit', greatest(b.amt, 0),
                           'description', 'كانت متسجلة على النقدية بالغلط')));
    UPDATE public.journal_entries SET branch_id = b.branch_id WHERE id = v_id;
    INSERT INTO public.cash_split_fixed_entries (entry_id, tenant_id, amount_1100, correction_entry_id)
    SELECT w.entry_id, w.tenant_id, w.amt, v_id FROM _wrong w
     WHERE w.branch_id = b.branch_id AND w.source_type = 'voucher' AND w.reversed_by IS NULL;
  END LOOP;
END $$;
