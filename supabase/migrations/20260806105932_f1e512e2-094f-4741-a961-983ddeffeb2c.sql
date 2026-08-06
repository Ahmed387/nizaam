CREATE OR REPLACE FUNCTION public.can_use_ask_me(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.has_role(_user_id, 'owner'::app_role)
    OR public.has_role(_user_id, 'super_admin'::app_role)
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_use_ask_me(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ai_sql(query text)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  q text := btrim(query);
  res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ai_sql: unauthorized';
  END IF;
  IF NOT public.can_use_ask_me(auth.uid()) THEN
    RAISE EXCEPTION 'ai_sql: owner only';
  END IF;

  q := regexp_replace(q, ';\s*$', '');
  IF position(';' IN q) > 0 THEN
    RAISE EXCEPTION 'ai_sql: single statement only';
  END IF;
  IF q !~* '^(select|with)\s' THEN
    RAISE EXCEPTION 'ai_sql: SELECT statements only';
  END IF;
  IF q ~* '\y(insert|update|delete|drop|alter|truncate|grant|revoke|copy|call|vacuum|reindex|refresh|comment|pg_sleep|pg_read_file|pg_read_binary_file|dblink|lo_import|lo_export)\y' THEN
    RAISE EXCEPTION 'ai_sql: forbidden keyword in query';
  END IF;

  INSERT INTO public.ai_ask_log (tenant_id, user_id, kind, sql_text)
  VALUES (public.current_tenant_id(), auth.uid(), 'sql', q);

  PERFORM set_config('transaction_read_only', 'on', true);
  SET LOCAL statement_timeout = '15s';

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s LIMIT 500) t', q) INTO res;
  RETURN res;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.purge_ai_ask_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.ai_ask_log WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_ai_ask_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_ai_ask_log() TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-ai-ask-log-daily';
SELECT cron.schedule('purge-ai-ask-log-daily', '15 3 * * *', $$SELECT public.purge_ai_ask_log();$$);