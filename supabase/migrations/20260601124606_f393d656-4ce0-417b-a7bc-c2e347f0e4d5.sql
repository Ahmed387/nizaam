CREATE OR REPLACE FUNCTION public.hard_delete_invoice(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  inv record;
  it record;
  uid uuid := auth.uid();
  is_adm boolean;
  is_bm boolean;
  v_plan_ids uuid[];
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة';
  END IF;

  SELECT has_role(uid, 'admin'::app_role) INTO is_adm;
  SELECT has_role(uid, 'branch_manager'::app_role) INTO is_bm;
  IF NOT (is_adm OR is_bm OR is_super_admin(uid)) THEN
    RAISE EXCEPTION 'غير مصرح بالحذف النهائي';
  END IF;

  -- Restore stock for active invoices
  IF inv.status = 'active' THEN
    FOR it IN SELECT product_id, quantity FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
      IF it.product_id IS NOT NULL THEN
        UPDATE public.products SET quantity = quantity + it.quantity WHERE id = it.product_id;
      END IF;
    END LOOP;
  END IF;

  -- Treasury reversal: remove rows referencing this invoice
  DELETE FROM public.treasury WHERE reference_id = _invoice_id;

  -- Payment plans linked to this invoice (reference_type='invoice')
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_plan_ids
  FROM public.payment_plans
  WHERE reference_type = 'invoice' AND reference_id = _invoice_id;

  IF array_length(v_plan_ids, 1) > 0 THEN
    DELETE FROM public.payment_transactions WHERE payment_plan_id = ANY(v_plan_ids);
    DELETE FROM public.payment_installments WHERE payment_plan_id = ANY(v_plan_ids);
    DELETE FROM public.payment_plans WHERE id = ANY(v_plan_ids);
  END IF;

  DELETE FROM public.invoice_payments WHERE invoice_id = _invoice_id;
  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;
  DELETE FROM public.invoices WHERE id = _invoice_id;
END;
$function$;