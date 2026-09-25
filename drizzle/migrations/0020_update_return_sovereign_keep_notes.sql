CREATE OR REPLACE FUNCTION public.update_return_sovereign(p_kind text, p_return_id uuid, p_date date, p_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid; v_old timestamptz; v_new timestamptz;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'owner')) THEN
    RAISE EXCEPTION 'تعديل المرتجع متاح للإدارة فقط';
  END IF;
  IF p_kind NOT IN ('sale_return','purchase_return') THEN RAISE EXCEPTION 'نوع مرتجع غير صالح'; END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'التاريخ مطلوب'; END IF;
  IF p_kind = 'sale_return' THEN
    SELECT tenant_id, invoice_date INTO v_tenant, v_old FROM public.returns WHERE id = p_return_id FOR UPDATE;
  ELSE
    SELECT tenant_id, invoice_date INTO v_tenant, v_old FROM public.purchase_returns WHERE id = p_return_id FOR UPDATE;
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'المرتجع غير موجود'; END IF;
  IF v_tenant IS DISTINCT FROM public.current_tenant_id() THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF (v_old AT TIME ZONE 'Africa/Cairo')::date = p_date THEN
    v_new := v_old;
  ELSE
    v_new := (p_date + time '12:00') AT TIME ZONE 'Africa/Cairo';
  END IF;
  -- trg_guard_return_dates enforces: not in the future, not before original invoice
  IF p_kind = 'sale_return' THEN
    UPDATE public.returns SET invoice_date = v_new,
      notes = CASE WHEN p_notes IS NULL THEN notes ELSE NULLIF(btrim(p_notes),'') END
     WHERE id = p_return_id;
  ELSE
    UPDATE public.purchase_returns SET invoice_date = v_new,
      notes = CASE WHEN p_notes IS NULL THEN notes ELSE NULLIF(btrim(p_notes),'') END
     WHERE id = p_return_id;
  END IF;
  IF v_new IS DISTINCT FROM v_old THEN
    UPDATE public.journal_entries SET entry_date = p_date, updated_at = now()
     WHERE source_type = p_kind AND source_id = p_return_id AND status = 'posted';
    UPDATE public.treasury SET created_at = v_new WHERE reference_id = p_return_id AND category = 'return';
  END IF;
END $$;