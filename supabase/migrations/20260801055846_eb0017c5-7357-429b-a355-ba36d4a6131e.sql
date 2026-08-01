CREATE OR REPLACE FUNCTION public.create_journal_entry(
  p_tenant_id UUID, p_entry_date DATE, p_description TEXT,
  p_source_type TEXT, p_source_id UUID, p_lines JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_entry_id UUID; v_entry_number TEXT; v_line JSONB; v_account_id UUID; v_seq INTEGER;
  v_total_debit NUMERIC(18,2) := 0; v_total_credit NUMERIC(18,2) := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  IF NOT public.is_super_admin(v_uid) THEN
    IF p_tenant_id IS DISTINCT FROM public.current_tenant_id() THEN
      RAISE EXCEPTION 'غير مصرح: القيد يخص شركة أخرى';
    END IF;
    IF NOT (public.has_role(v_uid,'admin'::app_role)
         OR public.has_role(v_uid,'owner'::app_role)
         OR public.has_role(v_uid,'accountant'::app_role)) THEN
      RAISE EXCEPTION 'غير مصرح: تسجيل القيود اليدوية للمدير أو المحاسب فقط';
    END IF;
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'Journal entry requires at least 2 lines';
  END IF;

  SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number,'-',3) AS INTEGER)),0)+1 INTO v_seq
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id
     AND entry_number LIKE 'JE-'||to_char(p_entry_date,'YYYYMM')||'-%';

  v_entry_number := 'JE-'||to_char(p_entry_date,'YYYYMM')||'-'||LPAD(v_seq::TEXT,4,'0');

  INSERT INTO public.journal_entries(tenant_id, entry_number, entry_date, description, source_type, source_id, status, created_by)
  VALUES (p_tenant_id, v_entry_number, p_entry_date, p_description, p_source_type, p_source_id, 'draft', v_uid)
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT id INTO v_account_id FROM public.chart_of_accounts
      WHERE tenant_id = p_tenant_id AND code = v_line->>'account_code' LIMIT 1;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Account code % not found', v_line->>'account_code';
    END IF;

    INSERT INTO public.journal_entry_lines(tenant_id, entry_id, account_id, debit, credit, description)
    VALUES (p_tenant_id, v_entry_id, v_account_id,
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      v_line->>'description');

    v_total_debit  := v_total_debit  + COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ROUND(v_total_debit,2) <> ROUND(v_total_credit,2) THEN
    RAISE EXCEPTION 'Unbalanced entry: debit=% credit=%', v_total_debit, v_total_credit;
  END IF;

  UPDATE public.journal_entries SET status = 'posted' WHERE id = v_entry_id;
  RETURN v_entry_id;
END $$;