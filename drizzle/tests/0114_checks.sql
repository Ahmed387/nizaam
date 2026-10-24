-- CHECKS (after 0114 in the same transaction). Ends with RAISE → everything rolls back, nothing is kept.
DO $$
declare r text := E'\n'; n int; v boolean; j jsonb; tpl uuid;
  t uuid := gen_random_uuid(); o uuid := gen_random_uuid(); a uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid();
  an uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a'; an_tenant uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; an_cash uuid; an_branch uuid;
  pass int := 0; fail int := 0;
  procedure_ok boolean;
begin
  -- 0. regression. The old has_permission skipped the role defaults while effective_permission used them; both are now
  --    ONE answer = the old effective_permission. So: every old effective answer is kept, and every old has_permission
  --    answer too, except test keys «__…» that no role row covers (dry-run 2026-10-24: only «__qa.view» for one partner).
  select count(*) into n from snap where public.has_permission(user_id, key) is distinct from before_eff
                                       or public.effective_permission(user_id, key) is distinct from before_eff
                                       or (key !~ '^__' and public.has_permission(user_id, key) is distinct from before_val);
  if n = 0 then pass := pass+1; r := r || '✅ 0. كل الصلاحيات القديمة (has_permission + effective_permission) زي ما هي (' || (select count(*) from snap) || ' فحص)' || E'\n';
  else fail := fail+1; r := r || '❌ 0. ' || n || ' صلاحية اتغيرت' || E'\n'; end if;
  select count(*) into n from user_permissions where branch_id is not null;
  if n = 0 then pass := pass+1; r := r || '✅ 0b. الاستثناءات القديمة كلها بقت «كل الفروع»' || E'\n'; else fail := fail+1; r := r || '❌ 0b' || E'\n'; end if;

  -- hidden test company: owner o (tenant owner + admin role), manager a, partner p, cashier c1 (both branches), warehouse c2
  insert into tenants(id,name,slug,plan,is_active,setup_completed,max_branches,is_test) values (t,'اختبار صلاحيات','zz-perm-test','free',true,true,3,true);
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    select x, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-'||left(x::text,8)||'@test.local','x',now(),'{}','{}',now(),now() from unnest(array[o,a,p,c1,c2]) x;
  update tenants set owner_user_id=o where id=t;
  insert into profiles(id,name,username,tenant_id) values (o,'مالك','zz-o',t),(a,'مدير عام','zz-a',t),(p,'شريك','zz-p',t),(c1,'كاشير 1','zz-c1',t),(c2,'مخزن','zz-c2',t)
    on conflict (id) do update set tenant_id=excluded.tenant_id;
  insert into user_roles(user_id,role,tenant_id) values (o,'admin',t),(a,'admin',t),(p,'partner',t),(c1,'cashier',t),(c2,'warehouse',t) on conflict do nothing;
  insert into branches(id,code,name,tenant_id) values (b1,'ZZ1','سكة تلة',t),(b2,'ZZ2','عبدالمنعم الغربي',t);
  insert into branch_users(user_id,branch_id,tenant_id,access_level) values (c1,b1,t,'manage'),(c1,b2,t,'manage');
  insert into role_permissions(tenant_id, role, permission_key, allowed) values
    (t,'cashier','dashboard.view',true),(t,'cashier','treasury.view',false),(t,'cashier','sales.create',true),(t,'cashier','receipt_vouchers.create',false);
  select id into an_cash from profiles where username='mohayassr07';
  select id into an_branch from branches where tenant_id=an_tenant limit 1;

  -- 1. parts follow their page
  if public.has_permission(c1, 'part.dashboard.sales_today.view') then pass:=pass+1; r := r || '✅ 1a. الكارت بياخد صلاحية صفحته (الرئيسية مفتوحة → الكارت ظاهر)' || E'\n'; else fail:=fail+1; r := r || '❌ 1a' || E'\n'; end if;
  if not public.has_permission(c1, 'part.treasury.balances.view') then pass:=pass+1; r := r || '✅ 1b. صفحة مقفولة → كروتها مقفولة' || E'\n'; else fail:=fail+1; r := r || '❌ 1b' || E'\n'; end if;
  insert into role_permissions(tenant_id, role, permission_key, allowed) values (t,'cashier','part.dashboard.till_balance.view',false);
  if not public.has_permission(c1, 'part.dashboard.till_balance.view') then pass:=pass+1; r := r || '✅ 1c. قالب الكاشير قافل كارت معين → مقفول' || E'\n'; else fail:=fail+1; r := r || '❌ 1c' || E'\n'; end if;

  -- 2. per branch: يبيع في سكة تلة، وفي عبدالمنعم الغربي يشوف بس ويعمل سند قبض
  perform pg_temp.as_(o);
  n := public.save_user_permissions(c1, jsonb_build_array(
         jsonb_build_object('key','sales.create','allowed',false,'branch',b2),
         jsonb_build_object('key','receipt_vouchers.create','allowed',true,'branch',b2),
         jsonb_build_object('key','part.dashboard.till_balance.view','allowed',true,'branch',b1)));
  execute 'reset role';
  if n = 3 and public.perm_resolve(c1,'sales.create',b1) and not public.perm_resolve(c1,'sales.create',b2)
     and public.perm_resolve(c1,'receipt_vouchers.create',b2) and not public.perm_resolve(c1,'receipt_vouchers.create',b1)
     and public.has_permission(c1,'sales.create')
  then pass:=pass+1; r := r || '✅ 2a. البيع مفتوح في سكة تلة ومقفول في عبدالمنعم الغربي، وسند القبض العكس' || E'\n'; else fail:=fail+1; r := r || '❌ 2a' || E'\n'; end if;
  if public.perm_resolve(c1,'part.dashboard.till_balance.view',b1) and not public.perm_resolve(c1,'part.dashboard.till_balance.view',b2)
  then pass:=pass+1; r := r || '✅ 2b. كارت رصيد الخزنة ظاهر في سكة تلة بس' || E'\n'; else fail:=fail+1; r := r || '❌ 2b' || E'\n'; end if;
  -- the server itself blocks it (assert_access asks for THAT branch)
  -- assert_access is internal (only SECURITY DEFINER RPCs call it): call it as the definer, with c1 signed in
  perform pg_temp.as_(c1); execute 'reset role';
  begin perform public.assert_access(b1, 'sales.create'); procedure_ok := true; exception when others then procedure_ok := false; end;
  begin perform public.assert_access(b2, 'sales.create'); v := true; exception when others then v := false; end;
  if procedure_ok and not v then pass:=pass+1; r := r || '✅ 2c. السيرفر نفسه: بيع في سكة تلة يعدي، في عبدالمنعم الغربي يترفض' || E'\n'; else fail:=fail+1; r := r || '❌ 2c ' || procedure_ok || '/' || v || E'\n'; end if;

  -- 3. managers / partners can be restricted, the owner never
  perform pg_temp.as_(o);
  perform public.save_user_permissions(a, '[{"key":"treasury.view","allowed":false}]'::jsonb);
  perform public.save_user_permissions(p, '[{"key":"sales.view","allowed":false}]'::jsonb);
  execute 'reset role';
  if not public.has_permission(a,'treasury.view') and public.has_permission(a,'sales.create') and not public.has_permission(p,'sales.view')
  then pass:=pass+1; r := r || '✅ 3a. المالك قفل الخزنة على المدير العام (والباقي مفتوح) وقفل المبيعات على الشريك' || E'\n'; else fail:=fail+1; r := r || '❌ 3a' || E'\n'; end if;
  insert into user_permissions(tenant_id,user_id,permission_key,allowed) values (t,o,'treasury.view',false);
  if public.has_permission(o,'treasury.view') and public.perm_resolve(o,'sales.create',b2)
  then pass:=pass+1; r := r || '✅ 3b. المالك دايماً مفتوح حتى لو فيه سطر قافل عليه' || E'\n'; else fail:=fail+1; r := r || '❌ 3b' || E'\n'; end if;
  delete from user_permissions where user_id=o;

  -- 4. who may change whom
  perform pg_temp.as_(a);
  begin perform public.save_user_permissions(c2, '[{"key":"inventory.view","allowed":true}]'::jsonb); v := true; exception when others then v := false; end;
  if v then pass:=pass+1; r := r || '✅ 4a. المدير العام يظبط الموظفين' || E'\n'; else fail:=fail+1; r := r || '❌ 4a' || E'\n'; end if;
  begin perform public.save_user_permissions(p, '[]'::jsonb); fail:=fail+1; r := r || '❌ 4b. المدير غيّر صلاحيات الشريك' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 4b. المدير مينفعش يغيّر شريك أو مدير — ' || sqlerrm || E'\n'; end;
  begin perform public.save_user_permissions(a, '[]'::jsonb); fail:=fail+1; r := r || '❌ 4c. غيّر صلاحياته هو' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 4c. محدش يغيّر صلاحياته هو — ' || sqlerrm || E'\n'; end;
  begin perform public.save_user_permissions(o, '[]'::jsonb); fail:=fail+1; r := r || '❌ 4d. غيّر صلاحيات المالك' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 4d. المالك مش بيتظبط — ' || sqlerrm || E'\n'; end;
  perform pg_temp.as_(c1);
  begin perform public.save_user_permissions(c2, '[]'::jsonb); fail:=fail+1; r := r || '❌ 4e. الكاشير غيّر صلاحيات' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 4e. الكاشير مينفعش يغيّر صلاحيات — ' || sqlerrm || E'\n'; end;
  perform pg_temp.as_(o);
  begin perform public.save_user_permissions(an_cash, '[]'::jsonb); fail:=fail+1; r := r || '❌ 4f. غيّر موظف شركة تانية' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 4f. موظف شركة تانية مرفوض — ' || sqlerrm || E'\n'; end;
  begin perform public.save_user_permissions(c1, '[{"key":"sales.view","allowed":true},{"key":"bad key!","allowed":true}]'::jsonb); fail:=fail+1; r := r || '❌ 4g. اتقبلت صلاحية غلط' || E'\n';
  exception when others then execute 'reset role'; select count(*) into n from user_permissions where user_id=c1;
    if n = 3 then pass:=pass+1; r := r || '✅ 4g. صلاحية مكتوبة غلط → الحفظ كله اترفض والقديم زي ما هو' || E'\n'; else fail:=fail+1; r := r || '❌ 4g. القديم اتغير ' || n || E'\n'; end if; end;
  perform pg_temp.as_(o);
  begin perform public.save_user_permissions(c1, jsonb_build_array(jsonb_build_object('key','sales.view','allowed',true,'branch',an_branch))); fail:=fail+1; r := r || '❌ 4h. فرع شركة تانية اتقبل' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 4h. فرع مش تبع الشركة مرفوض — ' || sqlerrm || E'\n'; end;
  execute 'reset role';

  -- 5. copy keeps the branch rows; the role of a manager is never touched
  perform pg_temp.as_(o);
  j := public.copy_user_permissions(c1, c2, true, true);
  execute 'reset role';
  select count(*) filter (where branch_id is not null) into n from user_permissions where user_id=c2;
  if n = 3 and exists(select 1 from user_roles where user_id=c2 and role='cashier') and not exists(select 1 from user_roles where user_id=c2 and role='warehouse')
     and (select count(*) from branch_users where user_id=c2) = 2 and not public.perm_resolve(c2,'sales.create',b2)
  then pass:=pass+1; r := r || '✅ 5a. انسخ من موظف تاني: استثناءات كل فرع + الدور + الفروع اتنقلوا — ' || j::text || E'\n'; else fail:=fail+1; r := r || '❌ 5a ' || n || E'\n'; end if;
  perform pg_temp.as_(o);
  perform public.copy_user_permissions(c1, a, true, false);
  execute 'reset role';
  if exists(select 1 from user_roles where user_id=a and role='admin') and not exists(select 1 from user_roles where user_id=a and role='cashier')
  then pass:=pass+1; r := r || '✅ 5b. النسخ على مدير عام مبيغيرش دوره' || E'\n'; else fail:=fail+1; r := r || '❌ 5b' || E'\n'; end if;

  -- 6. deleting a branch removes its rules
  delete from branch_users where branch_id=b2;
  delete from branches where id=b2;
  select count(*) into n from user_permissions where branch_id=b2;
  if n = 0 then pass:=pass+1; r := r || '✅ 6. مسح فرع بيمسح استثناءاته معاه' || E'\n'; else fail:=fail+1; r := r || '❌ 6' || E'\n'; end if;

  -- 7. templates
  perform pg_temp.as_(o);
  insert into permission_templates(tenant_id, name, base_role, perms) values (t, 'كاشير بدون خزنة', 'cashier', '{"part.dashboard.till_balance.view":false}') returning id into tpl;
  perform pg_temp.as_(c1);
  select count(*) into n from permission_templates;
  if n = 0 then pass:=pass+1; r := r || '✅ 7a. الكاشير مش شايف القوالب' || E'\n'; else fail:=fail+1; r := r || '❌ 7a' || E'\n'; end if;
  begin insert into permission_templates(tenant_id, name, base_role) values (t, 'x', 'cashier'); fail:=fail+1; r := r || '❌ 7b. الكاشير عمل قالب' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 7b. الكاشير مينفعش يعمل قالب' || E'\n'; end;
  perform pg_temp.as_(an);
  select count(*) into n from permission_templates where tenant_id=t;
  if n = 0 then pass:=pass+1; r := r || '✅ 7c. صاحب A&N مش شايف قوالب شركة تانية' || E'\n'; else fail:=fail+1; r := r || '❌ 7c' || E'\n'; end if;
  perform pg_temp.as_(o);
  begin insert into permission_templates(tenant_id, name, base_role) values (t, 'y', 'owner'); fail:=fail+1; r := r || '❌ 7d. قالب على دور المالك' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 7d. مينفعش قالب يبدأ من دور المالك/المدير' || E'\n'; end;
  -- the resolver itself is not callable from the app
  begin perform public.perm_resolve(c1, 'sales.view', null); fail:=fail+1; r := r || '❌ 7e. perm_resolve مكشوفة' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 7e. perm_resolve مش متاحة من التطبيق مباشرة' || E'\n'; end;
  execute 'reset role';

  -- 8. security
  select count(*) into n from security_exposed_definer_functions();
  if n = 0 then pass:=pass+1; r := r || '✅ 8. مفيش دوال مكشوفة' || E'\n'; else fail:=fail+1; r := r || '❌ 8. ' || n || ' دالة مكشوفة' || E'\n'; end if;

  raise exception 'ROLLBACK-RESULTS: نجح % / فشل % %', pass, fail, r;
end $$;
