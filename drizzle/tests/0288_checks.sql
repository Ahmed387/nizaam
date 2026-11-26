-- 0288 checks (rollback-only: always raises DRY). Run after migration 0288.
do $dry$
declare t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  mahmoud_p uuid := '4bcf7c60-69b2-4049-b1e5-001cbf4e509f'; mahmoud_u uuid := '9aa41d69-13ef-41d8-a6ca-b6c722c95c62';
  sk uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';
  out text := ''; id1 uuid; id2 uuid; r jsonb; c0 numeric; c1 numeric; v0 numeric; v1 numeric; ct uuid; ct2 uuid; d uuid; n int; att uuid;
begin
  create temp table _seq on commit drop as select schemaname, sequencename, last_value from pg_sequences where schemaname='public' and last_value is not null;
  SET CONSTRAINTS ALL IMMEDIATE;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  c0 := (public.partner_cards(mahmoud_p)->>'capital')::numeric;
  -- C1 deposit date older than 2026
  id1 := public.partner_existing_capital(mahmoud_p, 1000, '2026-01-01', 'تجربة', '2024-03-15');
  out := out||'C1 deposited_on='||(select deposited_on from partner_transactions where id=id1)||' | ';
  -- C2 empty deposit = بيتحسب من
  id2 := public.partner_existing_capital(mahmoud_p, 500, '2026-02-01', null, null);
  out := out||'C2 empty→'||(select deposited_on from partner_transactions where id=id2)||' | ';
  -- C3 future deposit refused
  begin perform public.partner_existing_capital(mahmoud_p, 1, '2026-01-01', null, (public.cairo_today()+1)); out := out||'C3 FUTURE ACCEPTED!! | ';
  exception when others then out := out||'C3 future refused ✓ | '; end;
  -- C4 deposit after بيتحسب من accepted (warning only on screen)
  perform public.partner_existing_capital(mahmoud_p, 1, '2026-01-01', null, '2026-03-01'); out := out||'C4 after-start ok ✓ | ';
  -- C5 edit existing (amount + deposit) with a proof file
  insert into attachments (tenant_id, record_type, record_id, file_path, file_name, uploaded_by) values (t, 'partner_transaction', id1, 'x/y.jpg', 'y.jpg', owner) returning id into att;
  begin perform public.edit_existing_capital(id1, 1200, '2026-01-01', '2024-03-15', null, ''); out := out||'C5a NO REASON ACCEPTED!! | ';
  exception when others then out := out||'C5a reason required ✓ | '; end;
  ct := public.edit_existing_capital(id1, 1200, '2026-01-01', '2024-04-01', null, 'المبلغ كان غلط');
  out := out||'C5 old void='||(select is_void from partner_transactions where id=id1)||' replaced_by ok='||((select replaced_by from partner_transactions where id=id1)=ct)
       ||' new replaces ok='||((select replaces from partner_transactions where id=ct)=id1)||' edited_by owner='||((select edited_by from partner_transactions where id=ct)=owner)
       ||' file moved='||((select record_id from attachments where id=att)=ct)||' capitalΔ='||((public.partner_cards(mahmoud_p)->>'capital')::numeric - c0)||' (1701) | ';
  -- C6 manager (not owner/admin) refused
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud_u,'role','authenticated')::text, true);
  begin perform public.edit_existing_capital(ct, 1, '2026-01-01', null, null, 'x'); out := out||'C6 MANAGER EDITED!! | ';
  exception when others then out := out||'C6 manager refused ✓ | '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  -- C7 cancel keeps who / when
  perform public.cancel_partner_transaction(id2, 'تجربة إلغاء');
  out := out||'C7 cancelled_by owner='||((select cancelled_by from partner_transactions where id=id2)=owner)||' at set='||((select cancelled_at from partner_transactions where id=id2) is not null)||' | ';
  -- C8 till contribution edited on another day: amount + date
  select coalesce(sum(case when x.type='income' then x.amount else -x.amount end),0) into v0 from treasury x where x.branch_id=sk and x.payment_method='cash';
  r := public.partner_money(mahmoud_p, 'contribution', 300, 'capital', null, sk, 'cash', '2026-11-20', 'مساهمة تجربة', null);
  select id into ct2 from partner_transactions where related_treasury_id=(r->>'treasury_id')::uuid;
  r := public.edit_partner_capital_move(ct2, 250, '2026-11-18', null, 'اليوم والمبلغ غلط');
  select coalesce(sum(case when x.type='income' then x.amount else -x.amount end),0) into v1 from treasury x where x.branch_id=sk and x.payment_method='cash';
  out := out||'C8 till Δ='||(v1-v0)||' (250) old void='||(select is_void from partner_transactions where id=ct2)
       ||' reversal day='||coalesce((select string_agg(x.transaction_date::text, ',') from treasury x where x.category='partner_cancel' and x.created_at > now()-interval '1 minute'),'-')
       ||' new day='||(select movement_date from partner_transactions where id=(r->>'new')::uuid)||' replaces ok='||((select replaces from partner_transactions where id=(r->>'new')::uuid)=ct2)
       ||' cards editable='||coalesce((select (m->>'editable') from jsonb_array_elements(public.partner_cards(mahmoud_p)->'movements') m where m->>'id'=(r->>'new')),'?')||' | ';
  -- C9 a distributed month blocks edits / cancels / new existing capital in it
  insert into profit_distributions (tenant_id, distribution_date, total_amount, status, notes, created_by, period_from, period_to)
  values (t, '2026-03-31', 1, 'posted', 'تجربة', owner, '2026-01-01', '2026-03-31') returning id into d;
  begin perform public.edit_existing_capital(ct, 999, '2026-01-01', null, null, 'x'); out := out||'C9a EDIT IN DISTRIBUTED ACCEPTED!! | ';
  exception when others then out := out||'C9a edit refused: '||left(sqlerrm, 40)||' ✓ | '; end;
  begin perform public.cancel_partner_transaction(ct, 'x'); out := out||'C9b CANCEL IN DISTRIBUTED ACCEPTED!! | ';
  exception when others then out := out||'C9b cancel refused ✓ | '; end;
  begin perform public.partner_existing_capital(mahmoud_p, 5, '2026-02-01', null, null); out := out||'C9c NEW IN DISTRIBUTED ACCEPTED!! | ';
  exception when others then out := out||'C9c new refused ✓ | '; end;
  -- a deposit-date-only change of a distributed month is fine (no capital moves)
  perform public.edit_existing_capital(ct, 1200, '2026-01-01', '2023-01-01', null, 'تاريخ الإيداع بس'); out := out||'C9d deposit-only edit ok ✓ | ';
  update profit_distributions set status='reversed' where id=d;
  perform public.cancel_partner_transaction((select id from partner_transactions where replaces=ct), 'بعد العكس'); out := out||'C9e after reversal cancel ok ✓ | ';
  -- C10 cards JSON
  out := out||'C10 json keys='||(select string_agg(k, ',' order by k) from jsonb_object_keys((public.partner_cards(mahmoud_p)->'movements')->0) k where k in ('deposited_on','edited_by','cancelled_by','replaces','files'))||' | ';
  out := out||'exposed='||(select count(*) from public.security_exposed_definer_functions())||' | ';
  perform setval(format('%I.%I', s.schemaname, s.sequencename), s.last_value) from _seq s;
  raise exception 'DRY %', out;
end $dry$;
