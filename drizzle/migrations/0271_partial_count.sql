-- 0271 «الجرد الجزئي» (owner «تمام نفذه» 2026-11-19): a count of PART of the branch, chosen three ways —
--   words  : every item whose name has the typed words («غسالة»), picked on the screen,
--   items  : items chosen one by one (name / code),
--   moved  : items that moved between two days (sale, purchase, return, transfer, count) — `count_moved_products`.
-- The count holds only those items; items outside it are never touched (approval adjusts the session's lines only).
-- Same rules as a full count (0267): switch «جرد المخزن ← يفتح ويعدّ», one open count per branch, full shelf quantity,
-- line cost = moving average. `inventory_sessions.scope` keeps how it was chosen (NULL = full count).

ALTER TABLE public.inventory_sessions ADD COLUMN IF NOT EXISTS scope jsonb;
COMMENT ON COLUMN public.inventory_sessions.scope IS
  'Partial count (0271): {"mode": "words"|"items"|"moved", "words"?, "from"?, "to"?, "count"} — NULL = whole branch';

CREATE OR REPLACE FUNCTION public.create_partial_inventory_session(p_branch_id uuid, p_notes text, p_product_ids uuid[], p_scope jsonb DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_session_id uuid; v_tenant uuid; v_n int; v_mode text := coalesce(p_scope->>'mode', 'items');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'لازم تسجّل دخول'; END IF;
  PERFORM public.require_switch('stock_count.create', p_branch_id, 'جرد المخزن ← يفتح ويعدّ');
  PERFORM public.assert_access(p_branch_id, 'stock_count.create');
  SELECT tenant_id INTO v_tenant FROM branches WHERE id = p_branch_id;
  IF v_tenant IS DISTINCT FROM public.current_tenant_id() THEN RAISE EXCEPTION 'الفرع مش موجود'; END IF;
  IF v_mode NOT IN ('words', 'items', 'moved') THEN RAISE EXCEPTION 'طريقة اختيار الأصناف مش معروفة'; END IF;
  IF coalesce(cardinality(p_product_ids), 0) = 0 THEN RAISE EXCEPTION 'اختار صنف واحد على الأقل للجرد'; END IF;
  IF cardinality(p_product_ids) > 5000 THEN RAISE EXCEPTION 'الأصناف كتير — اعمل جرد كامل بدل الجزئي'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('inventory_session:' || p_branch_id::text));
  IF EXISTS (SELECT 1 FROM inventory_sessions WHERE branch_id = p_branch_id AND status IN ('counting', 'reviewing', 'pending_approval')) THEN
    RAISE EXCEPTION 'فيه جرد مفتوح على الفرع ده — كمّله أو الغيه الأول';
  END IF;
  SELECT count(*) INTO v_n FROM products p
   WHERE p.id = ANY (p_product_ids) AND p.branch_id = p_branch_id AND p.tenant_id = v_tenant
     AND (p.archived_at IS NULL OR coalesce(p.quantity, 0) <> 0);
  IF v_n = 0 THEN RAISE EXCEPTION 'الأصناف اللي اخترتها مش في الفرع ده'; END IF;
  IF v_n < (SELECT count(DISTINCT x) FROM unnest(p_product_ids) x) THEN
    RAISE EXCEPTION 'فيه أصناف اخترتها مش في الفرع ده — اختار من أصناف الفرع بس';
  END IF;
  INSERT INTO inventory_sessions (tenant_id, branch_id, notes, created_by, status, scope)
  VALUES (v_tenant, p_branch_id, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), 'counting',
          jsonb_strip_nulls(jsonb_build_object('mode', v_mode, 'words', nullif(btrim(coalesce(p_scope->>'words', '')), ''),
                                               'from', p_scope->>'from', 'to', p_scope->>'to', 'count', v_n)))
  RETURNING id INTO v_session_id;
  INSERT INTO inventory_session_items (session_id, product_id, product_name, product_code, unit, system_quantity, unit_cost)
  SELECT v_session_id, p.id, p.name, p.sku, 'قطعة', greatest(coalesce(p.quantity, 0), 0),
         coalesce(nullif(p.avg_cost, 0), p.cost_price, 0)
    FROM products p
   WHERE p.id = ANY (p_product_ids) AND p.branch_id = p_branch_id AND p.tenant_id = v_tenant
     AND (p.archived_at IS NULL OR coalesce(p.quantity, 0) <> 0);
  RETURN v_session_id;
END $f$;

-- items of a branch that moved between two Cairo days (any stock movement), with how many moves
CREATE OR REPLACE FUNCTION public.count_moved_products(p_branch_id uuid, p_from date, p_to date)
 RETURNS TABLE(product_id uuid, name text, sku text, quantity integer, moves bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'لازم تسجّل دخول'; END IF;
  PERFORM public.assert_read_access(p_branch_id, 'inventory.view');
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'اختار فترة صحيحة (من ← إلى)'; END IF;
  IF p_to - p_from > 366 THEN RAISE EXCEPTION 'الفترة أطول من سنة — اختار فترة أقصر'; END IF;
  RETURN QUERY
  SELECT p.id, p.name, p.sku, coalesce(p.quantity, 0)::int, count(*)
    FROM stock_movements m JOIN products p ON p.id = m.product_id
   WHERE m.branch_id = p_branch_id
     AND m.movement_date >= (p_from::timestamp AT TIME ZONE 'Africa/Cairo')
     AND m.movement_date < ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo')
     AND (p.archived_at IS NULL OR coalesce(p.quantity, 0) <> 0)
   GROUP BY p.id, p.name, p.sku, p.quantity
   ORDER BY count(*) DESC, p.name;
END $f$;

REVOKE ALL ON FUNCTION public.create_partial_inventory_session(uuid, text, uuid[], jsonb), public.count_moved_products(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_partial_inventory_session(uuid, text, uuid[], jsonb), public.count_moved_products(uuid, date, date) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('create_partial_inventory_session', '0271', 'جرد جزئي'), ('count_moved_products', '0271', 'أصناف اتحركت في فترة (للجرد الجزئي)')
ON CONFLICT DO NOTHING;
