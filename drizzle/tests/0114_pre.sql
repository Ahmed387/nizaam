-- PRE: snapshot today's answers of has_permission for every A&N non-admin user × every known key
create function pg_temp.as_(uid uuid) returns void language plpgsql as $f$
begin execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
  execute 'set local role authenticated'; end $f$;
create temp table snap as
select ur.user_id, k.key, public.has_permission(ur.user_id, k.key) before_val
  from (select distinct user_id from user_roles where tenant_id='5316fbfe-b862-4c91-b48b-1d81c8aa5a71') ur
  cross join (select distinct permission_key key from role_permissions where tenant_id='5316fbfe-b862-4c91-b48b-1d81c8aa5a71'
              union select distinct permission_key from user_permissions) k;
