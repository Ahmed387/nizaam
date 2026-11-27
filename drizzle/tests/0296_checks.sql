-- 0296 checks (rollback-only): paste the migration where marked; one execute_sql call; ends with raise 'DRY …'
create temp table _seq on commit drop as select schemaname, sequencename, last_value from pg_sequences where schemaname='public' and last_value is not null;
create temp table _gl0 on commit drop as
  select a.code, coalesce(sum(l.debit - l.credit), 0) bal from public.chart_of_accounts a
    left join public.journal_entry_lines l on l.account_id = a.id
   where a.tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71' and a.code in ('1100', '1110', '1400', '1450', '3100', '3850') group by a.code;
create temp table _till0 on commit drop as
  select coalesce(sum(case when type = 'income' then amount else -amount end), 0) bal from public.treasury
   where tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71' and branch_id = '1329f6cc-a4a5-418c-9e91-cccd651b3142' and payment_method = 'cash';

-- >>> paste drizzle/migrations/0296_partner_advance_repay.sql here <<<

do $dry$
declare t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  sk uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142'; nour uuid := 'a10d68fc-73b6-436a-bc8b-153574a2add3';
  mah uuid := '4bcf7c60-69b2-4049-b1e5-001cbf4e509f'; mah_emp uuid := 'fd556698-0f8f-4333-bfcd-a263ddedf9bb';
  o text := ''; r jsonb; tr uuid; tx uuid; adv uuid; sal uuid;
  till numeric;
begin
  SET CONSTRAINTS ALL IMMEDIATE;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  -- setup: nour puts 100,000 in, then takes 60,000 «من الربح» with no profit → advance 60,000
  perform partner_money(nour, 'contribution', 100000, 'capital', null, sk, 'cash', date '2026-10-10', 'T-in', null, date '2026-11-01');
  r := partner_money(nour, 'withdrawal', 60000, 'profit', null, sk, 'cash', cairo_today(), 'T-adv', null, null);
  adv := (r->>'advance_id')::uuid;
  o := concat(o, E'\n0 سحب 60,000 من الربح ومفيش ربح → سلفة ', r->>'advance');
  -- (ب) limit 70,000: another 20,000 above profit is refused, 10,000 passes
  perform set_partner_advance_limit(nour, 70000);
  begin perform partner_money(nour, 'withdrawal', 20000, 'profit', null, sk, 'cash', cairo_today(), 'T-over', null, null); o := concat(o, E'\n1 فوق الحد اتقبل!!');
  exception when others then o := concat(o, E'\n1 حد 70,000 وعليه 60,000 وسحب 20,000: ', left(sqlerrm, 90)); end;
  r := partner_money(nour, 'withdrawal', 10000, 'profit', null, sk, 'cash', cairo_today(), 'T-ok', null, null);
  o := concat(o, E'\n1b سحب 10,000 (يوصل 70,000) اتقبل — السلف = ', (partner_cards(nour)->>'advances'));
  perform set_partner_advance_limit(nour, null);
  -- 4) cash repay 25,000 into سكة cash → oldest first
  r := partner_advance_repay(nour, 25000, sk, 'cash', cairo_today(), 'رد جزء', null);
  tr := (r->>'treasury_id')::uuid;
  o := concat(o, E'\n2 رد كاش 25,000: اتسدد ', r->>'paid', ' فاضل ', r->>'left', ' | الأولى فاضل ', (select remaining_amount from partner_advances where id = adv),
              ' | قيد ', (select string_agg(a.code || ':' || l.debit || '/' || l.credit, ' ') from journal_entries e join journal_entry_lines l on l.entry_id = e.id join chart_of_accounts a on a.id = l.account_id where e.source_type = 'treasury_row' and e.source_id = tr));
  begin perform partner_advance_repay(nour, 999999, sk, 'cash', cairo_today(), null, null); o := concat(o, E'\n2b أكتر من السلف اتقبل!!');
  exception when others then o := concat(o, E'\n2b أكتر من السلف: ', left(sqlerrm, 50)); end;
  perform cancel_partner_advance_repay(tr, 'غلط');
  o := concat(o, E'\n3 إلغاء الرد: السلف رجعت ', (partner_cards(nour)->>'advances'), ' | الحركة على يومها ',
              (select count(*) from treasury where category = 'partner_cancel' and reference_id = nour and transaction_date = cairo_today()), ' | القيد اتعكس ',
              (select count(*) from journal_entries where source_type = 'treasury_row' and source_id = tr));
  begin perform cancel_partner_advance_repay(tr, 'تاني'); o := concat(o, E'\n3b إلغاء مرتين اتقبل!!');
  exception when others then o := concat(o, E'\n3b إلغاء مرتين: ', left(sqlerrm, 40)); end;
  -- (أ) from his capital 10,000
  r := partner_advance_from_capital(nour, 10000, cairo_today(), 'خصم من رأس المال');
  tx := (r->>'tx_id')::uuid;
  o := concat(o, E'\n4 من رأس ماله 10,000: رأس ماله ', (partner_cards(nour)->>'capital'), ' | السلف ', (partner_cards(nour)->>'advances'),
              ' | رأس مال الشهر ده ', partner_capital_for_month(nour, date_trunc('month', cairo_today())::date), ' والجاي ', partner_capital_for_month(nour, (date_trunc('month', cairo_today()) + interval '1 month')::date),
              ' | قيد ', (select string_agg(a.code || ':' || l.debit || '/' || l.credit, ' ') from journal_entries e join journal_entry_lines l on l.entry_id = e.id join chart_of_accounts a on a.id = l.account_id where e.source_type = 'partner_adv_capital' and e.source_id = tx));
  perform cancel_partner_transaction(tx, 'غلط');
  o := concat(o, E'\n5 إلغاؤها من جدول الحركات: رأس ماله ', (partner_cards(nour)->>'capital'), ' | السلف ', (partner_cards(nour)->>'advances'));
  -- (6) employee-partner: advance 50,000, from the salary 5,000 a month
  update employees set base_salary = 20000 where id = mah_emp;
  r := partner_money(mah, 'withdrawal', 50000, 'profit', null, sk, 'cash', cairo_today(), 'T-mah', null, null);
  adv := (r->>'advance_id')::uuid;
  begin perform set_partner_advance_repay(adv, 'salary', 0); o := concat(o, E'\n6 من غير قسط اتقبل!!');
  exception when others then o := concat(o, E'\n6 من المرتب من غير قسط: ', left(sqlerrm, 50)); end;
  begin perform set_partner_advance_repay((select id from partner_advances where partner_id = nour and status <> 'cancelled' and remaining_amount > 0 limit 1), 'salary', 1000); o := concat(o, E'\n6b شريك مش موظف اتقبل!!');
  exception when others then o := concat(o, E'\n6b نور مش موظفة: ', left(sqlerrm, 50)); end;
  perform set_partner_advance_repay(adv, 'salary', 5000);
  o := concat(o, E'\n7 من المرتب 5,000: سلفة موظف مربوطة ', (select amount || ' / قسط ' || monthly_deduct from advances where partner_advance_id = adv and status = 'active'));
  begin update advances set status = 'cancelled' where partner_advance_id = adv; o := concat(o, E'\n7b إلغاء المربوطة من برا اتقبل!!');
  exception when others then o := concat(o, E'\n7b إلغاء المربوطة من صفحة الموظف: ', left(sqlerrm, 50)); end;
  perform pay_employee_salary(mah_emp, '2026-11', 0, 0, 5000, 'cash', null, null, null, 0, 'T-sal');
  select id into sal from salaries where employee_id = mah_emp and month = '2026-11' and coalesce(status, '') <> 'cancelled' order by paid_at desc limit 1;
  o := concat(o, E'\n8 مرتب نوفمبر بخصم 5,000: سلفة الشريك فاضل ', (select remaining_amount from partner_advances where id = adv),
              ' | المربوطة ', (select remaining from advances where partner_advance_id = adv and status = 'active'),
              ' | دفعة «salary» ', (select count(*) from partner_advance_payments where advance_id = adv and payment_method = 'salary' and status = 'active'),
              ' | قيد 1450/1400 ', (select string_agg(a.code || ':' || l.debit || '/' || l.credit, ' ') from journal_entries e join journal_entry_lines l on l.entry_id = e.id join chart_of_accounts a on a.id = l.account_id
                                    where e.source_type = 'partner_adv_salary' and e.source_id = (select ap.id from advance_payments ap join advances l2 on l2.id = ap.advance_id where l2.partner_advance_id = adv and ap.amount > 0 limit 1)));
  perform cancel_salary_payment(sal, 'تجربة');
  o := concat(o, E'\n9 إلغاء المرتب: سلفة الشريك ', (select remaining_amount from partner_advances where id = adv), ' | المربوطة ', (select remaining from advances where partner_advance_id = adv and status = 'active'),
              ' | الدفعة ', (select string_agg(status, ',') from partner_advance_payments where advance_id = adv));
  -- distribution skips a 'salary' advance; profit / both are paid from it
  o := concat(o, E'\n10 period_split_preview مفيهوش سلفة المرتب: ', (select position('repay_mode' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where proname = 'period_split_preview'),
              ' | distribute_profits_manual: ', (select position('<> ''salary''' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where proname = 'distribute_profits_manual'));
  perform set_partner_advance_repay(adv, 'profit', null);
  o := concat(o, E'\n11 رجعت «من الربح»: المربوطة ', (select status from advances where partner_advance_id = adv order by created_at desc limit 1), ' | الكارت: ',
              (select a->>'repay_mode' from jsonb_array_elements(partner_cards(mah)->'advances_list') a where a->>'id' = adv::text));
  perform set_partner_advance_repay(adv, 'both', 4000);
  o := concat(o, E'\n12 «الاتنين» 4,000: مربوطة جديدة ', (select count(*) from advances where partner_advance_id = adv and status = 'active'), ' قسط ', (select monthly_deduct from advances where partner_advance_id = adv and status = 'active'));
  -- the books: tills = cash accounts, 1450 net 0 after the salary + its cancel
  select coalesce(sum(case when type = 'income' then amount else -amount end), 0) - (select bal from _till0) into till from treasury where tenant_id = t and branch_id = sk and payment_method = 'cash';
  o := concat(o, E'\n13 حركة خزنة سكة الكاش ', till, ' | حركة الدفاتر: ', (select string_agg(g.code || ' ' || round(coalesce((select sum(l.debit - l.credit) from journal_entry_lines l join chart_of_accounts a on a.id = l.account_id where a.tenant_id = t and a.code = g.code), 0) - g.bal, 2), ', ' order by g.code) from _gl0 g));
  o := concat(o, E'\nexposed: ', (select count(*) from security_exposed_definer_functions()));
  perform setval(format('%I.%I', q.schemaname, q.sequencename), q.last_value) from _seq q;
  raise exception 'DRY %', o;
end $dry$;
