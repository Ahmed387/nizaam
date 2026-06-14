CREATE OR REPLACE FUNCTION public.register_sale_return_full(
  _invoice_id uuid,
  _reason text,
  _notes text,
  _status text,
  _refund_method text,
  _refund_reference text,
  _refund_account text,
  _refund_cash_amount numeric,
  _refund_transfer_amount numeric,
  _refund_balance_amount numeric,
  _items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  uid uuid := auth.uid();
  rt_id uuid;
  rn text;
  it jsonb;
  v_pid uuid;
  v_qty int;
  v_refund numeric;
  v_total numeric := 0;
  v_already numeric;
  v_sold numeric;
  v_status text := COALESCE(NULLIF(_status, ''), 'active');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id FOR UPDATE;
  IF inv IS NULL THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة';
  END IF;
  IF NOT public.user_in_branch(uid, inv.branch_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;
  IF v_status NOT IN ('active', 'draft') THEN
    RAISE EXCEPTION 'حالة المرتجع غير صحيحة';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_pid := NULLIF(it->>'product_id', '')::uuid;
    v_qty := COALESCE((it->>'quantity')::int, 0);
    v_refund := COALESCE((it->>'refund')::numeric, 0);
    IF v_pid IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'بيانات صنف المرتجع غير صحيحة';
    END IF;

    SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(returned_quantity), 0)
      INTO v_sold, v_already
    FROM public.invoice_items
    WHERE invoice_id = _invoice_id AND product_id = v_pid;

    IF v_sold <= 0 THEN
      RAISE EXCEPTION 'الصنف غير موجود في الفاتورة';
    END IF;
    IF v_status = 'active' AND (v_already + v_qty) > v_sold THEN
      RAISE EXCEPTION 'كمية المرتجع أكبر من المتاح للإرجاع';
    END IF;

    v_total := v_total + v_refund;
  END LOOP;

  IF ABS(v_total - (COALESCE(_refund_cash_amount,0) + COALESCE(_refund_transfer_amount,0) + COALESCE(_refund_balance_amount,0))) > 0.01 THEN
    RAISE EXCEPTION 'مجموع طرق الاسترداد لازم يساوي إجمالي المرتجع';
  END IF;

  rn := public.next_sale_return_number();

  INSERT INTO public.returns(
    invoice_id, branch_id, reason, notes, created_by, total_refund, status,
    refund_method, refund_reference, refund_account,
    refund_cash_amount, refund_transfer_amount, refund_balance_amount,
    return_number, tenant_id
  ) VALUES (
    _invoice_id, inv.branch_id, _reason, NULLIF(_notes, ''), uid, v_total, v_status,
    COALESCE(_refund_method, 'cash'), NULLIF(_refund_reference, ''), NULLIF(_refund_account, ''),
    COALESCE(_refund_cash_amount, 0), COALESCE(_refund_transfer_amount, 0), COALESCE(_refund_balance_amount, 0),
    rn, inv.tenant_id
  ) RETURNING id INTO rt_id;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO public.return_items(return_id, product_id, quantity, refund, tenant_id)
    VALUES (
      rt_id,
      NULLIF(it->>'product_id', '')::uuid,
      COALESCE((it->>'quantity')::int, 0),
      COALESCE((it->>'refund')::numeric, 0),
      inv.tenant_id
    );
  END LOOP;

  IF v_status = 'active' THEN
    PERFORM public.apply_return_batch_tracking(
      _invoice_id,
      (SELECT jsonb_agg(jsonb_build_object('product_id', x->>'product_id', 'quantity', (x->>'quantity')::int)) FROM jsonb_array_elements(_items) AS x)
    );
  END IF;

  RETURN jsonb_build_object('id', rt_id, 'return_number', rn, 'total_refund', v_total, 'status', v_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_sale_return_full(uuid, text, text, text, text, text, text, numeric, numeric, numeric, jsonb) TO authenticated, service_role;