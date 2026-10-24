-- CHECKS (after 0114 in the same transaction)
DO $$
declare r text := E'\n'; n int; v boolean; t uuid := gen_random_uuid(); o uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  an uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a'; an_cash uuid; j jsonb; tpl uuid;
  pass int := 0; fail int := 0;
begin
  -- 0. regression: every old answer unchanged for A&N
  select count(*) into n from snap where public.has_permission(user_id, key) is distinct from before_val;
  if n = 0 then pass := pass+1; r := r || '✅ 0. كل الصلاحيات القديمة لموظفين A&N زي ما هي (' || (select count(*) from snap) || ' فحص)' || E'\n';
  else fail := fail+1; r := r || '❌ 0. ' || n || ' صلاحية اتغيرت' || E'\n'; end if;

  -- setup a hidden test company
  insert into tenants(id,name,slug,plan,is_active,setup_completed,max_branches,is_test) values (t,'اختبار صلاحيات','zz-perm-test','free',true,true,3,true);
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    select x, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-'||left(x::text,8)||'@test.local','x',now(),'{}','{}',now(),now() from unnest(array[o,c1,c2]) x;
  update tenants set owner_user_id=o where id=t;
  insert into profiles(id,name,username,tenant_id) values (o,'مالك','zz-o',t),(c1,'كاشير 1','zz-c1',t),(c2,'كاشير 2','zz-c2',t) on conflict (id) do update set tenant_id=excluded.tenant_id;
  insert into user_roles(user_id,role,tenant_id) values (o,'admin',t),(c1,'cashier',t),(c2,'warehouse',t) on conflict do nothing;
  insert into role_permissions(tenant_id, role, permission_key, allowed) values (t,'cashier','dashboard.view',true),(t,'cashier','treasury.view',false);
  select id into an_cash from profiles where username='mohayassr07';

  -- 1. part inheritance
  v := public.has_permission(c1, 'part.dashboard.sales_today.view');
  if v then pass:=pass+1; r := r || '✅ 1a. الكارت بياخد صلاحية صفحته (الرئيسية مفتوحة → الكارت ظاهر)' || E'\n'; else fail:=fail+1; r := r || '❌ 1a' || E'\n'; end if;
  v := public.has_permission(c1, 'part.treasury.balance.view');
  if not v then pass:=pass+1; r := r || '✅ 1b. صفحة مقفولة → كروتها مقفولة' || E'\n'; else fail:=fail+1; r := r || '❌ 1b' || E'\n'; end if;
  insert into role_permissions(tenant_id, role, permission_key, allowed) values (t,'cashier','part.dashboard.till_balance.view',false);
  v := public.has_permission(c1, 'part.dashboard.till_balance.view');
  if not v then pass:=pass+1; r := r || '✅ 1c. قالب الكاشير قافل كارت معين → مقفول' || E'\n'; else fail:=fail+1; r := r || '❌ 1c' || E'\n'; end if;
  v := public.has_permission(o, 'part.dashboard.till_balance.view');
  if v then pass:=pass+1; r := r || '✅ 1d. المالك/المدير بيشوف كل الكروت' || E'\n'; else fail:=fail+1; r := r || '❌ 1d' || E'\n'; end if;

  -- 2. save_user_permissions
  perform pg_temp.as_(o);
  n := public.save_user_permissions(c1, '[{"key":"part.dashboard.till_balance.view","allowed":true},{"key":"sales.delete","allowed":false}]'::jsonb);
  execute 'reset role';
  if n = 2 and public.has_permission(c1,'part.dashboard.till_balance.view') then pass:=pass+1; r := r || '✅ 2a. المالك حفظ استثنائين، والاستثناء غلب القالب' || E'\n'; else fail:=fail+1; r := r || '❌ 2a ' || n || E'\n'; end if;
  perform pg_temp.as_(o);
  begin perform public.save_user_permissions(c1, '[{"key":"sales.view","allowed":true},{"key":"bad key!","allowed":true}]'::jsonb); fail:=fail+1; r := r || '❌ 2b. اتقبلت صلاحية غلط' || E'\n';
  exception when others then execute 'reset role'; select count(*) into n from user_permissions where user_id=c1;
    if n = 2 then pass:=pass+1; r := r || '✅ 2b. صلاحية مكتوبة غلط → الحفظ كله اترفض والقديم زي ما هو (' || sqlerrm || ')' || E'\n'; else fail:=fail+1; r := r || '❌ 2b. القديم اتمسح' || E'\n'; end if; end;
  perform pg_temp.as_(c1);
  begin perform public.save_user_permissions(c2, '[]'::jsonb); fail:=fail+1; r := r || '❌ 2c. الكاشير غيّر صلاحيات' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 2c. الكاشير مينفعش يغيّر صلاحيات — ' || sqlerrm || E'\n'; end;
  perform pg_temp.as_(o);
  begin perform public.save_user_permissions(an_cash, '[]'::jsonb); fail:=fail+1; r := r || '❌ 2d. غيّر صلاحيات موظف شركة تانية' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 2d. موظف شركة تانية مرفوض — ' || sqlerrm || E'\n'; end;
  begin perform public.save_user_permissions(o, '[]'::jsonb); fail:=fail+1; r := r || '❌ 2e. غيّر صلاحيات المالك' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 2e. المالك نفسه مش بيتظبط — ' || sqlerrm || E'\n'; end;

  -- 3. copy
  perform pg_temp.as_(o);
  j := public.copy_user_permissions(c1, c2, true, false);
  execute 'reset role';
  select count(*) into n from user_permissions where user_id=c2;
  if n = 2 and exists(select 1 from user_roles where user_id=c2 and role='cashier') and not exists(select 1 from user_roles where user_id=c2 and role='warehouse')
    then pass:=pass+1; r := r || '✅ 3. انسخ من موظف تاني: الاستثناءات والدور اتنقلوا — ' || j::text || E'\n'; else fail:=fail+1; r := r || '❌ 3 ' || n || E'\n'; end if;

  -- 4. templates
  perform pg_temp.as_(o);
  insert into permission_templates(tenant_id, name, base_role, perms) values (t, 'كاشير بدون خزنة', 'cashier', '{"part.dashboard.till_balance.view":false}') returning id into tpl;
  perform pg_temp.as_(c1);
  select count(*) into n from permission_templates;
  if n = 0 then pass:=pass+1; r := r || '✅ 4a. الكاشير مش شايف القوالب' || E'\n'; else fail:=fail+1; r := r || '❌ 4a' || E'\n'; end if;
  begin insert into permission_templates(tenant_id, name, base_role) values (t, 'x', 'cashier'); fail:=fail+1; r := r || '❌ 4b. الكاشير عمل قالب' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 4b. الكاشير مينفعش يعمل قالب' || E'\n'; end;
  perform pg_temp.as_(an);
  select count(*) into n from permission_templates where tenant_id=t;
  if n = 0 then pass:=pass+1; r := r || '✅ 4c. صاحب A&N مش شايف قوالب شركة تانية' || E'\n'; else fail:=fail+1; r := r || '❌ 4c' || E'\n'; end if;
  perform pg_temp.as_(o);
  begin insert into permission_templates(tenant_id, name, base_role) values (t, 'y', 'owner'); fail:=fail+1; r := r || '❌ 4d. قالب على دور المالك' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 4d. مينفعش قالب يبدأ من دور المالك/المدير' || E'\n'; end;
  execute 'reset role';

  -- 5. security
  select count(*) into n from security_exposed_definer_functions();
  if n = 0 then pass:=pass+1; r := r || '✅ 5. مفيش دوال مكشوفة' || E'\n'; else fail:=fail+1; r := r || '❌ 5. ' || n || ' دالة مكشوفة' || E'\n'; end if;

  raise exception 'ROLLBACK-RESULTS: نجح % / فشل % %', pass, fail, r;
end $$;
