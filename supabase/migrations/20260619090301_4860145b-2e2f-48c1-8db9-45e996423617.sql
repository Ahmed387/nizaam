
CREATE OR REPLACE FUNCTION public._whoami_invoker()
RETURNS json LANGUAGE sql STABLE
AS $$ SELECT json_build_object('current_user', current_user, 'session_user', session_user) $$;

CREATE OR REPLACE FUNCTION public._whoami_definer()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT json_build_object('current_user', current_user, 'session_user', session_user) $$;

GRANT EXECUTE ON FUNCTION public._whoami_invoker() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._whoami_definer() TO anon, authenticated, service_role;
