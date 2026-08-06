ALTER TABLE public.ai_ask_log ADD COLUMN IF NOT EXISTS steps jsonb;

CREATE OR REPLACE FUNCTION public.ai_sql(query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  q text := btrim(query);
  res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ai_sql: unauthorized';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'owner'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
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

  -- Log BEFORE the read-only switch (writes are impossible afterwards).
  INSERT INTO public.ai_ask_log (tenant_id, user_id, kind, sql_text)
  VALUES (public.current_tenant_id(), auth.uid(), 'sql', q);

  -- Hard read-only guard: blocks any write even via a function called inside SELECT.
  PERFORM set_config('transaction_read_only', 'on', true);
  SET LOCAL statement_timeout = '15s';

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s LIMIT 500) t', q) INTO res;
  RETURN res;
END;
$function$;