
-- 1) INVENTORY COUNT: apply delta, sync batches, record cost
CREATE OR REPLACE FUNCTION public.approve_inventory_session__impl(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sess record;
  v_adj_id uuid;
  v_num text;
  r record;
  b record;
  v_reserved numeric;
  v_cur integer;
  v_delta integer;
  v_new_qty integer;
  v_excess numeric;
  v_cost numeric;
  v_take numeric;
  v_remaining numeric;
  v_moved boolean;
  v_mgr record;
BEGIN
  SELECT * INTO v_sess FROM public.inventory_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_sess IS NULL THEN RAISE EXCEPTION 'session not found'; END IF;
  IF v_sess.status NOT IN ('pending_approval','reviewing') THEN
    RAISE EXCEPTION 'session not in approvable state';
  END IF;

  v_num := 'JRD-' || to_char(now(),'YYYYMMDDHH24MISS');

  INSERT INTO public.stock_adjustments (branch_id, adjustment_number, reason, notes, created_by, tenant_id)
  VALUES (v_sess.branch_id, v_num, 'جرد مخزن', COALESCE(v_sess.notes,''), auth.uid(), v_sess.tenant_id)
  RETURNING id INTO v_adj_id;

  FOR r IN
    SELECT * FROM public.inventory_session_items
    WHERE session_id = p_session_id AND actual_quantity IS NOT NULL AND difference <> 0
  LOOP
    -- lock product and read the LIVE quantity (may differ from the snapshot)
    SELECT COALESCE(quantity,0), COALESCE(cost_price,0)
      INTO v_cur, v_cost
      FROM public.products WHERE id = r.product_id FOR UPDATE;
    IF v_cur IS NULL THEN CONTINUE; END IF;

    v_delta   := (r.actual_quantity::int - r.system_quantity::int);
    v_new_qty := GREATEST(v_cur + v_delta, 0);
    v_delta   := v_new_qty - v_cur;                 -- effective applied delta
    v_moved   := (v_cur <> r.system_quantity::int); -- stock moved during the count

    UPDATE public.products SET quantity = v_new_qty WHERE id = r.product_id;

    -- keep FIFO batches in sync with the new quantity
    IF v_delta > 0 THEN
      INSERT INTO public.product_batches(
        tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
        cost_price, base_purchase_price, true_unit_cost, batch_type)
      VALUES (v_sess.tenant_id, v_sess.branch_id, r.product_id, v_delta, v_delta,
              v_cost, v_cost, v_cost, 'adjustment');
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
        v_remaining := v_remaining - v_take;
      END LOOP;
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

    -- notify managers when stock moved during the count
    IF v_moved THEN
      FOR v_mgr IN SELECT DISTINCT bu.user_id FROM public.branch_users bu WHERE bu.branch_id = v_sess.branch_id LOOP
        INSERT INTO public.notifications
          (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
        VALUES (v_sess.tenant_id, v_mgr.user_id,
          '⚠️ حركة مخزون أثناء الجرد',
          'المنتج ' || r.product_name || ' اتباع/اتشترى منه أثناء الجرد. النظام طبّق فرق الجرد (' ||
          v_delta::text || ') على الرصيد الحالي بدل ما يكتب الرقم المعدود كما هو.',
          'general', '/branch/' || v_sess.branch_id::text || '/inventory',
          'inventory_session', p_session_id);
      END LOOP;
    END IF;

    -- reservation overflow check
    SELECT COALESCE(SUM(reserved_quantity), 0) INTO v_reserved
      FROM public.inventory_reservations
     WHERE product_id = r.product_id AND branch_id = v_sess.branch_id
       AND status = 'active' AND (expires_at IS NULL OR expires_at > now());

    IF v_reserved > v_new_qty THEN
      v_excess := v_reserved - v_new_qty;
      FOR v_mgr IN SELECT DISTINCT bu.user_id FROM public.branch_users bu WHERE bu.branch_id = v_sess.branch_id LOOP
        INSERT INTO public.notifications
          (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
        VALUES (v_sess.tenant_id, v_mgr.user_id,
          '⚠️ تحذير: حجوزات تتجاوز المخزون بعد الجرد',
          'يوجد ' || v_excess::text || ' وحدة محجوزة تتجاوز المخزون الجديد بعد الجرد للمنتج ' || r.product_name,
          'general', '/branch/' || v_sess.branch_id::text || '/inventory',
          'inventory_session', p_session_id);
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.inventory_sessions
  SET status='closed', approved_by=auth.uid(), approved_at=now(), closed_at=now()
  WHERE id = p_session_id;
END $function$;

-- 2) ATTENDANCE guards
CREATE OR REPLACE FUNCTION public.guard_attendance_times()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_privileged boolean;
BEGIN
  v_privileged := public.is_super_admin(auth.uid())
               OR public.is_admin(auth.uid())
               OR public.has_role(auth.uid(),'owner')
               OR public.has_role(auth.uid(),'supervisor');

  IF NEW.check_out IS NOT NULL AND NEW.check_in IS NULL THEN
    RAISE EXCEPTION 'مينفعش تسجل انصراف من غير ما تسجل حضور الأول';
  END IF;

  IF NEW.check_in IS NOT NULL AND NEW.check_out IS NOT NULL
     AND NEW.check_out <= NEW.check_in THEN
    RAISE EXCEPTION 'وقت الانصراف لازم يكون بعد وقت الحضور';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.check_in IS NOT NULL
     AND NEW.check_in IS DISTINCT FROM OLD.check_in
     AND NOT v_privileged THEN
    RAISE EXCEPTION 'الحضور اتسجل قبل كده — تعديل وقت الحضور للمدير أو المالك بس';
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_attendance_guard ON public.attendance;
CREATE TRIGGER trg_attendance_guard
BEFORE INSERT OR UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_times();

-- 3) SHIFT: per payment-method breakdown
CREATE OR REPLACE FUNCTION public.shift_payment_breakdown(p_shift_id uuid)
RETURNS TABLE(payment_method text, total numeric, payments_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT branch_id, cashier_id, opened_at, COALESCE(closed_at, now()) AS closed_at
    FROM public.cashier_shifts WHERE id = p_shift_id
  )
  SELECT ip.payment_method, SUM(ip.amount)::numeric, COUNT(*)::int
  FROM public.invoice_payments ip
  JOIN public.invoices inv ON inv.id = ip.invoice_id
  JOIN s ON true
  WHERE inv.branch_id = s.branch_id
    AND inv.cashier_id = s.cashier_id
    AND ip.voided_at IS NULL
    AND ip.created_at >= s.opened_at
    AND ip.created_at <  s.closed_at
  GROUP BY ip.payment_method
  ORDER BY 2 DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.shift_payment_breakdown(uuid) TO authenticated;

-- 4) shift history: expose who closed it
CREATE OR REPLACE VIEW public.v_shifts_history AS
SELECT s.id, s.tenant_id, s.branch_id, s.cashier_id, s.opened_at, s.closed_at,
       s.opening_cash, s.closing_cash, s.expected_cash, s.cash_sales, s.variance,
       s.status, s.open_notes, s.close_notes, s.closed_by, s.created_at, s.updated_at,
       s.reminder_sent_at, s.pre_close_warned_at,
       b.name AS branch_name,
       p.name AS cashier_name,
       pc.name AS closed_by_name
FROM public.cashier_shifts s
LEFT JOIN public.branches b ON b.id = s.branch_id
LEFT JOIN public.profiles p ON p.id = s.cashier_id
LEFT JOIN public.profiles pc ON pc.id = s.closed_by;
