-- PRE: snapshot today's answers of has_permission / effective_permission for every user of every company × every known key
create function pg_temp.as_(uid uuid) returns void language plpgsql as $f$
begin execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
  execute 'set local role authenticated'; end $f$;
create temp table snap as
select ur.user_id, k.key, public.has_permission(ur.user_id, k.key) before_val, public.effective_permission(ur.user_id, k.key) before_eff
  from (select distinct user_id from user_roles) ur
  cross join (select distinct permission_key key from role_permissions
              union select distinct permission_key from user_permissions) k;
