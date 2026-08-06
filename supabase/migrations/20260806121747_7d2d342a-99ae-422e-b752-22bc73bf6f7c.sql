CREATE OR REPLACE FUNCTION public.apply_return_batch_tracking(_invoice_id uuid, _items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inv record;
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  ii record;
  remaining numeric;
  take numeric;
  ratio numeric;
  bc jsonb;
  v_bid uuid;
  v_bqty numeric;
  v_bcost numeric;
  v_exists boolean;
  new_bid uuid;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_pid := NULLIF(it->>'product_id','')::uuid;
    v_qty := COALESCE((it->>'quantity')::numeric, 0);
    IF v_pid IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    remaining := v_qty;

    FOR ii IN
      SELECT *
      FROM public.invoice_items
      WHERE invoice_id = _invoice_id
        AND product_id = v_pid
        AND COALESCE(returned_quantity, 0) < quantity
      ORDER BY id ASC
    LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(ii.quantity - COALESCE(ii.returned_quantity, 0), remaining);
      IF take <= 0 THEN CONTINUE; END IF;

      IF ii.batches_consumed IS NOT NULL AND jsonb_array_length(ii.batches_consumed) > 0 AND ii.quantity > 0 THEN
        ratio := take / ii.quantity;
        FOR bc IN
          SELECT value FROM jsonb_array_elements(ii.batches_consumed) WITH ORDINALITY arr(value, ord) ORDER BY ord DESC
        LOOP
          v_bid := NULLIF(bc->>'batch_id','')::uuid;
          v_bqty := ROUND((COALESCE((bc->>'qty_taken')::numeric, 0) * ratio)::numeric, 4);
          v_bcost := COALESCE((bc->>'cost_price')::numeric, COALESCE(ii.original_unit_cost, ii.unit_cost_at_sale, ii.cost_price, 0));
          IF v_bqty <= 0 THEN CONTINUE; END IF;

          SELECT EXISTS(SELECT 1 FROM public.product_batches WHERE id = v_bid) INTO v_exists;
          IF v_exists THEN
            UPDATE public.product_batches
            SET quantity_remaining = quantity_remaining + v_bqty,
                restore_count = restore_count + 1,
                last_restored_at = now()
            WHERE id = v_bid;
          ELSE
            INSERT INTO public.product_batches(
              tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
              cost_price, base_purchase_price, true_unit_cost,
              batch_type, restore_count, last_restored_at
            ) VALUES (
              inv.tenant_id, inv.branch_id, ii.product_id, v_bqty, v_bqty,
              v_bcost, v_bcost, v_bcost, 'return_restored', 1, now()
            ) RETURNING id INTO new_bid;
          END IF;
        END LOOP;
      ELSE
        -- No stored batch detail (legacy / migrated / older invoices):
        -- create a restored batch so product_batches stays in sync with products.quantity.
        v_bcost := COALESCE(NULLIF(ii.original_unit_cost,0), NULLIF(ii.unit_cost_at_sale,0), NULLIF(ii.cost_price,0),
                            (SELECT NULLIF(p.cost_price,0) FROM public.products p WHERE p.id = ii.product_id), 0);
        INSERT INTO public.product_batches(
          tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
          cost_price, base_purchase_price, true_unit_cost,
          batch_type, restore_count, last_restored_at
        ) VALUES (
          inv.tenant_id, inv.branch_id, ii.product_id, take, take,
          v_bcost, v_bcost, v_bcost, 'return_restored', 1, now()
        );
      END IF;

      UPDATE public.invoice_items
      SET returned_quantity = LEAST(quantity, COALESCE(returned_quantity, 0) + take),
          fully_returned = (LEAST(quantity, COALESCE(returned_quantity, 0) + take) >= quantity)
      WHERE id = ii.id;

      remaining := remaining - take;
    END LOOP;

    IF remaining > 0 THEN
      RAISE EXCEPTION 'كمية المرتجع أكبر من المتاح للإرجاع';
    END IF;

    UPDATE public.inventory_reservations
    SET status = 'released'
    WHERE product_id = v_pid
      AND branch_id = inv.branch_id
      AND status = 'active';
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_sale_return_journal(p_return_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_existing uuid;
  v_cash numeric(18,2);
  v_balance numeric(18,2);
  v_lines jsonb;
BEGIN
  SELECT id, tenant_id, return_number, status, total_refund, invoice_date, created_at,
         COALESCE(refund_cash_amount,0) AS cash_amt,
         COALESCE(refund_transfer_amount,0) AS transfer_amt,
         COALESCE(refund_balance_amount,0) AS balance_amt
    INTO r FROM public.returns WHERE id = p_return_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_existing FROM public.journal_entries
   WHERE source_type = 'sale_return' AND source_id = r.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    DELETE FROM public.journal_entries WHERE id = v_existing;
  END IF;

  IF r.status IS DISTINCT FROM 'active' OR COALESCE(r.total_refund,0) <= 0 THEN RETURN; END IF;

  v_cash := r.cash_amt + r.transfer_amt;
  v_balance := r.balance_amt;
  IF v_cash + v_balance <> r.total_refund THEN
    v_cash := 0;
    v_balance := r.total_refund;
  END IF;

  -- Revenue side only. Inventory / COGS are already netted by the invoice COGS engine.
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','4100','debit',r.total_refund,'credit',0,'description','مرتجع مبيعات '||r.return_number)
  );
  IF v_cash > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1100','debit',0,'credit',v_cash,'description','مرتجع مبيعات '||r.return_number||' — نقدي'));
  END IF;
  IF v_balance > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1200','debit',0,'credit',v_balance,'description','مرتجع مبيعات '||r.return_number||' — رصيد العميل'));
  END IF;

  PERFORM public.post_journal(
    r.tenant_id,
    COALESCE(r.invoice_date, r.created_at)::date,
    'مرتجع مبيعات '||r.return_number,
    'sale_return',
    r.id,
    v_lines
  );
END $$;