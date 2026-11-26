-- 0289 checks (rollback-only: always raises DRY). Run after migrations 0288 + 0289 + 0289b.
do $dry$
declare t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  mahmoud_u uuid := '9aa41d69-13ef-41d8-a6ca-b6c722c95c62'; nasser uuid := '4a260665-29aa-4510-af0f-388166b6c01e';
  mahmoud_p uuid := '4bcf7c60-69b2-4049-b1e5-001cbf4e509f';
  f date := '2026-10-01'; tt date := '2026-10-31'; out text := ''; pv jsonb; av numeric; r jsonb; d uuid; je uuid; s numeric; p0 numeric; p1 numeric; x uuid;
begin
  create temp table _seq on commit drop as select schemaname, sequencename, last_value from pg_sequences where schemaname='public' and last_value is not null;
  SET CONSTRAINTS ALL IMMEDIATE;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  pv := public.period_split_preview(f, tt);
  out := out||'P1 pay_missing='||(pv->>'pay_missing')||' | ';
  begin perform public.distribute_profits_manual(f, tt, jsonb_build_array(jsonb_build_object('partner_id', nasser, 'amount', 1)), null, 'keep'); out := out||'P2 NO-SALARIES ACCEPTED!! | ';
  exception when others then out := out||'P2 salaries first ✓ | '; end;
  perform public.post_partner_period_shares(f, tt, '{}'::jsonb);
  pv := public.period_split_preview(f, tt); av := (pv->>'available')::numeric;
  select sum((e->>'suggested')::numeric) into s from jsonb_array_elements(pv->'partners') e;
  out := out||'P3 net='||(pv->>'net_profit')||' avail='||av||' Σsuggested='||round(s,4)||' partners='||jsonb_array_length(pv->'partners')||' | ';
  -- over the available refused
  begin perform public.distribute_profits_manual(f, tt, jsonb_build_array(jsonb_build_object('partner_id', nasser, 'amount', av + 100)), null, 'keep'); out := out||'P4 OVER ACCEPTED!! | ';
  exception when others then out := out||'P4 over refused ✓ | '; end;
  -- spread but total ≠ available refused
  begin perform public.distribute_profits_manual(f, tt, jsonb_build_array(jsonb_build_object('partner_id', nasser, 'amount', 10)), null, 'spread'); out := out||'P5 SPREAD≠AVAIL ACCEPTED!! | ';
  exception when others then out := out||'P5 spread must equal ✓ | '; end;
  -- manager refused
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud_u,'role','authenticated')::text, true);
  begin perform public.distribute_profits_manual(f, tt, jsonb_build_array(jsonb_build_object('partner_id', nasser, 'amount', 10)), null, 'keep'); out := out||'P6 MANAGER ACCEPTED!! | ';
  exception when others then out := out||'P6 manager refused ✓ | '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  -- keep: 1,000 to الحاج ناصر + 500 to محمود, rest stays
  p0 := (public.partner_cards(nasser)->>'profit')::numeric;
  r := public.distribute_profits_manual(f, tt, jsonb_build_array(jsonb_build_object('partner_id', nasser, 'amount', 1000), jsonb_build_object('partner_id', mahmoud_p, 'amount', 500)), 'تجربة', 'keep');
  d := (r->>'distribution_id')::uuid; je := (r->>'journal_entry_id')::uuid;
  p1 := (public.partner_cards(nasser)->>'profit')::numeric;
  out := out||'P7 total='||(r->>'total_amount')||' kept='||(r->>'kept')||' nasser profitΔ='||(p1-p0)
       ||' entry balanced='||((select total_debit=total_credit from journal_entries where id=je))||' debit='||(select total_debit from journal_entries where id=je)
       ||' lines='||(select string_agg(round(share_percentage,2)||'%/sug '||round(suggested_percentage,2)||'%', ', ' order by amount desc) from profit_distribution_lines where distribution_id=d)||' | ';
  out := out||'P8 available after='||((public.period_split_preview(f, tt))->>'available')||' (avail−1500) | ';
  -- 0288 lock: capital of a distributed month can't change now
  begin x := public.partner_existing_capital(nasser, 5, '2026-10-01', null, null); out := out||'P9 LOCK MISSED!! | ';
  exception when others then out := out||'P9 capital lock ✓ | '; end;
  out := out||'P10 list n='||jsonb_array_length(public.profit_distributions_list())||' mode='||((public.profit_distributions_list())->0->>'mode')||' | ';
  -- reverse
  begin perform public.reverse_period_distribution(d, ''); out := out||'P11a NO REASON!! | '; exception when others then out := out||'P11a reason required ✓ | '; end;
  perform public.reverse_period_distribution(d, 'تجربة عكس');
  out := out||'P11 status='||(select status from profit_distributions where id=d)||' nasser profit back='||(((public.partner_cards(nasser)->>'profit')::numeric) = p0)
       ||' available back='||((((public.period_split_preview(f, tt))->>'available')::numeric) = av)||' | ';
  -- spread: whole available by two partners
  r := public.distribute_profits_manual(f, tt, jsonb_build_array(jsonb_build_object('partner_id', nasser, 'amount', round(av*0.7,2)), jsonb_build_object('partner_id', mahmoud_p, 'amount', av - round(av*0.7,2))), null, 'spread');
  out := out||'P12 spread total='||(r->>'total_amount')||' kept='||(r->>'kept')||' | ';
  out := out||'exposed='||(select count(*) from public.security_exposed_definer_functions())||' | ';
  perform setval(format('%I.%I', s2.schemaname, s2.sequencename), s2.last_value) from _seq s2;
  raise exception 'DRY %', out;
end $dry$;
