CREATE OR REPLACE FUNCTION public.system_health_check()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_email text; v_res jsonb; 
BEGIN
  IF COALESCE(current_setting('nizam.system_run', true), '') <> 'on' THEN
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
    IF LOWER(COALESCE(v_email,'')) <> 'an.ayoub98@gmail.com' AND NOT is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Not authorised';
    END IF;
  END IF;
  PERFORM set_config('nizam.system_run', 'on', true);
  SELECT public.system_health_check_impl() INTO v_res;
  RETURN v_res;
END $function$;

CREATE OR REPLACE FUNCTION public.run_regression_checks(p_source text DEFAULT 'cron')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res jsonb; v_fails jsonb := '[]'::jsonb; v_key text; v_item jsonb; v_id uuid; t record;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  PERFORM set_config('nizam.system_run', 'on', true);
  SELECT public.system_health_check() INTO v_res;

  FOR v_key IN SELECT jsonb_object_keys(v_res) LOOP
    IF jsonb_typeof(v_res -> v_key) = 'array' THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_res -> v_key) LOOP
        IF (v_item ? 'ok') AND (v_item ->> 'ok') = 'false' THEN
          v_fails := v_fails || jsonb_build_object('check', v_key, 'detail', v_item);
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO public.health_check_runs (status, failure_count, failures, details, source)
  VALUES (CASE WHEN jsonb_array_length(v_fails) = 0 THEN 'pass' ELSE 'fail' END,
          jsonb_array_length(v_fails), v_fails, v_res, p_source)
  RETURNING id INTO v_id;

  IF jsonb_array_length(v_fails) > 0 THEN
    FOR t IN SELECT id, name FROM public.tenants WHERE is_active AND NOT is_suspended LOOP
      PERFORM public.notify_tenant_admins(
        t.id,
        'فحص سلامة النظام لقى ' || jsonb_array_length(v_fails) || ' مشكلة',
        'الفحص التلقائي اكتشف اختلالات محاسبية أو بيانات غير متسقة. افتح صفحة صحة النظام للتفاصيل.',
        'health_check', '/admin/system-health', 'health_check_run', v_id);
    END LOOP;
  END IF;

  RETURN v_id;
END $$;