-- 1) Guard: skip trigger side-effects when running inside stocktake approval
CREATE OR REPLACE FUNCTION public.apply_stock_adjustment_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_adj RECORD; v_diff numeric; v_qty numeric; v_cost numeric := 0; v_unit numeric := 0;
  v_res jsonb; v_inv uuid; v_shrink uuid; v_surplus uuid; v_date date;
BEGIN
  -- Guard clause: approve_inventory_session__impl already handles quantities,
  -- FIFO batches and the journal entry itself. Avoid double accounting.
  IF COALESCE(current_setting('app.stocktake_apply', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT sa.id, sa.branch_id, sa.tenant_id, sa.adjustment_number, sa.created_at::date AS d
    INTO v_adj FROM public.stock_adjustments sa WHERE sa.id = NEW.adjustment_id;

  v_diff := COALESCE(NEW.actual_quantity,0) - COALESCE(NEW.system_quantity,0);
  v_date := COALESCE(v_adj.d, CURRENT_DATE);

  IF v_diff < 0 THEN
    v_qty := -v_diff;
    v_res := public.consume_product_batches_json(NEW.product_id, v_adj.branch_id, v_qty);
    v_unit := COALESCE((v_res->>'weighted_unit_cost')::numeric, 0);
    IF v_unit <= 0 THEN
      SELECT COALESCE(cost_price,0) INTO v_unit FROM public.products WHERE id = NEW.product_id;
    END IF;
    v_cost := ROUND(v_unit * v_qty, 2);
  ELSIF v_diff > 0 THEN
    SELECT COALESCE(NULLIF(NEW.unit_cost,0), p.cost_price, 0) INTO v_unit
      FROM public.products p WHERE p.id = NEW.product_id;
    v_unit := COALESCE(v_unit, 0);
    v_cost := ROUND(v_unit * v_diff, 2);
    INSERT INTO public.product_batches(tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
                                       cost_price, base_purchase_price, true_unit_cost, batch_type)
    VALUES (v_adj.tenant_id, v_adj.branch_id, NEW.product_id, v_diff, v_diff, v_unit, v_unit, v_unit, 'adjustment');
  END IF;

  UPDATE public.products SET quantity = NEW.actual_quantity WHERE id = NEW.product_id;

  IF v_adj.tenant_id IS NOT NULL AND v_cost > 0 THEN
    v_inv := public.ensure_account(v_adj.tenant_id, '1300', 'Inventory', 'asset');
    IF v_diff < 0 THEN
      v_shrink := public.ensure_account(v_adj.tenant_id, '5600', 'Inventory Shrinkage', 'expense');
      PERFORM public.post_journal_lines(v_adj.tenant_id, v_date,
        'عجز جرد - ' || COALESCE(v_adj.adjustment_number,'') || ' - ' || COALESCE(NEW.product_name,''),
        'stock_adjustment', v_adj.id,
        jsonb_build_array(
          jsonb_build_object('account_id', v_shrink, 'debit', v_cost, 'credit', 0, 'description','خسائر جرد'),
          jsonb_build_object('account_id', v_inv,    'debit', 0, 'credit', v_cost, 'description','تخفيض المخزون')
        ), v_adj.branch_id);
    ELSE
      v_surplus := public.ensure_account(v_adj.tenant_id, '4300', 'Inventory Count Surplus', 'revenue');
      PERFORM public.post_journal_lines(v_adj.tenant_id, v_date,
        'فائض جرد - ' || COALESCE(v_adj.adjustment_number,'') || ' - ' || COALESCE(NEW.product_name,''),
        'stock_adjustment', v_adj.id,
        jsonb_build_array(
          jsonb_build_object('account_id', v_inv,     'debit', v_cost, 'credit', 0, 'description','زيادة المخزون'),
          jsonb_build_object('account_id', v_surplus, 'debit', 0, 'credit', v_cost, 'description','فائض جرد')
        ), v_adj.branch_id);
    END IF;
  END IF;

  RETURN NEW;
END $function$;

-- 2) Set the flag inside stocktake approval (transaction-local)
CREATE OR REPLACE FUNCTION public.approve_inventory_session__impl(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sess record; v_adj_id uuid; v_num text; r record; b record;
  v_reserved numeric; v_cur integer; v_delta integer; v_new_qty integer;
  v_excess numeric; v_cost numeric; v_take numeric; v_remaining numeric;
  v_moved boolean; v_mgr record; v_batch_id uuid;
  v_short_val numeric := 0; v_sur_val numeric := 0;
  v_entry_id uuid; v_acc_short uuid; v_acc_sur uuid; v_acc_inv uuid;
BEGIN
  SELECT * INTO v_sess FROM public.inventory_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_sess IS NULL THEN RAISE EXCEPTION 'session not found'; END IF;
  IF v_sess.status NOT IN ('pending_approval','reviewing') THEN
    RAISE EXCEPTION 'session not in approvable state';
  END IF;

  -- transaction-local guard so trg_apply_sa_item does not duplicate our work
  PERFORM set_config('app.stocktake_apply', 'on', true);

  v_num := 'JRD-' || to_char(now(),'YYYYMMDDHH24MISS');

  INSERT INTO public.stock_adjustments (branch_id, adjustment_number, reason, notes, created_by, tenant_id)
  VALUES (v_sess.branch_id, v_num, 'جرد مخزن', COALESCE(v_sess.notes,''), auth.uid(), v_sess.tenant_id)
  RETURNING id INTO v_adj_id;

  FOR r IN
    SELECT * FROM public.inventory_session_items
    WHERE session_id = p_session_id AND actual_quantity IS NOT NULL AND difference <> 0
  LOOP
    SELECT COALESCE(quantity,0), COALESCE(cost_price,0)
      INTO v_cur, v_cost FROM public.products WHERE id = r.product_id FOR UPDATE;
    IF v_cur IS NULL THEN CONTINUE; END IF;

    v_delta   := (r.actual_quantity::int - r.system_quantity::int);
    v_new_qty := GREATEST(v_cur + v_delta, 0);
    v_delta   := v_new_qty - v_cur;
    v_moved   := (v_cur <> r.system_quantity::int);

    UPDATE public.products SET quantity = v_new_qty WHERE id = r.product_id;

    IF v_delta > 0 THEN
      INSERT INTO public.product_batches(
        tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
        cost_price, base_purchase_price, true_unit_cost, batch_type)
      VALUES (v_sess.tenant_id, v_sess.branch_id, r.product_id, v_delta, v_delta,
              v_cost, v_cost, v_cost, 'adjustment')
      RETURNING id INTO v_batch_id;
      INSERT INTO public.inventory_count_batch_moves(tenant_id, session_id, product_id, batch_id, delta, created_batch)
      VALUES (v_sess.tenant_id, p_session_id, r.product_id, v_batch_id, v_delta, true);
      v_sur_val := v_sur_val + (v_delta * COALESCE(v_cost,0));
    ELSIF v_delta < 0 THEN
      v_remaining := -v_delta;
      FOR b IN SELECT id, quantity_remaining FROM public.product_batches
               WHERE product_id = r.product_id AND branch_id = v_sess.branch_id
                 AND quantity_remaining > 0
               ORDER BY created_at ASC FOR UPDATE LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(b.quantity_remaining, v_remaining);
        UPDATE public.product_batches
           SET quantity_remaining = quantity_remaining - v_take WHERE id = b.id;
        INSERT INTO public.inventory_count_batch_moves(tenant_id, session_id, product_id, batch_id, delta, created_batch)
        VALUES (v_sess.tenant_id, p_session_id, r.product_id, b.id, -v_take, false);
        v_remaining := v_remaining - v_take;
      END LOOP;
      v_short_val := v_short_val + ((-v_delta) * COALESCE(v_cost,0));
    END IF;

    INSERT INTO public.stock_adjustment_items
      (adjustment_id, product_id, product_name, system_quantity, actual_quantity, difference, unit_cost)
    VALUES (v_adj_id, r.product_id, r.product_name, v_cur, v_new_qty, v_delta, v_cost);

    INSERT INTO public.inventory_adjustments (session_id, product_id, adjustment_amount, reason, created_by)
    VALUES (p_session_id, r.product_id, v_delta,
            COALESCE(r.reason,'') ||
            CASE WHEN v_moved
                 THEN ' [حركة مخزون أثناء الجرد: النظام وقت البدء ' || r.system_quantity::text ||
                      ' → وقت الاعتماد ' || v_cur::text || '، الفرق المطبق ' || v_delta::text || ']'
                 ELSE '' END,
            auth.uid());

    IF v_moved THEN
      FOR v_mgr IN SELECT DISTINCT bu.user_id FROM public.branch_users bu WHERE bu.branch_id = v_sess.branch_id LOOP
        INSERT INTO public.notifications
          (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
        VALUES (v_sess.tenant_id, v_mgr.user_id, '⚠️ حركة مخزون أثناء الجرد',
          'المنتج ' || r.product_name || ' اتباع/اتشترى منه أثناء الجرد. النظام طبّق فرق الجرد (' ||
          v_delta::text || ') على الرصيد الحالي بدل ما يكتب الرقم المعدود كما هو.',
          'general', '/branch/' || v_sess.branch_id::text || '/inventory',
          'inventory_session', p_session_id);
      END LOOP;
    END IF;

    SELECT COALESCE(SUM(reserved_quantity), 0) INTO v_reserved
      FROM public.inventory_reservations
     WHERE product_id = r.product_id AND branch_id = v_sess.branch_id
       AND status = 'active' AND (expires_at IS NULL OR expires_at > now());

    IF v_reserved > v_new_qty THEN
      v_excess := v_reserved - v_new_qty;
      FOR v_mgr IN SELECT DISTINCT bu.user_id FROM public.branch_users bu WHERE bu.branch_id = v_sess.branch_id LOOP
        INSERT INTO public.notifications
          (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
        VALUES (v_sess.tenant_id, v_mgr.user_id, '⚠️ تحذير: حجوزات تتجاوز المخزون بعد الجرد',
          'يوجد ' || v_excess::text || ' وحدة محجوزة تتجاوز المخزون الجديد بعد الجرد للمنتج ' || r.product_name,
          'general', '/branch/' || v_sess.branch_id::text || '/inventory',
          'inventory_session', p_session_id);
      END LOOP;
    END IF;
  END LOOP;

  -- ===== accounting entry for the variance =====
  IF v_sess.tenant_id IS NOT NULL AND (ROUND(v_short_val,2) > 0 OR ROUND(v_sur_val,2) > 0) THEN
    PERFORM public.ensure_count_variance_accounts(v_sess.tenant_id);
    SELECT id INTO v_acc_short FROM public.chart_of_accounts WHERE tenant_id=v_sess.tenant_id AND code='5600';
    SELECT id INTO v_acc_sur   FROM public.chart_of_accounts WHERE tenant_id=v_sess.tenant_id AND code='4300';
    SELECT id INTO v_acc_inv   FROM public.chart_of_accounts WHERE tenant_id=v_sess.tenant_id AND code='1300';

    IF v_acc_inv IS NOT NULL AND v_acc_short IS NOT NULL AND v_acc_sur IS NOT NULL THEN
      INSERT INTO public.journal_entries(tenant_id, branch_id, entry_number, entry_date, description,
        source_type, source_id, status, total_debit, total_credit)
      VALUES (v_sess.tenant_id, v_sess.branch_id, v_num, CURRENT_DATE,
        'فروقات جرد مخزون — ' || v_num, 'inventory_session', p_session_id, 'posted',
        ROUND(v_short_val,2) + ROUND(v_sur_val,2), ROUND(v_short_val,2) + ROUND(v_sur_val,2))
      RETURNING id INTO v_entry_id;

      IF ROUND(v_short_val,2) > 0 THEN
        INSERT INTO public.journal_entry_lines(tenant_id, entry_id, account_id, debit, credit, description, line_order)
        VALUES (v_sess.tenant_id, v_entry_id, v_acc_short, ROUND(v_short_val,2), 0, 'عجز جرد', 1),
               (v_sess.tenant_id, v_entry_id, v_acc_inv, 0, ROUND(v_short_val,2), 'تخفيض المخزون — عجز جرد', 2);
      END IF;
      IF ROUND(v_sur_val,2) > 0 THEN
        INSERT INTO public.journal_entry_lines(tenant_id, entry_id, account_id, debit, credit, description, line_order)
        VALUES (v_sess.tenant_id, v_entry_id, v_acc_inv, ROUND(v_sur_val,2), 0, 'زيادة المخزون — فروقات جرد', 3),
               (v_sess.tenant_id, v_entry_id, v_acc_sur, 0, ROUND(v_sur_val,2), 'إيراد فروقات جرد', 4);
      END IF;
    END IF;
  END IF;

  UPDATE public.inventory_sessions
  SET status='closed', approved_by=auth.uid(), approved_at=now(), closed_at=now()
  WHERE id = p_session_id;

  PERFORM set_config('app.stocktake_apply', 'off', true);
END $function$;

-- 3) Drop dead orphaned function
DROP FUNCTION IF EXISTS public.apply_shipment_item();