CREATE OR REPLACE FUNCTION public.edit_invoice(
  _invoice_id uuid,
  _customer_id uuid,
  _items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  inv record;
  uid uuid := auth.uid();
  is_adm boolean;
  is_bm boolean;
  it jsonb;
  v_old_qty int;
  v_new_qty int;
  v_pid uuid;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_disc_amount numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF inv.status <> 'active' THEN RAISE EXCEPTION 'لا يمكن تعديل فاتورة ملغاة'; END IF;

  SELECT has_role(uid, 'admin'::app_role) INTO is_adm;
  SELECT has_role(uid, 'branch_manager'::app_role) INTO is_bm;
  IF NOT (is_adm OR is_bm OR is_super_admin(uid)) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل الفاتورة — مدير الفرع أو الأدمن فقط';
  END IF;

  -- 1) Reverse old stock for items that will be removed or changed
  FOR v_pid, v_old_qty IN
    SELECT product_id, quantity FROM public.invoice_items WHERE invoice_id = _invoice_id
  LOOP
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity + v_old_qty WHERE id = v_pid;
    END IF;
  END LOOP;

  -- 2) Wipe old items
  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  -- 3) Re-insert new items and deduct stock
  FOR it IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_pid := NULLIF((it->>'product_id'), '')::uuid;
    v_new_qty := COALESCE((it->>'quantity')::int, 0);
    IF v_new_qty <= 0 THEN CONTINUE; END IF;

    INSERT INTO public.invoice_items(
      invoice_id, product_id, product_name, quantity,
      cost_price, selling_price, market_price, line_discount, total, tenant_id
    ) VALUES (
      _invoice_id,
      v_pid,
      it->>'product_name',
      v_new_qty,
      COALESCE((it->>'cost_price')::numeric, 0),
      COALESCE((it->>'selling_price')::numeric, 0),
      COALESCE((it->>'market_price')::numeric, 0),
      COALESCE((it->>'line_discount')::numeric, 0),
      (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0),
      inv.tenant_id
    );

    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity - v_new_qty WHERE id = v_pid;
    END IF;

    v_subtotal := v_subtotal + (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty);
    v_total := v_total + ((COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0));
  END LOOP;

  -- 4) Apply invoice-level discount (kept as-is)
  v_disc_amount := COALESCE(inv.discount_amount, 0);
  v_total := GREATEST(v_total - v_disc_amount, 0);

  -- 5) Update invoice header
  UPDATE public.invoices
     SET customer_id = _customer_id,
         subtotal = v_subtotal,
         total = v_total
   WHERE id = _invoice_id;

  -- 6) Sync treasury entry (the original "sale" income row referencing this invoice)
  UPDATE public.treasury
     SET amount = v_total,
         description = 'تعديل فاتورة ' || inv.invoice_number
   WHERE reference_id = _invoice_id AND type = 'income';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.edit_invoice(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.edit_invoice(uuid, uuid, jsonb) TO authenticated;