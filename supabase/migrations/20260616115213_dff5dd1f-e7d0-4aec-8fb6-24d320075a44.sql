CREATE OR REPLACE FUNCTION public.recalc_contact_balance(_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_type text;
  v_balance numeric := 0;
  do_customer boolean := false;
  do_supplier boolean := false;
BEGIN
  SELECT type INTO c_type FROM public.contacts WHERE id = _contact_id;
  IF c_type IS NULL THEN RETURN; END IF;

  IF c_type = 'customer' THEN do_customer := true;
  ELSIF c_type = 'supplier' THEN do_supplier := true;
  ELSIF c_type = 'both' THEN do_customer := true; do_supplier := true;
  END IF;

  IF do_customer THEN
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
  END IF;

  IF do_supplier THEN
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
    -- Payments to supplier via payment plans (linked to shipments/open plans)
    v_balance := v_balance + COALESCE((
      SELECT SUM(pt.amount)
        FROM public.payment_transactions pt
        JOIN public.payment_plans pp ON pp.id = pt.payment_plan_id
       WHERE pp.entity_type = 'supplier'
         AND pp.entity_id = _contact_id
         AND pt.direction = 'out'
    ), 0);
    -- Refunds from supplier via plans (direction='in')
    v_balance := v_balance - COALESCE((
      SELECT SUM(pt.amount)
        FROM public.payment_transactions pt
        JOIN public.payment_plans pp ON pp.id = pt.payment_plan_id
       WHERE pp.entity_type = 'supplier'
         AND pp.entity_id = _contact_id
         AND pt.direction = 'in'
    ), 0);
  END IF;

  -- Standalone contact payments (not tied to any plan/installment)
  IF do_customer OR do_supplier THEN
    v_balance := v_balance + COALESCE((
      SELECT SUM(CASE WHEN direction = 'out' THEN amount ELSE -amount END)
        FROM public.payment_transactions
       WHERE contact_id = _contact_id
         AND payment_plan_id IS NULL
         AND installment_id IS NULL
    ), 0);
  END IF;

  UPDATE public.contacts SET balance = v_balance WHERE id = _contact_id;
END;
$function$;

-- Recalculate all supplier-side contacts so existing balances catch up
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.contacts WHERE type IN ('supplier','both','customer') LOOP
    PERFORM public.recalc_contact_balance(r.id);
  END LOOP;
END $$;