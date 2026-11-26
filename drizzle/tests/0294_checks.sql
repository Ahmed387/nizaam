-- 0294 checks (rollback-only: always raises DRY). ONE call: helpers + migration 0294 (where marked) + the DO block.
create function pg_temp.pr(f date, t date) returns numeric language sql as $$
  select ((public.profit_statement_core('5316fbfe-b862-4c91-b48b-1d81c8aa5a71', f, t, null))->'total'->>'net_profit')::numeric $$;
create function pg_temp.gl(p_code text) returns numeric language sql as $$
  select round(coalesce(sum(l.debit-l.credit),0),2) from public.journal_entry_lines l join public.journal_entries e on e.id=l.entry_id and e.status='posted'
   join public.chart_of_accounts a on a.id=l.account_id where e.tenant_id='5316fbfe-b862-4c91-b48b-1d81c8aa5a71' and a.code=p_code $$;
create function pg_temp.books() returns text language sql as $$
  with t as (select '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'::uuid id),
  till as (select tr.branch_id, sum(case when public.ledger_cash_account(tr.payment_method)='1100' then (case when tr.type='income' then tr.amount else -tr.amount end) else 0 end) c,
                  sum(case when public.ledger_cash_account(tr.payment_method)='1110' then (case when tr.type='income' then tr.amount else -tr.amount end) else 0 end) w
             from public.treasury tr, t where tr.tenant_id=t.id group by 1),
  gl as (select e.branch_id, sum(l.debit-l.credit) filter (where a.code='1100') g0, sum(l.debit-l.credit) filter (where a.code='1110') g1
           from public.journal_entry_lines l join public.journal_entries e on e.id=l.entry_id and e.status='posted' join public.chart_of_accounts a on a.id=l.account_id, t
          where e.tenant_id=t.id and a.code in ('1100','1110') group by 1)
  select concat('خزن≠دفاتر ', (select count(*) from till join gl using(branch_id) where abs(coalesce(g0,0)-c)>0.01 or abs(coalesce(g1,0)-w)>0.01)) $$;
create function pg_temp.vb(m text) returns numeric language plpgsql as $$ begin return public._vessel_balance('1329f6cc-a4a5-418c-9e91-cccd651b3142'::uuid, m, public.cairo_today()); end $$;

-- >>> paste drizzle/migrations/0294_vessel_counts_and_advances.sql here <<<

do $dry$
declare t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a'; mgr uuid := '9aa41d69-13ef-41d8-a6ca-b6c722c95c62';
  sk uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142'; karim uuid := 'af4c23ab-b222-4fb0-af71-eebda08d4014';
  o text := ''; emp uuid; ename text; c_adv uuid; c_rep uuid; v1 uuid; v2 uuid; v3 uuid; r jsonb; b jsonb; p0 numeric; a numeric; x numeric; aid uuid; cid uuid;
begin
  create temp table _seq on commit drop as select schemaname, sequencename, last_value from pg_sequences where schemaname='public' and last_value is not null;
  SET CONSTRAINTS ALL IMMEDIATE;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  select id, name into emp, ename from employees where tenant_id=t and coalesce(is_active,true) and branch_id=sk order by name limit 1;
  select id into c_adv from voucher_categories where tenant_id=t and system_key='advance';
  select id into c_rep from voucher_categories where tenant_id=t and system_key='advance_repayment';
  o := concat(o, E'\nقبل: ', pg_temp.books());
  -- ===== A. advances =====
  v1 := create_manual_voucher(sk, 'payment', c_adv, 1000, 'cash', null, null, 0, 'employee', emp, ename, 'A1', cairo_today(), null);
  select id into aid from advances where voucher_id=v1;
  o := concat(o, E'\nA1 سند سلف 1,000 لـ', ename, ': سلفة اتسجلت؟ ', aid is not null, ' المتبقي ', (select remaining from advances where id=aid));
  v2 := create_manual_voucher(sk, 'receipt', c_rep, 300, 'cash', null, null, 0, 'employee', emp, ename, 'A2', cairo_today(), null);
  o := concat(o, E'\nA2 رد سلف 300: المتبقي ', (select remaining from advances where id=aid));
  a := (select coalesce(sum(remaining),0) from advances where employee_id=emp and status<>'cancelled');
  begin perform create_manual_voucher(sk, 'receipt', c_rep, a + 1, 'cash', null, null, 0, 'employee', emp, ename, 'A3', cairo_today(), null); o := concat(o, E'\nA3 رد أكتر من المفتوح اتقبل!!');
  exception when others then o := concat(o, E'\nA3 رد أكتر من المفتوح (', a, '): ', left(sqlerrm, 60)); end;
  begin perform cancel_voucher(v1, 'A4'); o := concat(o, E'\nA4 إلغاء سند السلفة بعد ما اتخصم منها اتقبل!!');
  exception when others then o := concat(o, E'\nA4 إلغاء سند السلفة بعد رد 300: ', left(sqlerrm, 70)); end;
  perform cancel_voucher(v2, 'A5');
  o := concat(o, E'\nA5 إلغاء سند رد السلفة: المتبقي رجع ', (select remaining from advances where id=aid));
  perform cancel_employee_advance(aid, 'A6');
  o := concat(o, E'\nA6 إلغاء السلفة من صفحة الموظف: السلفة ', (select status from advances where id=aid), ' | السند ', (select status from vouchers where id=v1), ' | ', pg_temp.books());
  -- ===== B. ledger reversal in a locked period =====
  r := settle_contact_to_balance(sk, karim, 'customer', 2000, '2026-10-15', 'B');
  insert into fiscal_periods (tenant_id, name, period_start, period_end, status) values (t, 'قفل تجربة', '2026-10-01', '2026-10-31', 'closed');
  perform cancel_contact_settlement((r->>'id')::uuid, 'B');
  o := concat(o, E'\nB إلغاء تسوية بعد قفل أكتوبر: قيود العكس في ', (select string_agg(distinct entry_date::text, ',') from journal_entries where created_at >= now() and entry_date >= '2026-10-01' and source_type like '%reversal%'));
  update fiscal_periods set status='open' where name='قفل تجربة' and tenant_id=t;
  -- ===== C. vessel counts =====
  b := vessel_count_board(sk);
  o := concat(o, E'\nC1 الأوعية: ', (select string_agg((ve->>'label')||' '||(ve->>'balance'), ' / ') from jsonb_array_elements(b->'vessels') ve), ' | الوضع ', b->>'mode');
  p0 := pg_temp.pr('2026-11-01', cairo_today()); a := pg_temp.vb('cash');
  begin perform submit_vessel_count(sk, 'cash', a - 500, 'عد'); o := concat(o, E'\nC2a عجز من غير اختيار اتقبل!!');
  exception when others then o := concat(o, E'\nC2a عجز 500 من غير اختيار: ', left(sqlerrm, 70)); end;
  r := submit_vessel_count(sk, 'cash', a - 500, 'عد', null, 'loss', null, 'فلوس ناقصة');
  o := concat(o, E'\nC2 كاش: في السيستم ', a, ' والفعلي ', a-500, ' → خسارة: ', r->>'voucher', ' | الكاش دلوقتي ', pg_temp.vb('cash'), ' | ربح نوفمبر Δ', pg_temp.pr('2026-11-01', cairo_today()) - p0, ' | 6920 ', pg_temp.gl('6920'));
  cid := (r->>'id')::uuid;
  x := pg_temp.gl('3800'); a := pg_temp.vb('vodafone');
  r := submit_vessel_count(sk, 'vodafone', a + 300, 'عد', null, 'prior_years', null, 'رصيد قديم');
  o := concat(o, E'\nC3 فودافون زيادة 300 على السنين اللي فاتت: الوعاء ', a, ' → ', pg_temp.vb('vodafone'), ' | ربح نوفمبر Δ', pg_temp.pr('2026-11-01', cairo_today()) - p0, ' | 3800 Δ', pg_temp.gl('3800') - x);
  a := pg_temp.vb('instapay');
  r := submit_vessel_count(sk, 'instapay', a - 200, 'عد', null, 'employee', emp, 'على الكاشير');
  o := concat(o, E'\nC4 إنستاباي عجز 200 على ', ename, ': سلفة عليه ', (select amount||' متبقي '||remaining from advances where voucher_id=(select voucher_id from vessel_counts where id=(r->>'id')::uuid)));
  perform cancel_vessel_count((r->>'id')::uuid, 'C4');
  o := concat(o, E'\nC4b إلغاؤها: السلفة ', (select status from advances where voucher_id=(select voucher_id from vessel_counts where id=(r->>'id')::uuid)), ' | إنستاباي ', pg_temp.vb('instapay'), ' (كان ', a, ')');
  a := pg_temp.vb('cash');
  r := submit_vessel_count(sk, 'cash', a + 100, 'عد', null, 'gain', null, 'زيادة');
  o := concat(o, E'\nC5 كاش زيادة 100 ربح: ربح نوفمبر Δ', pg_temp.pr('2026-11-01', cairo_today()) - p0, ' (−500 +100)');
  r := submit_vessel_count(sk, 'cash', pg_temp.vb('cash'), 'مطابق');
  o := concat(o, E'\nC6 عدّ مطابق: ', r->>'status', ' فرق ', r->>'difference');
  begin perform submit_vessel_count(sk, 'company_offers', 0, 'x'); o := concat(o, E'\nC7 وعاء دفتري اتقبل!!');
  exception when others then o := concat(o, E'\nC7 وعاء خصومات وعروض: ', left(sqlerrm, 50)); end;
  begin perform submit_vessel_count(sk, 'cash', -5, 'x'); o := concat(o, E'\nC8 رقم سالب اتقبل!!');
  exception when others then o := concat(o, E'\nC8 فعلي بالسالب: اترفض ✓'); end;
  begin perform cancel_voucher((select voucher_id from vessel_counts where id=cid), 'x'); o := concat(o, E'\nC9 إلغاء سند التسوية لوحده اتقبل!!');
  exception when others then o := concat(o, E'\nC9 إلغاء سند التسوية لوحده: ', left(sqlerrm, 60)); end;
  begin perform create_manual_voucher(sk, 'payment', (select id from voucher_categories where tenant_id=t and system_key='vessel_short_loss'), 10, 'cash', null, null, 0, null, null, null, 'x', cairo_today(), null);
    o := concat(o, E'\nC10 سند يدوي «عجز خزنة» اتقبل!!');
  exception when others then o := concat(o, E'\nC10 سند يدوي على «عجز خزنة»: ', left(sqlerrm, 50)); end;
  a := pg_temp.vb('cash');
  perform cancel_vessel_count(cid, 'C11');
  o := concat(o, E'\nC11 إلغاء تسوية الخسارة: الكاش ', a, ' → ', pg_temp.vb('cash'), ' | ربح نوفمبر Δ', pg_temp.pr('2026-11-01', cairo_today()) - p0, ' (+100 بس)');
  -- approval mode
  perform set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true);
  begin perform submit_vessel_count(sk, 'cash', 1, 'x'); o := concat(o, E'\nC12 المدير والوضع «المالك بس» اتقبل!!');
  exception when others then o := concat(o, E'\nC12 المدير والوضع «المالك بس»: ', left(sqlerrm, 60)); end;
  begin perform set_vessel_count_mode('approval'); o := concat(o, E'\nC13 المدير غيّر الإعداد!!');
  exception when others then o := concat(o, E'\nC13 المدير يغيّر الإعداد: اترفض ✓'); end;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  perform set_vessel_count_mode('approval');
  perform set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true);
  a := pg_temp.vb('cash');
  begin
    r := submit_vessel_count(sk, 'cash', a - 50, 'عديت الدرج', null, 'gain', null, 'x');
    o := concat(o, E'\nC14 المدير عدّ (عجز 50): ', r->>'status', ' | الكاش لسه ', pg_temp.vb('cash'), ' | إشعار للمالك: ', (select count(*) from notifications where related_entity_id=(r->>'id')::uuid));
    begin perform submit_vessel_count(sk, 'cash', a, 'تاني'); o := concat(o, E'\nC15 عدّ تاني وفيه واحد مستني اتقبل!!');
    exception when others then o := concat(o, E'\nC15 عدّ تاني لنفس الوعاء وفيه واحد مستني: اترفض ✓'); end;
    begin perform decide_vessel_count((r->>'id')::uuid, true, 'loss', null, 'x'); o := concat(o, E'\nC16 المدير وافق بنفسه!!');
    exception when others then o := concat(o, E'\nC16 المدير يوافق: اترفض ✓'); end;
    perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
    perform decide_vessel_count((r->>'id')::uuid, true, 'employee', emp, 'الكاشير');
    o := concat(o, E'\nC17 المالك وافق «على الموظف»: الكاش ', pg_temp.vb('cash'), ' | سلفة على ', ename, ' ', (select amount from advances where voucher_id=(select voucher_id from vessel_counts where id=(r->>'id')::uuid)));
    perform set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true);
    r := submit_vessel_count(sk, 'vodafone', pg_temp.vb('vodafone') + 999, 'x');
    perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
    perform decide_vessel_count((r->>'id')::uuid, false, null, null, 'العد غلط');
    o := concat(o, E'\nC18 المالك رفض: ', (select status from vessel_counts where id=(r->>'id')::uuid), ' | فودافون ما اتحركش');
  exception when others then o := concat(o, E'\nC14 فشل: ', left(sqlerrm, 120)); end;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  o := concat(o, E'\nفي الآخر: ', pg_temp.books(), ' | exposed=', (select count(*) from public.security_exposed_definer_functions()));
  perform setval(format('%I.%I', s2.schemaname, s2.sequencename), s2.last_value) from _seq s2;
  raise exception 'DRY %', o;
end $dry$;
