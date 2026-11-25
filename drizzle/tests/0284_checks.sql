-- 0284 checks (rollback-only: always raises DRY). Run AFTER the migration as one execute_sql call.
do $dry$
declare t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; br uuid; s record; out text := ''; r jsonb; r2 jsonb; id1 uuid; id2 uuid; id3 uuid;
  b0 jsonb; till0 numeric; till1 numeric; n int;
  function_text text;
begin
  create temp table _seq on commit drop as select schemaname, sequencename, last_value from pg_sequences where schemaname='public' and last_value is not null;
  perform set_config('request.jwt.claims', json_build_object('sub','85c76e60-3d27-4a99-8cd7-c8f8b39d914a','role','authenticated')::text, true);
  select id into br from branches where tenant_id=t and name like '%شلبى%' limit 1;
  SET CONSTRAINTS ALL IMMEDIATE;
  -- books snapshot
  select jsonb_object_agg(code, bal) into b0 from (select a.code, round(sum(l.debit-l.credit),2) bal from journal_entry_lines l join journal_entries e on e.id=l.entry_id join chart_of_accounts a on a.id=l.account_id where e.tenant_id=t and e.status='posted' and a.code in ('1500','1590','3950','6500','1100','1110') group by a.code) x;
  select coalesce(sum(case when type='income' then amount else -amount end),0) into till0 from treasury where branch_id=br;

  -- 1) opening asset, then edit cost (replace), dispose, undo, cancel
  r := public.add_fixed_asset('اختبار تكييف','أجهزة',br,'2026-01-15',60000,0,60,'opening','cash',null,null); id1 := (r->>'id')::uuid;
  out := out || format('add: %s dep=%s | ', r->>'code', r->'depreciation');
  r2 := public.edit_fixed_asset(id1,'اختبار تكييف 2','أجهزة',br,'2026-01-15',60000,0,60,'opening','cash','ملاحظة',null,null);
  out := out || format('text-edit mode=%s status=%s | ', r2->>'mode', (select status from fixed_assets where id=id1));
  r2 := public.edit_fixed_asset(id1,'اختبار تكييف 2','أجهزة',br,'2026-03-10',48000,0,48,'opening','cash',null,null,'التكلفة كانت غلط'); id2 := (r2->>'id')::uuid;
  out := out || format('edit mode=%s new=%s old=%s replaced_by_ok=%s dep_new=%s | ', r2->>'mode', r2->>'code', (select status from fixed_assets where id=id1),
     (select replaced_by=id2 from fixed_assets where id=id1), r2->'depreciation');
  perform public.dispose_fixed_asset(id2, '2026-10-20', 40000, 'cash', null);
  out := out || format('disposed=%s | ', (select status from fixed_assets where id=id2));
  r2 := public.undo_fixed_asset_disposal(id2, 'اتسجل بالغلط');
  out := out || format('undo status=%s dep=%s | ', (select status from fixed_assets where id=id2), r2->'depreciation');
  begin perform public.edit_fixed_asset(id1,'x',null,br,'2026-01-15',1,0,1,'opening','cash',null,null,'x'); out := out||'EDIT-CANCELLED-ALLOWED!! | ';
  exception when others then out := out || 'edit cancelled refused ok | '; end;
  perform public.dispose_fixed_asset(id2, '2026-11-01', 0, 'cash', null);
  r2 := public.cancel_fixed_asset(id2, 'اختبار');
  out := out || format('cancel disposed: %s | ', r2);

  -- 2) paid asset then cancel
  r := public.add_fixed_asset('اختبار رفوف',null,br,'2026-06-05',10000,0,24,'paid','cash',null,null); id3 := (r->>'id')::uuid;
  select coalesce(sum(case when type='income' then amount else -amount end),0) into till1 from treasury where branch_id=br;
  out := out || format('paid till delta=%s | ', till1-till0);
  r2 := public.cancel_fixed_asset(id3, 'اختبار');
  select coalesce(sum(case when type='income' then amount else -amount end),0) into till1 from treasury where branch_id=br;
  out := out || format('after cancel till delta=%s rev_on_day=%s | ', till1-till0,
     (select string_agg(distinct transaction_date::text, ',') from treasury where branch_id=br and category='إلغاء سند' and description like '%أصل FA%'));

  -- books back?
  select string_agg(code||':'||(coalesce(bal,0)-coalesce((b0->>code)::numeric,0))::text, ' ') into function_text
    from (select c.code, (select round(sum(l.debit-l.credit),2) from journal_entry_lines l join journal_entries e on e.id=l.entry_id join chart_of_accounts a on a.id=l.account_id where e.tenant_id=t and e.status='posted' and a.code=c.code) bal from unnest(array['1500','1590','3950','6500','1100','1110']) c(code)) x;
  out := out || 'books delta ' || function_text;
  select count(*) into n from journal_entries o join journal_entries rv on rv.id=o.reversed_by where o.tenant_id=t and o.source_id in (id1,id2,id3, (select treasury_id from fixed_assets where id=id3)) and o.entry_date <> rv.entry_date;
  out := out || ' | reversals not on own day=' || n || ' | reversed=' || (select count(*) from journal_entries o where o.tenant_id=t and o.reversed_by is not null and o.source_id in (id1,id2,id3,(select treasury_id from fixed_assets where id=id3)))
     || ' unreversed_left=' || (select count(*) from journal_entries o where o.tenant_id=t and o.reversed_by is null and o.source_type not like '%reversal' and (o.source_id in (id1,id2,id3) or o.description like '%اختبار%'));
  for s in select * from _seq loop perform setval(format('%I.%I', s.schemaname, s.sequencename), s.last_value); end loop;
  raise exception 'DRY %', out;
end $dry$;
