-- 0295 checks (rollback-only): paste the migration where marked; one execute_sql call; ends with raise 'DRY …'
create temp table _cap0 on commit drop as
  select p.id, m::date as m, public.partner_capital_for_month(p.id, m::date) as c
    from public.equity_partners p, generate_series(date '2026-01-01', date '2026-12-01', interval '1 month') m
   where p.tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
create temp table _seq on commit drop as select schemaname, sequencename, last_value from pg_sequences where schemaname='public' and last_value is not null;

-- >>> paste drizzle/migrations/0295_partner_counts_from_and_archive.sql here <<<

do $dry$
declare t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  sk uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142'; nasser uuid := '4a260665-29aa-4510-af0f-388166b6c01e'; nour uuid := 'a10d68fc-73b6-436a-bc8b-153574a2add3';
  o text := ''; r jsonb; x numeric; txid uuid; n int;
begin
  SET CONSTRAINTS ALL IMMEDIATE;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  o := concat(o, E'\nقبل: الأشهر اللي اتغيرت = ', (select count(*) from _cap0 c where abs(public.partner_capital_for_month(c.id, c.m) - c.c) > 0.005));
  -- 1) contribution 10,000 on 27/11 counting from December
  r := partner_money(nour, 'contribution', 10000, 'capital', null, sk, 'cash', cairo_today(), 'T1', null, date '2026-12-01');
  o := concat(o, E'\n1 مساهمة 10,000 يوم ', cairo_today(), ' يتحسب من ', r->>'counts_from', ': نوفمبر ', partner_capital_for_month(nour, '2026-11-01'), ' | ديسمبر ', partner_capital_for_month(nour, '2026-12-01'));
  -- 2) capital withdrawal counted in November while the money came in December: capital below zero → refused
  begin perform partner_money(nour, 'withdrawal', 4000, 'capital', null, sk, 'cash', cairo_today(), 'T2', null, date '2026-11-01'); o := concat(o, E'\n2 سحب يتحسب قبل الإيداع اتقبل!!');
  exception when others then o := concat(o, E'\n2 سحب 4,000 يتحسب من نوفمبر والإيداع من ديسمبر: ', left(sqlerrm, 70)); end;
  r := partner_money(nour, 'withdrawal', 4000, 'capital', null, sk, 'cash', cairo_today(), 'T2', null, date '2026-12-01');
  o := concat(o, E'\n2b سحب 4,000 يتحسب من ديسمبر: نوفمبر ', partner_capital_for_month(nour, '2026-11-01'), ' | ديسمبر ', partner_capital_for_month(nour, '2026-12-01'));
  -- 3) no month = the old rule (the month after)
  r := partner_money(nour, 'contribution', 1000, 'capital', null, sk, 'cash', date '2026-10-15', 'T3', null, null);
  o := concat(o, E'\n3 مساهمة 1,000 يوم 15/10 من غير شهر: أكتوبر ', partner_capital_for_month(nour, '2026-10-01'), ' | نوفمبر ', partner_capital_for_month(nour, '2026-11-01'), ' (القاعدة القديمة)');
  -- 4) wrong months refused
  begin perform partner_money(nour, 'contribution', 1, 'capital', null, sk, 'cash', cairo_today(), 'x', null, date '2026-12-15'); o := concat(o, E'\n4 شهر مش أول الشهر اتقبل!!');
  exception when others then o := concat(o, E'\n4 «يتحسب من» 15/12: ', left(sqlerrm, 40)); end;
  begin perform partner_money(nour, 'contribution', 1, 'capital', null, sk, 'cash', cairo_today(), 'x', null, date '2025-12-01'); o := concat(o, E'\n4b قبل 2026 اتقبل!!');
  exception when others then o := concat(o, E'\n4b «يتحسب من» 12/2025: ', left(sqlerrm, 50)); end;
  -- 5) edit the December contribution to count from November
  select id into txid from partner_transactions where partner_id = nour and description = 'T1' and not coalesce(is_void, false);
  r := edit_partner_capital_move(txid, 10000, cairo_today(), null, 'الشهر غلط', date '2026-11-01');
  o := concat(o, E'\n5 تعديل المساهمة تتحسب من نوفمبر: نوفمبر ', partner_capital_for_month(nour, '2026-11-01'), ' | ديسمبر ', partner_capital_for_month(nour, '2026-12-01'), ' | الكارت بيقول ', (select m->>'counts_from' from jsonb_array_elements(partner_cards(nour)->'movements') m where m->>'id' = r->>'new'));
  -- 6) delete / archive
  begin perform delete_partner(nour, 'تجربة'); o := concat(o, E'\n6 حذف نور وليها حركات اتقبل!!');
  exception when others then o := concat(o, E'\n6 حذف نور بعد الحركات: ', left(sqlerrm, 70)); end;
  begin perform set_partner_archived(nour, true, 'تجربة'); o := concat(o, E'\n6b أرشفة ورأس ماله مش صفر اتقبلت!!');
  exception when others then o := concat(o, E'\n6b أرشفة ورأس ماله ', partner_capital_for_month(nour, '2026-12-01'), ': ', left(sqlerrm, 50)); end;
  begin perform set_partner_archived(nasser, true, 'تجربة'); o := concat(o, E'\n6c أرشفة الحاج ناصر اتقبلت!!');
  exception when others then o := concat(o, E'\n6c أرشفة الحاج ناصر: ', left(sqlerrm, 50)); end;
  begin perform delete_partner(nasser, 'تجربة'); o := concat(o, E'\n6d حذف الحاج ناصر اتقبل!!');
  exception when others then o := concat(o, E'\n6d حذف الحاج ناصر: ', left(sqlerrm, 60)); end;
  -- a partner with nothing: archive, bring back, delete
  insert into equity_partners (tenant_id, name, partner_type, capital_share, operating_share, initial_capital, is_active)
  select t, 'شريك تجربة 0295', partner_type, 0, 0, 0, true from equity_partners where id = nour returning id into txid;
  perform set_partner_archived(txid, true, 'خرج');
  o := concat(o, E'\n7 أرشفة شريك فاضي: نشط؟ ', (select is_active from equity_partners where id = txid), ' سبب ', (select archive_reason from equity_partners where id = txid));
  perform set_partner_archived(txid, false, null);
  o := concat(o, E'\n7b رجوعه: نشط؟ ', (select is_active from equity_partners where id = txid));
  r := delete_partner(txid, 'اتعمل غلط');
  o := concat(o, E'\n7c حذف شريك فاضي: ', r->>'name', ' | لسه موجود؟ ', exists(select 1 from equity_partners where id = txid));
  -- 8) the browser can no longer delete a partner directly
  begin
    execute 'set local role authenticated';
    delete from equity_partners where id = nasser;
    get diagnostics n = row_count;
    execute 'reset role';
    o := concat(o, E'\n8 مسح مباشر من المتصفح: اتمسح ', n, '!!');
  exception when others then execute 'reset role'; o := concat(o, E'\n8 مسح مباشر من المتصفح: ', left(sqlerrm, 50)); end;
  -- 9) old movements unchanged
  o := concat(o, E'\n9 حركات الشركاء القديمة: الأشهر اللي اتغيرت = ', (select count(*) from _cap0 c where c.id <> nour and abs(public.partner_capital_for_month(c.id, c.m) - c.c) > 0.005),
              ' | exposed=', (select count(*) from public.security_exposed_definer_functions()));
  perform setval(format('%I.%I', s2.schemaname, s2.sequencename), s2.last_value) from _seq s2;
  raise exception 'DRY %', o;
end $dry$;
