-- PRE for 0122: today's answers of perm_resolve for every user × every known key, company-wide and in each of his branches
create temp table snap2 as
select ur.user_id, k.key, bx.branch_id, public.perm_resolve(ur.user_id, k.key, bx.branch_id) before_val
  from (select distinct user_id from user_roles) ur
  cross join (select distinct permission_key key from role_permissions
              union select distinct permission_key from user_permissions) k
  cross join lateral (select null::uuid branch_id union all select bu.branch_id from branch_users bu where bu.user_id = ur.user_id) bx;
