-- =============== 1) Variance accounts ===============
CREATE OR REPLACE FUNCTION public.ensure_count_variance_accounts(p_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_exp_parent uuid; v_rev_parent uuid;
BEGIN
  SELECT id INTO v_exp_parent FROM public.chart_of_accounts WHERE tenant_id=p_tenant AND code='5000' LIMIT 1;
  SELECT id INTO v_rev_parent FROM public.chart_of_accounts WHERE tenant_id=p_tenant AND code='4000' LIMIT 1;

  INSERT INTO public.chart_of_accounts(tenant_id, code, name, name_ar, account_type, normal_balance, parent_id, is_system)
  SELECT p_tenant, '5600', 'Inventory Shrinkage', 'عجز/تالف مخزون', 'expense', 'debit', v_exp_parent, true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE tenant_id=p_tenant AND code='5600');

  INSERT INTO public.chart_of_accounts(tenant_id, code, name, name_ar, account_type, normal_balance, parent_id, is_system)
  SELECT p_tenant, '4300', 'Inventory Count Surplus', 'فروقات جرد (زيادة مخزون)', 'revenue', 'credit', v_rev_parent, true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE tenant_id=p_tenant AND code='4300');
END $$;

DO $$
DECLARE t uuid;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM public.chart_of_accounts LOOP
    PERFORM public.ensure_count_variance_accounts(t);
  END LOOP;
END $$;

-- =============== 2) Batch move ledger for counts ===============
CREATE TABLE IF NOT EXISTS public.inventory_count_batch_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  session_id uuid NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  delta numeric NOT NULL,
  created_batch boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_icbm_session ON public.inventory_count_batch_moves(session_id);

GRANT SELECT ON public.inventory_count_batch_moves TO authenticated;
GRANT ALL ON public.inventory_count_batch_moves TO service_role;
ALTER TABLE public.inventory_count_batch_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "icbm_read" ON public.inventory_count_batch_moves;
CREATE POLICY "icbm_read" ON public.inventory_count_batch_moves FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id());

-- =============== 3) Approve with journal entry ===============
CREATE OR REPLACE FUNCTION public.approve_inventory_session__impl(p_session_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
END $function$;

-- =============== 4) Cancel approved count (Owner only) ===============
CREATE OR REPLACE FUNCTION public.cancel_inventory_session(p_session_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sess record; v_is_owner boolean; m record; a record;
  v_block text; v_total numeric := 0; v_qty numeric := 0;
  v_entry record; v_lines jsonb; v_new_id uuid; v_num text;
  v_uname text;
BEGIN
  SELECT s.*, t.owner_user_id INTO v_sess
    FROM public.inventory_sessions s
    LEFT JOIN public.tenants t ON t.id = s.tenant_id
   WHERE s.id = p_session_id FOR UPDATE;
  IF v_sess IS NULL THEN RAISE EXCEPTION 'الجرد غير موجود'; END IF;

  v_is_owner := (auth.uid() IS NOT NULL AND auth.uid() = v_sess.owner_user_id)
                OR public.has_role(auth.uid(),'owner');
  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'إلغاء الجرد مسموح لصاحب الشركة (Owner) بس';
  END IF;
  IF v_sess.tenant_id IS DISTINCT FROM public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مسموح';
  END IF;
  IF v_sess.status <> 'closed' OR v_sess.approved_at IS NULL THEN
    RAISE EXCEPTION 'الجرد ده مش معتمد أصلاً';
  END IF;

  -- guard: any stock movement on affected products after approval
  SELECT string_agg(x.txt, E'\n') INTO v_block FROM (
    SELECT 'فاتورة بيع ' || i.invoice_number || ' بتاريخ ' || to_char(i.created_at,'YYYY-MM-DD HH24:MI') || ' — ' || ii.product_name AS txt
      FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id
     WHERE i.branch_id = v_sess.branch_id AND i.created_at > v_sess.approved_at
       AND ii.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    UNION ALL
    SELECT 'مرتجع بيع ' || COALESCE(rt.return_number,'') || ' بتاريخ ' || to_char(rt.created_at,'YYYY-MM-DD HH24:MI') || ' — ' || ri.product_name
      FROM public.return_items ri JOIN public.returns rt ON rt.id = ri.return_id
     WHERE rt.branch_id = v_sess.branch_id AND rt.created_at > v_sess.approved_at
       AND ri.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    UNION ALL
    SELECT 'شحنة شراء بتاريخ ' || to_char(sh.created_at,'YYYY-MM-DD HH24:MI') || ' — ' || COALESCE(si.product_name,'')
      FROM public.shipment_items si JOIN public.shipments sh ON sh.id = si.shipment_id
     WHERE sh.branch_id = v_sess.branch_id AND sh.created_at > v_sess.approved_at
       AND si.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    UNION ALL
    SELECT 'مرتجع شراء ' || COALESCE(pr.return_number,'') || ' بتاريخ ' || to_char(pr.created_at,'YYYY-MM-DD HH24:MI') || ' — ' || pri.product_name
      FROM public.purchase_return_items pri JOIN public.purchase_returns pr ON pr.id = pri.purchase_return_id
     WHERE pr.branch_id = v_sess.branch_id AND pr.created_at > v_sess.approved_at
       AND pri.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    UNION ALL
    SELECT 'تحويل مخزون بتاريخ ' || to_char(st.created_at,'YYYY-MM-DD HH24:MI')
      FROM public.stock_transfers st
     WHERE (st.from_branch_id = v_sess.branch_id OR st.to_branch_id = v_sess.branch_id)
       AND st.created_at > v_sess.approved_at
       AND st.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    UNION ALL
    SELECT 'تسوية مخزون ' || sa.adjustment_number || ' بتاريخ ' || to_char(sa.created_at,'YYYY-MM-DD HH24:MI') || ' — ' || sai.product_name
      FROM public.stock_adjustment_items sai JOIN public.stock_adjustments sa ON sa.id = sai.adjustment_id
     WHERE sa.branch_id = v_sess.branch_id AND sa.created_at > v_sess.approved_at
       AND sai.product_id IN (SELECT product_id FROM public.inventory_adjustments WHERE session_id = p_session_id)
    LIMIT 10
  ) x;

  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION 'مينفعش تلغي الجرد — حصلت حركة على نفس المنتجات بعد الاعتماد:%', E'\n' || v_block;
  END IF;

  -- revert quantities
  FOR a IN SELECT product_id, adjustment_amount FROM public.inventory_adjustments WHERE session_id = p_session_id LOOP
    UPDATE public.products SET quantity = GREATEST(COALESCE(quantity,0) - a.adjustment_amount, 0)
     WHERE id = a.product_id;
    v_qty := v_qty + ABS(a.adjustment_amount);
  END LOOP;

  -- revert batches
  FOR m IN SELECT * FROM public.inventory_count_batch_moves WHERE session_id = p_session_id ORDER BY created_at DESC LOOP
    IF m.created_batch THEN
      DELETE FROM public.product_batches WHERE id = m.batch_id;
    ELSE
      UPDATE public.product_batches
         SET quantity_remaining = quantity_remaining - m.delta
       WHERE id = m.batch_id;
    END IF;
  END LOOP;
  DELETE FROM public.inventory_count_batch_moves WHERE session_id = p_session_id;

  -- reverse the journal entry
  FOR v_entry IN SELECT * FROM public.journal_entries
                  WHERE tenant_id = v_sess.tenant_id AND source_type = 'inventory_session'
                    AND source_id = p_session_id AND status = 'posted' AND reversed_by IS NULL LOOP
    v_num := 'JRDX-' || to_char(now(),'YYYYMMDDHH24MISS');
    INSERT INTO public.journal_entries(tenant_id, branch_id, entry_number, entry_date, description,
      source_type, source_id, status, total_debit, total_credit)
    VALUES (v_sess.tenant_id, v_entry.branch_id, v_num, CURRENT_DATE,
      'عكس قيد فروقات جرد — ' || v_entry.entry_number, 'inventory_session_reversal', p_session_id,
      'posted', v_entry.total_debit, v_entry.total_credit)
    RETURNING id INTO v_new_id;

    INSERT INTO public.journal_entry_lines(tenant_id, entry_id, account_id, debit, credit, description, line_order)
    SELECT v_sess.tenant_id, v_new_id, l.account_id, l.credit, l.debit,
           'عكس: ' || COALESCE(l.description,''), l.line_order
      FROM public.journal_entry_lines l WHERE l.entry_id = v_entry.id;

    v_total := v_total + COALESCE(v_entry.total_debit,0);
    UPDATE public.journal_entries SET status='reversed', reversed_by = v_new_id WHERE id = v_entry.id;
  END LOOP;

  UPDATE public.inventory_sessions
     SET status = 'cancelled',
         notes = COALESCE(notes,'') || E'\n[ألغي بعد الاعتماد] ' || COALESCE(p_reason,'')
   WHERE id = p_session_id;

  SELECT COALESCE(full_name, 'مستخدم') INTO v_uname FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
  VALUES (auth.uid(), COALESCE(v_uname,'مستخدم'), v_sess.branch_id, 'cancel', 'inventory_session',
          p_session_id::text,
          jsonb_build_object('reason', p_reason, 'reverted_qty', v_qty, 'reverted_value', v_total,
                             'approved_at', v_sess.approved_at),
          v_sess.tenant_id);

  RETURN jsonb_build_object('reverted_qty', v_qty, 'reverted_value', v_total);
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_inventory_session(uuid, text) TO authenticated;

-- =============== 5) Shift <-> attendance ===============
CREATE OR REPLACE FUNCTION public.open_cashier_shift(p_branch_id uuid, p_opening_cash numeric, p_notes text DEFAULT NULL::text, p_auto_attendance boolean DEFAULT false)
 RETURNS cashier_shifts LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID; v_row public.cashier_shifts; v_emp record; v_att record;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'الفرع غير موجود'; END IF;
  IF v_tenant <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مسموح: الفرع خارج شركتك';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cashier_shifts
    WHERE branch_id = p_branch_id AND cashier_id = auth.uid() AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'لديك وردية مفتوحة بالفعل في هذا الفرع';
  END IF;

  SELECT id, name INTO v_emp FROM public.employees
   WHERE user_id = auth.uid() AND branch_id = p_branch_id AND is_active = true LIMIT 1;

  IF v_emp.id IS NOT NULL THEN
    SELECT * INTO v_att FROM public.attendance
     WHERE employee_id = v_emp.id AND date = CURRENT_DATE;

    IF v_att.id IS NULL OR v_att.check_in IS NULL THEN
      IF NOT p_auto_attendance THEN
        RAISE EXCEPTION 'لازم تسجل حضورك الأول قبل ما تفتح الوردية'
          USING ERRCODE = 'check_violation', HINT = 'NO_ATTENDANCE';
      END IF;
      IF v_att.id IS NULL THEN
        INSERT INTO public.attendance (tenant_id, branch_id, employee_id, employee_name, date, check_in, status, created_by, notes)
        VALUES (v_tenant, p_branch_id, v_emp.id, v_emp.name, CURRENT_DATE, now(), 'present', auth.uid(), 'حضور تلقائي مع فتح الوردية');
      ELSE
        UPDATE public.attendance SET check_in = now(),
               status = CASE WHEN status = 'absent' THEN 'present' ELSE status END,
               notes = COALESCE(notes,'') || ' | حضور تلقائي مع فتح الوردية'
         WHERE id = v_att.id;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.cashier_shifts (tenant_id, branch_id, cashier_id, opening_cash, open_notes)
  VALUES (v_tenant, p_branch_id, auth.uid(), COALESCE(p_opening_cash,0), p_notes)
  RETURNING * INTO v_row;

  RETURN v_row;
END $function$;

CREATE OR REPLACE FUNCTION public.close_cashier_shift(p_shift_id uuid, p_closing_cash numeric, p_notes text DEFAULT NULL::text, p_auto boolean DEFAULT false, p_auto_checkout boolean DEFAULT true)
 RETURNS cashier_shifts LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.cashier_shifts; v_cash NUMERIC; v_move NUMERIC; v_expected NUMERIC;
  v_is_system BOOLEAN := (p_auto AND COALESCE(auth.role(), '') = 'service_role');
  v_emp_id uuid;
BEGIN
  SELECT * INTO v_row FROM public.cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية غير موجودة'; END IF;
  IF v_row.status <> 'open' THEN RAISE EXCEPTION 'الوردية مغلقة بالفعل'; END IF;
  IF NOT v_is_system AND v_row.tenant_id <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مسموح';
  END IF;
  IF NOT v_is_system
     AND v_row.cashier_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'مسموح فقط لصاحب الوردية أو الأدمن';
  END IF;

  v_cash := public.shift_cash_sales(p_shift_id);
  v_move := public.shift_cash_movement(p_shift_id);
  v_expected := COALESCE(v_row.opening_cash,0) + COALESCE(v_move, COALESCE(v_cash,0));

  UPDATE public.cashier_shifts SET
    closed_at = now(), closing_cash = COALESCE(p_closing_cash,0), cash_sales = v_cash,
    expected_cash = v_expected, variance = COALESCE(p_closing_cash,0) - v_expected,
    close_notes = p_notes, closed_by = auth.uid(),
    status = CASE WHEN v_is_system THEN 'auto_closed' ELSE 'closed' END
  WHERE id = p_shift_id
  RETURNING * INTO v_row;

  IF p_auto_checkout THEN
    SELECT id INTO v_emp_id FROM public.employees
     WHERE user_id = v_row.cashier_id AND branch_id = v_row.branch_id AND is_active = true LIMIT 1;
    IF v_emp_id IS NOT NULL THEN
      UPDATE public.attendance
         SET check_out = now(),
             notes = COALESCE(notes,'') || ' | انصراف تلقائي مع قفل الوردية'
       WHERE employee_id = v_emp_id AND date = CURRENT_DATE
         AND check_in IS NOT NULL AND check_out IS NULL
         AND now() > check_in;
    END IF;
  END IF;

  RETURN v_row;
END $function$;
