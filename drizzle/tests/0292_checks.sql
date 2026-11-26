-- 0292 checks (rollback-only: always raises DRY). ONE call: this header + migration 0292 (where marked) + the DO block.
create function pg_temp.gap() returns text language sql as $$
  with t as (select '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'::uuid id),
  till as (select tr.branch_id, sum(case when public.ledger_cash_account(tr.payment_method)='1100' then (case when tr.type='income' then tr.amount else -tr.amount end) else 0 end) c,
                  sum(case when public.ledger_cash_account(tr.payment_method)='1110' then (case when tr.type='income' then tr.amount else -tr.amount end) else 0 end) w
             from public.treasury tr, t where tr.tenant_id=t.id group by 1),
  gl as (select e.branch_id, sum(l.debit-l.credit) filter (where a.code='1100') g0, sum(l.debit-l.credit) filter (where a.code='1110') g1
           from public.journal_entry_lines l join public.journal_entries e on e.id=l.entry_id and e.status='posted' join public.chart_of_accounts a on a.id=l.account_id, t
          where e.tenant_id=t.id and a.code in ('1100','1110') group by 1)
  select string_agg(left(b.name,10)||' نقدية Δ'||round(coalesce(gl.g0,0)-coalesce(till.c,0),2)||' محافظ Δ'||round(coalesce(gl.g1,0)-coalesce(till.w,0),2), ' / ' order by b.name)
    from till full join gl using(branch_id) join public.branches b on b.id=coalesce(till.branch_id, gl.branch_id) $$;
create function pg_temp.others() returns text language sql as $$
  select md5(string_agg(a.code||':'||round(s,2), ',' order by a.code)) from (
    select a.code, sum(l.debit-l.credit) s from public.journal_entry_lines l join public.journal_entries e on e.id=l.entry_id and e.status='posted'
      join public.chart_of_accounts a on a.id=l.account_id where e.tenant_id='5316fbfe-b862-4c91-b48b-1d81c8aa5a71' and a.code not in ('1100','1110') group by 1) a $$;
create function pg_temp.cashsum() returns numeric language sql as $$
  select round(sum(l.debit-l.credit),2) from public.journal_entry_lines l join public.journal_entries e on e.id=l.entry_id and e.status='posted'
   join public.chart_of_accounts a on a.id=l.account_id where e.tenant_id='5316fbfe-b862-4c91-b48b-1d81c8aa5a71' and a.code in ('1100','1110') $$;
create function pg_temp.profit() returns numeric language sql as $$
  select ((public.profit_statement_core('5316fbfe-b862-4c91-b48b-1d81c8aa5a71','2026-01-01',public.cairo_today(),null))->'total'->>'net_profit')::numeric $$;
select set_config('t.oth', pg_temp.others(), true), set_config('t.cs', pg_temp.cashsum()::text, true), set_config('t.p', pg_temp.profit()::text, true), set_config('t.gap0', pg_temp.gap(), true);

-- >>> paste drizzle/migrations/0292_cash_split_vessels.sql here <<<

do $dry$
declare t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  sk uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142'; o text := ''; cat uuid; v uuid; r jsonb; old uuid; n int;
begin
  create temp table _seq on commit drop as select schemaname, sequencename, last_value from pg_sequences where schemaname='public' and last_value is not null;
  SET CONSTRAINTS ALL IMMEDIATE;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  o := concat(o, E'\nقبل: ', current_setting('t.gap0'), E'\nبعد التصليح: ', pg_temp.gap());
  o := concat(o, E'\nباقي الحسابات اتغيرت؟ ', (pg_temp.others() <> current_setting('t.oth')), ' | مجموع النقدية+المحافظ Δ', pg_temp.cashsum() - current_setting('t.cs')::numeric,
              ' | ربح السنة Δ', round(pg_temp.profit() - current_setting('t.p')::numeric, 2));
  o := concat(o, E'\nقيود التصحيح: ', (select string_agg(left(e.description, 120) || ' = ' || round((select sum(debit) from journal_entry_lines where entry_id=e.id),2), ' || ')
                                        from journal_entries e where e.source_type='cash_split_correction' and e.tenant_id=t));
  o := concat(o, E'\nقيود تحويل الأوعية الجديدة: ', (select count(*) from journal_entries where source_type='vessel_transfer' and tenant_id=t),
              ' | سندات اتعلّمت: ', (select count(*) from cash_split_fixed_entries));
  -- new expense in a non-cash vessel
  select id into cat from voucher_categories where tenant_id=t and type='payment' and coalesce(is_active,true) and gl_account_code like '5%' and not coalesce(is_system,false) limit 1;
  v := create_manual_voucher(sk, 'payment', cat, 777, 'company_offers', 'X0292', 'تجربة', 0, 'other', null, 'تجربة', 'تجربة 0292', cairo_today(), 'تجربة');
  o := concat(o, E'\nN1 مصروف 777 من «خصومات وعروض»: ', pg_temp.gap());
  perform cancel_voucher(v, 'تجربة');
  o := concat(o, E'\nN2 إلغاؤه: ', pg_temp.gap());
  -- an OLD wallet expense (corrected) cancelled now
  select v2.id into old from cash_split_fixed_entries f join journal_entries e on e.id=f.entry_id join vouchers v2 on v2.id=e.source_id
   where e.branch_id=sk and v2.status='active' and v2.payment_method='vodafone' and v2.type='payment' order by v2.voucher_date desc limit 1;
  perform cancel_voucher(old, 'تجربة 0292');
  o := concat(o, E'\nN3 إلغاء سند فودافون قديم (', (select voucher_number||' '||amount from vouchers where id=old), '): ', pg_temp.gap());
  -- vessel transfer cash -> vodafone, then cancel
  r := transfer_between_vessels(sk, 'cash', 'vodafone', 1000, 'none', 0, null, 'تجربة 0292', null, '01017144488');
  o := concat(o, E'\nN4 تحويل 1,000 كاش ← فودافون: ', pg_temp.gap(), ' | قيد؟ ', (select count(*) from journal_entries where source_type='vessel_transfer' and source_id=(r->>'id')::uuid));
  perform cancel_vessel_transfer((r->>'id')::uuid, 'تجربة');
  o := concat(o, E'\nN5 إلغاؤه: ', pg_temp.gap());
  -- an old transfer cancelled
  select id into old from vessel_transfers where tenant_id=t and branch_id=sk and status<>'cancelled' and ledger_cash_account(from_method)<>ledger_cash_account(to_method) order by transfer_date desc limit 1;
  begin perform cancel_vessel_transfer(old, 'تجربة'); o := concat(o, E'\nN6 إلغاء تحويل قديم: ', pg_temp.gap());
  exception when others then o := concat(o, E'\nN6 ', left(sqlerrm, 90)); end;
  o := concat(o, E'\nexposed=', (select count(*) from public.security_exposed_definer_functions()));
  perform setval(format('%I.%I', s2.schemaname, s2.sequencename), s2.last_value) from _seq s2;
  raise exception 'DRY %', o;
end $dry$;
