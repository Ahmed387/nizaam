-- 0267 (owner 2026-11-18 «أمين المخزن أو المدير يفتح ويعدّ، والمدير يراجع ويكتب أسباب الفروق، وإنت تعتمد. نفذ»):
-- the branch stock count runs ONLY through server functions, each with its switch:
--   «جرد المخزن ← يضيف» (stock_count.create: open + count + hand in)   default branch manager, warehouse
--   «جرد المخزن ← يعدل» (stock_count.update: review + reasons, send back, cancel an open count)   default branch manager
--   approve / cancel an approved count = the company owner only (as before).
-- Fixes found by the 2026-11-18 test: cancelling an approved count always failed (FOR UPDATE on an outer join); the
-- count showed «quantity − reserved» so counting the shelf made a false surplus; the difference was valued at
-- cost_price instead of the moving average; anyone in the company could write count lines of any branch (also closed
-- ones) and move a count to any status from the browser; a read-only («عرض فقط») manager could open a count; the journal
-- date was UTC; the stock log rows of an approval had no type / reference; cancelling an approved count named a column
-- return_items does not have. (One open count per branch was already a unique index; now it has an Arabic message.)

-- ---------------------------------------------------------------- switches (server defaults = DEFAULT_ROLE_PERMISSIONS)
CREATE OR REPLACE FUNCTION pg_temp.rep(p_fn regprocedure, p_old text, p_new text) RETURNS void LANGUAGE plpgsql AS $r$
DECLARE d text := pg_get_functiondef(p_fn);
BEGIN
  IF position(p_old IN d) = 0 THEN RAISE EXCEPTION 'anchor not found in %: %', p_fn, left(p_old, 80); END IF;
  EXECUTE replace(d, p_old, p_new);
END $r$;
SELECT pg_temp.rep('public.role_permission_default(text,text)'::regprocedure,
  $$'doc_class.update','vessel_transfers.create'])$$,
  $$'doc_class.update','vessel_transfers.create','stock_count.create','stock_count.update'])$$);
SELECT pg_temp.rep('public.role_permission_default(text,text)'::regprocedure,
  $$WHEN 'warehouse' THEN p_key = ANY (ARRAY[
      'dashboard.view',$$,
  $$WHEN 'warehouse' THEN p_key = ANY (ARRAY[
      'dashboard.view','stock_count.create',$$);

-- ---------------------------------------------------------------- the browser writes nothing directly
ALTER POLICY inv_sessions_insert ON public.inventory_sessions WITH CHECK (false);
ALTER POLICY inv_sessions_update ON public.inventory_sessions USING (false) WITH CHECK (false);
ALTER POLICY inv_sessions_delete ON public.inventory_sessions USING (false);

ALTER POLICY inv_items_tenant_all ON public.inventory_session_items USING (false) WITH CHECK (false);
CREATE POLICY inv_items_read ON public.inventory_session_items FOR SELECT TO authenticated
  USING (session_id IN (SELECT s.id FROM public.inventory_sessions s
                         WHERE s.tenant_id = (SELECT public.current_tenant_id())));

ALTER POLICY inv_adj_tenant_all ON public.inventory_adjustments USING (false) WITH CHECK (false);
CREATE POLICY inv_adj_read ON public.inventory_adjustments FOR SELECT TO authenticated
  USING (session_id IN (SELECT s.id FROM public.inventory_sessions s
                         WHERE s.tenant_id = (SELECT public.current_tenant_id())));

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION public.inv_count_session_for(p_session uuid, p_key text)
RETURNS public.inventory_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE s public.inventory_sessions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'لازم تسجّل دخول'; END IF;
  SELECT * INTO s FROM inventory_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.tenant_id IS DISTINCT FROM public.current_tenant_id() THEN RAISE EXCEPTION 'الجرد مش موجود'; END IF;
  PERFORM public.require_switch(p_key, s.branch_id, CASE p_key WHEN 'stock_count.create' THEN 'جرد المخزن ← يفتح ويعدّ' ELSE 'جرد المخزن ← يراجع' END);
  PERFORM public.assert_access(s.branch_id, p_key);
  RETURN s;
END $f$;
REVOKE ALL ON FUNCTION public.inv_count_session_for(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- open a count
CREATE OR REPLACE FUNCTION public.create_inventory_session(p_branch_id uuid, p_notes text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_session_id uuid; v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'لازم تسجّل دخول'; END IF;
  PERFORM public.require_switch('stock_count.create', p_branch_id, 'جرد المخزن ← يفتح ويعدّ');
  PERFORM public.assert_access(p_branch_id, 'stock_count.create');
  SELECT tenant_id INTO v_tenant FROM branches WHERE id = p_branch_id;
  IF v_tenant IS DISTINCT FROM public.current_tenant_id() THEN RAISE EXCEPTION 'الفرع مش موجود'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('inventory_session:' || p_branch_id::text));
  IF EXISTS (SELECT 1 FROM inventory_sessions WHERE branch_id = p_branch_id AND status IN ('counting', 'reviewing', 'pending_approval')) THEN
    RAISE EXCEPTION 'فيه جرد مفتوح على الفرع ده — كمّله أو الغيه الأول';
  END IF;

  INSERT INTO inventory_sessions (tenant_id, branch_id, notes, created_by, status)
  VALUES (v_tenant, p_branch_id, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), 'counting')
  RETURNING id INTO v_session_id;

  -- the quantity on the shelf = the full quantity: a piece reserved for an open sale is still on the shelf
  INSERT INTO inventory_session_items (session_id, product_id, product_name, product_code, unit, system_quantity, unit_cost)
  SELECT v_session_id, p.id, p.name, p.sku, 'قطعة', greatest(coalesce(p.quantity, 0), 0),
         coalesce(nullif(p.avg_cost, 0), p.cost_price, 0)
    FROM products p
   WHERE p.branch_id = p_branch_id AND p.tenant_id = v_tenant AND (p.archived_at IS NULL OR coalesce(p.quantity, 0) <> 0);
  RETURN v_session_id;
END $function$;

-- ---------------------------------------------------------------- count (only while counting)
CREATE OR REPLACE FUNCTION public.upsert_inventory_counts(_session_id uuid, _items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s public.inventory_sessions; v_item jsonb; v_q numeric; v_count int := 0; n int;
BEGIN
  s := public.inv_count_session_for(_session_id, 'stock_count.create');
  IF s.status <> 'counting' THEN RAISE EXCEPTION 'الجرد ده اتسلّم خلاص — مينفعش تغيّر العد (المراجع يقدر يرجّعهولك)'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) LOOP
    v_q := NULLIF(btrim(coalesce(v_item->>'actual_quantity', '')), '')::numeric;
    IF v_q IS NOT NULL AND (v_q < 0 OR v_q <> trunc(v_q)) THEN RAISE EXCEPTION 'الكمية لازم تكون رقم صحيح مش سالب'; END IF;
    UPDATE inventory_session_items SET actual_quantity = v_q, updated_at = now()
     WHERE id = (v_item->>'id')::uuid AND session_id = _session_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_count := v_count + n;
  END LOOP;
  RETURN v_count;
END $function$;

-- hand the count in → review
CREATE OR REPLACE FUNCTION public.submit_inventory_count(p_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE s public.inventory_sessions;
BEGIN
  s := public.inv_count_session_for(p_session, 'stock_count.create');
  IF s.status <> 'counting' THEN RAISE EXCEPTION 'الجرد ده اتسلّم قبل كده'; END IF;
  IF NOT EXISTS (SELECT 1 FROM inventory_session_items WHERE session_id = p_session AND actual_quantity IS NOT NULL) THEN
    RAISE EXCEPTION 'مفيش ولا صنف اتعدّ';
  END IF;
  UPDATE inventory_sessions SET status = 'reviewing', counted_at = now() WHERE id = p_session;
END $f$;

-- review: reasons for the differences → the owner
CREATE OR REPLACE FUNCTION public.review_inventory_session(p_session uuid, p_reasons jsonb DEFAULT '[]'::jsonb, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE s public.inventory_sessions; r jsonb;
BEGIN
  s := public.inv_count_session_for(p_session, 'stock_count.update');
  IF s.status <> 'reviewing' THEN RAISE EXCEPTION 'الجرد ده مش مستني مراجعة'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p_reasons, '[]'::jsonb)) LOOP
    UPDATE inventory_session_items SET reason = left(nullif(btrim(coalesce(r->>'reason', '')), ''), 500), updated_at = now()
     WHERE id = (r->>'id')::uuid AND session_id = p_session;
  END LOOP;
  UPDATE inventory_sessions
     SET status = 'pending_approval', reviewed_at = now(), accountant_id = auth.uid(),
         notes = CASE WHEN nullif(btrim(coalesce(p_note, '')), '') IS NULL THEN notes
                      ELSE concat_ws(E'\n', notes, '[المراجعة] ' || btrim(p_note)) END
   WHERE id = p_session;
END $f$;

-- send back one step: approval → review (owner or reviewer), review → counting (reviewer)
CREATE OR REPLACE FUNCTION public.return_inventory_session(p_session uuid, p_reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE s public.inventory_sessions; v_to text;
BEGIN
  s := public.inv_count_session_for(p_session, 'stock_count.update');
  v_to := CASE s.status WHEN 'pending_approval' THEN 'reviewing' WHEN 'reviewing' THEN 'counting' END;
  IF v_to IS NULL THEN RAISE EXCEPTION 'الجرد ده مينفعش يترجع'; END IF;
  UPDATE inventory_sessions
     SET status = v_to, reject_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         notes = CASE WHEN nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN notes
                      ELSE concat_ws(E'\n', notes, '[اترجع] ' || btrim(p_reason)) END
   WHERE id = p_session;
  RETURN v_to;
END $f$;

-- cancel a count that was not approved (nothing moved yet)
CREATE OR REPLACE FUNCTION public.cancel_open_inventory_session(p_session uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE s public.inventory_sessions;
BEGIN
  s := public.inv_count_session_for(p_session, 'stock_count.update');
  IF s.status NOT IN ('counting', 'reviewing', 'pending_approval') THEN RAISE EXCEPTION 'الجرد ده مش مفتوح'; END IF;
  UPDATE inventory_sessions
     SET status = 'cancelled', notes = concat_ws(E'\n', notes, '[اتلغى قبل الاعتماد] ' || coalesce(nullif(btrim(p_reason), ''), ''))
   WHERE id = p_session;
END $f$;

-- ---------------------------------------------------------------- approve (owner only)
CREATE OR REPLACE FUNCTION public.approve_inventory_session(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user uuid := auth.uid(); v_sess record; v_adj_id uuid; v_num text; r record; b record;
  v_reserved numeric; v_cur integer; v_delta integer; v_new_qty integer; v_excess numeric; v_cost numeric;
  v_take numeric; v_remaining numeric; v_moved boolean; v_mgr record; v_batch_id uuid;
  v_short_val numeric := 0; v_sur_val numeric := 0; v_entry_id uuid; v_acc_short uuid; v_acc_sur uuid; v_acc_inv uuid;
  v_day date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO v_sess FROM inventory_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_sess IS NULL THEN RAISE EXCEPTION 'الجرد مش موجود'; END IF;
  PERFORM public.assert_same_tenant(v_sess.tenant_id);
  IF NOT (public.is_super_admin(v_user)
          OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = v_sess.tenant_id AND t.owner_user_id = v_user)
          OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = v_user AND ur.role = 'owner' AND ur.tenant_id = v_sess.tenant_id)) THEN
    RAISE EXCEPTION 'اعتماد الجرد متاح لمالك الشركة فقط';
  END IF;
  IF v_sess.status NOT IN ('pending_approval', 'reviewing') THEN RAISE EXCEPTION 'الجرد ده مش جاهز للاعتماد'; END IF;

  PERFORM set_config('app.stocktake_apply', 'on', true);
  v_num := 'JRD-' || to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYYMMDDHH24MISS');
  INSERT INTO stock_adjustments (branch_id, adjustment_number, reason, notes, created_by, tenant_id)
  VALUES (v_sess.branch_id, v_num, 'جرد مخزن', coalesce(v_sess.notes, ''), v_user, v_sess.tenant_id)
  RETURNING id INTO v_adj_id;

  FOR r IN SELECT i.*, coalesce(nullif(i.unit_cost, 0), nullif(p.avg_cost, 0), p.cost_price, 0) AS cost
             FROM inventory_session_items i JOIN products p ON p.id = i.product_id
            WHERE i.session_id = p_session_id AND i.actual_quantity IS NOT NULL AND i.actual_quantity <> i.system_quantity LOOP
    SELECT coalesce(quantity, 0) INTO v_cur FROM products WHERE id = r.product_id FOR UPDATE;
    IF v_cur IS NULL THEN CONTINUE; END IF;
    v_cost := r.cost;
    v_delta := (r.actual_quantity::int - r.system_quantity::int);
    v_new_qty := greatest(v_cur + v_delta, 0);
    v_delta := v_new_qty - v_cur;
    v_moved := (v_cur <> r.system_quantity::int);
    IF v_delta = 0 THEN CONTINUE; END IF;

    PERFORM public.stock_mv_ctx('adjustment', 'inventory_session', p_session_id, r.product_id, now());
    UPDATE products SET quantity = v_new_qty WHERE id = r.product_id;

    IF v_delta > 0 THEN
      INSERT INTO product_batches (tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
                                   cost_price, base_purchase_price, true_unit_cost, batch_type)
      VALUES (v_sess.tenant_id, v_sess.branch_id, r.product_id, v_delta, v_delta, v_cost, v_cost, v_cost, 'adjustment')
      RETURNING id INTO v_batch_id;
      INSERT INTO inventory_count_batch_moves (tenant_id, session_id, product_id, batch_id, delta, created_batch)
      VALUES (v_sess.tenant_id, p_session_id, r.product_id, v_batch_id, v_delta, true);
      v_sur_val := v_sur_val + v_delta * v_cost;
    ELSE
      v_remaining := -v_delta;
      FOR b IN SELECT id, quantity_remaining FROM product_batches
                WHERE product_id = r.product_id AND branch_id = v_sess.branch_id AND quantity_remaining > 0
                ORDER BY effective_at ASC, created_at ASC, id ASC FOR UPDATE LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := least(b.quantity_remaining, v_remaining);
        UPDATE product_batches SET quantity_remaining = quantity_remaining - v_take WHERE id = b.id;
        INSERT INTO inventory_count_batch_moves (tenant_id, session_id, product_id, batch_id, delta, created_batch)
        VALUES (v_sess.tenant_id, p_session_id, r.product_id, b.id, -v_take, false);
        v_remaining := v_remaining - v_take;
      END LOOP;
      v_short_val := v_short_val + (-v_delta) * v_cost;
    END IF;

    INSERT INTO stock_adjustment_items (adjustment_id, product_id, product_name, system_quantity, actual_quantity, difference, unit_cost)
    VALUES (v_adj_id, r.product_id, r.product_name, v_cur, v_new_qty, v_delta, v_cost);

    INSERT INTO inventory_adjustments (session_id, product_id, adjustment_amount, reason, created_by)
    VALUES (p_session_id, r.product_id, v_delta,
            coalesce(r.reason, '') ||
            CASE WHEN v_moved THEN ' [حركة مخزون أثناء الجرد: النظام وقت البدء ' || r.system_quantity::int::text ||
                                   ' → وقت الاعتماد ' || v_cur::text || '، الفرق المطبق ' || v_delta::text || ']' ELSE '' END,
            v_user);

    IF v_moved THEN
      FOR v_mgr IN SELECT DISTINCT bu.user_id FROM branch_users bu WHERE bu.branch_id = v_sess.branch_id LOOP
        INSERT INTO notifications (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
        VALUES (v_sess.tenant_id, v_mgr.user_id, '⚠️ حركة مخزون أثناء الجرد',
          'المنتج ' || r.product_name || ' اتباع/اتشترى منه أثناء الجرد. النظام طبّق فرق الجرد (' || v_delta::text ||
          ') على الرصيد الحالي بدل ما يكتب الرقم المعدود كما هو.',
          'general', '/branch/' || v_sess.branch_id::text || '/inventory', 'inventory_session', p_session_id);
      END LOOP;
    END IF;

    SELECT coalesce(sum(reserved_quantity), 0) INTO v_reserved FROM inventory_reservations
     WHERE product_id = r.product_id AND branch_id = v_sess.branch_id AND status = 'active' AND (expires_at IS NULL OR expires_at > now());
    IF v_reserved > v_new_qty THEN
      v_excess := v_reserved - v_new_qty;
      FOR v_mgr IN SELECT DISTINCT bu.user_id FROM branch_users bu WHERE bu.branch_id = v_sess.branch_id LOOP
        INSERT INTO notifications (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
        VALUES (v_sess.tenant_id, v_mgr.user_id, '⚠️ تحذير: حجوزات تتجاوز المخزون بعد الجرد',
          'يوجد ' || v_excess::text || ' وحدة محجوزة تتجاوز المخزون الجديد بعد الجرد للمنتج ' || r.product_name,
          'general', '/branch/' || v_sess.branch_id::text || '/inventory', 'inventory_session', p_session_id);
      END LOOP;
    END IF;
  END LOOP;

  IF round(v_short_val, 2) > 0 OR round(v_sur_val, 2) > 0 THEN
    PERFORM public.ensure_count_variance_accounts(v_sess.tenant_id);
    SELECT id INTO v_acc_short FROM chart_of_accounts WHERE tenant_id = v_sess.tenant_id AND code = '5600';
    SELECT id INTO v_acc_sur   FROM chart_of_accounts WHERE tenant_id = v_sess.tenant_id AND code = '4300';
    SELECT id INTO v_acc_inv   FROM chart_of_accounts WHERE tenant_id = v_sess.tenant_id AND code = '1300';
    IF v_acc_inv IS NULL OR v_acc_short IS NULL OR v_acc_sur IS NULL THEN RAISE EXCEPTION 'حسابات فروقات الجرد ناقصة'; END IF;
    INSERT INTO journal_entries (tenant_id, branch_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit)
    VALUES (v_sess.tenant_id, v_sess.branch_id, v_num, v_day, 'فروقات جرد مخزون — ' || v_num, 'inventory_session', p_session_id, 'posted',
            round(v_short_val, 2) + round(v_sur_val, 2), round(v_short_val, 2) + round(v_sur_val, 2))
    RETURNING id INTO v_entry_id;
    IF round(v_short_val, 2) > 0 THEN
      INSERT INTO journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (v_sess.tenant_id, v_entry_id, v_acc_short, round(v_short_val, 2), 0, 'عجز جرد', 1),
             (v_sess.tenant_id, v_entry_id, v_acc_inv, 0, round(v_short_val, 2), 'تخفيض المخزون — عجز جرد', 2);
    END IF;
    IF round(v_sur_val, 2) > 0 THEN
      INSERT INTO journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (v_sess.tenant_id, v_entry_id, v_acc_inv, round(v_sur_val, 2), 0, 'زيادة المخزون — فروقات جرد', 3),
             (v_sess.tenant_id, v_entry_id, v_acc_sur, 0, round(v_sur_val, 2), 'إيراد فروقات جرد', 4);
    END IF;
  END IF;

  UPDATE inventory_sessions SET status = 'closed', approved_by = v_user, approved_at = now(), closed_at = now() WHERE id = p_session_id;
  PERFORM set_config('app.stocktake_apply', 'off', true);
END $function$;

-- ---------------------------------------------------------------- cancel an approved count (owner): fix + stock log type
SELECT pg_temp.rep('public.cancel_inventory_session(uuid,text)'::regprocedure,
  $$WHERE s.id = p_session_id FOR UPDATE;$$, $$WHERE s.id = p_session_id FOR UPDATE OF s;$$);
SELECT pg_temp.rep('public.cancel_inventory_session(uuid,text)'::regprocedure,
  $$  FOR a IN SELECT product_id, adjustment_amount FROM public.inventory_adjustments WHERE session_id = p_session_id LOOP
    UPDATE public.products$$,
  $$  FOR a IN SELECT product_id, adjustment_amount FROM public.inventory_adjustments WHERE session_id = p_session_id LOOP
    PERFORM public.stock_mv_ctx('adjustment', 'inventory_session', p_session_id, a.product_id, now());
    UPDATE public.products$$);
SELECT pg_temp.rep('public.cancel_inventory_session(uuid,text)'::regprocedure,
  $$VALUES (v_sess.tenant_id, v_entry.branch_id, v_num, CURRENT_DATE,$$,
  $$VALUES (v_sess.tenant_id, v_entry.branch_id, v_num, (now() AT TIME ZONE 'Africa/Cairo')::date,$$);
SELECT pg_temp.rep('public.cancel_inventory_session(uuid,text)'::regprocedure,
  $$v_is_owner := (auth.uid() IS NOT NULL AND auth.uid() = v_sess.owner_user_id)
                OR public.has_role(auth.uid(),'owner');$$,
  $$v_is_owner := (auth.uid() IS NOT NULL AND auth.uid() = v_sess.owner_user_id)
                OR public.is_owner(auth.uid());$$);

SELECT pg_temp.rep('public.cancel_inventory_session(uuid,text)'::regprocedure,
  $$' — ' || ri.product_name$$, $$' — ' || COALESCE((SELECT p2.name FROM public.products p2 WHERE p2.id = ri.product_id), '')$$);

-- ---------------------------------------------------------------- browser RPCs
REVOKE ALL ON FUNCTION public.submit_inventory_count(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_inventory_session(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_inventory_session(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_open_inventory_session(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_inventory_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_inventory_session(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_inventory_session(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_open_inventory_session(uuid, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('submit_inventory_count', '0267', 'stock count: hand in (stock_count.create)'),
  ('review_inventory_session', '0267', 'stock count: review + reasons (stock_count.update)'),
  ('return_inventory_session', '0267', 'stock count: send back one step (stock_count.update)'),
  ('cancel_open_inventory_session', '0267', 'stock count: cancel before approval (stock_count.update)')
ON CONFLICT (function_name) DO NOTHING;
