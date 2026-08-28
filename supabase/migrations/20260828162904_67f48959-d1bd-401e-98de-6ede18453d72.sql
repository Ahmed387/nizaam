-- تعديل تاريخ/ملاحظات الفاتورة عبر دالة معتمدة (الترايجرات الحالية بتفضل تشتغل)
CREATE OR REPLACE FUNCTION public.set_invoice_meta(
  p_invoice_id uuid,
  p_invoice_date timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.invoices;
BEGIN
  SELECT * INTO v_row FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_row.tenant_id <> public.current_tenant_id() THEN RAISE EXCEPTION 'غير مسموح'; END IF;

  UPDATE public.invoices
     SET invoice_date = COALESCE(p_invoice_date, invoice_date),
         notes        = COALESCE(p_notes, notes)
   WHERE id = p_invoice_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_invoice_meta(uuid, timestamptz, text) TO authenticated;

-- وسم فاتورة مرحّلة (استيراد الفواتير القديمة)
CREATE OR REPLACE FUNCTION public.mark_invoice_migrated(
  p_invoice_id uuid,
  p_invoice_date timestamptz,
  p_legacy_number text,
  p_batch_id uuid,
  p_source text,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.invoices WHERE id = p_invoice_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_tenant <> public.current_tenant_id() THEN RAISE EXCEPTION 'غير مسموح'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'الترحيل للإدارة فقط';
  END IF;

  UPDATE public.invoices
     SET invoice_date      = COALESCE(p_invoice_date, invoice_date),
         legacy_number     = p_legacy_number,
         migration_batch_id= p_batch_id,
         is_migrated       = true,
         migration_source  = p_source,
         notes             = COALESCE(p_notes, notes)
   WHERE id = p_invoice_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_invoice_migrated(uuid, timestamptz, text, uuid, text, text) TO authenticated;

-- مسح أرصدة الخزنة الافتتاحية قبل إعادة الاستيراد
CREATE OR REPLACE FUNCTION public.clear_opening_treasury()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'للإدارة فقط';
  END IF;
  DELETE FROM public.treasury
   WHERE tenant_id = public.current_tenant_id() AND category = 'رصيد افتتاحي';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.clear_opening_treasury() TO authenticated;

-- أدوات إعادة التهيئة (شاشة البيانات التجريبية)
CREATE OR REPLACE FUNCTION public.admin_cancel_all_invoices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'للإدارة فقط';
  END IF;
  UPDATE public.invoices SET status = 'cancelled'
   WHERE tenant_id = public.current_tenant_id() AND status <> 'cancelled';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_cancel_all_invoices() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_clear_treasury()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'للإدارة فقط';
  END IF;
  DELETE FROM public.treasury WHERE tenant_id = public.current_tenant_id();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_clear_treasury() TO authenticated;