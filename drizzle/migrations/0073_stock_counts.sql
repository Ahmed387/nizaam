-- 0073 — Stock counts (owner request 2026-10-11)
-- 1) admin_set_product_quantity wrote its own stock batch AND the stock_adjustment_items trigger
--    (apply_stock_adjustment_item) wrote one too → every count-up became two batches (20 pairs found).
--    The function now leaves batches to the trigger; the extra batch of each pair is emptied (kept, not deleted).
-- 2) The cost ledger reads stock counts from the adjustment documents (stock_adjustment_items), not batches.
-- 3) branch_stock_report splits «تسوية جرد» (with a document) from «فرق من غير مستند».

-- ---------------------------------------------------------------- cost ledger: counts from documents
CREATE OR REPLACE FUNCTION public.product_cost_ledger(
  p_product uuid, p_until timestamptz DEFAULT 'infinity', p_skip_invoice uuid DEFAULT NULL)
RETURNS TABLE(ev_at timestamptz, kind text, ref_id uuid, qty numeric, unit_cost numeric,
              run_qty numeric, run_avg numeric, out_value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p record; e record;
  q numeric := 0; a numeric := NULL; c numeric;
BEGIN
  SELECT id, branch_id, name, cost_price INTO v_p FROM products WHERE id = p_product;
  IF NOT FOUND THEN RETURN; END IF;

  FOR e IN
    WITH ev AS (
      -- opening stock (in, with cost)
      SELECT coalesce(b.effective_at, b.created_at) AS e_at, 0 AS e_ord, 'opening'::text AS e_kind, b.id AS e_ref,
             b.quantity_purchased::numeric AS e_qty, b.cost_price::numeric AS e_cost
        FROM product_batches b WHERE b.product_id = p_product AND b.batch_type = 'opening_stock'
      UNION ALL
      -- purchases (in, landed unit cost)
      SELECT s.invoice_date, 1, 'purchase', s.id, si.quantity::numeric,
             coalesce(nullif(si.true_unit_cost, 0), nullif(si.cost_price, 0), 0)::numeric
        FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
       WHERE si.product_id = p_product AND coalesce(s.status, 'active') = 'active'
      UNION ALL
      -- transfers in (in, sender's average at that moment — filled below)
      SELECT (coalesce(t.transfer_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date) + time '12:00') AT TIME ZONE 'Africa/Cairo',
             1, 'transfer_in', t.id, t.received_quantity::numeric, NULL::numeric
        FROM stock_transfers t JOIN products src ON src.id = t.product_id
       WHERE t.to_branch_id = v_p.branch_id AND src.name = v_p.name AND t.product_id <> p_product
         AND t.status = 'confirmed' AND coalesce(t.received_quantity, 0) > 0
      UNION ALL
      -- sale returns (in, at the cost the goods left with)
      SELECT coalesce(r.invoice_date, r.created_at), 1, 'sale_return', r.id, ri.quantity::numeric,
             (SELECT nullif(ii.unit_cost_at_sale, 0) FROM invoice_items ii
               WHERE ii.invoice_id = r.invoice_id AND ii.product_id = p_product LIMIT 1)
        FROM return_items ri JOIN returns r ON r.id = ri.return_id
       WHERE ri.product_id = p_product AND coalesce(r.status, 'active') = 'active'
      UNION ALL
      -- stock count up (quantity only) — from the adjustment document
      SELECT sa.created_at, 1, 'count_in', sa.id, sai.difference::numeric, nullif(sai.unit_cost, 0)::numeric
        FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adjustment_id
       WHERE sai.product_id = p_product AND sai.difference > 0
      UNION ALL
      -- sales (out)
      SELECT i.invoice_date, 2, 'sale', i.id, ii.quantity::numeric, nullif(ii.unit_cost_at_sale, 0)::numeric
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE ii.product_id = p_product AND i.status = 'active' AND i.id IS DISTINCT FROM p_skip_invoice
      UNION ALL
      -- purchase returns (out)
      SELECT coalesce(pr.invoice_date, pr.created_at), 2, 'purchase_return', pr.id, pri.quantity::numeric, NULL::numeric
        FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
       WHERE pri.product_id = p_product AND coalesce(pr.status, 'active') = 'active'
      UNION ALL
      -- transfers out (out; a rejected transfer comes back whole, a partly received one sends only what arrived)
      SELECT (coalesce(t.transfer_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date) + time '12:00') AT TIME ZONE 'Africa/Cairo',
             2, 'transfer_out', t.id,
             (CASE WHEN t.status = 'confirmed' THEN coalesce(t.received_quantity, t.quantity) ELSE t.quantity END)::numeric, NULL::numeric
        FROM stock_transfers t
       WHERE t.product_id = p_product AND t.status IN ('pending', 'confirmed')
      UNION ALL
      -- stock count down (out)
      SELECT sa.created_at, 2, 'count_out', sa.id, (-sai.difference)::numeric, NULL::numeric
        FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adjustment_id
       WHERE sai.product_id = p_product AND sai.difference < 0
    )
    SELECT * FROM ev WHERE ev.e_at <= p_until AND ev.e_qty <> 0 ORDER BY ev.e_at, ev.e_ord, ev.e_ref
  LOOP
    IF e.e_ord < 2 THEN
      c := e.e_cost;
      IF e.e_kind = 'transfer_in' THEN
        c := public.product_avg_cost((SELECT product_id FROM stock_transfers WHERE id = e.e_ref), e.e_at - interval '1 microsecond');
      END IF;
      IF e.e_kind = 'count_in' AND a IS NOT NULL AND q > 0 THEN
        c := a; q := q + e.e_qty;                         -- stock found by a count: valued at the average, average unchanged
      ELSIF c IS NULL OR c <= 0 THEN
        q := q + e.e_qty;                                 -- quantity only
      ELSIF q <= 0 OR a IS NULL THEN
        a := c; q := q + e.e_qty;                            -- empty / negative stock: the new cost is the average
      ELSE
        a := round((q * a + e.e_qty * c) / (q + e.e_qty), 6); q := q + e.e_qty;
      END IF;
      ev_at := e.e_at; kind := e.e_kind; ref_id := e.e_ref; qty := e.e_qty; unit_cost := c;
      run_qty := q; run_avg := a; out_value := NULL;
    ELSE
      -- a sale leaves at the cost written on its line (= the average when it was sold); other outs at the average
      q := q - e.e_qty;
      ev_at := e.e_at; kind := e.e_kind; ref_id := e.e_ref; qty := -e.e_qty; unit_cost := coalesce(e.e_cost, a);
      run_qty := q; run_avg := a; out_value := round(e.e_qty * coalesce(e.e_cost, a, v_p.cost_price, 0), 2);
    END IF;
    RETURN NEXT;
  END LOOP;
END $$;


-- ---------------------------------------------------------------- empty the duplicate batch of each pair
WITH pairs AS (
  SELECT product_id, created_at, quantity_purchased AS q,
         array_agg(id ORDER BY quantity_remaining DESC, id) AS ids, sum(quantity_remaining) AS rem
    FROM public.product_batches WHERE batch_type = 'adjustment'
   GROUP BY product_id, created_at, quantity_purchased, cost_price HAVING count(*) = 2),
keep AS (UPDATE public.product_batches b SET quantity_remaining = greatest(p.rem - p.q, 0)
           FROM pairs p WHERE b.id = p.ids[1] RETURNING b.id)
UPDATE public.product_batches b SET quantity_purchased = 0, quantity_remaining = 0
  FROM pairs p WHERE b.id = p.ids[2];

CREATE OR REPLACE TRIGGER zz_avg_cost_refresh AFTER INSERT ON public.stock_adjustment_items
  FOR EACH ROW EXECUTE FUNCTION public.avg_cost_refresh_trg();

-- ---------------------------------------------------------------- report
CREATE OR REPLACE FUNCTION public.branch_stock_report(p_from date, p_to date, p_branch uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t uuid := public.current_tenant_id();
  v_from timestamptz := (p_from::timestamp) AT TIME ZONE 'Africa/Cairo';
  v_to   timestamptz := ((p_to + 1)::timestamp) AT TIME ZONE 'Africa/Cairo';
  v_live boolean := p_to >= public.cairo_today();
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch AND tenant_id = v_t) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  WITH prod AS (
    SELECT p.id, p.branch_id, p.name, p.quantity
      FROM products p JOIN branches b ON b.id = p.branch_id
     WHERE p.tenant_id = v_t AND p.archived_at IS NULL AND coalesce(b.is_system, false) = false
       AND (p_branch IS NULL OR p.branch_id = p_branch)),
  led AS (
    SELECT pr.id AS product_id, l.*
      FROM prod pr, LATERAL public.product_cost_ledger(pr.id, v_to - interval '1 microsecond')
           WITH ORDINALITY AS l(ev_at, kind, ref_id, qty, unit_cost, run_qty, run_avg, out_value, seq)),
  o AS (   -- last state before the period
    SELECT DISTINCT ON (product_id) product_id, run_qty AS o_qty, coalesce(run_avg, 0) AS o_avg
      FROM led WHERE ev_at < v_from ORDER BY product_id, seq DESC),
  c AS (   -- last state at the end of the period
    SELECT DISTINCT ON (product_id) product_id, run_qty AS c_ledger_qty, coalesce(run_avg, 0) AS c_avg
      FROM led ORDER BY product_id, seq DESC),
  k AS (   -- what moved inside the period, by kind
    SELECT product_id, kind AS k, sum(abs(qty)) AS q,
           round(sum(CASE WHEN qty > 0 THEN qty * coalesce(unit_cost, run_avg, 0) ELSE coalesce(out_value, 0) END), 2) AS v
      FROM led WHERE ev_at >= v_from GROUP BY 1, 2),
  mv AS (
    SELECT product_id, jsonb_object_agg(k, jsonb_build_object('q', q, 'v', v)) AS mv FROM k GROUP BY 1),
  agg AS (
    SELECT pr.id, pr.branch_id, pr.name, pr.quantity AS qty_now,
           coalesce(o.o_qty, 0) AS o_qty, coalesce(o.o_avg, 0) AS o_avg,
           coalesce(c.c_avg, 0) AS c_avg, coalesce(c.c_ledger_qty, 0) AS c_ledger_qty, mv.mv
      FROM prod pr LEFT JOIN o ON o.product_id = pr.id LEFT JOIN c ON c.product_id = pr.id LEFT JOIN mv ON mv.product_id = pr.id),
  rows AS (
    SELECT a.*, CASE WHEN v_live THEN a.qty_now ELSE a.c_ledger_qty END AS c_qty FROM agg a),
  prod_rows AS (
    SELECT r.branch_id, jsonb_build_object(
      'product_id', r.id, 'name', r.name,
      'opening_qty', r.o_qty, 'opening_value', round(greatest(r.o_qty, 0) * r.o_avg, 2),
      'purchased_qty', coalesce((r.mv->'purchase'->>'q')::numeric, 0), 'purchased_value', coalesce((r.mv->'purchase'->>'v')::numeric, 0),
      'opening_stock_qty', coalesce((r.mv->'opening'->>'q')::numeric, 0), 'opening_stock_value', coalesce((r.mv->'opening'->>'v')::numeric, 0),
      'transfer_in_qty', coalesce((r.mv->'transfer_in'->>'q')::numeric, 0), 'transfer_in_value', coalesce((r.mv->'transfer_in'->>'v')::numeric, 0),
      'sale_return_qty', coalesce((r.mv->'sale_return'->>'q')::numeric, 0), 'sale_return_value', coalesce((r.mv->'sale_return'->>'v')::numeric, 0),
      'sold_qty', coalesce((r.mv->'sale'->>'q')::numeric, 0), 'sold_cost', coalesce((r.mv->'sale'->>'v')::numeric, 0),
      'purchase_return_qty', coalesce((r.mv->'purchase_return'->>'q')::numeric, 0), 'purchase_return_value', coalesce((r.mv->'purchase_return'->>'v')::numeric, 0),
      'transfer_out_qty', coalesce((r.mv->'transfer_out'->>'q')::numeric, 0), 'transfer_out_value', coalesce((r.mv->'transfer_out'->>'v')::numeric, 0),
      -- stock counts with a document («تسوية جرد»), at the average of the day
      'count_qty', coalesce((r.mv->'count_in'->>'q')::numeric, 0) - coalesce((r.mv->'count_out'->>'q')::numeric, 0),
      'count_value', coalesce((r.mv->'count_in'->>'v')::numeric, 0) - coalesce((r.mv->'count_out'->>'v')::numeric, 0),
      'closing_qty', r.c_qty, 'avg_cost', round(r.c_avg, 2), 'closing_value', round(greatest(r.c_qty, 0) * r.c_avg, 2),
      -- what no document explains: quantity fixed by hand without a document, or selling ahead of stock
      'unrecorded_qty', r.c_qty - r.c_ledger_qty,
      'unrecorded_value', round(greatest(r.c_qty, 0) * r.c_avg - (
          greatest(r.o_qty, 0) * r.o_avg
          + coalesce((r.mv->'purchase'->>'v')::numeric, 0) + coalesce((r.mv->'opening'->>'v')::numeric, 0)
          + coalesce((r.mv->'transfer_in'->>'v')::numeric, 0) + coalesce((r.mv->'sale_return'->>'v')::numeric, 0)
          + coalesce((r.mv->'count_in'->>'v')::numeric, 0) - coalesce((r.mv->'count_out'->>'v')::numeric, 0)
          - coalesce((r.mv->'sale'->>'v')::numeric, 0) - coalesce((r.mv->'purchase_return'->>'v')::numeric, 0)
          - coalesce((r.mv->'transfer_out'->>'v')::numeric, 0)), 2)
    ) AS j
      FROM rows r
     WHERE r.o_qty <> 0 OR r.c_qty <> 0 OR r.mv IS NOT NULL),
  tot AS (
    SELECT pr.branch_id, b.name AS branch,
      jsonb_build_object(
        'branch_id', pr.branch_id, 'branch', b.name, 'products', count(*),
        'opening_qty', sum((j->>'opening_qty')::numeric), 'opening_value', sum((j->>'opening_value')::numeric),
        'purchased_qty', sum((j->>'purchased_qty')::numeric) + sum((j->>'opening_stock_qty')::numeric),
        'purchased_value', sum((j->>'purchased_value')::numeric) + sum((j->>'opening_stock_value')::numeric),
        'transfer_in_qty', sum((j->>'transfer_in_qty')::numeric), 'transfer_in_value', sum((j->>'transfer_in_value')::numeric),
        'sale_return_qty', sum((j->>'sale_return_qty')::numeric), 'sale_return_value', sum((j->>'sale_return_value')::numeric),
        'sold_qty', sum((j->>'sold_qty')::numeric), 'sold_cost', sum((j->>'sold_cost')::numeric),
        'purchase_return_qty', sum((j->>'purchase_return_qty')::numeric), 'purchase_return_value', sum((j->>'purchase_return_value')::numeric),
        'transfer_out_qty', sum((j->>'transfer_out_qty')::numeric), 'transfer_out_value', sum((j->>'transfer_out_value')::numeric),
        'count_qty', sum((j->>'count_qty')::numeric), 'count_value', sum((j->>'count_value')::numeric),
        'unrecorded_qty', sum((j->>'unrecorded_qty')::numeric), 'unrecorded_value', sum((j->>'unrecorded_value')::numeric),
        'closing_qty', sum((j->>'closing_qty')::numeric), 'closing_value', sum((j->>'closing_value')::numeric)) AS t
      FROM prod_rows pr JOIN branches b ON b.id = pr.branch_id GROUP BY pr.branch_id, b.name)
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'live', v_live,
    'branches', coalesce((SELECT jsonb_agg(t ORDER BY branch) FROM tot), '[]'::jsonb),
    'products', CASE WHEN p_branch IS NULL THEN '[]'::jsonb
                     ELSE coalesce((SELECT jsonb_agg(j ORDER BY (j->>'closing_value')::numeric DESC, j->>'name') FROM prod_rows), '[]'::jsonb) END)
  INTO v_rows;
  RETURN v_rows;
END $$;
REVOKE ALL ON FUNCTION public.branch_stock_report(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_stock_report(date, date, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- admin_set_product_quantity: one batch, written by the trigger
CREATE OR REPLACE FUNCTION public.admin_set_product_quantity(p_product_id uuid, p_actual_quantity integer, p_reason text DEFAULT 'admin_manual_edit'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_prod public.products%ROWTYPE;
  v_system_qty int; v_diff int; v_adj_id uuid; v_num text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_actual_quantity < 0 THEN RAISE EXCEPTION 'الكمية لا يمكن أن تكون سالبة'; END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المنتج غير موجود'; END IF;

  IF v_prod.tenant_id IS DISTINCT FROM public.current_tenant_id()
     AND NOT public.is_super_admin(v_user) THEN
    RAISE EXCEPTION 'المنتج ليس ضمن شركتك';
  END IF;
  IF NOT (
    public.is_super_admin(v_user)
    OR public.has_role(v_user, 'admin'::app_role)
    OR (public.user_in_branch(v_user, v_prod.branch_id)
        AND (public.has_role(v_user, 'branch_manager'::app_role)
             OR public.has_role(v_user, 'warehouse'::app_role)))
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لتعديل هذا المنتج';
  END IF;

  v_system_qty := COALESCE(v_prod.quantity, 0);
  v_diff := p_actual_quantity - v_system_qty;
  IF v_diff = 0 THEN
    RETURN jsonb_build_object('changed', false, 'system', v_system_qty, 'actual', p_actual_quantity);
  END IF;

  v_num := 'ADJ-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(md5(random()::text),1,6));
  INSERT INTO public.stock_adjustments(tenant_id, branch_id, adjustment_number, reason, notes, created_by)
  VALUES (v_prod.tenant_id, v_prod.branch_id, v_num, COALESCE(p_reason,'admin_manual_edit'), p_notes, v_user)
  RETURNING id INTO v_adj_id;

  -- the item's trigger (apply_stock_adjustment_item) sets the quantity, writes / consumes the batch and posts
  -- the journal; doing it here as well counted every change twice in the batches
  INSERT INTO public.stock_adjustment_items(adjustment_id, product_id, product_name, system_quantity, actual_quantity, difference, unit_cost)
  VALUES (v_adj_id, v_prod.id, v_prod.name, v_system_qty, p_actual_quantity, v_diff, COALESCE(v_prod.avg_cost, v_prod.cost_price, 0));

  RETURN jsonb_build_object('changed', true, 'system', v_system_qty, 'actual', p_actual_quantity, 'diff', v_diff, 'adjustment_id', v_adj_id, 'adjustment_number', v_num);
END;
$function$;
