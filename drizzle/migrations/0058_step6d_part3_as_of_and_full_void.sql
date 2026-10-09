-- Step 6D part 3: documents as of a date, full payment void, single fee.
CREATE OR REPLACE FUNCTION public.ledger_simulate_as_of(p_tenant uuid, p_contact uuid, p_side text, p_as_of date, p_invoice uuid DEFAULT NULL)
RETURNS TABLE (row_kind text, debt_type text, debt_id uuid, branch_id uuid, doc_date date, amount numeric,
               allocated numeric, by_returns numeric, from_other_branches numeric, remaining numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_cut date := public.ledger_cutoff();
  d_type text[]; d_id uuid[]; d_br uuid[]; d_dd date[]; d_amt numeric[]; d_rem numeric[]; d_ret numeric[]; d_x numeric[];
  c_id uuid[]; c_br uuid[]; c_md date[]; c_kind text[]; c_amt numeric[]; c_rem numeric[]; c_tt text[]; c_tid uuid[];
  f record; i int; j int; p int := 1; nd int; nc int; v_take numeric;
BEGIN
  SELECT array_agg(x.t ORDER BY x.ff, x.dd, x.ts, x.id), array_agg(x.id ORDER BY x.ff, x.dd, x.ts, x.id),
         array_agg(x.br ORDER BY x.ff, x.dd, x.ts, x.id), array_agg(x.dd ORDER BY x.ff, x.dd, x.ts, x.id),
         array_agg(x.amt ORDER BY x.ff, x.dd, x.ts, x.id)
    INTO d_type, d_id, d_br, d_dd, d_amt
    FROM (
      SELECT 'invoice'::text AS t, iv.id, iv.branch_id AS br, public.ledger_day(iv.invoice_date) AS dd, iv.created_at AS ts, 1 AS ff, iv.total AS amt
        FROM invoices iv
       WHERE p_side = 'customer' AND iv.tenant_id = p_tenant AND iv.status = 'active' AND iv.total > 0
         AND ((p_contact IS NOT NULL AND iv.contact_id = p_contact) OR (p_contact IS NULL AND iv.id = p_invoice AND iv.contact_id IS NULL))
         AND public.ledger_day(iv.invoice_date) BETWEEN v_cut AND p_as_of
      UNION ALL
      SELECT 'shipment', s.id, s.branch_id, public.ledger_day(COALESCE(s.invoice_date, s.created_at)), s.created_at, 1, s.total_cost
        FROM shipments s
       WHERE p_side = 'supplier' AND p_contact IS NOT NULL AND s.contact_id = p_contact AND s.status = 'active' AND s.total_cost > 0
         AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) BETWEEN v_cut AND p_as_of
      UNION ALL
      SELECT 'movement', mm.id, mm.branch_id, COALESCE(public.ledger_day(ci.invoice_date), mm.movement_date),
             COALESCE(ci.created_at, mm.created_at), CASE WHEN mm.kind = 'opening' THEN 0 ELSE 1 END, mm.amount
        FROM money_movements mm
        LEFT JOIN invoices ci ON mm.source_table = 'invoices' AND mm.kind = 'refund' AND ci.id = mm.source_id
       WHERE p_contact IS NOT NULL AND mm.contact_id = p_contact AND mm.side = p_side AND mm.status = 'active'
         AND mm.effect = 'charge' AND mm.movement_date <= p_as_of
    ) x;
  nd := COALESCE(array_length(d_id, 1), 0);
  d_rem := d_amt;
  IF nd > 0 THEN
    d_ret := array_fill(0::numeric, ARRAY[nd]);
    d_x := array_fill(0::numeric, ARRAY[nd]);
  END IF;

  SELECT array_agg(mm.id ORDER BY mm.movement_date, mm.created_at, mm.id), array_agg(mm.branch_id ORDER BY mm.movement_date, mm.created_at, mm.id),
         array_agg(mm.movement_date ORDER BY mm.movement_date, mm.created_at, mm.id),
         array_agg(mm.kind ORDER BY mm.movement_date, mm.created_at, mm.id),
         array_agg(mm.amount ORDER BY mm.movement_date, mm.created_at, mm.id),
         array_agg(mm.target_doc_type ORDER BY mm.movement_date, mm.created_at, mm.id),
         array_agg(mm.target_doc_id ORDER BY mm.movement_date, mm.created_at, mm.id)
    INTO c_id, c_br, c_md, c_kind, c_amt, c_tt, c_tid
    FROM money_movements mm
   WHERE mm.tenant_id = p_tenant AND mm.side = p_side AND mm.status = 'active' AND mm.effect = 'settle'
     AND mm.movement_date <= p_as_of
     AND ((p_contact IS NOT NULL AND mm.contact_id = p_contact)
          OR (p_contact IS NULL AND mm.contact_id IS NULL AND mm.target_doc_type = 'invoice' AND mm.target_doc_id = p_invoice));
  nc := COALESCE(array_length(c_id, 1), 0);
  c_rem := c_amt;

  IF nd > 0 AND nc > 0 THEN
    FOR f IN
      SELECT pa.movement_id, pa.debt_id, sum(pa.amount) AS amt
        FROM payment_allocations pa
       WHERE pa.status = 'active' AND pa.tenant_id = p_tenant AND pa.side = p_side
         AND pa.movement_id = ANY (c_id) AND pa.debt_id = ANY (d_id) AND pa.effective_date <= p_as_of
         AND public.ledger_period_closed(p_tenant, pa.effective_date)
       GROUP BY 1, 2
    LOOP
      i := array_position(d_id, f.debt_id); j := array_position(c_id, f.movement_id);
      d_rem[i] := d_rem[i] - f.amt; c_rem[j] := c_rem[j] - f.amt;
      IF c_kind[j] = 'return_credit' THEN d_ret[i] := d_ret[i] + f.amt; END IF;
      IF c_br[j] <> d_br[i] THEN d_x[i] := d_x[i] + f.amt; END IF;
    END LOOP;

    FOR j IN 1..nc LOOP
      CONTINUE WHEN c_tid[j] IS NULL OR c_rem[j] <= 0.005;
      i := array_position(d_id, c_tid[j]);
      CONTINUE WHEN i IS NULL;
      CONTINUE WHEN d_type[i] <> c_tt[j] OR d_rem[i] <= 0.005;
      v_take := LEAST(c_rem[j], d_rem[i]);
      d_rem[i] := d_rem[i] - v_take; c_rem[j] := c_rem[j] - v_take;
      IF c_kind[j] = 'return_credit' THEN d_ret[i] := d_ret[i] + v_take; END IF;
      IF c_br[j] <> d_br[i] THEN d_x[i] := d_x[i] + v_take; END IF;
    END LOOP;

    IF p_contact IS NOT NULL THEN
      FOR j IN 1..nc LOOP
        CONTINUE WHEN c_rem[j] <= 0.005;
        WHILE p <= nd AND d_rem[p] <= 0.005 LOOP p := p + 1; END LOOP;
        i := p;
        WHILE i <= nd AND c_rem[j] > 0.005 LOOP
          IF d_rem[i] > 0.005 THEN
            v_take := LEAST(c_rem[j], d_rem[i]);
            d_rem[i] := d_rem[i] - v_take; c_rem[j] := c_rem[j] - v_take;
            IF c_kind[j] = 'return_credit' THEN d_ret[i] := d_ret[i] + v_take; END IF;
            IF c_br[j] <> d_br[i] THEN d_x[i] := d_x[i] + v_take; END IF;
          END IF;
          i := i + 1;
        END LOOP;
      END LOOP;
    END IF;
  END IF;

  FOR i IN 1..nd LOOP
    row_kind := 'debt'; debt_type := d_type[i]; debt_id := d_id[i]; branch_id := d_br[i]; doc_date := d_dd[i];
    amount := round(d_amt[i], 2); allocated := round(d_amt[i] - d_rem[i], 2); by_returns := round(d_ret[i], 2);
    from_other_branches := round(d_x[i], 2); remaining := round(d_rem[i], 2);
    RETURN NEXT;
  END LOOP;
  FOR j IN 1..nc LOOP
    row_kind := 'credit'; debt_type := c_kind[j]; debt_id := c_id[j]; branch_id := c_br[j]; doc_date := c_md[j];
    amount := round(c_amt[j], 2); allocated := round(c_amt[j] - c_rem[j], 2); by_returns := 0; from_other_branches := 0;
    remaining := round(c_rem[j], 2);
    RETURN NEXT;
  END LOOP;
END
$fn$;

DROP FUNCTION IF EXISTS public.ledger_document_status(text, uuid[]);
CREATE OR REPLACE FUNCTION public.ledger_document_status(p_doc_type text, p_ids uuid[], p_as_of date DEFAULT NULL)
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

  IF p_as_of IS NULL OR p_as_of >= public.cairo_today() THEN
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
    RETURN;
  END IF;

  RETURN QUERY
  WITH docs AS (
    SELECT i.id, i.tenant_id, i.branch_id, i.contact_id, i.total AS amt, i.status::text AS st, public.ledger_day(i.invoice_date) AS dd
      FROM invoices i WHERE p_doc_type = 'invoice' AND i.id = ANY (p_ids)
    UNION ALL
    SELECT s.id, s.tenant_id, s.branch_id, s.contact_id, s.total_cost, s.status, public.ledger_day(COALESCE(s.invoice_date, s.created_at))
      FROM shipments s WHERE p_doc_type = 'shipment' AND s.id = ANY (p_ids)
  ),
  ok AS (SELECT * FROM docs WHERE docs.tenant_id = v_tenant AND (v_all OR public.user_in_branch(v_uid, docs.branch_id))),
  keys AS (
    SELECT DISTINCT ok.contact_id, CASE WHEN ok.contact_id IS NULL THEN ok.id END AS inv FROM ok
     WHERE ok.st = 'active' AND ok.dd BETWEEN public.ledger_cutoff() AND p_as_of
  ),
  sim AS (
    SELECT s.* FROM keys k
     CROSS JOIN LATERAL public.ledger_simulate_as_of(v_tenant, k.contact_id,
                          CASE WHEN p_doc_type = 'invoice' THEN 'customer' ELSE 'supplier' END, p_as_of, k.inv) s
     WHERE s.row_kind = 'debt' AND s.debt_type = p_doc_type
  ),
  j AS (
    SELECT ok.*, (ok.st = 'active' AND ok.dd BETWEEN public.ledger_cutoff() AND p_as_of) AS live,
           sim.allocated AS al, sim.by_returns AS br, sim.from_other_branches AS xb, sim.remaining AS rem
      FROM ok LEFT JOIN sim ON sim.debt_id = ok.id
  )
  SELECT j.id, round(j.amt, 2),
         CASE WHEN j.live THEN COALESCE(j.al, 0) ELSE 0 END,
         CASE WHEN j.live THEN round(COALESCE(j.al, 0) - COALESCE(j.br, 0), 2) ELSE 0 END,
         CASE WHEN j.live THEN COALESCE(j.br, 0) ELSE 0 END,
         CASE WHEN j.live THEN COALESCE(j.xb, 0) ELSE 0 END,
         CASE WHEN j.st <> 'active' OR j.dd < public.ledger_cutoff() THEN 0
              WHEN j.dd > p_as_of THEN round(j.amt, 2)
              ELSE COALESCE(j.rem, round(j.amt, 2)) END,
         CASE WHEN j.st <> 'active' THEN 'cancelled'
              WHEN j.dd < public.ledger_cutoff() THEN 'before_ledger'
              WHEN j.dd > p_as_of THEN 'not_yet'
              WHEN COALESCE(j.rem, j.amt) <= 0.005 THEN 'paid'
              WHEN COALESCE(j.al, 0) > 0.005 THEN 'partial'
              ELSE 'unpaid' END
    FROM j;
END
$fn$;

DROP FUNCTION IF EXISTS public.ledger_aging(text, uuid);
CREATE OR REPLACE FUNCTION public.ledger_aging(p_side text, p_branch_id uuid DEFAULT NULL, p_as_of date DEFAULT NULL)
RETURNS TABLE (contact_id uuid, contact_name text, contact_type text, d0_30 numeric, d31_60 numeric, d61_90 numeric,
               d91_120 numeric, d120_plus numeric, total_open numeric, advance numeric, oldest_date date)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid; v_day date := LEAST(COALESCE(p_as_of, public.cairo_today()), public.cairo_today()); v_live boolean;
BEGIN
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'side غير صحيح'; END IF;
  v_tenant := public.ledger_read_scope(p_branch_id, p_side);
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'أعمار الديون لكل الفروع للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  v_live := v_day >= public.cairo_today();
  RETURN QUERY
  WITH who AS (
    SELECT DISTINCT x.cid FROM (
      SELECT dr.contact_id AS cid FROM public.ledger_debt_rows(v_tenant, NULL) dr
       WHERE NOT v_live AND dr.side = p_side AND dr.contact_id IS NOT NULL AND dr.doc_date <= v_day
      UNION
      SELECT mm.contact_id FROM money_movements mm
       WHERE NOT v_live AND mm.tenant_id = v_tenant AND mm.side = p_side AND mm.status = 'active' AND mm.contact_id IS NOT NULL
         AND mm.movement_date <= v_day) x
  ),
  sim AS (
    SELECT w.cid, s.* FROM who w CROSS JOIN LATERAL public.ledger_simulate_as_of(v_tenant, w.cid, p_side, v_day) s
  ),
  d AS (
    SELECT dr.contact_id, dr.remaining, v_day - dr.doc_date AS age, dr.doc_date
      FROM public.ledger_debt_rows(v_tenant, NULL) dr
     WHERE v_live AND dr.side = p_side AND dr.contact_id IS NOT NULL AND dr.remaining > 0.005
       AND (p_branch_id IS NULL OR dr.branch_id = p_branch_id)
    UNION ALL
    SELECT sim.cid, sim.remaining, v_day - sim.doc_date, sim.doc_date
      FROM sim WHERE sim.row_kind = 'debt' AND sim.remaining > 0.005 AND (p_branch_id IS NULL OR sim.branch_id = p_branch_id)
  ),
  a AS (
    SELECT cr.contact_id, sum(cr.unallocated) AS adv
      FROM public.ledger_credit_rows(v_tenant, NULL) cr
     WHERE v_live AND cr.side = p_side AND cr.contact_id IS NOT NULL AND cr.unallocated > 0.005
       AND (p_branch_id IS NULL OR cr.branch_id = p_branch_id)
     GROUP BY 1
    UNION ALL
    SELECT sim.cid, sum(sim.remaining)
      FROM sim WHERE sim.row_kind = 'credit' AND sim.remaining > 0.005 AND (p_branch_id IS NULL OR sim.branch_id = p_branch_id)
     GROUP BY 1
  ),
  ids AS (SELECT d.contact_id FROM d UNION SELECT a.contact_id FROM a WHERE a.adv > 0.005)
  SELECT c.id, c.name, c.type,
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age <= 30), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age BETWEEN 31 AND 60), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age BETWEEN 61 AND 90), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age BETWEEN 91 AND 120), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id AND d.age > 120), 0), 2),
         round(COALESCE((SELECT sum(d.remaining) FROM d WHERE d.contact_id = c.id), 0), 2),
         round(COALESCE((SELECT sum(a.adv) FROM a WHERE a.contact_id = c.id), 0), 2),
         (SELECT min(d.doc_date) FROM d WHERE d.contact_id = c.id)
    FROM ids JOIN contacts c ON c.id = ids.contact_id;
END
$fn$;

DROP FUNCTION IF EXISTS public.ledger_contact_documents(uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.ledger_contact_documents(p_contact uuid, p_side text, p_branch_id uuid DEFAULT NULL, p_as_of date DEFAULT NULL)
RETURNS TABLE (doc_type text, doc_id uuid, doc_number text, doc_date date, branch_id uuid, branch_name text,
               state text, total numeric, paid_money numeric, paid_by_returns numeric, paid_from_other_branches numeric,
               remaining numeric, cancel_reason text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid; v_live boolean := p_as_of IS NULL OR p_as_of >= public.cairo_today();
BEGIN
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'side غير صحيح'; END IF;
  v_tenant := public.ledger_read_scope(p_branch_id, p_side);
  IF p_branch_id IS NULL AND NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'حركات كل الفروع للإدارة فقط — اختار فرعك' USING ERRCODE = '42501';
  END IF;
  PERFORM public.ledger_contact_tenant_check(p_contact, v_tenant);
  RETURN QUERY
  WITH dr AS (
    SELECT x.debt_type, x.debt_id, x.branch_id, x.doc_date, x.amount, x.allocated, x.remaining, x.paid_by_returns, x.paid_from_other_branches
      FROM public.ledger_debt_rows(v_tenant, p_contact) x WHERE v_live AND x.side = p_side
    UNION ALL
    SELECT s.debt_type, s.debt_id, s.branch_id, s.doc_date, s.amount, s.allocated, s.remaining, s.by_returns, s.from_other_branches
      FROM public.ledger_simulate_as_of(v_tenant, p_contact, p_side, p_as_of) s WHERE NOT v_live AND s.row_kind = 'debt'
  )
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
     AND (v_live OR public.ledger_day(i.invoice_date) <= p_as_of)
  UNION ALL
  SELECT 'shipment', s.id, s.shipment_number, public.ledger_day(COALESCE(s.invoice_date, s.created_at)), s.branch_id, b.name, 'cancelled',
         round(s.total_cost, 2), 0, 0, 0, 0, s.cancel_reason
    FROM shipments s JOIN branches b ON b.id = s.branch_id
   WHERE p_side = 'supplier' AND s.contact_id = p_contact AND s.status <> 'active'
     AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
     AND (v_live OR public.ledger_day(COALESCE(s.invoice_date, s.created_at)) <= p_as_of)
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

CREATE OR REPLACE FUNCTION public.plan_recompute(p_plan uuid, p_extra_paid numeric DEFAULT 0)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_plan record; v_dir text; v_paid numeric; v_left numeric; v_inst record; v_take numeric; v_today date := public.cairo_today();
BEGIN
  SELECT * INTO v_plan FROM payment_plans WHERE id = p_plan FOR UPDATE;
  IF NOT FOUND OR v_plan.status = 'cancelled' THEN RETURN NULL; END IF;
  v_dir := CASE WHEN v_plan.entity_type = 'customer' THEN 'in' ELSE 'out' END;
  SELECT COALESCE(sum(pt.amount), 0) INTO v_paid FROM payment_transactions pt
   WHERE pt.payment_plan_id = p_plan AND pt.direction = v_dir AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL;
  v_paid := round(LEAST(v_paid + COALESCE(p_extra_paid, 0), v_plan.total_amount), 2);

  v_left := v_paid;
  FOR v_inst IN SELECT * FROM payment_installments
                 WHERE payment_plan_id = p_plan AND cancelled_at IS NULL AND COALESCE(status, '') <> 'cancelled'
                 ORDER BY due_date NULLS LAST, installment_number, created_at, id
                 FOR UPDATE LOOP
    v_take := LEAST(v_left, COALESCE(v_inst.amount, 0));
    UPDATE payment_installments SET
      paid_amount = v_take,
      status = CASE WHEN v_take >= COALESCE(amount, 0) - 0.005 THEN 'paid'
                    WHEN v_take > 0.005 THEN 'partial'
                    WHEN due_date IS NOT NULL AND due_date < v_today THEN 'overdue'
                    ELSE 'pending' END,
      paid_at = CASE WHEN v_take >= COALESCE(amount, 0) - 0.005 THEN COALESCE(paid_at, now()) ELSE NULL END,
      updated_at = now()
    WHERE id = v_inst.id
      AND (paid_amount IS DISTINCT FROM v_take
           OR status IS DISTINCT FROM CASE WHEN v_take >= COALESCE(amount, 0) - 0.005 THEN 'paid'
                                          WHEN v_take > 0.005 THEN 'partial'
                                          WHEN due_date IS NOT NULL AND due_date < v_today THEN 'overdue'
                                          ELSE 'pending' END);
    v_left := v_left - v_take;
  END LOOP;

  UPDATE payment_plans SET
    paid_amount = v_paid,
    remaining_amount = GREATEST(total_amount - v_paid, 0),
    status = CASE WHEN total_amount - v_paid <= 0.005 THEN 'settled' ELSE 'active' END,
    updated_at = now()
  WHERE id = p_plan;
  RETURN v_paid;
END
$fn$;

CREATE OR REPLACE FUNCTION public.plan_recompute_supplier_spread(p_contact uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_pool numeric; v_plan record; v_own numeric; v_cap numeric; v_take numeric;
BEGIN
  SELECT COALESCE(sum(pt.amount), 0) INTO v_pool FROM payment_transactions pt
   WHERE pt.contact_id = p_contact AND pt.payment_plan_id IS NULL AND pt.direction = 'out'
     AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL
     AND pt.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement');
  v_pool := GREATEST(v_pool - COALESCE((SELECT sum(pt.amount) FROM payment_transactions pt
                                          WHERE pt.contact_id = p_contact AND pt.payment_plan_id IS NOT NULL AND pt.direction = 'out'
                                            AND pt.payment_method = 'credit_balance' AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL), 0), 0);
  FOR v_plan IN SELECT * FROM payment_plans
                 WHERE entity_type = 'supplier' AND entity_id = p_contact AND status <> 'cancelled'
                 ORDER BY created_at, id LOOP
    SELECT COALESCE(sum(pt.amount), 0) INTO v_own FROM payment_transactions pt
     WHERE pt.payment_plan_id = v_plan.id AND pt.direction = 'out' AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL;
    v_cap := GREATEST(v_plan.total_amount - v_own, 0);
    v_take := LEAST(v_pool, v_cap);
    PERFORM public.plan_recompute(v_plan.id, v_take);
    v_pool := v_pool - v_take;
  END LOOP;
END
$fn$;

CREATE OR REPLACE FUNCTION public._void_payment_transaction_exec(p_tx_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tx record; v_plan record; v_new_tx_id uuid; v_rev_treasury uuid; v_rev_fee_tres uuid;
  v_uid uuid := auth.uid(); v_rev_direction text; v_name text; v_inv uuid; v_ip record; v_till numeric;
  v_ref_type text; v_ref_id uuid;
BEGIN
  IF p_tx_id IS NULL THEN RAISE EXCEPTION 'tx id required'; END IF;
  SELECT * INTO v_tx FROM public.payment_transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction not found'; END IF;
  IF v_tx.voided_at IS NOT NULL THEN RAISE EXCEPTION 'الدفعة ملغاة بالفعل'; END IF;
  IF v_tx.reverses_tx_id IS NOT NULL THEN RAISE EXCEPTION 'مينفعش تلغي قيد عكسي'; END IF;

  IF v_tx.payment_plan_id IS NOT NULL THEN
    SELECT * INTO v_plan FROM public.payment_plans WHERE id = v_tx.payment_plan_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'plan not found'; END IF;
    v_name := v_plan.entity_name; v_ref_type := v_plan.reference_type; v_ref_id := v_plan.reference_id;
  ELSE
    SELECT name INTO v_name FROM public.contacts WHERE id = v_tx.contact_id;
  END IF;
  v_rev_direction := CASE WHEN v_tx.direction = 'in' THEN 'out' ELSE 'in' END;

  IF public.ledger_period_closed(v_tx.tenant_id, public.ledger_day(v_tx.created_at)) THEN
    RAISE EXCEPTION 'الدفعة في فترة محاسبية مقفولة — مينفعش تتلغي (سجّل حركة عكسية بتاريخ النهارده بسند)';
  END IF;
  IF v_tx.payment_plan_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.payment_plans pp WHERE pp.id = v_tx.payment_plan_id AND pp.status = 'cancelled') THEN
    RAISE EXCEPTION 'خطة الدفع اتلغت مع المستند — فلوسها اتسوت في الإلغاء';
  END IF;
  IF v_tx.direction = 'in' AND EXISTS (
       SELECT 1 FROM public.invoices i
        WHERE i.id = COALESCE(v_tx.invoice_id, CASE WHEN v_ref_type = 'invoice' THEN v_ref_id END)
          AND i.status = 'cancelled' AND i.refund_method IN ('cash', 'credit') AND COALESCE(i.refund_amount, 0) > 0) THEN
    RAISE EXCEPTION 'الفاتورة اتلغت واترد مبلغها بالفعل — مينفعش تلغي الدفعة كمان';
  END IF;

  PERFORM set_config('app.contact_money',
    CASE WHEN v_tx.contact_id IS NOT NULL AND public.ledger_day(v_tx.created_at) >= public.ledger_cutoff() THEN '1' ELSE '' END, true);

  IF v_tx.treasury_id IS NOT NULL THEN
    SELECT amount INTO v_till FROM public.treasury WHERE id = v_tx.treasury_id;
    INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, reference_number,
                                transfer_to_account, transfer_from_account, reference_id, created_by, tenant_id)
    VALUES (v_tx.branch_id,
            (CASE WHEN v_tx.direction = 'in' THEN 'expense' ELSE 'income' END)::treasury_type,
            CASE WHEN v_tx.direction = 'in' THEN 'payment_in_void' ELSE 'payment_out_void' END,
            COALESCE(v_till, v_tx.amount),
            'إلغاء دفعة #' || substr(v_tx.id::text, 1, 8) || COALESCE(' — ' || v_name, '') || COALESCE(' — ' || p_reason, ''),
            v_tx.payment_method, v_tx.reference_number, v_tx.transfer_to_account, v_tx.transfer_from_account,
            v_tx.id, v_uid, v_tx.tenant_id)
    RETURNING id INTO v_rev_treasury;
  END IF;

  PERFORM set_config('app.contact_money', '', true);
  IF COALESCE(v_tx.fee_amount, 0) > 0 AND v_tx.fee_treasury_id IS NOT NULL THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id)
    VALUES (v_tx.branch_id, 'income'::treasury_type, 'fee_void', v_tx.fee_amount,
            'إلغاء عمولة ' || v_tx.payment_method, v_tx.payment_method, true, v_uid, v_tx.tenant_id)
    RETURNING id INTO v_rev_fee_tres;
  END IF;

  INSERT INTO public.payment_transactions(payment_plan_id, installment_id, branch_id, tenant_id, contact_id, invoice_id,
    direction, amount, payment_method, fee_amount, fee_type, total_with_fee, reference_number, transfer_to_account,
    transfer_from_account, received_by_name, treasury_id, fee_treasury_id, created_by, reverses_tx_id)
  VALUES (v_tx.payment_plan_id, v_tx.installment_id, v_tx.branch_id, v_tx.tenant_id, v_tx.contact_id, v_tx.invoice_id,
    v_rev_direction, v_tx.amount, v_tx.payment_method, COALESCE(v_tx.fee_amount, 0), v_tx.fee_type,
    v_tx.amount + COALESCE(CASE WHEN v_tx.total_with_fee > v_tx.amount THEN v_tx.fee_amount ELSE 0 END, 0),
    v_tx.reference_number, v_tx.transfer_to_account, v_tx.transfer_from_account,
    'إلغاء — ' || COALESCE(v_tx.received_by_name, ''), v_rev_treasury, v_rev_fee_tres, v_uid, v_tx.id)
  RETURNING id INTO v_new_tx_id;

  UPDATE public.payment_transactions
     SET voided_at = now(), voided_by = v_uid, void_reason = p_reason, voided_by_tx_id = v_new_tx_id
   WHERE id = v_tx.id;

  IF v_tx.direction = 'in' THEN
    v_inv := COALESCE(v_tx.invoice_id, CASE WHEN v_ref_type = 'invoice' THEN v_ref_id END);
    IF v_inv IS NOT NULL THEN
      FOR v_ip IN SELECT * FROM public.invoice_payments ip
                   WHERE ip.invoice_id = v_inv AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
                     AND ip.created_at = v_tx.created_at AND ip.payment_method = v_tx.payment_method
                   FOR UPDATE LOOP
        UPDATE public.invoice_payments
           SET voided_at = now(), voided_by = v_uid, void_reason = 'إلغاء دفعة الخطة: ' || p_reason
         WHERE id = v_ip.id;
      END LOOP;
    END IF;
  END IF;

  IF v_tx.payment_plan_id IS NOT NULL THEN
    PERFORM public.plan_recompute(v_tx.payment_plan_id);
  END IF;
  IF v_tx.payment_plan_id IS NULL AND v_tx.direction = 'out' AND v_tx.contact_id IS NOT NULL THEN
    PERFORM public.plan_recompute_supplier_spread(v_tx.contact_id);
  END IF;

  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
  VALUES (v_uid, (SELECT name FROM public.profiles WHERE id = v_uid), v_tx.branch_id, 'payment_voided', 'payment_transaction',
          v_tx.id::text, jsonb_build_object('amount', v_tx.amount, 'method', v_tx.payment_method, 'direction', v_tx.direction,
                                            'plan', v_tx.payment_plan_id, 'contact', v_tx.contact_id, 'reason', p_reason,
                                            'reversal_tx', v_new_tx_id), v_tx.tenant_id);
  RETURN v_new_tx_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.void_payment_transaction(p_tx_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_res uuid;
BEGIN
  PERFORM public.assert_access((SELECT pt.branch_id FROM public.payment_transactions pt WHERE pt.id = p_tx_id), 'invoices.update');
  PERFORM public.assert_same_tenant((SELECT tenant_id FROM public.payment_transactions WHERE id = p_tx_id));
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'سبب الإلغاء مطلوب (5 أحرف على الأقل)';
  END IF;
  SELECT public._void_payment_transaction_exec(p_tx_id, btrim(p_reason)) INTO v_res;
  RETURN v_res;
END
$fn$;
REVOKE ALL ON FUNCTION public._void_payment_transaction_exec(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_recompute(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_recompute_supplier_spread(uuid) FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.edit_payment_transaction(uuid,numeric,text,text,text,text,numeric,text,text)'::regprocedure);
  v_new := replace(v_def,
$a$  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)$a$,
$b$  -- Step 6D: the mirrored invoice payment follows the edit (same transaction time = the mirror)
  IF v_tx.direction = 'in' AND (v_new_amount <> v_tx.amount OR p_payment_method IS DISTINCT FROM v_tx.payment_method) THEN
    UPDATE public.invoice_payments ip
       SET amount = LEAST(ip.amount, v_new_amount), payment_method = p_payment_method
     WHERE ip.invoice_id = COALESCE(v_tx.invoice_id, CASE WHEN v_plan.reference_type = 'invoice' THEN v_plan.reference_id END)
       AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
       AND ip.created_at = v_tx.created_at AND ip.payment_method = v_tx.payment_method;
  END IF;
  IF v_plan.id IS NOT NULL THEN PERFORM public.plan_recompute(v_plan.id); END IF;
  IF v_plan.id IS NULL AND v_tx.direction = 'out' AND v_tx.contact_id IS NOT NULL THEN
    PERFORM public.plan_recompute_supplier_spread(v_tx.contact_id);
  END IF;

  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)$b$);
  v_new := replace(v_new,
$a$    INSERT INTO public.expenses(
      branch_id, type, amount, description, date,
      payment_method, reference_number, is_fee, created_by, tenant_id
    ) VALUES (
      v_tx.branch_id, 'تعديل عمولة تحويل', v_fee_delta,
      'تعديل عمولة ' || p_payment_method || ' — دفعة #' || substr(v_tx.id::text,1,8),
      CURRENT_DATE, p_payment_method,
      COALESCE(p_reference_number, v_tx.reference_number), true, v_uid, v_tx.tenant_id
    );$a$,
$b$    IF v_fee_delta > 0 THEN
    INSERT INTO public.expenses(
      branch_id, type, amount, description, date,
      payment_method, reference_number, is_fee, created_by, tenant_id
    ) VALUES (
      v_tx.branch_id, 'تعديل عمولة تحويل', v_fee_delta,
      'تعديل عمولة ' || p_payment_method || ' — دفعة #' || substr(v_tx.id::text,1,8),
      CURRENT_DATE, p_payment_method,
      COALESCE(p_reference_number, v_tx.reference_number), true, v_uid, v_tx.tenant_id
    );
    END IF;$b$);
  IF v_new = v_def OR position('IF v_fee_delta > 0 THEN
    INSERT INTO public.expenses(' IN v_new) = 0 THEN RAISE EXCEPTION 'Step 6D: edit_payment_transaction body not found'; END IF;
  EXECUTE v_new;
END
$patch$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.expense_to_treasury()'::regprocedure);
  v_new := replace(v_def,
$a$  IF COALESCE(NEW.amount, 0) > 0 THEN$a$,
$b$  IF COALESCE(current_setting('app.skip_expense_till', true), '') = '1' THEN
    RETURN NEW;   -- the caller writes the till row itself (Step 6D)
  END IF;
  IF COALESCE(NEW.amount, 0) > 0 THEN$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6D: expense_to_treasury body not found'; END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.record_payment_transaction(uuid,uuid,numeric,text,text,text,text,numeric,text,boolean,text,text,date)'::regprocedure);
  v_new := replace(v_def,
$a$    INSERT INTO expenses(branch_id, type, amount, description, date, payment_method, reference_number, is_fee, created_by, tenant_id)
    VALUES (v_branch, 'عمولة تحويل', p_fee_amount,
      'عمولة ' || p_payment_method || ' — دفعة خطة #' || substr(p_payment_plan_id::text,1,8),
      v_date, p_payment_method, p_reference_number, true, v_uid, v_tenant);$a$,
$b$    PERFORM set_config('app.skip_expense_till', '1', true);
    INSERT INTO expenses(branch_id, type, amount, description, date, payment_method, reference_number, is_fee, created_by, tenant_id)
    VALUES (v_branch, 'عمولة تحويل', p_fee_amount,
      'عمولة ' || p_payment_method || ' — دفعة خطة #' || substr(p_payment_plan_id::text,1,8),
      v_date, p_payment_method, p_reference_number, true, v_uid, v_tenant);
    PERFORM set_config('app.skip_expense_till', '', true);$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6D: record_payment_transaction fee block not found'; END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.edit_payment_transaction(uuid,numeric,text,text,text,text,numeric,text,text)'::regprocedure);
  v_new := replace(v_def,
$a$    IF v_fee_delta > 0 THEN
    INSERT INTO public.expenses($a$,
$b$    IF v_fee_delta > 0 THEN
    PERFORM set_config('app.skip_expense_till', '1', true);
    INSERT INTO public.expenses($b$);
  v_new := replace(v_new,
$a$      COALESCE(p_reference_number, v_tx.reference_number), true, v_uid, v_tx.tenant_id
    );
    END IF;$a$,
$b$      COALESCE(p_reference_number, v_tx.reference_number), true, v_uid, v_tx.tenant_id
    );
    PERFORM set_config('app.skip_expense_till', '', true);
    END IF;$b$);
  IF v_new = v_def OR position('app.skip_expense_till'', ''''' IN v_new) = 0 THEN
    RAISE EXCEPTION 'Step 6D: edit_payment_transaction fee block not found';
  END IF;
  EXECUTE v_new;
END
$patch$;