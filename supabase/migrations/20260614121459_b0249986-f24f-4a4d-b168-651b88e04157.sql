CREATE OR REPLACE FUNCTION public.process_return_item_effect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.returns WHERE id = NEW.return_id;
  IF NEW.product_id IS NOT NULL AND COALESCE(v_status, 'active') = 'active' THEN
    UPDATE public.products SET quantity = quantity + NEW.quantity WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_return_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash_out numeric;
BEGIN
  v_cash_out := COALESCE(NEW.refund_cash_amount, 0) + COALESCE(NEW.refund_transfer_amount, 0);
  IF COALESCE(NEW.status, 'active') = 'active' AND v_cash_out > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id, payment_method, reference_number, transfer_to_account)
    VALUES (
      NEW.branch_id,
      'expense',
      'return',
      v_cash_out,
      'مرتجع فاتورة',
      NEW.id,
      NEW.created_by,
      NEW.tenant_id,
      NEW.refund_method,
      NEW.refund_reference,
      NEW.refund_account
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_contact_balance(_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_type text;
  v_balance numeric := 0;
BEGIN
  SELECT type INTO c_type FROM public.contacts WHERE id = _contact_id;
  IF c_type IS NULL THEN RETURN; END IF;

  IF c_type = 'customer' THEN
    v_balance := v_balance + COALESCE((
      SELECT SUM(total) FROM public.invoices
       WHERE contact_id = _contact_id AND status = 'active'
    ), 0);
    v_balance := v_balance - COALESCE((
      SELECT SUM(ip.amount) FROM public.invoice_payments ip
       JOIN public.invoices i ON i.id = ip.invoice_id
       WHERE i.contact_id = _contact_id AND i.status = 'active'
    ), 0);
    v_balance := v_balance - COALESCE((
      SELECT SUM(COALESCE(r.refund_balance_amount, 0)) FROM public.returns r
       JOIN public.invoices i ON i.id = r.invoice_id
       WHERE i.contact_id = _contact_id AND COALESCE(r.status, 'active') = 'active'
    ), 0);
    v_balance := v_balance - COALESCE((
      SELECT SUM(amount) FROM public.vouchers
       WHERE party_id = _contact_id AND party_type = 'customer'
         AND source = 'manual' AND status = 'active'
    ), 0);

  ELSIF c_type = 'supplier' THEN
    v_balance := v_balance - COALESCE((
      SELECT SUM(si.quantity * COALESCE(si.true_unit_cost, si.cost_price, 0))
        FROM public.shipments s
        JOIN public.shipment_items si ON si.shipment_id = s.id
       WHERE s.contact_id = _contact_id
    ), 0);
    v_balance := v_balance + COALESCE((
      SELECT SUM(amount) FROM public.supplier_payments WHERE contact_id = _contact_id
    ), 0);
    v_balance := v_balance + COALESCE((
      SELECT SUM(COALESCE(total_amount, 0)) FROM public.purchase_returns WHERE contact_id = _contact_id
    ), 0);
    v_balance := v_balance + COALESCE((
      SELECT SUM(CASE WHEN type='payment' THEN amount ELSE -amount END)
        FROM public.vouchers
       WHERE party_id = _contact_id AND party_type = 'supplier'
         AND source = 'manual' AND status = 'active'
    ), 0);
  END IF;

  UPDATE public.contacts SET balance = v_balance WHERE id = _contact_id;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.contacts LOOP
    PERFORM public.recalc_contact_balance(r.id);
  END LOOP;
END;
$$;