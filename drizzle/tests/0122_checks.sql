-- Migration test for 0122 — ONE batch: 0122_pre.sql → 0122 → this file. Raises at the end → ROLLBACK.
DO $$
declare r text := E'\n'; n int; v boolean; tpl uuid; tpl_other uuid;
  t uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); o uuid := gen_random_uuid(); c1 uuid := gen_random_uuid();
  x uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); b3 uuid := gen_random_uuid(); b4 uuid := gen_random_uuid();
  pass int := 0; fail int := 0;
  procedure_ok boolean;
begin
  -- 0. every real answer unchanged (every user × every known key, company-wide and in each of his branches)
  select count(*) into n from snap2 where public.perm_resolve(user_id, key, branch_id) is distinct from before_val;
  if n = 0 then pass := pass+1; r := r || '✅ 0. كل الصلاحيات الحالية زي ما هي (' || (select count(*) from snap2) || ' فحص)' || E'\n';
  else fail := fail+1; r := r || '❌ 0. ' || n || ' صلاحية اتغيرت: ' || (select string_agg(key || coalesce('@'||left(branch_id::text,4),''), ', ') from (select * from snap2 where public.perm_resolve(user_id, key, branch_id) is distinct from before_val limit 8) z) || E'\n'; end if;

  insert into tenants(id,name,slug,plan,is_active,setup_completed,max_branches,is_test) values (t,'اختبار فروع','zz-br-test','free',true,true,5,true),(t2,'شركة تانية','zz-br-test2','free',true,true,3,true);
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    select y, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-'||left(y::text,8)||'@test.local','x',now(),'{}','{}',now(),now() from unnest(array[o,c1,x]) y;
  update tenants set owner_user_id=o where id=t;
  insert into profiles(id,name,username,tenant_id) values (o,'مالك','zz-o',t),(c1,'محمود','zz-c1',t),(x,'غريب','zz-x',t2) on conflict (id) do update set tenant_id=excluded.tenant_id;
  insert into user_roles(user_id,role,tenant_id) values (o,'admin',t),(c1,'cashier',t),(x,'admin',t2);
  insert into branches(id,code,name,tenant_id) values (b1,'ZB1','سكة تلة',t),(b2,'ZB2','شلبى',t),(b3,'ZB3','عبدالمنعم',t),(b4,'ZB4','فرع رابع',t);
  insert into role_permissions(tenant_id, role, permission_key, allowed) values
    (t,'cashier','sales.view',true),(t,'cashier','sales.create',true),(t,'cashier','sales.delete',false),(t,'cashier','treasury.view',true),
    (t,'cashier','receipt_vouchers.create',false),(t,'cashier','payment_vouchers.create',false),(t,'cashier','admin_settings.view',false),
    (t,'warehouse','inventory.update',true),(t,'warehouse','sales.create',false);
  insert into permission_templates(tenant_id,name,base_role,perms) values (t,'مندوب مبيعات','cashier','{"treasury.view":false,"receipt_vouchers.create":true}') returning id into tpl;
  insert into permission_templates(tenant_id,name,base_role,perms) values (t2,'دور شركة تانية','cashier','{}') returning id into tpl_other;
  -- سكة تلة كاملة · شلبى جزئية على «مندوب مبيعات» · عبدالمنعم عرض · الرابع جزئية على «أمين مخزن»
  insert into branch_users(user_id,branch_id,tenant_id,access_level,full_access,branch_role,branch_template) values
    (c1,b1,t,'manage',true,null,null),(c1,b2,t,'manage',false,null,tpl),(c1,b3,t,'read',false,null,null),(c1,b4,t,'manage',false,'warehouse',null);

  if public.perm_resolve(c1,'sales.delete',b1) and public.perm_resolve(c1,'payment_vouchers.create',b1) and public.perm_resolve(c1,'part.dashboard.gross_profit_today.view',b1)
     and not public.perm_resolve(c1,'admin_settings.view',b1)
  then pass:=pass+1; r := r || '✅ 1. سكة تلة «كاملة»: الإلغاء وسند الصرف وكارت الربح مفتوحين، وإعدادات الشركة لأ' || E'\n'; else fail:=fail+1; r := r || '❌ 1' || E'\n'; end if;

  if not public.perm_resolve(c1,'treasury.view',b2) and public.perm_resolve(c1,'receipt_vouchers.create',b2) and public.perm_resolve(c1,'sales.create',b2) and not public.perm_resolve(c1,'sales.delete',b2)
  then pass:=pass+1; r := r || '✅ 2. شلبى على «مندوب مبيعات»: الخزنة مقفولة، سند القبض مفتوح، البيع من الكاشير مفتوح، الإلغاء لأ' || E'\n'; else fail:=fail+1; r := r || '❌ 2' || E'\n'; end if;

  if public.perm_resolve(c1,'sales.view',b3) and not public.perm_resolve(c1,'sales.create',b3) and public.perm_resolve(c1,'treasury.view',b3)
  then pass:=pass+1; r := r || '✅ 3. عبدالمنعم «عرض»: يشوف المبيعات والخزنة، ومايبيعش' || E'\n'; else fail:=fail+1; r := r || '❌ 3' || E'\n'; end if;

  if public.perm_resolve(c1,'inventory.update',b4) and not public.perm_resolve(c1,'sales.create',b4)
  then pass:=pass+1; r := r || '✅ 4. الفرع الرابع على «أمين مخزن»: يعدل المخزون ومايبيعش' || E'\n'; else fail:=fail+1; r := r || '❌ 4' || E'\n'; end if;

  if public.perm_resolve(c1,'treasury.view',null) and not public.perm_resolve(c1,'receipt_vouchers.create',null)
  then pass:=pass+1; r := r || '✅ 5. برّه أي فرع بياخد دوره الأساسي (كاشير)' || E'\n'; else fail:=fail+1; r := r || '❌ 5' || E'\n'; end if;

  -- his own change in one branch beats its template; nothing opens a write in a view-only branch
  insert into user_permissions(tenant_id,user_id,permission_key,allowed,branch_id) values
    (t,c1,'treasury.view',true,b2),(t,c1,'sales.create',true,b3),(t,c1,'sales.delete',false,b1);
  if public.perm_resolve(c1,'treasury.view',b2) and not public.perm_resolve(c1,'sales.create',b3) and not public.perm_resolve(c1,'sales.delete',b1)
  then pass:=pass+1; r := r || '✅ 6. تعديله في فرع بيكسب القالب، والإلغاء اللي قفلته في سكة تلة اتقفل رغم «كاملة»، والعرض فاضل عرض' || E'\n'; else fail:=fail+1; r := r || '❌ 6' || E'\n'; end if;

  -- the server guard of every RPC follows the branch
  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  begin perform public.assert_access(b3, 'sales.create'); v := true; exception when others then v := false; end;
  begin perform public.assert_access(b1, 'payment_vouchers.create'); procedure_ok := true; exception when others then procedure_ok := false; end;
  if not v and procedure_ok then pass:=pass+1; r := r || '✅ 7. السيرفر نفسه: رفض البيع في عبدالمنعم، وقبل سند الصرف في سكة تلة' || E'\n'; else fail:=fail+1; r := r || '❌ 7 ' || v || ' ' || procedure_ok || E'\n'; end if;

  begin update branch_users set branch_template = tpl_other where user_id = c1 and branch_id = b2; fail:=fail+1; r := r || '❌ 8a' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 8a. قالب من شركة تانية مرفوض' || E'\n'; end;
  begin update branch_users set full_access = true where user_id = c1 and branch_id = b3; fail:=fail+1; r := r || '❌ 8b' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 8b. «كاملة» و«عرض» مع بعض مرفوض' || E'\n'; end;

  perform set_config('request.jwt.claims', json_build_object('sub',o,'role','authenticated')::text, true);
  begin perform public.set_role_setting('warehouse', true, null); fail:=fail+1; r := r || '❌ 9' || E'\n';
  exception when others then pass:=pass+1; r := r || '✅ 9. إخفاء «أمين مخزن» مرفوض وهو قالب فرع — ' || sqlerrm || E'\n'; end;

  -- deleting the company role: that branch goes back to his main role
  delete from user_permissions where user_id = c1;
  delete from permission_templates where id = tpl;
  if (select branch_template from branch_users where user_id=c1 and branch_id=b2) is null and public.perm_resolve(c1,'treasury.view',b2)
  then pass:=pass+1; r := r || '✅ 10. مسح «مندوب مبيعات» رجّع شلبى لدوره الأساسي' || E'\n'; else fail:=fail+1; r := r || '❌ 10' || E'\n'; end if;

  -- branch_users of a company is no longer readable from another company
  perform set_config('request.jwt.claims', json_build_object('sub',x,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from branch_users where tenant_id = t;
  execute 'reset role';
  if n = 0 then pass:=pass+1; r := r || '✅ 11. شركة تانية مبقتش تشوف فروع موظفينك' || E'\n'; else fail:=fail+1; r := r || '❌ 11. ' || n || E'\n'; end if;

  select count(*) into n from security_exposed_definer_functions();
  if n = 0 then pass:=pass+1; r := r || '✅ 12. مفيش دوال مكشوفة' || E'\n'; else fail:=fail+1; r := r || '❌ 12. ' || n || E'\n'; end if;

  raise exception 'ROLLBACK-RESULTS: نجح % / فشل % %', pass, fail, r;
end $$;
