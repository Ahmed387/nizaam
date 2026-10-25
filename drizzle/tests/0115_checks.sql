-- Migration test for 0115 — ONE batch: 0114_pre.sql (snapshot + pg_temp.as_) → 0115 → this file. Raises at the end → ROLLBACK.
-- Expected: «ROLLBACK-RESULTS: نجح 21 / فشل 0».
DO $$
declare r text := E'\n'; n int; v boolean; j jsonb; tpl uuid; tpl2 uuid;
  t uuid := gen_random_uuid(); o uuid := gen_random_uuid(); a uuid := gen_random_uuid(); c1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid();
  pass int := 0; fail int := 0;
begin
  select count(*) into n from snap where public.has_permission(user_id, key) is distinct from before_eff
                                       or (key !~ '^__' and public.has_permission(user_id, key) is distinct from before_val);
  if n = 0 then pass := pass+1; r := r || '✅ 0. كل الصلاحيات الحالية زي ما هي (' || (select count(*) from snap) || ' فحص)' || E'\n';
  else fail := fail+1; r := r || '❌ 0. ' || n || ' صلاحية اتغيرت' || E'\n'; end if;

  insert into tenants(id,name,slug,plan,is_active,setup_completed,max_branches,is_test) values (t,'اختبار أدوار','zz-role-test','free',true,true,3,true);
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    select x, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-'||left(x::text,8)||'@test.local','x',now(),'{}','{}',now(),now() from unnest(array[o,a,c1,c2,c3]) x;
  update tenants set owner_user_id=o where id=t;
  insert into profiles(id,name,username,tenant_id) values (o,'مالك','zz-o',t),(a,'مدير','zz-a',t),(c1,'مندوب 1','zz-c1',t),(c2,'مندوب 2','zz-c2',t),(c3,'كاشير عادي','zz-c3',t)
    on conflict (id) do update set tenant_id=excluded.tenant_id;
  insert into user_roles(user_id,role,tenant_id) values (o,'admin',t),(a,'admin',t),(c1,'warehouse',t),(c2,'warehouse',t),(c3,'cashier',t);
  insert into branches(id,code,name,tenant_id) values (b1,'ZZ1','سكة تلة',t);
  insert into role_permissions(tenant_id, role, permission_key, allowed) values (t,'cashier','treasury.view',true),(t,'cashier','sales.create',true),(t,'cashier','receipt_vouchers.create',false);

  -- 1. a company role «مندوب مبيعات» built on cashier, treasury closed, linked to two employees
  perform pg_temp.as_(o);
  insert into permission_templates(tenant_id,name,base_role,perms) values (t,'مندوب مبيعات','cashier','{"treasury.view":false}') returning id into tpl;
  perform public.set_user_company_role(c1, tpl);
  perform public.set_user_company_role(c2, tpl);
  execute 'reset role';
  if (select count(*) from user_roles where user_id in (c1,c2) and role='cashier') = 2 and not exists (select 1 from user_roles where user_id in (c1,c2) and role='warehouse')
  then pass:=pass+1; r := r || '✅ 1a. الاتنين اتحطوا على «مندوب مبيعات» وخدوا دور كاشير بتاعه (أمين المخزن اتشال)' || E'\n'; else fail:=fail+1; r := r || '❌ 1a' || E'\n'; end if;
  if not public.has_permission(c1,'treasury.view') and not public.has_permission(c2,'treasury.view') and public.has_permission(c3,'treasury.view') and public.has_permission(c1,'sales.create')
  then pass:=pass+1; r := r || '✅ 1b. الخزنة مقفولة عند المندوبين ومفتوحة عند الكاشير العادي، والبيع مفتوح للكل' || E'\n'; else fail:=fail+1; r := r || '❌ 1b' || E'\n'; end if;

  -- 2. change the role once → every employee on it follows
  perform pg_temp.as_(o);
  update permission_templates set perms = perms || '{"receipt_vouchers.create":true}' where id = tpl;
  execute 'reset role';
  if public.has_permission(c1,'receipt_vouchers.create') and public.has_permission(c2,'receipt_vouchers.create') and not public.has_permission(c3,'receipt_vouchers.create')
  then pass:=pass+1; r := r || '✅ 2. فتحت سند القبض في الدور مرة واحدة → اتفتح عند المندوبين الاتنين بس' || E'\n'; else fail:=fail+1; r := r || '❌ 2' || E'\n'; end if;

  -- 3. one employee differs, the other follows the role
  perform pg_temp.as_(o);
  perform public.save_user_permissions(c1, '[{"key":"treasury.view","allowed":true}]'::jsonb);
  execute 'reset role';
  if public.has_permission(c1,'treasury.view') and not public.has_permission(c2,'treasury.view')
  then pass:=pass+1; r := r || '✅ 3. مندوب 1 بس اتفتحتله الخزنة لوحده، ومندوب 2 لسه على الدور' || E'\n'; else fail:=fail+1; r := r || '❌ 3' || E'\n'; end if;

  -- 4. the server (assert_access) follows the company role too
  insert into branch_users(user_id,branch_id,tenant_id,access_level) values (c2,b1,t,'manage');
  perform pg_temp.as_(c2); execute 'reset role';
  begin perform public.assert_access(b1, 'treasury.view'); v := true; exception when others then v := false; end;
  if not v then pass:=pass+1; r := r || '✅ 4. السيرفر نفسه رافض الخزنة لمندوب 2' || E'\n'; else fail:=fail+1; r := r || '❌ 4' || E'\n'; end if;

  -- 5. the ready role of a company role changes → its employees move with it
  perform pg_temp.as_(o);
  update permission_templates set base_role = 'accountant' where id = tpl;
  execute 'reset role';
  if (select count(*) from user_roles where user_id in (c1,c2) and role='accountant') = 2 and (select count(*) from user_company_roles where template_id = tpl) = 2
  then pass:=pass+1; r := r || '✅ 5. غيّرت الدور الجاهز اللي «مندوب مبيعات» مبني عليه → موظفينه اتغيروا معاه وفضلوا على الدور' || E'\n'; else fail:=fail+1; r := r || '❌ 5' || E'\n'; end if;
  perform pg_temp.as_(o);
  update permission_templates set base_role = 'cashier' where id = tpl;
  execute 'reset role';

  -- 6. putting him on a ready role from another screen takes him off the company role
  delete from user_roles where user_id = c2 and role = 'cashier';
  insert into user_roles(user_id,role,tenant_id) values (c2,'warehouse',t);
  if not exists (select 1 from user_company_roles where user_id = c2)
  then pass:=pass+1; r := r || '✅ 6. حطيت مندوب 2 أمين مخزن من شاشة تانية → اتشال من «مندوب مبيعات» لوحده' || E'\n'; else fail:=fail+1; r := r || '❌ 6' || E'\n'; end if;
  perform pg_temp.as_(o);
  perform public.set_user_company_role(c2, tpl);
  execute 'reset role';

  -- 7. delete a company role: refused while it has employees, then moved and deleted
  perform pg_temp.as_(o);
  begin perform public.delete_company_role(tpl); fail:=fail+1; r := r || '❌ 7a. اتمسح وعليه موظفين' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 7a. مسح الدور وعليه موظفين مرفوض — ' || sqlerrm || E'\n'; end;
  begin delete from permission_templates where id = tpl; fail:=fail+1; r := r || '❌ 7b. اتمسح مباشرة' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 7b. مسحه من غير نقل الموظفين مرفوض حتى من برّه الشاشة' || E'\n'; end;
  insert into permission_templates(tenant_id,name,base_role,perms) values (t,'كاشير مسائي','cashier','{}') returning id into tpl2;
  j := public.delete_company_role(tpl, tpl2, null);
  execute 'reset role';
  if (select count(*) from user_company_roles where template_id = tpl2) = 2 and not exists (select 1 from permission_templates where id = tpl) and public.has_permission(c2,'treasury.view')
  then pass:=pass+1; r := r || '✅ 7c. نقلت الاتنين على «كاشير مسائي» والدور اتمسح — ' || j::text || E'\n'; else fail:=fail+1; r := r || '❌ 7c' || E'\n'; end if;
  perform pg_temp.as_(o);
  j := public.delete_company_role(tpl2, null, 'warehouse');
  execute 'reset role';
  if (select count(*) from user_roles where user_id in (c1,c2) and role='warehouse') = 2 and not exists (select 1 from user_company_roles where user_id in (c1,c2))
  then pass:=pass+1; r := r || '✅ 7d. مسح دور ونقل موظفينه على دور جاهز (أمين مخزن)' || E'\n'; else fail:=fail+1; r := r || '❌ 7d' || E'\n'; end if;

  -- 8. hide a ready role
  perform pg_temp.as_(o);
  perform public.set_role_setting('driver', true, null);
  execute 'reset role';
  begin insert into user_roles(user_id,role,tenant_id) values (c3,'driver',t); fail:=fail+1; r := r || '❌ 8a. اتعيّن على سواق وهو مخفي' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 8a. «سواق» مخفي → السيرفر رفض تعيين حد عليه — ' || sqlerrm || E'\n'; end;
  perform pg_temp.as_(o);
  begin perform public.set_role_setting('cashier', true, null); fail:=fail+1; r := r || '❌ 8b. اتخفى وعليه موظف' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 8b. إخفاء «كاشير» وعليه موظف مرفوض — ' || sqlerrm || E'\n'; end;
  begin perform public.set_role_setting('viewer', true, null); fail:=fail+1; r := r || '❌ 8c' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 8c. «مراقب» مبيتخفاش — ' || sqlerrm || E'\n'; end;
  begin insert into permission_templates(tenant_id,name,base_role) values (t,'سواق ليلي','driver'); fail:=fail+1; r := r || '❌ 8d' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 8d. مينفعش دور جديد مبني على دور مخفي' || E'\n'; end;
  perform public.set_role_setting('driver', false, null);
  execute 'reset role';
  begin insert into user_roles(user_id,role,tenant_id) values (c3,'driver',t); v := true; exception when others then v := false; end;
  if v then pass:=pass+1; r := r || '✅ 8e. «إظهار» رجّعه، والتعيين عليه اشتغل' || E'\n'; else fail:=fail+1; r := r || '❌ 8e' || E'\n'; end if;

  -- 9. rename, and who may do it
  perform pg_temp.as_(o);
  perform public.set_role_setting('warehouse', false, 'مسؤول المخزن');
  execute 'reset role';
  if (select label from tenant_role_settings where tenant_id=t and role='warehouse') = 'مسؤول المخزن' and public.has_permission(c1,'inventory.view') = public.role_permission_default('warehouse','inventory.view')
  then pass:=pass+1; r := r || '✅ 9a. «أمين مخزن» بقى اسمه «مسؤول المخزن» عند الشركة دي وشغله زي ما هو' || E'\n'; else fail:=fail+1; r := r || '❌ 9a' || E'\n'; end if;
  perform pg_temp.as_(c3);
  begin perform public.set_role_setting('worker', true, null); fail:=fail+1; r := r || '❌ 9b' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 9b. الكاشير مينفعش يخفي أو يسمّي أدوار' || E'\n'; end;
  begin insert into tenant_role_settings(tenant_id, role, hidden) values (t,'worker',true); fail:=fail+1; r := r || '❌ 9c' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 9c. محدش يكتب في إعدادات الأدوار من برّه الدوال' || E'\n'; end;
  execute 'reset role';

  select count(*) into n from security_exposed_definer_functions();
  if n = 0 then pass:=pass+1; r := r || '✅ 10. مفيش دوال مكشوفة' || E'\n'; else fail:=fail+1; r := r || '❌ 10. ' || n || ' دالة مكشوفة' || E'\n'; end if;

  raise exception 'ROLLBACK-RESULTS: نجح % / فشل % %', pass, fail, r;
end $$;
