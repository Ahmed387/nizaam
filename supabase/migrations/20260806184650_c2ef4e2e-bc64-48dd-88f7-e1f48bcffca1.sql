-- 1) Unified owner check (role-based OR tenant owner_user_id)
CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user_id, 'owner'::app_role)
      OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.owner_user_id = _user_id)
$function$;

-- 2) Point close_fiscal_period(uuid,text) at the unified single-arg version
DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'close_fiscal_period'
    AND pg_get_function_identity_arguments(p.oid) LIKE '%p_reason%';
  IF d IS NULL THEN RAISE EXCEPTION 'close_fiscal_period(uuid,text) not found'; END IF;
  d := replace(d, 'public.is_owner(v_uid, v_tenant)', 'public.is_owner(v_uid)');
  EXECUTE d;
END
$mig$;

-- 3) Drop the stale overloads / unused function
DROP FUNCTION IF EXISTS public.close_fiscal_period(uuid);
DROP FUNCTION IF EXISTS public.is_owner(uuid, uuid);
DROP FUNCTION IF EXISTS public.backfill_missing_journals();