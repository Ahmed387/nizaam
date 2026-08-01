CREATE OR REPLACE FUNCTION public.create_journal_entry(
  p_tenant_id uuid,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id uuid,
  p_lines jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_entry_id uuid;
  v_line jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  IF NOT public.is_super_admin(v_uid) THEN
    IF p_tenant_id IS DISTINCT FROM public.current_tenant_id() THEN
      RAISE EXCEPTION 'غير مصرح: القيد يخص شركة أخرى';
    END IF;
    IF NOT (public.has_role(v_uid,'admin'::app_role)
         OR public.has_role(v_uid,'owner'::app_role)
         OR public.has_role(v_uid,'accountant'::app_role)) THEN
      RAISE EXCEPTION 'غير مصرح: تسجيل القيود للمدير أو المحاسب فقط';
    END IF;
  END IF;

  INSERT INTO public.journal_entries(tenant_id, entry_date, description, source_type, source_id, created_by)
  VALUES (p_tenant_id, p_entry_date, p_description, p_source_type, p_source_id, v_uid)
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.journal_entry_lines(entry_id, account_id, debit, credit, description, branch_id)
    VALUES (
      v_entry_id,
      (v_line->>'account_id')::uuid,
      COALESCE((v_line->>'debit')::numeric, 0),
      COALESCE((v_line->>'credit')::numeric, 0),
      v_line->>'description',
      NULLIF(v_line->>'branch_id','')::uuid
    );
  END LOOP;

  RETURN v_entry_id;
END;
$function$;