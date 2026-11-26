-- 0291 checks (rollback-only: always raises DRY). Run after migration 0291.
create function pg_temp.net(c uuid, br uuid, side text) returns numeric language sql as $$ select public._contact_side_net(c, br, side) $$;
create function pg_temp.gl(p_code text) returns numeric language sql as $$
  select coalesce(sum(l.debit-l.credit),0) from public.journal_entry_lines l join public.journal_entries e on e.id=l.entry_id and e.status='posted'
   join public.chart_of_accounts a on a.id=l.account_id where e.tenant_id='5316fbfe-b862-4c91-b48b-1d81c8aa5a71' and a.code=p_code $$;
create function pg_temp.real() returns numeric language sql as $$
  select coalesce(sum(case when type='income' then amount else -amount end),0) from public.treasury where tenant_id='5316fbfe-b862-4c91-b48b-1d81c8aa5a71' and payment_method<>'company_offers' $$;
create function pg_temp.virt() returns numeric language sql as $$
  select coalesce(sum(case when type='income' then amount else -amount end),0) from public.treasury where tenant_id='5316fbfe-b862-4c91-b48b-1d81c8aa5a71' and payment_method='company_offers' $$;
create function pg_temp.profit() returns numeric language sql as $$
  select ((public.profit_statement_core('5316fbfe-b862-4c91-b48b-1d81c8aa5a71','2026-11-01',public.cairo_today(),null))->'total'->>'net_profit')::numeric $$;
create function pg_temp.st() returns text language sql as $$
  select concat(' [خزن حقيقية Δ', round(pg_temp.real()-current_setting('t.re0')::numeric,2), ' | وعاء دفتري Δ', round(pg_temp.virt()-current_setting('t.vi0')::numeric,2),
    ' | ربح نوفمبر Δ', round(pg_temp.profit()-current_setting('t.p0')::numeric,2), ' | 3800 Δ', round(pg_temp.gl('3800')-current_setting('t.g38')::numeric,2),
    ' | 6910 Δ', round(pg_temp.gl('6910')-current_setting('t.g69')::numeric,2), ' | 4200 Δ', round(pg_temp.gl('4200')-current_setting('t.g42')::numeric,2), ']') $$;
do $dry$
declare t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a'; mgr uuid := '9aa41d69-13ef-41d8-a6ca-b6c722c95c62';
  sk uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142'; sh uuid; karim uuid := 'af4c23ab-b222-4fb0-af71-eebda08d4014'; sup uuid := 'aa5971a3-e079-485f-9e4f-9dae4592de64';
  o text := ''; r jsonb; p1 jsonb; l1 jsonb; a numeric; cat uuid; rv uuid; info jsonb;
begin
  create temp table _seq on commit drop as select schemaname, sequencename, last_value from pg_sequences where schemaname='public' and last_value is not null;
  SET CONSTRAINTS ALL IMMEDIATE;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  select id into sh from branches where tenant_id=t and name like '%شلب%' limit 1;
  perform set_config('t.re0', pg_temp.real()::text, true); perform set_config('t.vi0', pg_temp.virt()::text, true); perform set_config('t.p0', pg_temp.profit()::text, true);
  perform set_config('t.g38', pg_temp.gl('3800')::text, true); perform set_config('t.g69', pg_temp.gl('6910')::text, true); perform set_config('t.g42', pg_temp.gl('4200')::text, true);
  o := concat(o, E'\nG5 TS00189 بعد التصليح = ', (select status from contact_settlements where settlement_number='TS00189'));
  info := contact_settle_info(karim);
  o := concat(o, E'\nINFO كريم: ', (select string_agg((x->>'branch')||' عميل '||(x->>'customer'), ' / ') from jsonb_array_elements(info) x));
  -- ===== التسوية القديمة (على أرباح السنين) =====
  p1 := settle_contact_without_money(sk, karim, 'customer', 'he_owes_less', 1000, '2026-11-20', 'P1');
  o := concat(o, E'\nP1 كريم «نقلل اللي عليه» 1,000: ', (p1->>'balance_before'), ' → ', pg_temp.net(karim, sk, 'customer'), pg_temp.st());
  begin perform settle_contact_without_money(sk, karim, 'customer', 'he_owes_less', 5000, '2026-11-20', 'P2'); o := concat(o, E'\nP2a أكبر من الرصيد من غير اختيار اتقبل!!');
  exception when others then o := concat(o, E'\nP2a أكبر من الرصيد اترفض: ', left(sqlerrm, 90)); end;
  r := settle_contact_without_money(sk, karim, 'customer', 'he_owes_less', 5000, '2026-11-20', 'P2', true);
  o := concat(o, E'\nP2b «كمّل» بـ 5,000: كريم ', pg_temp.net(karim, sk, 'customer'), ' (له عندنا)');
  perform cancel_contact_settlement((r->>'id')::uuid, 'x');
  begin perform settle_contact_without_money(sk, karim, 'customer', 'we_owe_less', 500, '2026-11-20', 'P3'); o := concat(o, E'\nP3 الاتجاه الغلط اتقبل!!');
  exception when others then o := concat(o, E'\nP3 الاتجاه الغلط اترفض: ', left(sqlerrm, 70)); end;
  begin perform settle_contact_without_money(sh, karim, 'customer', 'he_owes_less', 300, '2026-11-20', 'P4'); o := concat(o, E'\nP4 فرع ملوش فيه رصيد اتقبل!!');
  exception when others then o := concat(o, E'\nP4 فرع ملوش فيه رصيد اترفض: ', left(sqlerrm, 70)); end;
  r := settle_contact_without_money(sk, sup, 'supplier', 'we_owe_less', 2000, '2026-11-20', 'P5');
  o := concat(o, E'\nP5 مورد «نقلل اللي علينا» 2,000: ', (r->>'balance_before'), ' → ', pg_temp.net(sup, sk, 'supplier'));
  perform cancel_contact_settlement((r->>'id')::uuid, 'x');
  begin perform settle_contact_without_money(sk, sup, 'supplier', 'he_owes_less', 1, '2026-11-20', 'P6'); o := concat(o, E'\nP6 مورد «نقلل اللي عليه» اتقبل!!');
  exception when others then o := concat(o, E'\nP6 مورد «نقلل اللي عليه» اترفض ✓'); end;
  -- ===== الحماية =====
  perform set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true);
  begin perform cancel_voucher((p1->>'contact_voucher_id')::uuid, 'مدير'); o := concat(o, E'\nG1 المدير لغى سند التسوية لوحده!!');
  exception when others then o := concat(o, E'\nG1 المدير يلغي سند التسوية لوحده: ', left(sqlerrm, 80)); end;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  begin perform cancel_voucher((p1->>'offset_voucher_id')::uuid, 'مالك'); o := concat(o, E'\nG2 المالك لغى سند التسوية لوحده!!');
  exception when others then o := concat(o, E'\nG2 المالك يلغي سند واحد: اترفض ✓'); end;
  select category_id into cat from vouchers where id=(p1->>'contact_voucher_id')::uuid;
  begin perform edit_voucher((p1->>'contact_voucher_id')::uuid, cat, 999, 'company_offers', '2026-11-20', 'customer', karim, 'كريم عاطف', 'x', 'r', 'تسوية دفترية', 'تسوية دفترية', 0, 'تجربة');
    o := concat(o, E'\nG3 تعديل مبلغ سند التسوية اتقبل!!');
  exception when others then o := concat(o, E'\nG3 تعديل سند التسوية: ', left(sqlerrm, 80)); end;
  perform cancel_contact_settlement((p1->>'id')::uuid, 'C1');
  o := concat(o, E'\nC1 إلغاء P1: كريم ', pg_temp.net(karim, sk, 'customer'), pg_temp.st());
  begin perform restore_cancelled_voucher((p1->>'contact_voucher_id')::uuid); o := concat(o, E'\nG4 استرجاع سند واحد اتقبل!!');
  exception when others then o := concat(o, E'\nG4 استرجاع سند واحد من تسوية ملغية: اترفض ✓'); end;
  -- G6 an old broken one: one voucher cancelled behind the guard, then cancel the settlement
  r := settle_contact_without_money(sk, karim, 'customer', 'he_owes_less', 100, '2026-11-20', 'G6');
  perform set_config('app.settlement_op', '1', true); perform cancel_voucher((r->>'contact_voucher_id')::uuid, 'قديم'); perform set_config('app.settlement_op', '', true);
  begin perform cancel_contact_settlement((r->>'id')::uuid, 'G6'); o := concat(o, E'\nG6 إلغاء تسوية سندها اتلغى لوحده قبل كده: اشتغل ✓ كريم ', pg_temp.net(karim, sk, 'customer'), pg_temp.st());
  exception when others then o := concat(o, E'\nG6 فشل: ', left(sqlerrm, 80)); end;
  -- ===== تسوية برصيد (ربح / خسارة) =====
  l1 := settle_contact_to_balance(sk, karim, 'customer', 2000, '2026-11-20', 'L1');
  o := concat(o, E'\nL1 كريم 3,600 → 2,000: ', l1->>'result', ' ', l1->>'amount', ' | كريم ', pg_temp.net(karim, sk, 'customer'), pg_temp.st());
  r := settle_contact_to_balance(sk, karim, 'customer', 0, '2026-11-20', 'L2');
  o := concat(o, E'\nL2 «صفّر» كريم: ', r->>'result', ' ', r->>'amount', ' | كريم ', pg_temp.net(karim, sk, 'customer'), pg_temp.st());
  perform cancel_contact_settlement((r->>'id')::uuid, 'x');
  begin perform settle_contact_to_balance(sk, karim, 'customer', -500, '2026-11-20', 'L3'); o := concat(o, E'\nL3a قلب الناحية من غير اختيار اتقبل!!');
  exception when others then o := concat(o, E'\nL3a قلب الناحية اترفض: ', left(sqlerrm, 80)); end;
  r := settle_contact_to_balance(sk, karim, 'customer', -500, '2026-11-20', 'L3', true);
  o := concat(o, E'\nL3b «كمّل» لـ له 500: ', r->>'result', ' ', r->>'amount', ' | كريم ', pg_temp.net(karim, sk, 'customer'));
  perform cancel_contact_settlement((r->>'id')::uuid, 'x');
  r := settle_contact_to_balance(sk, karim, 'customer', 2400, '2026-11-20', 'L4');
  o := concat(o, E'\nL4 كريم 2,000 → 2,400 (عليه أكتر): ', r->>'result', ' ', r->>'amount', ' | كريم ', pg_temp.net(karim, sk, 'customer'), pg_temp.st());
  perform cancel_contact_settlement((r->>'id')::uuid, 'x');
  r := settle_contact_to_balance(sk, sup, 'supplier', 16000, '2026-11-20', 'L5');
  o := concat(o, E'\nL5 مورد 17,100 → 16,000: ', r->>'result', ' ', r->>'amount', ' | المورد ', pg_temp.net(sup, sk, 'supplier'), pg_temp.st());
  perform cancel_contact_settlement((r->>'id')::uuid, 'x');
  r := settle_contact_to_balance(sk, sup, 'supplier', 17600, '2026-11-20', 'L6');
  o := concat(o, E'\nL6 مورد 17,100 → 17,600 (علينا أكتر): ', r->>'result', ' ', r->>'amount', ' | المورد ', pg_temp.net(sup, sk, 'supplier'), pg_temp.st());
  perform cancel_contact_settlement((r->>'id')::uuid, 'x');
  o := concat(o, E'\nL6 بعد الإلغاء: المورد ', pg_temp.net(sup, sk, 'supplier'), pg_temp.st());
  begin perform settle_contact_to_balance(sk, karim, 'customer', 2000, '2026-11-20', 'L7'); o := concat(o, E'\nL7 نفس الرصيد اتقبل!!');
  exception when others then o := concat(o, E'\nL7 نفس الرصيد: اترفض ✓'); end;
  begin perform settle_contact_to_balance(sh, karim, 'customer', 0, '2026-11-20', 'L8'); o := concat(o, E'\nL8 فرع ملوش فيه رصيد اتقبل!!');
  exception when others then o := concat(o, E'\nL8 فرع ملوش فيه رصيد: اترفض ✓'); end;
  perform set_config('request.jwt.claims', json_build_object('sub',mgr,'role','authenticated')::text, true);
  begin perform settle_contact_to_balance(sk, karim, 'customer', 0, '2026-11-20', 'L9'); o := concat(o, E'\nL9 المدير اتقبل!!');
  exception when others then o := concat(o, E'\nL9 المدير: اترفض ✓'); end;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  -- ===== إلغاء التسوية برصيد =====
  select id into cat from voucher_categories where tenant_id=t and system_key='installment' limit 1;
  a := pg_temp.real();
  rv := create_manual_voucher(sk, 'receipt', cat, 2000, 'cash', null, null, 0, 'customer', karim, 'كريم عاطف', 'دفع بعد التسوية', '2026-11-21', null);
  o := concat(o, E'\nC2 كريم دفع 2,000 كاش بعد L1: كريم ', pg_temp.net(karim, sk, 'customer'), ' | الكاش +', pg_temp.real()-a);
  perform cancel_contact_settlement((l1->>'id')::uuid, 'C2');
  o := concat(o, E'\nC2 بعدها لغينا L1: كريم ', pg_temp.net(karim, sk, 'customer'), ' | الكاش لسه +', pg_temp.real()-a, pg_temp.st());
  begin perform cancel_contact_settlement((l1->>'id')::uuid, 'again'); o := concat(o, E'\nC3 مرتين اتقبل!!');
  exception when others then o := concat(o, E'\nC3 الإلغاء مرتين: اترفض ✓'); end;
  r := settle_contact_to_balance(sk, karim, 'customer', 0, '2026-11-20', 'C4');
  insert into fiscal_periods (tenant_id, name, period_start, period_end, status) values (t, 'قفل تجربة', '2026-11-20', '2026-11-20', 'closed');
  begin perform cancel_contact_settlement((r->>'id')::uuid, 'C4'); o := concat(o, E'\nC4 إلغاء بعد قفل يومها اشتغل');
  exception when others then o := concat(o, E'\nC4 إلغاء بعد قفل يومها: اترفض — ', left(sqlerrm, 60)); end;
  o := concat(o, E'\nexposed=', (select count(*) from public.security_exposed_definer_functions()));
  perform setval(format('%I.%I', s2.schemaname, s2.sequencename), s2.last_value) from _seq s2;
  raise exception 'DRY %', o;
end $dry$;
