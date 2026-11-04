-- 0148 checks — rollback-only (ends with RAISE). Run after migration 0148 (or with its text pasted above for a dry-run).
--  A) supplier «المخزن الرئيسي», عبدالمنعم, 1,000 on 5/10 → we owe him 1,000 less; the tills (every 11xx) and the book
--     vessel net 0; books 3800 −1,000 (credit), 2100/1460 +1,000; October profit unchanged
--  B) a customer with an open invoice, 500 → he owes 500 less; books 3800 +500 (debit); profit unchanged
--  B2) a customer with credit (احمد ماهر), 100 «نقلل اللي علينا ليه» → his credit 100 less; books 3800 −100 (credit)
--  C) cancel A → his balance and the books back
--  D) a branch manager is refused; E) «قلّل اللي على المورد» is refused (that is a purchase return)
DO $t$
DECLARE v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a'; v_mgr uuid := '598491e8-589f-4ad1-88a6-62d6e9114bde';
  v_t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; v_br uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213';
  v_sup uuid := '3df0c0b2-ed60-4cd6-b8d5-ae6a762a6ea3'; v_cus uuid; v_cred uuid := '852d1672-ae38-4544-8493-69e28a1ece0f'; v_seq jsonb; r record; o jsonb := '{}'; x jsonb; v_err text;
  b0 jsonb; b1 jsonb; p0 numeric; p1 numeric;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET CONSTRAINTS ALL IMMEDIATE;
  CREATE OR REPLACE FUNCTION pg_temp.gl() RETURNS jsonb LANGUAGE sql AS $f$
    SELECT coalesce(jsonb_object_agg(code, s), '{}') FROM (
      SELECT CASE WHEN c.code LIKE '11%' THEN '11xx' ELSE c.code END code, round(sum(l.debit - l.credit), 2) s
        FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id JOIN public.chart_of_accounts c ON c.id = l.account_id
       WHERE e.tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71' AND e.status = 'posted' AND e.created_at = now()
       GROUP BY 1) g WHERE s <> 0;
  $f$;
  CREATE OR REPLACE FUNCTION pg_temp.bal(p uuid) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM public.ledger_side_balances('5316fbfe-b862-4c91-b48b-1d81c8aa5a71', NULL, p) x;
  $f$;
  CREATE OR REPLACE FUNCTION pg_temp.till() RETURNS jsonb LANGUAGE sql AS $f$
    SELECT coalesce(jsonb_object_agg(m, s), '{}') FROM (SELECT coalesce(payment_method, 'cash') m, round(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 2) s
      FROM public.treasury WHERE branch_id = '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213' GROUP BY 1) q WHERE s <> 0;   -- a vessel that nets 0 is no change
  $f$;
  SELECT i.contact_id INTO v_cus FROM public.invoices i WHERE i.branch_id = v_br AND i.status = 'active' AND i.contact_id IS NOT NULL
     AND i.invoice_date >= '2026-09-01' ORDER BY i.invoice_date DESC LIMIT 1;
  p0 := (public.profit_statement_core(v_t, '2026-10-01', '2026-10-31', NULL)->'total'->>'net_profit')::numeric;
  b0 := pg_temp.till();
  o := o || jsonb_build_object('A_before', pg_temp.bal(v_sup));
  x := public.settle_contact_without_money(v_br, v_sup, 'supplier', 'we_owe_less', 1000, '2026-10-05', 'تجربة 0148');
  o := o || jsonb_build_object('A_res', x - 'contact_voucher_id' - 'offset_voucher_id', 'A_after', pg_temp.bal(v_sup), 'A_gl', pg_temp.gl(),
    'A_till_same', b0 = pg_temp.till(),
    'A_flow', (SELECT jsonb_agg(flow_class) FROM public.vouchers WHERE id IN ((x->>'contact_voucher_id')::uuid, (x->>'offset_voucher_id')::uuid)));
  o := o || jsonb_build_object('B_before', pg_temp.bal(v_cus));
  x := public.settle_contact_without_money(v_br, v_cus, 'customer', 'he_owes_less', 500, '2026-10-06', 'تجربة 0148');
  o := o || jsonb_build_object('B_after', pg_temp.bal(v_cus), 'B_gl', pg_temp.gl());
  o := o || jsonb_build_object('B2_before', pg_temp.bal(v_cred));
  x := public.settle_contact_without_money(v_br, v_cred, 'customer', 'we_owe_less', 100, '2026-10-07', 'تجربة 0148');
  o := o || jsonb_build_object('B2_after', pg_temp.bal(v_cred), 'B2_gl', pg_temp.gl(), 'till_same_after_all', b0 = pg_temp.till());
  BEGIN PERFORM public.settle_contact_without_money(v_br, v_sup, 'supplier', 'he_owes_less', 5, '2026-10-05', 'x'); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  o := o || jsonb_build_object('E_supplier_he_owes_less', v_err);
  p1 := (public.profit_statement_core(v_t, '2026-10-01', '2026-10-31', NULL)->'total'->>'net_profit')::numeric;
  o := o || jsonb_build_object('profit_same', p0 = p1);
  PERFORM public.cancel_contact_settlement((SELECT id FROM public.contact_settlements WHERE contact_id = v_sup AND status = 'active' ORDER BY created_at DESC LIMIT 1), 'تجربة');
  o := o || jsonb_build_object('C_after_cancel', pg_temp.bal(v_sup), 'C_gl', pg_temp.gl());
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.settle_contact_without_money(v_br, v_sup, 'supplier', 'we_owe_less', 5, '2026-10-05', 'x'); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  o := o || jsonb_build_object('D_manager', v_err);
  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  RAISE EXCEPTION '0148 CHECKS %', o;
END
$t$;
