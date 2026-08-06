-- 1) Access level: full (owner/super_admin) | scoped (granted permission) | none
CREATE OR REPLACE FUNCTION public.ask_me_access_level(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN 'none'
    WHEN public.has_role(_user_id, 'owner'::app_role)
      OR public.has_role(_user_id, 'super_admin'::app_role) THEN 'full'
    WHEN public.has_permission(_user_id, 'admin_ask_me.view') THEN 'scoped'
    ELSE 'none'
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_use_ask_me(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.ask_me_access_level(_user_id) <> 'none';
$$;

-- 2) Table allow-list derived from the user's own permissions.
--    Sensitive company-wide tables (salaries, partners, profits, audit, permissions...) are
--    intentionally absent => owner-only.
CREATE OR REPLACE FUNCTION public.ask_me_allowed_tables(_user_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t text[] := ARRAY['branches','branch_users','product_types','categories','brands','colors','sizes'];
BEGIN
  IF public.ask_me_access_level(_user_id) = 'full' THEN
    SELECT array_agg(c.relname)
      INTO t
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p');
    RETURN t;
  END IF;

  IF public.has_permission(_user_id, 'sales.view') OR public.has_permission(_user_id, 'invoices.view') THEN
    t := t || ARRAY['invoices','invoice_items','invoice_payments','returns','return_items','quotes','quote_items','payment_transactions','payment_plans','payment_installments'];
  END IF;
  IF public.has_permission(_user_id, 'inventory.view') THEN
    t := t || ARRAY['products','product_batches','inventory_sessions','inventory_session_items','inventory_adjustments','inventory_reservations','stock_adjustments','stock_adjustment_items','stock_transfers','price_list_items','price_list_sources'];
  END IF;
  IF public.has_permission(_user_id, 'customers.view') OR public.has_permission(_user_id, 'suppliers.view') THEN
    t := t || ARRAY['contacts','customer_credit_log'];
  END IF;
  IF public.has_permission(_user_id, 'shipments.view') THEN
    t := t || ARRAY['shipments','shipment_items','purchase_returns','purchase_return_items','supplier_payments'];
  END IF;
  IF public.has_permission(_user_id, 'treasury.view') THEN
    t := t || ARRAY['treasury','treasury_transfers','cashier_shifts','expenses','transfer_fees'];
  END IF;
  IF public.has_permission(_user_id, 'receipt_vouchers.view') OR public.has_permission(_user_id, 'payment_vouchers.view') THEN
    t := t || ARRAY['vouchers','voucher_categories','voucher_attachments'];
  END IF;
  IF public.has_permission(_user_id, 'employees.view') THEN
    t := t || ARRAY['employees'];
  END IF;
  IF public.has_permission(_user_id, 'attendance.view') THEN
    t := t || ARRAY['attendance','branch_schedules','branch_closures'];
  END IF;
  IF public.has_permission(_user_id, 'advances.view') THEN
    t := t || ARRAY['advances','advance_requests','advance_payments'];
  END IF;
  IF public.has_permission(_user_id, 'preorders.view') THEN
    t := t || ARRAY['pre_orders','pre_order_transactions'];
  END IF;

  RETURN ARRAY(SELECT DISTINCT unnest(t));
END;
$$;

-- 3) Schema snapshot limited to what the caller may query
CREATE OR REPLACE FUNCTION public.ask_me_schema()
RETURNS TABLE(table_name text, columns text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.table_name::text,
         string_agg(c.column_name || ':' || c.data_type, ', ' ORDER BY c.ordinal_position)
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND public.can_use_ask_me(auth.uid())
     AND c.table_name = ANY (public.ask_me_allowed_tables(auth.uid()))
   GROUP BY c.table_name
   ORDER BY c.table_name;
$$;

GRANT EXECUTE ON FUNCTION public.ask_me_schema() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ask_me_allowed_tables(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ask_me_access_level(uuid) TO authenticated;

-- 4) ai_sql: keep read-only guards, add per-permission table gating for scoped users.
--    Runs as INVOKER so RLS already limits rows to the user's own branch/tenant.
CREATE OR REPLACE FUNCTION public.ai_sql(query text)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  q text := btrim(query);
  res jsonb;
  lvl text;
  allowed text[];
  bad text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ai_sql: unauthorized';
  END IF;

  lvl := public.ask_me_access_level(auth.uid());
  IF lvl = 'none' THEN
    RAISE EXCEPTION 'ai_sql: not allowed';
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

  IF lvl = 'scoped' THEN
    IF q ~* '\y(pg_catalog|information_schema|pg_[a-z_]+|auth\.|storage\.|vault\.)' THEN
      RAISE EXCEPTION 'ai_sql: system catalogs are not available for your account';
    END IF;
    allowed := public.ask_me_allowed_tables(auth.uid());
    SELECT c.relname INTO bad
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r','v','m','p')
       AND NOT (c.relname = ANY (allowed))
       AND q ~* ('\y' || c.relname || '\y')
     LIMIT 1;
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION 'ai_sql: no permission for table %', bad;
    END IF;
  END IF;

  INSERT INTO public.ai_ask_log (tenant_id, user_id, kind, sql_text)
  VALUES (public.current_tenant_id(), auth.uid(), 'sql', q);

  PERFORM set_config('transaction_read_only', 'on', true);
  SET LOCAL statement_timeout = '15s';

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s LIMIT 500) t', q) INTO res;
  RETURN res;
END;
$function$;