-- Step 6C (0056) part 2 — ledger readers for screens (no netting).
CREATE OR REPLACE FUNCTION public.ledger_read_scope(p_branch uuid, p_side text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF p_branch IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = p_branch AND b.tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'الفرع غير موجود في شركتك' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid) OR public.user_in_branch(v_uid, p_branch)) THEN
      RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية على هذا الفرع' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_side = 'customer' AND NOT public.effective_permission(v_uid, 'customers.view') THEN
    RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية «customers.view»' USING ERRCODE = '42501';
  ELSIF p_side = 'supplier' AND NOT public.effective_permission(v_uid, 'suppliers.view') THEN
    RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية «suppliers.view»' USING ERRCODE = '42501';
  ELSIF p_side = 'any' AND NOT (public.effective_permission(v_uid, 'customers.view')
                                OR public.effective_permission(v_uid, 'suppliers.view')) THEN
    RAISE EXCEPTION 'غير مصرح: تحتاج صلاحية عرض العملاء أو الموردين' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_can_see_side(p_side text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.effective_permission(auth.uid(), CASE WHEN p_side = 'customer' THEN 'customers.view' ELSE 'suppliers.view' END)
$$;

CREATE OR REPLACE FUNCTION public.ledger_contact_tenant_check(p_contact uuid, p_tenant uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = p_contact AND c.tenant_id = p_tenant) THEN
    RAISE EXCEPTION 'جهة التعامل غير موجودة في شركتك' USING ERRCODE = '42501';
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_debt_rows(p_tenant uuid, p_contact uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid, side text, debt_type text, debt_id uuid, branch_id uuid, doc_date date,
               created_at timestamptz, amount numeric, allocated numeric, remaining numeric,
               paid_by_returns numeric, paid_from_other_branches numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH d AS (
    SELECT i.contact_id, 'customer'::text AS side, 'invoice'::text AS t, i.id, i.branch_id,
           public.ledger_day(i.invoice_date) AS dd, i.created_at AS ts, i.total AS amt
      FROM invoices i
     WHERE i.tenant_id = p_tenant AND (p_contact IS NULL OR i.contact_id = p_contact)
       AND i.status = 'active' AND i.total > 0 AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff()
    UNION ALL
    SELECT s.contact_id, 'supplier', 'shipment', s.id, s.branch_id,
           public.ledger_day(COALESCE(s.invoice_date, s.created_at)), s.created_at, s.total_cost
      FROM shipments s
     WHERE s.tenant_id = p_tenant AND s.contact_id IS NOT NULL AND (p_contact IS NULL OR s.contact_id = p_contact)
       AND s.status = 'active' AND s.total_cost > 0
       AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= public.ledger_cutoff()
    UNION ALL
    SELECT m.contact_id, m.side, 'movement', m.id, m.branch_id, m.movement_date, m.created_at, m.amount
      FROM money_movements m
     WHERE m.tenant_id = p_tenant AND (p_contact IS NULL OR m.contact_id = p_contact)
       AND m.status = 'active' AND m.effect = 'charge'
  ),
  a AS (
    SELECT pa.debt_type, pa.debt_id, sum(pa.amount) AS s,
           sum(pa.amount) FILTER (WHERE mv.kind = 'return_credit') AS s_ret,
           sum(pa.amount) FILTER (WHERE pa.is_cross_branch) AS s_x
      FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
     WHERE pa.tenant_id = p_tenant AND pa.status = 'active'
       AND (p_contact IS NULL OR pa.contact_id = p_contact)
     GROUP BY 1, 2
  )
  SELECT d.contact_id, d.side, d.t, d.id, d.branch_id, d.dd, d.ts, d.amt,
         COALESCE(a.s, 0), d.amt - COALESCE(a.s, 0), COALESCE(a.s_ret, 0), COALESCE(a.s_x, 0)
    FROM d LEFT JOIN a ON a.debt_type = d.t AND a.debt_id = d.id
$$;

CREATE OR REPLACE FUNCTION public.ledger_credit_rows(p_tenant uuid, p_contact uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid, side text, movement_id uuid, kind text, branch_id uuid, movement_date date,
               created_at timestamptz, amount numeric, allocated numeric, unallocated numeric, used_in_other_branches numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.contact_id, m.side, m.id, m.kind, m.branch_id, m.movement_date, m.created_at, m.amount,
         COALESCE(a.s, 0), m.amount - COALESCE(a.s, 0), COALESCE(a.s_x, 0)
    FROM money_movements m
    LEFT JOIN (SELECT pa.movement_id, sum(pa.amount) AS s, sum(pa.amount) FILTER (WHERE pa.is_cross_branch) AS s_x
                 FROM payment_allocations pa
                WHERE pa.tenant_id = p_tenant AND pa.status = 'active' AND (p_contact IS NULL OR pa.contact_id = p_contact)
                GROUP BY 1) a ON a.movement_id = m.id
   WHERE m.tenant_id = p_tenant AND (p_contact IS NULL OR m.contact_id = p_contact)
     AND m.status = 'active' AND m.effect = 'settle'
$$;

CREATE OR REPLACE FUNCTION public.ledger_overdue_rows(p_tenant uuid, p_branch uuid DEFAULT NULL, p_contact uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid, side text, overdue numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH plan AS (
    SELECT pp.id, pp.entity_id, pp.entity_type AS side, pp.reference_type, pp.reference_id,
           sum(GREATEST(pi.amount - COALESCE(pi.paid_amount, 0), 0)) AS due
      FROM payment_plans pp
      JOIN payment_installments pi ON pi.payment_plan_id = pp.id
     WHERE pp.tenant_id = p_tenant AND pp.entity_type IN ('customer', 'supplier')
       AND COALESCE(pp.status, 'active') NOT IN ('cancelled', 'completed')
       AND pi.cancelled_at IS NULL AND COALESCE(pi.status, '') NOT IN ('paid', 'cancelled')
       AND pi.due_date < public.cairo_today()
       AND (p_branch IS NULL OR pp.branch_id = p_branch)
       AND (p_contact IS NULL OR pp.entity_id = p_contact)
     GROUP BY 1, 2, 3, 4, 5
  ),
  capped AS (
    SELECT p.entity_id, p.side,
           CASE WHEN p.reference_type IN ('invoice', 'shipment') THEN
                  LEAST(p.due, COALESCE((SELECT GREATEST(dr.remaining, 0) FROM public.ledger_debt_rows(p_tenant, p.entity_id) dr
                                          WHERE dr.debt_type = p.reference_type AND dr.debt_id = p.reference_id), 0))
                ELSE p.due END AS due
      FROM plan p
  ),
  open_side AS (
    SELECT dr.contact_id, dr.side, sum(GREATEST(dr.remaining, 0)) AS rem
      FROM public.ledger_debt_rows(p_tenant, p_contact) dr
     WHERE dr.contact_id IS NOT NULL AND (p_branch IS NULL OR dr.branch_id = p_branch)
     GROUP BY 1, 2
  )
  SELECT c.entity_id, c.side, round(LEAST(sum(c.due), COALESCE(max(o.rem), 0)), 2)
    FROM capped c LEFT JOIN open_side o ON o.contact_id = c.entity_id AND o.side = c.side
   GROUP BY c.entity_id, c.side
  HAVING sum(c.due) > 0.005
$$;

CREATE OR REPLACE FUNCTION public.ledger_side_balances(p_tenant uuid, p_branch uuid DEFAULT NULL, p_contact uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid, side text, open_remaining numeric, open_docs int, advance numeric, balance numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH d AS (
    SELECT dr.contact_id, dr.side, sum(dr.remaining) AS r, count(*) FILTER (WHERE dr.remaining > 0.005 AND dr.debt_type <> 'movement') AS n
      FROM public.ledger_debt_rows(p_tenant, p_contact) dr
     WHERE dr.contact_id IS NOT NULL AND (p_branch IS NULL OR dr.branch_id = p_branch)
     GROUP BY 1, 2
  ),
  c AS (
    SELECT cr.contact_id, cr.side, sum(cr.unallocated) AS u
      FROM public.ledger_credit_rows(p_tenant, p_contact) cr
     WHERE cr.contact_id IS NOT NULL AND (p_branch IS NULL OR cr.branch_id = p_branch)
     GROUP BY 1, 2
  )
  SELECT COALESCE(d.contact_id, c.contact_id), COALESCE(d.side, c.side),
         round(COALESCE(d.r, 0), 2), COALESCE(d.n, 0)::int, round(COALESCE(c.u, 0), 2),
         round(COALESCE(d.r, 0) - COALESCE(c.u, 0), 2)
    FROM d FULL JOIN c ON c.contact_id = d.contact_id AND c.side = d.side
$$;

CREATE OR REPLACE FUNCTION public.contact_side_balances(p_contact_ids uuid[], p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid,
               customer_balance numeric, customer_open numeric, customer_advance numeric, customer_overdue numeric,
               supplier_balance numeric, supplier_open numeric, supplier_advance numeric, supplier_overdue numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid; v_c boolean; v_s boolean;
BEGIN
  v_tenant := public.ledger_read_scope(p_branch_id, 'any');
  v_c := public.ledger_can_see_side('customer');
  v_s := public.ledger_can_see_side('supplier');
  IF COALESCE(cardinality(p_contact_ids), 0) > 5000 THEN
    RAISE EXCEPTION 'عدد جهات كبير في طلب واحد (الحد 5000)';
  END IF;
  RETURN QUERY
  WITH ids AS (SELECT DISTINCT x AS id FROM unnest(p_contact_ids) x
                JOIN contacts ct ON ct.id = x AND ct.tenant_id = v_tenant),
       b AS (SELECT sb.* FROM ids, LATERAL public.ledger_side_balances(v_tenant, p_branch_id, ids.id) sb
              WHERE cardinality(p_contact_ids) <= 50
             UNION ALL
             SELECT sb.* FROM public.ledger_side_balances(v_tenant, p_branch_id, NULL) sb
              WHERE cardinality(p_contact_ids) > 50 AND sb.contact_id IN (SELECT ids.id FROM ids)),
       o AS (SELECT ov.* FROM ids, LATERAL public.ledger_overdue_rows(v_tenant, p_branch_id, ids.id) ov
              WHERE cardinality(p_contact_ids) <= 50
             UNION ALL
             SELECT ov.* FROM public.ledger_overdue_rows(v_tenant, p_branch_id, NULL) ov
              WHERE cardinality(p_contact_ids) > 50 AND ov.contact_id IN (SELECT ids.id FROM ids))
  SELECT ids.id,
         CASE WHEN v_c THEN COALESCE((SELECT b.balance FROM b WHERE b.contact_id = ids.id AND b.side = 'customer'), 0) END,
         CASE WHEN v_c THEN COALESCE((SELECT b.open_remaining FROM b WHERE b.contact_id = ids.id AND b.side = 'customer'), 0) END,
         CASE WHEN v_c THEN COALESCE((SELECT b.advance FROM b WHERE b.contact_id = ids.id AND b.side = 'customer'), 0) END,
         CASE WHEN v_c THEN COALESCE((SELECT o.overdue FROM o WHERE o.contact_id = ids.id AND o.side = 'customer'), 0) END,
         CASE WHEN v_s THEN COALESCE((SELECT b.balance FROM b WHERE b.contact_id = ids.id AND b.side = 'supplier'), 0) END,
         CASE WHEN v_s THEN COALESCE((SELECT b.open_remaining FROM b WHERE b.contact_id = ids.id AND b.side = 'supplier'), 0) END,
         CASE WHEN v_s THEN COALESCE((SELECT b.advance FROM b WHERE b.contact_id = ids.id AND b.side = 'supplier'), 0) END,
         CASE WHEN v_s THEN COALESCE((SELECT o.overdue FROM o WHERE o.contact_id = ids.id AND o.side = 'supplier'), 0) END
    FROM ids;
END
$fn$;

DROP FUNCTION IF EXISTS public.contacts_page(uuid, text, text, text[], integer, integer);
CREATE OR REPLACE FUNCTION public.contacts_page(p_branch_id uuid, p_type text DEFAULT 'all', p_query text DEFAULT NULL,
                                                p_balance text[] DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid; v_c boolean; v_s boolean; v jsonb;
BEGIN
  v_tenant := public.ledger_read_scope(p_branch_id, 'any');
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'عرض كل الفروع للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  v_c := public.ledger_can_see_side('customer');
  v_s := public.ledger_can_see_side('supplier');
  WITH toks AS (
    SELECT array_remove(regexp_split_to_array(public.normalize_search_text(p_query), '\s+'), '') AS t
  ),
  sb AS (SELECT * FROM public.ledger_side_balances(v_tenant, p_branch_id, NULL)),
  sball AS (SELECT * FROM public.ledger_side_balances(v_tenant, NULL, NULL)),
  ov AS (SELECT * FROM public.ledger_overdue_rows(v_tenant, p_branch_id, NULL)),
  base AS (
    SELECT c.id, c.name, c.phone, c.contact_person, c.email, c.address, c.notes, c.type, c.branch_id, c.created_at,
           c.opening_balance, c.is_migrated,
           COALESCE(bc.balance, 0) AS customer_balance, COALESCE(bc.open_remaining, 0) AS customer_open,
           COALESCE(bc.advance, 0) AS customer_advance, COALESCE(oc.overdue, 0) AS customer_overdue,
           COALESCE(bs.balance, 0) AS supplier_balance, COALESCE(bs.open_remaining, 0) AS supplier_open,
           COALESCE(bs.advance, 0) AS supplier_advance, COALESCE(os.overdue, 0) AS supplier_overdue,
           COALESCE(ac.balance, 0) AS customer_balance_all, COALESCE(asu.balance, 0) AS supplier_balance_all,
           (p_branch_id IS NULL OR c.branch_id = p_branch_id OR c.branch_id IS NULL
             OR abs(COALESCE(bc.balance, 0)) > 0.005 OR abs(COALESCE(bs.balance, 0)) > 0.005
             OR COALESCE(oc.overdue, 0) > 0.005 OR COALESCE(os.overdue, 0) > 0.005
             OR EXISTS (SELECT 1 FROM invoices i WHERE i.contact_id = c.id AND i.branch_id = p_branch_id)
             OR EXISTS (SELECT 1 FROM shipments s WHERE s.contact_id = c.id AND s.branch_id = p_branch_id)
             OR EXISTS (SELECT 1 FROM purchase_returns pr WHERE pr.contact_id = c.id AND pr.branch_id = p_branch_id)
             OR EXISTS (SELECT 1 FROM money_movements m WHERE m.contact_id = c.id AND m.branch_id = p_branch_id)
             OR EXISTS (SELECT 1 FROM vouchers v WHERE v.party_id = c.id AND v.branch_id = p_branch_id)) AS in_branch
      FROM contacts c
      LEFT JOIN sb bc ON bc.contact_id = c.id AND bc.side = 'customer'
      LEFT JOIN sb bs ON bs.contact_id = c.id AND bs.side = 'supplier'
      LEFT JOIN sball ac ON ac.contact_id = c.id AND ac.side = 'customer'
      LEFT JOIN sball asu ON asu.contact_id = c.id AND asu.side = 'supplier'
      LEFT JOIN ov oc ON oc.contact_id = c.id AND oc.side = 'customer'
      LEFT JOIN ov os ON os.contact_id = c.id AND os.side = 'supplier'
     WHERE c.tenant_id = v_tenant AND c.is_archived = false
  ),
  vis AS (
    SELECT b.id, b.name, b.phone, b.contact_person, b.email, b.address, b.notes, b.type, b.branch_id, b.created_at,
           b.opening_balance, b.is_migrated, b.in_branch,
           CASE WHEN v_c THEN b.customer_balance ELSE 0 END AS customer_balance,
           CASE WHEN v_c THEN b.customer_open ELSE 0 END AS customer_open,
           CASE WHEN v_c THEN b.customer_advance ELSE 0 END AS customer_advance,
           CASE WHEN v_c THEN b.customer_overdue ELSE 0 END AS customer_overdue,
           CASE WHEN v_c THEN b.customer_balance_all ELSE 0 END AS customer_balance_all,
           CASE WHEN v_s THEN b.supplier_balance ELSE 0 END AS supplier_balance,
           CASE WHEN v_s THEN b.supplier_open ELSE 0 END AS supplier_open,
           CASE WHEN v_s THEN b.supplier_advance ELSE 0 END AS supplier_advance,
           CASE WHEN v_s THEN b.supplier_overdue ELSE 0 END AS supplier_overdue,
           CASE WHEN v_s THEN b.supplier_balance_all ELSE 0 END AS supplier_balance_all
      FROM base b
  ),
  scoped AS (
    SELECT vis.* FROM vis, toks
     WHERE CASE WHEN COALESCE(cardinality(toks.t), 0) = 0 THEN vis.in_branch
           ELSE NOT EXISTS (SELECT 1 FROM unnest(toks.t) tk
                             WHERE public.normalize_search_text(concat_ws(' ', vis.name, vis.phone, vis.contact_person, vis.email, vis.address, vis.notes))
                                   NOT LIKE '%' || tk || '%') END
  ),
  typed AS (
    SELECT * FROM scoped
     WHERE p_type = 'all' OR (p_type = 'both' AND type::text = 'both')
        OR (p_type <> 'both' AND type::text IN (p_type, 'both'))
  ),
  filtered AS (
    SELECT * FROM typed
     WHERE p_balance IS NULL OR cardinality(p_balance) = 0
        OR ('owe_us' = ANY (p_balance) AND customer_open > 0.005)
        OR ('we_owe' = ANY (p_balance) AND supplier_open > 0.005)
        OR ('customer_advance' = ANY (p_balance) AND customer_advance > 0.005)
        OR ('supplier_advance' = ANY (p_balance) AND supplier_advance > 0.005)
        OR ('overdue' = ANY (p_balance) AND (customer_overdue > 0.005 OR supplier_overdue > 0.005))
        OR ('settled' = ANY (p_balance) AND customer_open <= 0.005 AND customer_advance <= 0.005
                                       AND supplier_open <= 0.005 AND supplier_advance <= 0.005)
  ),
  page AS (
    SELECT * FROM filtered ORDER BY created_at DESC, id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100000) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(page) - 'in_branch' ORDER BY page.created_at DESC, page.id) FROM page), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'counts', (SELECT jsonb_build_object(
        'all', count(*),
        'customer', count(*) FILTER (WHERE type::text IN ('customer', 'both')),
        'supplier', count(*) FILTER (WHERE type::text IN ('supplier', 'both')),
        'both', count(*) FILTER (WHERE type::text = 'both')) FROM scoped),
    'totals', (SELECT jsonb_build_object(
        'customers_open', COALESCE(round(sum(customer_open), 2), 0),
        'customers_open_count', count(*) FILTER (WHERE customer_open > 0.005),
        'customer_advances', COALESCE(round(sum(customer_advance), 2), 0),
        'customer_advances_count', count(*) FILTER (WHERE customer_advance > 0.005),
        'suppliers_open', COALESCE(round(sum(supplier_open), 2), 0),
        'suppliers_open_count', count(*) FILTER (WHERE supplier_open > 0.005),
        'supplier_advances', COALESCE(round(sum(supplier_advance), 2), 0),
        'supplier_advances_count', count(*) FILTER (WHERE supplier_advance > 0.005),
        'customer_overdue', COALESCE(round(sum(customer_overdue), 2), 0),
        'supplier_overdue', COALESCE(round(sum(supplier_overdue), 2), 0)) FROM typed),
    'sides', jsonb_build_object('customer', v_c, 'supplier', v_s)
  ) INTO v;
  RETURN v;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_movement_ref(p_source_table text, p_source_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE p_source_table
    WHEN 'vouchers' THEN (SELECT v.voucher_number FROM vouchers v WHERE v.id = p_source_id)
    WHEN 'invoice_payments' THEN (SELECT 'دفعة على ' || i.invoice_number || COALESCE(' #' || NULLIF(ip.reference_number, ''), '')
                                    FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id WHERE ip.id = p_source_id)
    WHEN 'payment_transactions' THEN (SELECT COALESCE(NULLIF(pt.reference_number, ''), 'دفعة') FROM payment_transactions pt WHERE pt.id = p_source_id)
    WHEN 'supplier_payments' THEN (SELECT COALESCE(NULLIF(sp.notes, ''), 'دفعة مورد') FROM supplier_payments sp WHERE sp.id = p_source_id)
    WHEN 'returns' THEN (SELECT COALESCE(r.return_number, 'مرتجع بيع') FROM returns r WHERE r.id = p_source_id)
    WHEN 'purchase_returns' THEN (SELECT COALESCE(pr.return_number, 'مرتجع شراء') FROM purchase_returns pr WHERE pr.id = p_source_id)
    WHEN 'invoices' THEN (SELECT 'رد نقدية — ' || i.invoice_number FROM invoices i WHERE i.id = p_source_id)
    WHEN 'customer_credit_log' THEN 'إيداع تحت الحساب'
    WHEN 'contacts' THEN 'رصيد افتتاحي'
  END
$$;

CREATE OR REPLACE FUNCTION public.ledger_kind_label(p_side text, p_kind text, p_effect text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_kind = 'opening' AND p_effect = 'charge' THEN CASE WHEN p_side = 'customer' THEN 'رصيد افتتاحي (مديونية عليه)' ELSE 'رصيد افتتاحي (مستحق له)' END
    WHEN p_kind = 'opening' THEN CASE WHEN p_side = 'customer' THEN 'رصيد افتتاحي (مقدم منه)' ELSE 'رصيد افتتاحي (مقدم لينا عنده)' END
    WHEN p_kind = 'payment' THEN CASE WHEN p_side = 'customer' THEN 'تحصيل' ELSE 'سداد للمورد' END
    WHEN p_kind = 'deposit' THEN 'إيداع تحت الحساب'
    WHEN p_kind = 'refund' THEN CASE WHEN p_side = 'customer' THEN 'رد فلوس للعميل' ELSE 'استرداد من المورد' END
    WHEN p_kind = 'return_credit' THEN CASE WHEN p_side = 'customer' THEN 'مرتجع بيع (رصيد)' ELSE 'مرتجع شراء (خصم من المديونية)' END
  END
$$;

CREATE OR REPLACE FUNCTION public.ledger_contact_documents(p_contact uuid, p_side text, p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (doc_type text, doc_id uuid, doc_number text, doc_date date, branch_id uuid, branch_name text,
               state text, total numeric, paid_money numeric, paid_by_returns numeric, paid_from_other_branches numeric,
               remaining numeric, cancel_reason text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid;
BEGIN
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'side غير صحيح'; END IF;
  v_tenant := public.ledger_read_scope(p_branch_id, p_side);
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'حركات كل الفروع للإدارة فقط — اختار فرعك' USING ERRCODE = '42501';
  END IF;
  PERFORM public.ledger_contact_tenant_check(p_contact, v_tenant);
  RETURN QUERY
  WITH dr AS (SELECT * FROM public.ledger_debt_rows(v_tenant, p_contact) x WHERE x.side = p_side)
  SELECT dr.debt_type, dr.debt_id,
         CASE WHEN dr.debt_type = 'invoice' THEN (SELECT i.invoice_number FROM invoices i WHERE i.id = dr.debt_id)
              WHEN dr.debt_type = 'shipment' THEN (SELECT s.shipment_number FROM shipments s WHERE s.id = dr.debt_id)
              ELSE (SELECT public.ledger_movement_ref(m.source_table, m.source_id) FROM money_movements m WHERE m.id = dr.debt_id) END,
         dr.doc_date, dr.branch_id, (SELECT b.name FROM branches b WHERE b.id = dr.branch_id),
         CASE WHEN dr.remaining > 0.005 THEN 'open' ELSE 'closed' END,
         round(dr.amount, 2), round(dr.allocated - dr.paid_by_returns, 2), round(dr.paid_by_returns, 2),
         round(dr.paid_from_other_branches, 2), round(dr.remaining, 2), NULL::text
    FROM dr
   WHERE p_branch_id IS NULL OR dr.branch_id = p_branch_id
  UNION ALL
  SELECT 'invoice', i.id, i.invoice_number, public.ledger_day(i.invoice_date), i.branch_id, b.name, 'cancelled',
         round(i.total, 2), 0::numeric, 0::numeric, 0::numeric, 0::numeric, i.cancel_reason
    FROM invoices i JOIN branches b ON b.id = i.branch_id
   WHERE p_side = 'customer' AND i.contact_id = p_contact AND i.status <> 'active'
     AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
  UNION ALL
  SELECT 'shipment', s.id, s.shipment_number, public.ledger_day(COALESCE(s.invoice_date, s.created_at)), s.branch_id, b.name, 'cancelled',
         round(s.total_cost, 2), 0, 0, 0, 0, s.cancel_reason
    FROM shipments s JOIN branches b ON b.id = s.branch_id
   WHERE p_side = 'supplier' AND s.contact_id = p_contact AND s.status <> 'active'
     AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  UNION ALL
  SELECT 'invoice', i.id, i.invoice_number, public.ledger_day(i.invoice_date), i.branch_id, b.name, 'before_ledger',
         round(i.total, 2), NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::text
    FROM invoices i JOIN branches b ON b.id = i.branch_id
   WHERE p_side = 'customer' AND i.contact_id = p_contact AND i.status = 'active'
     AND public.ledger_day(i.invoice_date) < public.ledger_cutoff()
     AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
  UNION ALL
  SELECT 'shipment', s.id, s.shipment_number, public.ledger_day(COALESCE(s.invoice_date, s.created_at)), s.branch_id, b.name, 'before_ledger',
         round(s.total_cost, 2), NULL, NULL, NULL, NULL, NULL
    FROM shipments s JOIN branches b ON b.id = s.branch_id
   WHERE p_side = 'supplier' AND s.contact_id = p_contact AND s.status = 'active'
     AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) < public.ledger_cutoff()
     AND (p_branch_id IS NULL OR s.branch_id = p_branch_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_contact_money(p_contact uuid, p_side text, p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (movement_id uuid, kind text, kind_label text, effect text, movement_date date, branch_id uuid, branch_name text,
               method text, amount numeric, allocated numeric, unallocated numeric, used_in_other_branches numeric,
               status text, reference text, source_table text, source_id uuid, target_doc_number text, cancel_reason text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid;
BEGIN
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'side غير صحيح'; END IF;
  v_tenant := public.ledger_read_scope(p_branch_id, p_side);
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'حركات كل الفروع للإدارة فقط — اختار فرعك' USING ERRCODE = '42501';
  END IF;
  PERFORM public.ledger_contact_tenant_check(p_contact, v_tenant);
  RETURN QUERY
  SELECT m.id, m.kind, public.ledger_kind_label(m.side, m.kind, m.effect), m.effect, m.movement_date, m.branch_id, b.name,
         m.method, round(m.amount, 2),
         round(CASE WHEN m.effect = 'settle' THEN COALESCE(a.s, 0) ELSE COALESCE(d.s, 0) END, 2),
         round(CASE WHEN m.status <> 'active' THEN 0 WHEN m.effect = 'settle' THEN m.amount - COALESCE(a.s, 0) ELSE m.amount - COALESCE(d.s, 0) END, 2),
         round(CASE WHEN m.effect = 'settle' THEN COALESCE(a.sx, 0) ELSE 0 END, 2),
         m.status, public.ledger_movement_ref(m.source_table, m.source_id), m.source_table, m.source_id,
         CASE m.target_doc_type WHEN 'invoice' THEN (SELECT i.invoice_number FROM invoices i WHERE i.id = m.target_doc_id)
                                WHEN 'shipment' THEN (SELECT s.shipment_number FROM shipments s WHERE s.id = m.target_doc_id) END,
         m.cancel_reason
    FROM money_movements m
    JOIN branches b ON b.id = m.branch_id
    LEFT JOIN (SELECT pa.movement_id, sum(pa.amount) s, sum(pa.amount) FILTER (WHERE pa.is_cross_branch) sx
                 FROM payment_allocations pa WHERE pa.status = 'active' AND pa.contact_id = p_contact GROUP BY 1) a ON a.movement_id = m.id
    LEFT JOIN (SELECT pa.debt_id, sum(pa.amount) s
                 FROM payment_allocations pa WHERE pa.status = 'active' AND pa.contact_id = p_contact AND pa.debt_type = 'movement' GROUP BY 1) d ON d.debt_id = m.id
   WHERE m.tenant_id = v_tenant AND m.contact_id = p_contact AND m.side = p_side
     AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)
     AND (m.status = 'active' OR NOT EXISTS (SELECT 1 FROM money_movements r WHERE r.status = 'active'
            AND r.source_table = m.source_table AND r.source_id = m.source_id AND r.kind = m.kind AND r.side = m.side));
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_contact_statement(p_contact uuid, p_side text, p_branch_id uuid DEFAULT NULL,
                                                          p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (line_no int, line_date date, line_type text, reference text, branch_name text, description text,
               debit numeric, credit numeric, balance numeric, doc_type text, doc_id uuid, branch_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid;
BEGIN
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'side غير صحيح'; END IF;
  v_tenant := public.ledger_read_scope(p_branch_id, p_side);
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'حركات كل الفروع للإدارة فقط — اختار فرعك' USING ERRCODE = '42501';
  END IF;
  PERFORM public.ledger_contact_tenant_check(p_contact, v_tenant);
  RETURN QUERY
  WITH ev AS (
    SELECT dr.doc_date AS d, 1 AS o, dr.created_at AS ts, dr.debt_id AS id,
           CASE WHEN dr.debt_type = 'invoice' THEN 'فاتورة بيع' WHEN dr.debt_type = 'shipment' THEN 'فاتورة شراء'
                ELSE (SELECT public.ledger_kind_label(m.side, m.kind, m.effect) FROM money_movements m WHERE m.id = dr.debt_id) END AS t,
           CASE WHEN dr.debt_type = 'invoice' THEN (SELECT i.invoice_number FROM invoices i WHERE i.id = dr.debt_id)
                WHEN dr.debt_type = 'shipment' THEN (SELECT s.shipment_number FROM shipments s WHERE s.id = dr.debt_id)
                ELSE (SELECT public.ledger_movement_ref(m.source_table, m.source_id) FROM money_movements m WHERE m.id = dr.debt_id) END AS ref,
           dr.branch_id AS br, NULL::text AS descr, dr.amount AS dr_amt, 0::numeric AS cr_amt,
           CASE WHEN dr.debt_type = 'movement' THEN NULL ELSE dr.debt_type END AS dt,
           CASE WHEN dr.debt_type = 'movement' THEN NULL ELSE dr.debt_id END AS did
      FROM public.ledger_debt_rows(v_tenant, p_contact) dr
     WHERE dr.side = p_side AND (p_branch_id IS NULL OR dr.branch_id = p_branch_id)
    UNION ALL
    SELECT m.movement_date, 2, m.created_at, m.id, public.ledger_kind_label(m.side, m.kind, m.effect),
           public.ledger_movement_ref(m.source_table, m.source_id), m.branch_id,
           CASE WHEN m.method IS NOT NULL THEN m.method END, 0, m.amount, NULL, NULL
      FROM money_movements m
     WHERE m.tenant_id = v_tenant AND m.contact_id = p_contact AND m.side = p_side AND m.status = 'active'
       AND m.effect = 'settle' AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)
    UNION ALL
    SELECT pa.effective_date, 3, pa.created_at, pa.id, 'سداد من فرع آخر',
           (SELECT b.name FROM branches b WHERE b.id = pa.movement_branch_id), pa.debt_branch_id,
           'اتسدد من فلوس متسجلة في فرع تاني (حساب جاري بين الفروع 1910)', 0, pa.amount, NULL, NULL
      FROM payment_allocations pa
     WHERE p_branch_id IS NOT NULL AND pa.tenant_id = v_tenant AND pa.contact_id = p_contact AND pa.side = p_side
       AND pa.status = 'active' AND pa.is_cross_branch AND pa.debt_branch_id = p_branch_id
    UNION ALL
    SELECT pa.effective_date, 3, pa.created_at, pa.id, 'استخدام في فرع آخر',
           (SELECT b.name FROM branches b WHERE b.id = pa.debt_branch_id), pa.movement_branch_id,
           'فلوس اتسجلت هنا واتسدد بيها مستند في فرع تاني (حساب جاري بين الفروع 1910)', pa.amount, 0, NULL, NULL
      FROM payment_allocations pa
     WHERE p_branch_id IS NOT NULL AND pa.tenant_id = v_tenant AND pa.contact_id = p_contact AND pa.side = p_side
       AND pa.status = 'active' AND pa.is_cross_branch AND pa.movement_branch_id = p_branch_id
  ),
  ordered AS (
    SELECT ev.*, sum(ev.dr_amt - ev.cr_amt) OVER (ORDER BY ev.d, ev.o, ev.ts, ev.id ROWS UNBOUNDED PRECEDING) AS run,
           row_number() OVER (ORDER BY ev.d, ev.o, ev.ts, ev.id) AS rn
      FROM ev
  ),
  pre AS (
    SELECT COALESCE(sum(o.dr_amt - o.cr_amt), 0) AS v FROM ordered o WHERE p_from IS NOT NULL AND o.d < p_from
  )
  SELECT 0, p_from, 'رصيد أول المدة'::text, NULL::text, NULL::text, NULL::text, 0::numeric, 0::numeric, round(pre.v, 2), NULL::text, NULL::uuid, NULL::uuid
    FROM pre WHERE p_from IS NOT NULL
  UNION ALL
  SELECT o.rn::int, o.d, o.t, o.ref, (SELECT b.name FROM branches b WHERE b.id = o.br), o.descr,
         round(o.dr_amt, 2), round(o.cr_amt, 2), round(o.run, 2), o.dt, o.did, o.br
    FROM ordered o
   WHERE (p_from IS NULL OR o.d >= p_from) AND (p_to IS NULL OR o.d <= p_to)
   ORDER BY 1;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_contact_overview(p_contact uuid, p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid; v_cust jsonb; v_supp jsonb; v_contact jsonb;
BEGIN
  v_tenant := public.ledger_read_scope(p_branch_id, 'any');
  PERFORM public.ledger_contact_tenant_check(p_contact, v_tenant);

  SELECT jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type, 'phone', c.phone, 'contact_person', c.contact_person,
                            'address', c.address, 'notes', c.notes, 'email', c.email, 'is_archived', c.is_archived,
                            'opening_balance', c.opening_balance, 'branch_id', c.branch_id,
                            'branch_name', (SELECT b.name FROM branches b WHERE b.id = c.branch_id),
                            'branches', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name)
                                                    FROM branches b WHERE b.tenant_id = v_tenant AND (
                                                      EXISTS (SELECT 1 FROM invoices i WHERE i.contact_id = c.id AND i.branch_id = b.id)
                                                      OR EXISTS (SELECT 1 FROM shipments s WHERE s.contact_id = c.id AND s.branch_id = b.id)
                                                      OR EXISTS (SELECT 1 FROM money_movements m WHERE m.contact_id = c.id AND m.branch_id = b.id AND m.status = 'active')
                                                      OR EXISTS (SELECT 1 FROM vouchers v WHERE v.party_id = c.id AND v.branch_id = b.id))), '[]'::jsonb))
    INTO v_contact FROM contacts c WHERE c.id = p_contact;

  IF public.ledger_can_see_side('customer') THEN
    WITH dr AS (SELECT * FROM public.ledger_debt_rows(v_tenant, p_contact) x
                 WHERE x.side = 'customer' AND (p_branch_id IS NULL OR x.branch_id = p_branch_id)),
         cr AS (SELECT * FROM public.ledger_credit_rows(v_tenant, p_contact) x
                 WHERE x.side = 'customer' AND (p_branch_id IS NULL OR x.branch_id = p_branch_id)),
         mv AS (SELECT * FROM money_movements m WHERE m.contact_id = p_contact AND m.side = 'customer' AND m.status = 'active'
                   AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)),
         rt AS (SELECT r.* FROM returns r JOIN invoices i ON i.id = r.invoice_id
                 WHERE i.contact_id = p_contact AND COALESCE(r.status, 'active') NOT IN ('draft', 'cancelled')
                   AND public.ledger_day(COALESCE(r.invoice_date, r.created_at)) >= public.ledger_cutoff()
                   AND (p_branch_id IS NULL OR COALESCE(r.branch_id, i.branch_id) = p_branch_id))
    SELECT jsonb_build_object(
      'documents', jsonb_build_object(
        'count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'invoice'),
        'total', (SELECT COALESCE(round(sum(dr.amount), 2), 0) FROM dr WHERE dr.debt_type = 'invoice'),
        'open_count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'invoice' AND dr.remaining > 0.005),
        'closed_count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'invoice' AND dr.remaining <= 0.005),
        'cancelled_count', (SELECT count(*) FROM invoices i WHERE i.contact_id = p_contact AND i.status <> 'active'
                              AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)),
        'cancelled_total', (SELECT COALESCE(round(sum(i.total), 2), 0) FROM invoices i WHERE i.contact_id = p_contact AND i.status <> 'active'
                              AND (p_branch_id IS NULL OR i.branch_id = p_branch_id))),
      'returns', jsonb_build_object(
        'count', (SELECT count(*) FROM rt),
        'total', (SELECT COALESCE(round(sum(rt.total_refund), 2), 0) FROM rt),
        'cash', (SELECT COALESCE(round(sum(COALESCE(rt.refund_cash_amount, 0) + COALESCE(rt.refund_transfer_amount, 0)), 2), 0) FROM rt),
        'credit', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'return_credit')),
      'money', jsonb_build_object(
        'collected', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind IN ('payment', 'deposit')),
        'deposits', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'deposit'),
        'by_method', COALESCE((SELECT jsonb_object_agg(x.method, x.amt) FROM (
                         SELECT COALESCE(mv.method, 'other') AS method, round(sum(mv.amount), 2) AS amt FROM mv
                          WHERE mv.kind IN ('payment', 'deposit') GROUP BY 1) x), '{}'::jsonb),
        'refunded', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'refund'),
        'opening_debt', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'opening' AND mv.effect = 'charge'),
        'opening_advance', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'opening' AND mv.effect = 'settle')),
      'open_remaining', (SELECT COALESCE(round(sum(dr.remaining), 2), 0) FROM dr),
      'advance', (SELECT COALESCE(round(sum(cr.unallocated), 2), 0) FROM cr),
      'balance', (SELECT COALESCE(round(sum(dr.remaining), 2), 0) FROM dr) - (SELECT COALESCE(round(sum(cr.unallocated), 2), 0) FROM cr),
      'overdue', COALESCE((SELECT o.overdue FROM public.ledger_overdue_rows(v_tenant, p_branch_id, p_contact) o WHERE o.side = 'customer'), 0),
      'paid_from_other_branches', (SELECT COALESCE(round(sum(dr.paid_from_other_branches), 2), 0) FROM dr),
      'used_in_other_branches', (SELECT COALESCE(round(sum(cr.used_in_other_branches), 2), 0) FROM cr),
      'before_ledger', jsonb_build_object(
        'count', (SELECT count(*) FROM invoices i WHERE i.contact_id = p_contact AND i.status = 'active'
                    AND public.ledger_day(i.invoice_date) < public.ledger_cutoff() AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)),
        'total', (SELECT COALESCE(round(sum(i.total), 2), 0) FROM invoices i WHERE i.contact_id = p_contact AND i.status = 'active'
                    AND public.ledger_day(i.invoice_date) < public.ledger_cutoff() AND (p_branch_id IS NULL OR i.branch_id = p_branch_id))))
      INTO v_cust;
  END IF;

  IF public.ledger_can_see_side('supplier') THEN
    WITH dr AS (SELECT * FROM public.ledger_debt_rows(v_tenant, p_contact) x
                 WHERE x.side = 'supplier' AND (p_branch_id IS NULL OR x.branch_id = p_branch_id)),
         cr AS (SELECT * FROM public.ledger_credit_rows(v_tenant, p_contact) x
                 WHERE x.side = 'supplier' AND (p_branch_id IS NULL OR x.branch_id = p_branch_id)),
         mv AS (SELECT * FROM money_movements m WHERE m.contact_id = p_contact AND m.side = 'supplier' AND m.status = 'active'
                   AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)),
         rt AS (SELECT pr.* FROM purchase_returns pr
                 WHERE pr.contact_id = p_contact AND pr.status = 'active'
                   AND public.ledger_day(COALESCE(pr.invoice_date, pr.created_at)) >= public.ledger_cutoff()
                   AND (p_branch_id IS NULL OR pr.branch_id = p_branch_id))
    SELECT jsonb_build_object(
      'documents', jsonb_build_object(
        'count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'shipment'),
        'total', (SELECT COALESCE(round(sum(dr.amount), 2), 0) FROM dr WHERE dr.debt_type = 'shipment'),
        'open_count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'shipment' AND dr.remaining > 0.005),
        'closed_count', (SELECT count(*) FROM dr WHERE dr.debt_type = 'shipment' AND dr.remaining <= 0.005),
        'cancelled_count', (SELECT count(*) FROM shipments s WHERE s.contact_id = p_contact AND s.status <> 'active'
                              AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)),
        'cancelled_total', (SELECT COALESCE(round(sum(s.total_cost), 2), 0) FROM shipments s WHERE s.contact_id = p_contact AND s.status <> 'active'
                              AND (p_branch_id IS NULL OR s.branch_id = p_branch_id))),
      'returns', jsonb_build_object(
        'count', (SELECT count(*) FROM rt),
        'total', (SELECT COALESCE(round(sum(rt.total_amount), 2), 0) FROM rt),
        'cash', (SELECT COALESCE(round(sum(COALESCE(rt.refund_cash_amount, 0) + COALESCE(rt.refund_transfer_amount, 0)), 2), 0) FROM rt),
        'credit', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'return_credit')),
      'money', jsonb_build_object(
        'paid', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind IN ('payment', 'deposit')),
        'by_method', COALESCE((SELECT jsonb_object_agg(x.method, x.amt) FROM (
                         SELECT COALESCE(mv.method, 'other') AS method, round(sum(mv.amount), 2) AS amt FROM mv
                          WHERE mv.kind IN ('payment', 'deposit') GROUP BY 1) x), '{}'::jsonb),
        'refunded', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'refund'),
        'opening_debt', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'opening' AND mv.effect = 'charge'),
        'opening_advance', (SELECT COALESCE(round(sum(mv.amount), 2), 0) FROM mv WHERE mv.kind = 'opening' AND mv.effect = 'settle')),
      'open_remaining', (SELECT COALESCE(round(sum(dr.remaining), 2), 0) FROM dr),
      'advance', (SELECT COALESCE(round(sum(cr.unallocated), 2), 0) FROM cr),
      'balance', (SELECT COALESCE(round(sum(dr.remaining), 2), 0) FROM dr) - (SELECT COALESCE(round(sum(cr.unallocated), 2), 0) FROM cr),
      'overdue', COALESCE((SELECT o.overdue FROM public.ledger_overdue_rows(v_tenant, p_branch_id, p_contact) o WHERE o.side = 'supplier'), 0),
      'paid_from_other_branches', (SELECT COALESCE(round(sum(dr.paid_from_other_branches), 2), 0) FROM dr),
      'used_in_other_branches', (SELECT COALESCE(round(sum(cr.used_in_other_branches), 2), 0) FROM cr),
      'discounts', (SELECT COALESCE(round(sum(s.discount_amount), 2), 0) FROM shipments s WHERE s.contact_id = p_contact AND s.status = 'active'
                      AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= public.ledger_cutoff()
                      AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)),
      'before_ledger', jsonb_build_object(
        'count', (SELECT count(*) FROM shipments s WHERE s.contact_id = p_contact AND s.status = 'active'
                    AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) < public.ledger_cutoff() AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)),
        'total', (SELECT COALESCE(round(sum(s.total_cost), 2), 0) FROM shipments s WHERE s.contact_id = p_contact AND s.status = 'active'
                    AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) < public.ledger_cutoff() AND (p_branch_id IS NULL OR s.branch_id = p_branch_id))))
      INTO v_supp;
  END IF;

  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    v_cust := CASE WHEN v_cust IS NULL THEN NULL ELSE jsonb_build_object('totals_only', true,
                'balance', v_cust->'balance', 'open_remaining', v_cust->'open_remaining', 'advance', v_cust->'advance', 'overdue', v_cust->'overdue') END;
    v_supp := CASE WHEN v_supp IS NULL THEN NULL ELSE jsonb_build_object('totals_only', true,
                'balance', v_supp->'balance', 'open_remaining', v_supp->'open_remaining', 'advance', v_supp->'advance', 'overdue', v_supp->'overdue') END;
    v_contact := v_contact - 'branches';
  END IF;
  RETURN jsonb_build_object('contact', v_contact, 'branch_id', p_branch_id, 'ledger_date', public.ledger_cutoff(),
                            'customer', v_cust, 'supplier', v_supp);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_document_status(p_doc_type text, p_ids uuid[])
RETURNS TABLE (doc_id uuid, total numeric, paid numeric, paid_money numeric, paid_by_returns numeric,
               paid_from_other_branches numeric, remaining numeric, state text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid; v_uid uuid := auth.uid(); v_all boolean;
BEGIN
  IF p_doc_type NOT IN ('invoice', 'shipment') THEN RAISE EXCEPTION 'نوع المستند غير صحيح'; END IF;
  v_tenant := public.assert_company_access(NULL);
  IF COALESCE(cardinality(p_ids), 0) > 5000 THEN RAISE EXCEPTION 'عدد مستندات كبير في طلب واحد (الحد 5000)'; END IF;
  v_all := public.is_admin(v_uid) OR public.is_super_admin(v_uid);
  RETURN QUERY
  WITH docs AS (
    SELECT i.id, i.tenant_id, i.branch_id, i.total AS amt, i.status::text AS st,
           public.ledger_day(i.invoice_date) >= public.ledger_cutoff() AS in_ledger
      FROM invoices i WHERE p_doc_type = 'invoice' AND i.id = ANY (p_ids)
    UNION ALL
    SELECT s.id, s.tenant_id, s.branch_id, s.total_cost, s.status,
           public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= public.ledger_cutoff()
      FROM shipments s WHERE p_doc_type = 'shipment' AND s.id = ANY (p_ids)
  ),
  ok AS (SELECT * FROM docs WHERE docs.tenant_id = v_tenant AND (v_all OR public.user_in_branch(v_uid, docs.branch_id))),
  a AS (
    SELECT pa.debt_id, sum(pa.amount) s, sum(pa.amount) FILTER (WHERE mv.kind = 'return_credit') sr,
           sum(pa.amount) FILTER (WHERE pa.is_cross_branch) sx
      FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
     WHERE pa.status = 'active' AND pa.debt_type = p_doc_type AND pa.debt_id IN (SELECT ok.id FROM ok)
     GROUP BY 1
  )
  SELECT ok.id, round(ok.amt, 2),
         round(COALESCE(a.s, 0), 2), round(COALESCE(a.s, 0) - COALESCE(a.sr, 0), 2), round(COALESCE(a.sr, 0), 2),
         round(COALESCE(a.sx, 0), 2),
         CASE WHEN ok.st <> 'active' OR NOT ok.in_ledger THEN 0 ELSE round(ok.amt - COALESCE(a.s, 0), 2) END,
         CASE WHEN ok.st <> 'active' THEN 'cancelled'
              WHEN NOT ok.in_ledger THEN 'before_ledger'
              WHEN ok.amt - COALESCE(a.s, 0) <= 0.005 THEN 'paid'
              WHEN COALESCE(a.s, 0) > 0.005 THEN 'partial'
              ELSE 'unpaid' END
    FROM ok LEFT JOIN a ON a.debt_id = ok.id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_position(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid; v_c boolean; v_s boolean; v jsonb;
BEGIN
  v_tenant := public.ledger_read_scope(p_branch_id, 'any');
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'مركز الشركة كلها للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  v_c := public.ledger_can_see_side('customer');
  v_s := public.ledger_can_see_side('supplier');
  WITH sb AS (SELECT * FROM public.ledger_side_balances(v_tenant, p_branch_id, NULL)),
       ov AS (SELECT * FROM public.ledger_overdue_rows(v_tenant, p_branch_id, NULL)),
       walk AS (SELECT dr.* FROM public.ledger_debt_rows(v_tenant, NULL) dr
                 WHERE dr.contact_id IS NULL AND (p_branch_id IS NULL OR dr.branch_id = p_branch_id)),
       xb AS (SELECT pa.* FROM payment_allocations pa
               WHERE pa.tenant_id = v_tenant AND pa.status = 'active' AND pa.is_cross_branch
                 AND (p_branch_id IS NULL OR pa.debt_branch_id = p_branch_id OR pa.movement_branch_id = p_branch_id))
  SELECT jsonb_build_object(
    'branch_id', p_branch_id,
    'ledger_date', public.ledger_cutoff(),
    'customers', CASE WHEN v_c THEN jsonb_build_object(
        'open', COALESCE((SELECT round(sum(open_remaining), 2) FROM sb WHERE side = 'customer'), 0),
        'open_contacts', (SELECT count(*) FROM sb WHERE side = 'customer' AND open_remaining > 0.005),
        'advances', COALESCE((SELECT round(sum(advance), 2) FROM sb WHERE side = 'customer'), 0),
        'advance_contacts', (SELECT count(*) FROM sb WHERE side = 'customer' AND advance > 0.005),
        'overdue', COALESCE((SELECT round(sum(overdue), 2) FROM ov WHERE side = 'customer'), 0),
        'walkin_open', COALESCE((SELECT round(sum(remaining), 2) FROM walk WHERE remaining > 0.005), 0)) END,
    'suppliers', CASE WHEN v_s THEN jsonb_build_object(
        'open', COALESCE((SELECT round(sum(open_remaining), 2) FROM sb WHERE side = 'supplier'), 0),
        'open_contacts', (SELECT count(*) FROM sb WHERE side = 'supplier' AND open_remaining > 0.005),
        'advances', COALESCE((SELECT round(sum(advance), 2) FROM sb WHERE side = 'supplier'), 0),
        'advance_contacts', (SELECT count(*) FROM sb WHERE side = 'supplier' AND advance > 0.005),
        'overdue', COALESCE((SELECT round(sum(overdue), 2) FROM ov WHERE side = 'supplier'), 0)) END,
    'cross_branch', jsonb_build_object(
        'paid_here_for_other_branches', COALESCE((SELECT round(sum(amount), 2) FROM xb WHERE p_branch_id IS NOT NULL AND movement_branch_id = p_branch_id), 0),
        'paid_elsewhere_for_this_branch', COALESCE((SELECT round(sum(amount), 2) FROM xb WHERE p_branch_id IS NOT NULL AND debt_branch_id = p_branch_id), 0),
        'total', COALESCE((SELECT round(sum(amount), 2) FROM xb), 0),
        'count', (SELECT count(*) FROM xb))
  ) INTO v;
  RETURN v;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_aging(p_side text, p_branch_id uuid DEFAULT NULL)
RETURNS TABLE (contact_id uuid, contact_name text, contact_type text, d0_30 numeric, d31_60 numeric, d61_90 numeric,
               d91_120 numeric, d120_plus numeric, total_open numeric, advance numeric, oldest_date date)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid; v_today date := public.cairo_today();
BEGIN
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'side غير صحيح'; END IF;
  v_tenant := public.ledger_read_scope(p_branch_id, p_side);
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'أعمار الديون لكل الفروع للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH d AS (
    SELECT dr.contact_id, dr.remaining, v_today - dr.doc_date AS age, dr.doc_date
      FROM public.ledger_debt_rows(v_tenant, NULL) dr
     WHERE dr.side = p_side AND dr.contact_id IS NOT NULL AND dr.remaining > 0.005
       AND (p_branch_id IS NULL OR dr.branch_id = p_branch_id)
  ),
  a AS (
    SELECT cr.contact_id, sum(cr.unallocated) AS adv
      FROM public.ledger_credit_rows(v_tenant, NULL) cr
     WHERE cr.side = p_side AND cr.contact_id IS NOT NULL AND cr.unallocated > 0.005
       AND (p_branch_id IS NULL OR cr.branch_id = p_branch_id)
     GROUP BY 1
  ),
  ids AS (SELECT d.contact_id FROM d UNION SELECT a.contact_id FROM a)
  SELECT c.id, c.name, c.type,
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age <= 30), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age BETWEEN 31 AND 60), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age BETWEEN 61 AND 90), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age BETWEEN 91 AND 120), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age > 120), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id), 0), 2),
         round(COALESCE((SELECT a.adv FROM a WHERE a.contact_id = c.id), 0), 2),
         (SELECT min(d.doc_date) FROM d WHERE d.contact_id = c.id)
    FROM ids JOIN contacts c ON c.id = ids.contact_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.ledger_can_see_side(text)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_read_scope(uuid, text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_contact_tenant_check(uuid, uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_debt_rows(uuid, uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_credit_rows(uuid, uuid)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_overdue_rows(uuid, uuid, uuid)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_side_balances(uuid, uuid, uuid)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_movement_ref(text, uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.contact_side_balances(uuid[], uuid),
  public.contacts_page(uuid, text, text, text[], integer, integer),
  public.ledger_contact_documents(uuid, text, uuid),
  public.ledger_contact_money(uuid, text, uuid),
  public.ledger_contact_statement(uuid, text, uuid, date, date),
  public.ledger_contact_overview(uuid, uuid),
  public.ledger_document_status(text, uuid[]),
  public.ledger_position(uuid),
  public.ledger_aging(text, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.contact_side_balances(uuid[], uuid),
  public.contacts_page(uuid, text, text, text[], integer, integer),
  public.ledger_contact_documents(uuid, text, uuid),
  public.ledger_contact_money(uuid, text, uuid),
  public.ledger_contact_statement(uuid, text, uuid, date, date),
  public.ledger_contact_overview(uuid, uuid),
  public.ledger_document_status(text, uuid[]),
  public.ledger_position(uuid),
  public.ledger_aging(text, uuid)
TO authenticated, service_role;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('contact_side_balances',     '0056', 'read-only; customer/supplier sides separate; side permission and branch membership'),
  ('contacts_page',             '0056', 'read-only; ledger side balances; all-branches view for admins'),
  ('ledger_contact_documents',  '0056', 'read-only contact file; side permission and branch membership; all branches for admins'),
  ('ledger_contact_money',      '0056', 'read-only contact file; side permission and branch membership'),
  ('ledger_contact_statement',  '0056', 'read-only contact statement per side; side permission and branch membership'),
  ('ledger_contact_overview',   '0056', 'read-only contact file cards; hidden side = null'),
  ('ledger_document_status',    '0056', 'read-only paid/remaining of listed documents; tenant and branch membership'),
  ('ledger_position',           '0056', 'read-only company/branch receivables, payables and advances'),
  ('ledger_aging',              '0056', 'read-only aging of open documents per side; all-branches view for admins')
ON CONFLICT (function_name) DO UPDATE SET added_in = EXCLUDED.added_in, note = EXCLUDED.note;

DO $check$
DECLARE v_list text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Step 6C: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
END
$check$;