-- 0255 (owner 2026-11-18 «(أ) … نفذ»): a piece sold ahead of stock is re-costed by the next incoming batch
-- (`settle_stock_shortages_trg`): the sale line takes the batch cost and its COGS entry is re-posted on the SALE's day.
-- When that day is in a CLOSED period (`lock_distributed_period` / fiscal close) the re-post hit
-- «لا يمكن تعديل بنود قيود داخل فترة مغلقة» and the purchase could not be saved at all.
-- Now, for a sale in a closed period: the sale line and its entry stay as they were (the closed month does not change), and the
-- difference (taken × (batch cost − provisional cost)) is ONE entry on the incoming day (first open day if that is closed too),
-- source 'shortage_cost_adjust' / the shortage row, branch of the batch: more → Dr 5100 / Cr 1300, less → Dr 1300 / Cr 5100.
-- The shortage row is settled as before. Open periods: unchanged (line re-costed, entry on the sale day).

CREATE OR REPLACE FUNCTION public.settle_stock_shortages_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s record; v_avail numeric; v_take numeric; v_item record; v_new_unit numeric;
  v_diff numeric; v_day date; v_eid uuid;
BEGIN
  IF coalesce(NEW.quantity_remaining, 0) <= 0 THEN RETURN NEW; END IF;
  v_avail := NEW.quantity_remaining;
  FOR s IN SELECT * FROM public.stock_shortages
            WHERE product_id = NEW.product_id AND branch_id = NEW.branch_id AND status = 'open'
            ORDER BY created_at, id FOR UPDATE LOOP
    EXIT WHEN v_avail <= 0;
    v_take := least(v_avail, s.qty - s.qty_settled);
    CONTINUE WHEN v_take <= 0;
    v_avail := v_avail - v_take;

    UPDATE public.stock_shortages
       SET qty_settled = qty_settled + v_take,
           settled_cost = settled_cost + v_take * coalesce(NEW.cost_price, 0),
           status = CASE WHEN qty_settled + v_take >= qty - 0.0001 THEN 'settled' ELSE 'open' END,
           settled_at = CASE WHEN qty_settled + v_take >= qty - 0.0001 THEN now() ELSE settled_at END
     WHERE id = s.id;

    SELECT ii.id, ii.quantity, coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0) AS unit, ii.batches_consumed,
           i.tenant_id, i.invoice_number, (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date AS sale_day
      INTO v_item FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id
     WHERE ii.id = s.invoice_item_id FOR UPDATE OF ii;
    IF FOUND AND coalesce(v_item.quantity, 0) > 0 THEN
      IF public.ledger_effective_date(v_item.tenant_id, v_item.sale_day) <> v_item.sale_day THEN
        -- 0255: the sale's period is closed → the difference goes on the incoming day, the closed month stays as it is
        v_diff := round(v_take * (coalesce(NEW.cost_price, 0) - coalesce(s.provisional_unit_cost, 0)), 2);
        IF v_diff <> 0 THEN
          v_day := public.ledger_effective_date(v_item.tenant_id,
                     coalesce((NEW.effective_at AT TIME ZONE 'Africa/Cairo')::date, (now() AT TIME ZONE 'Africa/Cairo')::date));
          v_eid := public.post_journal(v_item.tenant_id, v_day,
            'فرق تكلفة قطعة اتباعت قبل ما تدخل المخزن — فاتورة ' || v_item.invoice_number || ' (فترتها مقفولة)',
            'shortage_cost_adjust', s.id,
            CASE WHEN v_diff > 0 THEN jsonb_build_array(
                   jsonb_build_object('account_code', '5100', 'debit', v_diff, 'credit', 0, 'description', 'فرق تكلفة — ' || v_item.invoice_number),
                   jsonb_build_object('account_code', '1300', 'debit', 0, 'credit', v_diff, 'description', 'فرق تكلفة — ' || v_item.invoice_number))
                 ELSE jsonb_build_array(
                   jsonb_build_object('account_code', '1300', 'debit', -v_diff, 'credit', 0, 'description', 'فرق تكلفة — ' || v_item.invoice_number),
                   jsonb_build_object('account_code', '5100', 'debit', 0, 'credit', -v_diff, 'description', 'فرق تكلفة — ' || v_item.invoice_number)) END);
          IF v_eid IS NOT NULL THEN UPDATE public.journal_entries SET branch_id = NEW.branch_id WHERE id = v_eid; END IF;
        END IF;
      ELSE
        v_new_unit := round(v_item.unit + v_take * (coalesce(NEW.cost_price, 0) - s.provisional_unit_cost) / v_item.quantity, 4);
        UPDATE public.invoice_items
           SET unit_cost_at_sale = v_new_unit,
               cost_price = v_new_unit,
               batches_consumed = coalesce(batches_consumed, '[]'::jsonb)
                 || jsonb_build_object('batch_id', NEW.id, 'qty_taken', v_take, 'cost_price', NEW.cost_price, 'settles_shortage', s.id)
         WHERE id = v_item.id;
      END IF;
    END IF;
  END LOOP;

  IF v_avail < NEW.quantity_remaining THEN
    UPDATE public.product_batches SET quantity_remaining = v_avail WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;
-- Dry-run 2026-11-18 (rolled back): October locked; sale A 25/10 + sale B 10/11 of خلاط 105 سكة at stock 0 (provisional 1,050); purchase 18/11 2 × 1,400 → A line stays 1,050, its entry stays 25/10, October profit 120,246.96 unchanged, adjustment entry 18/11 Dr 5100 350 (branch سكة); B line 1,400, entry on 10/11.
