CREATE TABLE public.ai_ask_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  kind text NOT NULL DEFAULT 'question',
  question text,
  answer text,
  sql_text text,
  rows_returned integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ai_ask_log TO authenticated;
GRANT ALL ON public.ai_ask_log TO service_role;

ALTER TABLE public.ai_ask_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own insert" ON public.ai_ask_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "admins read logs" ON public.ai_ask_log
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'owner'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE INDEX ai_ask_log_created_idx ON public.ai_ask_log (created_at DESC);

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

  -- Hard read-only guard: blocks any write even through a function called inside SELECT
  PERFORM set_config('transaction_read_only', 'on', true);
  SET LOCAL statement_timeout = '15s';

  BEGIN
    EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s LIMIT 500) t', q) INTO res;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ai_ask_log (tenant_id, user_id, kind, sql_text, error)
    VALUES (public.current_tenant_id(), auth.uid(), 'sql', q, SQLERRM);
    RAISE;
  END;

  INSERT INTO public.ai_ask_log (tenant_id, user_id, kind, sql_text, rows_returned)
  VALUES (public.current_tenant_id(), auth.uid(), 'sql', q, jsonb_array_length(res));

  RETURN res;
END;
$function$;