
CREATE OR REPLACE FUNCTION public.hard_delete_invoice(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  it record;
  uid uuid := auth.uid();
  is_admin boolean;
  is_branch_mgr boolean;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة';
  END IF;

  -- Permission check
  SELECT has_role(uid, 'admin'::app_role) INTO is_admin;
  SELECT has_role(uid, 'branch_manager'::app_role) INTO is_branch_mgr;
  IF NOT (is_admin OR is_branch_mgr OR is_super_admin(uid)) THEN
    RAISE EXCEPTION 'غير مصرح بالحذف النهائي';
  END IF;

  -- Restore stock for each item (only if invoice was active — cancelled invoices already restored)
  IF inv.status = 'active' THEN
    FOR it IN SELECT product_id, quantity FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
      IF it.product_id IS NOT NULL THEN
        UPDATE public.products SET quantity = quantity + it.quantity WHERE id = it.product_id;
      END IF;
    END LOOP;
  END IF;

  -- Remove all treasury entries linked to this invoice (income from sale + any cancellation expense)
  DELETE FROM public.treasury WHERE reference_id = _invoice_id;

  -- Remove payment plans / installments / payment transactions linked to invoice
  DELETE FROM public.payment_transactions WHERE invoice_id = _invoice_id;
  DELETE FROM public.payment_installments WHERE plan_id IN (SELECT id FROM public.payment_plans WHERE invoice_id = _invoice_id);
  DELETE FROM public.payment_plans WHERE invoice_id = _invoice_id;

  -- Remove invoice_payments (in case no cascade)
  DELETE FROM public.invoice_payments WHERE invoice_id = _invoice_id;

  -- Finally delete invoice (cascades invoice_items)
  DELETE FROM public.invoices WHERE id = _invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hard_delete_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hard_delete_invoice(uuid) TO authenticated;
