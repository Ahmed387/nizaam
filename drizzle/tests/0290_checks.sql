-- 0290 checks (rollback-only: always raises DRY). Run after migrations 0288–0290.
do $dry$
declare owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a'; nasser uuid := '4a260665-29aa-4510-af0f-388166b6c01e';
  out text := ''; c0 jsonb; c1 jsonb; id1 uuid; id2 uuid; id3 uuid; g0 numeric; g1 numeric; m0 numeric; m1 numeric; m2 numeric; till0 numeric; till1 numeric; je0 bigint; je1 bigint;
begin
  create temp table _seq on commit drop as select schemaname, sequencename, last_value from pg_sequences where schemaname='public' and last_value is not null;
  SET CONSTRAINTS ALL IMMEDIATE;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  c0 := public.partner_cards(nasser); g0 := (public.partner_capital_gap_info()->>'capital_new')::numeric;
  m0 := public.partner_capital_for_month(nasser, '2026-02-01');
  select sum(case when type='income' then amount else -amount end) into till0 from treasury; select count(*) into je0 from journal_entries;
  -- W1 capital mode from Feb: capital −300,000, Feb share lower, Jan unchanged
  id1 := public.partner_pre_system_withdrawal(nasser, 300000, '2026-02-01', 'capital', '2025-06-10', 'سحب قديم');
  c1 := public.partner_cards(nasser);
  out := out||'W1 capitalΔ='||((c1->>'capital')::numeric-(c0->>'capital')::numeric)||' Feb capΔ='||(public.partner_capital_for_month(nasser,'2026-02-01')-m0)
       ||' Jan capΔ='||(public.partner_capital_for_month(nasser,'2026-01-01')-public.partner_capital_for_month(nasser,'2026-01-01'))
       ||' withdrawn_on='||(select deposited_on from partner_transactions where id=id1)||' gapΔ='||((public.partner_capital_gap_info()->>'capital_new')::numeric-g0)||' | ';
  -- W2 profit mode: capital same, profit card −50,000
  id2 := public.partner_pre_system_withdrawal(nasser, 50000, '2026-01-01', 'profit', null, null);
  out := out||'W2 capitalΔ='||((public.partner_cards(nasser)->>'capital')::numeric-(c1->>'capital')::numeric)||' profitΔ='||((public.partner_cards(nasser)->>'profit')::numeric-(c1->>'profit')::numeric)||' | ';
  -- W3 more than capital refused
  begin perform public.partner_pre_system_withdrawal(nasser, 99999999, '2026-01-01', 'capital', null, null); out := out||'W3 OVER CAPITAL ACCEPTED!! | ';
  exception when others then out := out||'W3 over capital refused ✓ | '; end;
  -- W4 no mode refused
  begin perform public.partner_pre_system_withdrawal(nasser, 1, '2026-01-01', '', null, null); out := out||'W4 NO MODE!! | ';
  exception when others then out := out||'W4 mode required ✓ | '; end;
  -- W5 tills and books untouched
  select sum(case when type='income' then amount else -amount end) into till1 from treasury; select count(*) into je1 from journal_entries;
  out := out||'W5 tillΔ='||(till1-till0)||' entriesΔ='||(je1-je0)||' | ';
  -- W6 edit keeps the kind, editable in cards
  id3 := public.edit_existing_capital(id1, 250000, '2026-02-01', '2025-06-10', null, 'المبلغ غلط');
  out := out||'W6 kind='||(select transaction_type from partner_transactions where id=id3)||' capitalΔ now='||((public.partner_cards(nasser)->>'capital')::numeric-(c0->>'capital')::numeric)
       ||' editable='||coalesce((select m->>'editable' from jsonb_array_elements(public.partner_cards(nasser)->'movements') m where m->>'id'=id3::text),'?')
       ||' profit editable='||coalesce((select m->>'editable' from jsonb_array_elements(public.partner_cards(nasser)->'movements') m where m->>'id'=id2::text),'?')||' | ';
  -- W7 cancel puts it back
  perform public.cancel_partner_transaction(id3, 'تجربة'); perform public.cancel_partner_transaction(id2, 'تجربة');
  out := out||'W7 back='||((public.partner_cards(nasser)->>'capital')=(c0->>'capital') and (public.partner_cards(nasser)->>'profit')=(c0->>'profit'))||' | ';
  -- W8 a till withdrawal still counts from the next month (unchanged rule)
  out := out||'W8 existing capital unchanged rule Jan='||(public.partner_capital_for_month(nasser,'2026-01-01'))||' | ';
  out := out||'exposed='||(select count(*) from public.security_exposed_definer_functions());
  perform setval(format('%I.%I', s2.schemaname, s2.sequencename), s2.last_value) from _seq s2;
  raise exception 'DRY %', out;
end $dry$;
