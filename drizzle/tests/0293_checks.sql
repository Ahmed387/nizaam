-- 0293 checks (rollback-only: always raises DRY). ONE call: this file's helpers + migration 0293 (where marked) + the DO block.
create function pg_temp.net(c uuid, br uuid, side text) returns numeric language sql as $$ select public._contact_side_net(c, br, side) $$;
create function pg_temp.pr(f date, t date) returns numeric language sql as $$
  select ((public.profit_statement_core('5316fbfe-b862-4c91-b48b-1d81c8aa5a71', f, t, null))->'total'->>'net_profit')::numeric $$;
create function pg_temp.books() returns text language sql as $$
  with t as (select '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'::uuid id),
  till as (select tr.branch_id, sum(case when public.ledger_cash_account(tr.payment_method)='1100' then (case when tr.type='income' then tr.amount else -tr.amount end) else 0 end) c,
                  sum(case when public.ledger_cash_account(tr.payment_method)='1110' then (case when tr.type='income' then tr.amount else -tr.amount end) else 0 end) w
             from public.treasury tr, t where tr.tenant_id=t.id group by 1),
  gl as (select e.branch_id, sum(l.debit-l.credit) filter (where a.code='1100') g0, sum(l.debit-l.credit) filter (where a.code='1110') g1
           from public.journal_entry_lines l join public.journal_entries e on e.id=l.entry_id and e.status='posted' join public.chart_of_accounts a on a.id=l.account_id, t
          where e.tenant_id=t.id and a.code in ('1100','1110') group by 1)
  select concat('خزن≠دفاتر: ', (select count(*) from till join gl using(branch_id) where abs(coalesce(g0,0)-c)>0.01 or abs(coalesce(g1,0)-w)>0.01),
                ' | حسابات≠قيود: ', (select string_agg(left(branch_name,8)||' '||round(gl_net-ledger_net,2), ',') from public.ca_branch_accounts((select id from t)) where abs(gl_net-ledger_net)>0.01)) $$;

-- >>> paste drizzle/migrations/0293_voucher_party_rules.sql here <<<

do $dry$
declare t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  sk uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142'; karim uuid := 'af4c23ab-b222-4fb0-af71-eebda08d4014'; sup uuid := 'aa5971a3-e079-485f-9e4f-9dae4592de64';
  o text := ''; c_sp uuid; c_in uuid; c_rs uuid; c_or uuid; c_sal uuid; c_ar uuid; emp uuid; emp_off uuid; v uuid; r jsonb; a numeric; b numeric; p10 numeric; p11 numeric; old uuid;
begin
  create temp table _seq on commit drop as select schemaname, sequencename, last_value from pg_sequences where schemaname='public' and last_value is not null;
  SET CONSTRAINTS ALL IMMEDIATE;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  select id into c_sp from voucher_categories where tenant_id=t and system_key='supplier_payment';
  select id into c_in from voucher_categories where tenant_id=t and system_key='installment';
  select id into c_rs from voucher_categories where tenant_id=t and name='مقبوضات من موردين' and type='receipt';
  select id into c_or from voucher_categories where tenant_id=t and system_key='other_receipt';
  select id into c_sal from voucher_categories where tenant_id=t and system_key='salary';
  select id into c_ar from voucher_categories where tenant_id=t and system_key='advance_repayment';
  select id into emp from employees where tenant_id=t and coalesce(is_active,true) order by (branch_id=sk) desc, name limit 1;
  select id into emp_off from employees where tenant_id=t and is_active = false limit 1;
  o := concat(o, E'\nالقواعد: مدفوعات موردين=', voucher_category_party_rule(c_sp), ' أقساط=', voucher_category_party_rule(c_in), ' مقبوضات موردين=', voucher_category_party_rule(c_rs),
              ' رواتب=', voucher_category_party_rule(c_sal), ' رد سلف=', voucher_category_party_rule(c_ar), ' إيرادات أخرى=', coalesce(voucher_category_party_rule(c_or),'—'));
  o := concat(o, E'\nقبل: ', pg_temp.books());
  -- V1/V2 supplier payment
  begin perform create_manual_voucher(sk, 'payment', c_sp, 100, 'cash', null, null, 0, null, null, null, 'V1', cairo_today(), null); o := concat(o, E'\nV1 مدفوعات موردين من غير مورد اتقبل!!');
  exception when others then o := concat(o, E'\nV1 مدفوعات موردين من غير مورد: ', left(sqlerrm, 70)); end;
  begin perform create_manual_voucher(sk, 'payment', c_sp, 100, 'cash', null, null, 0, 'customer', karim, 'كريم عاطف', 'V1b', cairo_today(), null); o := concat(o, E'\nV1b مدفوعات موردين لعميل اتقبل!!');
  exception when others then o := concat(o, E'\nV1b مدفوعات موردين لعميل: اترفض ✓'); end;
  a := pg_temp.net(sup, sk, 'supplier');
  perform create_manual_voucher(sk, 'payment', c_sp, 100, 'cash', null, null, 0, 'supplier', sup, 'ولاد محمود', 'V2', cairo_today(), null);
  o := concat(o, E'\nV2 مدفوعات موردين لولاد محمود 100: ', a, ' → ', pg_temp.net(sup, sk, 'supplier'));
  -- V3 installment
  begin perform create_manual_voucher(sk, 'receipt', c_in, 100, 'cash', null, null, 0, 'other', null, 'حد', 'V3', cairo_today(), null); o := concat(o, E'\nV3 أقساط من غير عميل اتقبل!!');
  exception when others then o := concat(o, E'\nV3 تحصيل أقساط من غير عميل: ', left(sqlerrm, 70)); end;
  -- V4 receipt from supplier on «مقبوضات من موردين»
  a := pg_temp.net(sup, sk, 'supplier'); b := (select sum(case when type='income' then amount else -amount end) from treasury where branch_id=sk and payment_method='cash');
  perform create_manual_voucher(sk, 'receipt', c_rs, 500, 'cash', null, null, 0, 'supplier', sup, 'ولاد محمود', 'V4', cairo_today(), null);
  o := concat(o, E'\nV4 مقبوضات من موردين 500 من ولاد محمود: علينا له ', a, ' → ', pg_temp.net(sup, sk, 'supplier'), ' | الكاش +',
              (select sum(case when type='income' then amount else -amount end) from treasury where branch_id=sk and payment_method='cash') - b, ' | ', pg_temp.books());
  begin perform create_manual_voucher(sk, 'receipt', c_rs, 500, 'cash', null, null, 0, null, null, null, 'V4b', cairo_today(), null); o := concat(o, E'\nV4b مقبوضات موردين من غير مورد اتقبل!!');
  exception when others then o := concat(o, E'\nV4b مقبوضات موردين من غير مورد: اترفض ✓'); end;
  begin perform create_manual_voucher(sk, 'receipt', c_or, 50, 'cash', null, null, 0, 'supplier', sup, 'ولاد محمود', 'V5', cairo_today(), null); o := concat(o, E'\nV5 إيرادات أخرى من مورد اتقبل!!');
  exception when others then o := concat(o, E'\nV5 إيرادات أخرى من مورد: ', left(sqlerrm, 60)); end;
  -- V6 salary
  begin perform create_manual_voucher(sk, 'payment', c_sal, 100, 'cash', null, null, 0, null, null, null, 'V6', cairo_today(), null); o := concat(o, E'\nV6 رواتب من غير موظف اتقبل!!');
  exception when others then o := concat(o, E'\nV6 رواتب من غير موظف: ', left(sqlerrm, 70)); end;
  if emp_off is not null then
    begin perform create_manual_voucher(sk, 'payment', c_sal, 100, 'cash', null, null, 0, 'employee', emp_off, 'x', 'V6b', cairo_today(), null); o := concat(o, E'\nV6b موظف موقوف اتقبل!!');
    exception when others then o := concat(o, E'\nV6b موظف موقوف: اترفض ✓'); end;
  end if;
  perform create_manual_voucher(sk, 'payment', c_sal, 100, 'cash', null, null, 0, 'employee', emp, (select name from employees where id=emp), 'V6c', cairo_today(), null);
  o := concat(o, E'\nV6c رواتب لموظف شغال: اتقبل ✓');
  perform create_manual_voucher(sk, 'receipt', c_ar, 100, 'cash', null, null, 0, 'employee', emp, (select name from employees where id=emp), 'V7', cairo_today(), null);
  o := concat(o, E'\nV7 رد سلف من موظف: اتقبل ✓');
  -- V8 settlement still works, V9 PV-7650 untouched
  r := settle_contact_without_money(sk, sup, 'supplier', 'we_owe_less', 50, cairo_today(), 'V8');
  o := concat(o, E'\nV8 تسوية بدون فلوس لمورد: ', r->>'settlement_number', ' ✓');
  perform cancel_contact_settlement((r->>'id')::uuid, 'x');
  o := concat(o, E'\nV9 PV-7650 لسه: ', (select status || ' بدون مورد=' || (party_id is null) from vouchers where voucher_number='PV-7650'));
  -- V10 cancelling an old salary voucher with no employee still works
  select v2.id into old from vouchers v2 where v2.tenant_id=t and v2.category_id=c_sal and v2.party_id is null and v2.status='active' and v2.source='manual' and v2.branch_id=sk order by voucher_date desc limit 1;
  begin perform cancel_voucher(old, 'تجربة'); o := concat(o, E'\nV10 إلغاء سند رواتب قديم من غير موظف: اشتغل ✓');
  exception when others then o := concat(o, E'\nV10 ', left(sqlerrm, 80)); end;
  o := concat(o, E'\nبعد السندات: ', pg_temp.books());
  -- C1 a «تسوية برصيد» in October, October locked, cancelled now
  r := settle_contact_to_balance(sk, karim, 'customer', 2000, '2026-10-15', 'C1');
  p10 := pg_temp.pr('2026-10-01','2026-10-31'); p11 := pg_temp.pr('2026-11-01', cairo_today());
  insert into fiscal_periods (tenant_id, name, period_start, period_end, status) values (t, 'قفل تجربة', '2026-10-01', '2026-10-31', 'closed');
  begin perform cancel_contact_settlement((r->>'id')::uuid, 'C1');
    o := concat(o, E'\nC1 إلغاء تسوية خسارة 1,600 يوم 15/10 بعد قفل أكتوبر: اشتغل | كريم ', pg_temp.net(karim, sk, 'customer'),
      ' | ربح أكتوبر Δ', round(pg_temp.pr('2026-10-01','2026-10-31') - p10, 2), ' | ربح نوفمبر Δ', round(pg_temp.pr('2026-11-01', cairo_today()) - p11, 2),
      ' | حركات الإلغاء في: ', (select string_agg(distinct transaction_date::text, ',') from treasury where category='إلغاء سند' and reference_id in ((r->>'contact_voucher_id')::uuid, (r->>'offset_voucher_id')::uuid)),
      ' | ', pg_temp.books());
  exception when others then o := concat(o, E'\nC1 فشل: ', left(sqlerrm, 120)); end;
  -- C2 an ordinary voucher of a locked day is still refused
  select v2.id into old from vouchers v2 where v2.tenant_id=t and v2.status='active' and v2.source='manual' and v2.voucher_date between '2026-10-01' and '2026-10-31' and v2.branch_id=sk and v2.party_id is null limit 1;
  begin perform cancel_voucher(old, 'تجربة'); o := concat(o, E'\nC2 سند عادي في فترة مقفولة اتلغى!!');
  exception when others then o := concat(o, E'\nC2 سند عادي في فترة مقفولة: اترفض ✓'); end;
  o := concat(o, E'\nفي الآخر: ولاد محمود علينا له ', pg_temp.net(sup, sk, 'supplier'), ' (بعد +100 صرف −50 تسوية ملغية +500 مقبوضات) | ', pg_temp.books());
  o := concat(o, E'\nexposed=', (select count(*) from public.security_exposed_definer_functions()));
  perform setval(format('%I.%I', s2.schemaname, s2.sequencename), s2.last_value) from _seq s2;
  raise exception 'DRY %', o;
end $dry$;
