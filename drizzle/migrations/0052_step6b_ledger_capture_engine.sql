-- =============================================================================================
-- Step 6B — ledger capture rules, dual allocation engine, live shadow capture, backfill, reconciliation
-- Scope (owner rule, 8 Oct): only 1 January 2026 onwards. The historical archive (historical_* tables)
-- and the owner's personal ledger are not read, not written and not allocated.
-- =============================================================================================

-- 1. Helpers
CREATE OR REPLACE FUNCTION public.ledger_cutoff()
RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT DATE '2026-01-01' $$;

CREATE OR REPLACE FUNCTION public.ledger_day(ts timestamptz)
RETURNS date LANGUAGE sql STABLE AS $$ SELECT (ts AT TIME ZONE 'Africa/Cairo')::date $$;

CREATE OR REPLACE FUNCTION public.ledger_fallback_branch(p_tenant uuid, p_contact uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT b.id FROM branches b WHERE b.tenant_id = p_tenant AND b.code = 'MAIN-TREASURY' LIMIT 1),
    (SELECT c.branch_id FROM contacts c WHERE c.id = p_contact),
    (SELECT b.id FROM branches b WHERE b.tenant_id = p_tenant ORDER BY b.created_at, b.id LIMIT 1))
$$;

CREATE TABLE IF NOT EXISTS public.ledger_sync_errors (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid,
  contact_id  uuid,
  invoice_id  uuid,
  context     text NOT NULL,
  error       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ledger_sync_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ledger_sync_errors FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ledger_sync_errors TO service_role;

ALTER TABLE public.money_movements DROP CONSTRAINT IF EXISTS mm_source_unique;
CREATE UNIQUE INDEX IF NOT EXISTS mm_source_active_uidx
  ON public.money_movements (source_table, source_id, kind, side) WHERE status = 'active';

-- 2. Capture rules
CREATE OR REPLACE FUNCTION public.ledger_ip_is_voided_mirror(p_ip uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM invoice_payments ip
      JOIN payment_transactions pt ON pt.direction = 'in' AND pt.voided_at IS NOT NULL AND pt.reverses_tx_id IS NULL
                                  AND pt.created_at = ip.created_at AND pt.payment_method = ip.payment_method
      LEFT JOIN payment_plans pp ON pp.id = pt.payment_plan_id
     WHERE ip.id = p_ip AND ip.voided_at IS NULL
       AND ip.invoice_id = COALESCE(pt.invoice_id, CASE WHEN pp.reference_type = 'invoice' THEN pp.reference_id END))
$$;
CREATE OR REPLACE FUNCTION public.ledger_desired_movements(p_contact uuid)
RETURNS TABLE (
  source_table text, source_id uuid, kind text, side text, effect text,
  branch_id uuid, method text, amount numeric, movement_date date,
  target_doc_type text, target_doc_id uuid, treasury_id uuid, fallback_branch boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE
  c record;
  v_cut date := public.ledger_cutoff();
BEGIN
  SELECT ct.id, ct.tenant_id, ct.type, ct.branch_id, COALESCE(ct.opening_balance, 0) AS ob
    INTO c FROM contacts ct WHERE ct.id = p_contact;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT 'invoice_payments'::text, ip.id, 'payment'::text, 'customer'::text, 'settle'::text,
         ip.branch_id, ip.payment_method, round(ip.amount, 2), public.ledger_day(ip.created_at),
         'invoice'::text, i.id, NULL::uuid, false
    FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
   WHERE i.contact_id = c.id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
     AND ip.amount > 0 AND ip.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
     AND public.ledger_day(ip.created_at) >= v_cut
     AND NOT public.ledger_ip_is_voided_mirror(ip.id)

  UNION ALL
  SELECT 'payment_transactions', x.id,
         CASE WHEN x.sd = (CASE WHEN x.direction = 'in' THEN 'customer' ELSE 'supplier' END) THEN 'payment' ELSE 'refund' END,
         x.sd,
         CASE WHEN x.sd = (CASE WHEN x.direction = 'in' THEN 'customer' ELSE 'supplier' END) THEN 'settle' ELSE 'charge' END,
         x.branch_id, x.payment_method, round(x.amount - x.mirrored, 2), public.ledger_day(x.created_at),
         CASE WHEN x.direction = 'out' AND x.sd = 'supplier' AND x.ship_id IS NOT NULL THEN 'shipment' END,
         CASE WHEN x.direction = 'out' AND x.sd = 'supplier' AND x.ship_id IS NOT NULL THEN x.ship_id END,
         x.treasury_id, false
    FROM (
      SELECT pt.*,
             CASE
               WHEN pp.entity_type = 'supplier' THEN 'supplier'
               WHEN pp.entity_type = 'customer' THEN 'customer'
               WHEN c.type = 'supplier' THEN 'supplier'
               WHEN c.type = 'customer' THEN 'customer'
               WHEN pt.direction = 'in' THEN 'customer' ELSE 'supplier' END AS sd,
             (SELECT s.id FROM shipments s WHERE pp.reference_type = 'shipment' AND s.id = pp.reference_id
                 AND s.contact_id = c.id) AS ship_id,
             CASE WHEN pt.direction = 'in' THEN COALESCE((
               SELECT sum(ip.amount) FROM invoice_payments ip
                WHERE ip.invoice_id = COALESCE(pt.invoice_id, CASE WHEN pp.reference_type = 'invoice' THEN pp.reference_id END)
                  AND ip.created_at = pt.created_at AND ip.payment_method = pt.payment_method), 0)
             ELSE 0 END AS mirrored
        FROM payment_transactions pt
        LEFT JOIN payment_plans pp ON pp.id = pt.payment_plan_id
       WHERE pt.contact_id = c.id AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL
         AND pt.amount > 0 AND pt.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
         AND public.ledger_day(pt.created_at) >= v_cut
    ) x
   WHERE x.amount - x.mirrored > 0.005

  UNION ALL
  SELECT 'vouchers', v.id,
         CASE WHEN (v.party_type::text = 'customer') = (v.type::text = 'receipt') THEN 'payment' ELSE 'refund' END,
         v.party_type::text,
         CASE WHEN (v.party_type::text = 'customer') = (v.type::text = 'receipt') THEN 'settle' ELSE 'charge' END,
         v.branch_id, COALESCE(v.payment_method, 'cash'), round(v.amount, 2), v.voucher_date,
         NULL, NULL, v.treasury_id, false
    FROM vouchers v
   WHERE v.party_id = c.id AND v.party_type::text IN ('customer', 'supplier') AND v.status = 'active'
     AND v.amount > 0 AND v.voucher_date >= v_cut AND v.source_type IS DISTINCT FROM 'credit_deposit'

  UNION ALL
  SELECT 'customer_credit_log', l.id,
         CASE WHEN c.type = 'supplier' THEN 'refund' ELSE 'deposit' END,
         CASE WHEN c.type = 'supplier' THEN 'supplier' ELSE 'customer' END,
         CASE WHEN c.type = 'supplier' THEN 'charge' ELSE 'settle' END,
         COALESCE(dv.branch_id, t.branch_id, public.ledger_fallback_branch(c.tenant_id, c.id)),
         COALESCE(dv.payment_method, t.payment_method, 'cash'), round(l.amount, 2),
         COALESCE(dv.voucher_date, public.ledger_day(l.created_at)),
         NULL, NULL, COALESCE(dv.treasury_id, t.id), dv.id IS NULL AND t.id IS NULL
    FROM customer_credit_log l
    LEFT JOIN LATERAL (
      SELECT v.id, v.treasury_id, v.branch_id, v.payment_method, v.voucher_date FROM vouchers v
       WHERE v.tenant_id = c.tenant_id AND v.source_type = 'credit_deposit' AND v.party_id = c.id
         AND v.amount = l.amount AND v.created_at = l.created_at
       ORDER BY v.id LIMIT 1) dv ON true
    LEFT JOIN LATERAL (
      SELECT tr.id, tr.branch_id, tr.payment_method FROM treasury tr
       WHERE dv.id IS NULL AND tr.tenant_id = c.tenant_id AND tr.type::text = 'income' AND tr.amount = l.amount
         AND tr.created_at = l.created_at
       ORDER BY tr.id LIMIT 1) t ON true
   WHERE l.contact_id = c.id AND l.type = 'credit_added' AND l.invoice_id IS NULL AND l.amount > 0
     AND COALESCE(dv.voucher_date, public.ledger_day(l.created_at)) >= v_cut

  UNION ALL
  SELECT 'invoices', i.id, 'refund', 'customer', 'charge',
         i.branch_id, 'cash', round(i.refund_amount, 2), public.ledger_day(COALESCE(i.cancelled_at, i.invoice_date)),
         NULL, NULL, NULL, false
    FROM invoices i
   WHERE i.contact_id = c.id AND i.status = 'cancelled' AND i.refund_method = 'cash' AND COALESCE(i.refund_amount, 0) > 0
     AND public.ledger_day(COALESCE(i.cancelled_at, i.invoice_date)) >= v_cut

  UNION ALL
  SELECT 'returns', r.id, 'return_credit', 'customer', 'settle',
         COALESCE(r.branch_id, i.branch_id), NULL,
         round(COALESCE(r.total_refund, 0) - COALESCE(r.refund_cash_amount, 0) - COALESCE(r.refund_transfer_amount, 0), 2),
         public.ledger_day(COALESCE(r.invoice_date, r.created_at)),
         'invoice', i.id, NULL, false
    FROM returns r JOIN invoices i ON i.id = r.invoice_id
   WHERE i.contact_id = c.id AND COALESCE(r.status, 'active') NOT IN ('draft', 'cancelled')
     AND COALESCE(r.total_refund, 0) - COALESCE(r.refund_cash_amount, 0) - COALESCE(r.refund_transfer_amount, 0) > 0.005
     AND public.ledger_day(COALESCE(r.invoice_date, r.created_at)) >= v_cut

  UNION ALL
  SELECT 'supplier_payments', sp.id, 'payment', 'supplier', 'settle',
         sp.branch_id, COALESCE(tr.payment_method, 'cash'), round(sp.amount, 2),
         public.ledger_day(COALESCE(sp.paid_at, sp.created_at)),
         NULL, NULL, sp.treasury_id, false
    FROM supplier_payments sp
    LEFT JOIN treasury tr ON tr.id = sp.treasury_id
   WHERE sp.contact_id = c.id AND sp.amount > 0
     AND NOT (sp.treasury_id IS NULL AND COALESCE(sp.notes, '') LIKE 'خصم من الرصيد المسبق%')
     AND public.ledger_day(COALESCE(sp.paid_at, sp.created_at)) >= v_cut

  UNION ALL
  SELECT 'purchase_returns', pr.id, 'return_credit', 'supplier', 'settle',
         pr.branch_id, NULL,
         round(COALESCE(pr.total_amount, 0) - COALESCE(pr.refund_cash_amount, 0) - COALESCE(pr.refund_transfer_amount, 0), 2),
         public.ledger_day(COALESCE(pr.invoice_date, pr.created_at)),
         CASE WHEN s.id IS NOT NULL THEN 'shipment' END, s.id, NULL, false
    FROM purchase_returns pr
    LEFT JOIN shipments s ON s.id = pr.shipment_id AND s.contact_id = pr.contact_id
   WHERE pr.contact_id = c.id AND pr.status = 'active'
     AND COALESCE(pr.total_amount, 0) - COALESCE(pr.refund_cash_amount, 0) - COALESCE(pr.refund_transfer_amount, 0) > 0.005
     AND public.ledger_day(COALESCE(pr.invoice_date, pr.created_at)) >= v_cut

  UNION ALL
  SELECT 'contacts', c.id, 'opening', o.sd,
         CASE WHEN o.amt > 0 THEN 'charge' ELSE 'settle' END,
         COALESCE(c.branch_id, public.ledger_fallback_branch(c.tenant_id, c.id)), NULL, round(abs(o.amt), 2), v_cut,
         NULL, NULL, NULL, c.branch_id IS NULL
    FROM (SELECT CASE WHEN c.type = 'supplier' THEN 'supplier'
                      WHEN c.type = 'customer' THEN 'customer'
                      WHEN c.ob > 0 THEN 'customer' ELSE 'supplier' END AS sd,
                 CASE WHEN c.type = 'supplier' THEN -c.ob
                      WHEN c.type = 'customer' THEN c.ob
                      WHEN c.ob > 0 THEN c.ob ELSE -c.ob END AS amt) o
   WHERE abs(c.ob) > 0.005;
END
$fn$;

-- 3. Allocation engine
CREATE OR REPLACE FUNCTION public.ledger_effective_date(p_tenant uuid, p_day date)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE d date := p_day; e date;
BEGIN
  LOOP
    SELECT fp.period_end INTO e FROM fiscal_periods fp
     WHERE fp.tenant_id = p_tenant AND fp.status = 'closed' AND d BETWEEN fp.period_start AND fp.period_end LIMIT 1;
    EXIT WHEN e IS NULL;
    d := e + 1;
  END LOOP;
  RETURN d;
END $fn$;

CREATE OR REPLACE FUNCTION public.ledger_allocate(p_tenant uuid, p_contact uuid, p_side text, p_invoice uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET client_min_messages TO warning
AS $fn$
DECLARE
  v_cut date := public.ledger_cutoff();
  v_run uuid := gen_random_uuid();
  d record; m record;
  v_take numeric;
  v_kept int := 0; v_new int := 0; v_sup int := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _la_debt (debt_type text, debt_id uuid, branch_id uuid, dd date, ts timestamptz,
    first_flag int, amount numeric, rem numeric) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _la_cred (movement_id uuid, branch_id uuid, md date, ts timestamptz,
    amount numeric, rem numeric, target_type text, target_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _la_want (movement_id uuid, movement_branch_id uuid, debt_type text, debt_id uuid,
    debt_branch_id uuid, amount numeric, mode text, effective_date date) ON COMMIT DROP;
  TRUNCATE _la_debt, _la_cred, _la_want;

  IF p_contact IS NULL THEN
    INSERT INTO _la_debt SELECT 'invoice', i.id, i.branch_id, public.ledger_day(i.invoice_date), i.created_at, 1, i.total, i.total
      FROM invoices i WHERE i.id = p_invoice AND i.contact_id IS NULL AND i.status = 'active'
       AND public.ledger_day(i.invoice_date) >= v_cut;
    INSERT INTO _la_cred SELECT mm.id, mm.branch_id, mm.movement_date, mm.created_at, mm.amount, mm.amount, mm.target_doc_type, mm.target_doc_id
      FROM money_movements mm WHERE mm.tenant_id = p_tenant AND mm.contact_id IS NULL AND mm.status = 'active'
       AND mm.effect = 'settle' AND mm.target_doc_type = 'invoice' AND mm.target_doc_id = p_invoice;
  ELSE
    IF p_side = 'customer' THEN
      INSERT INTO _la_debt SELECT 'invoice', i.id, i.branch_id, public.ledger_day(i.invoice_date), i.created_at, 1, i.total, i.total
        FROM invoices i WHERE i.contact_id = p_contact AND i.status = 'active' AND i.total > 0
         AND public.ledger_day(i.invoice_date) >= v_cut;
    ELSE
      INSERT INTO _la_debt SELECT 'shipment', s.id, s.branch_id, public.ledger_day(COALESCE(s.invoice_date, s.created_at)), s.created_at, 1,
             s.total_cost, s.total_cost
        FROM shipments s WHERE s.contact_id = p_contact AND s.status = 'active' AND s.total_cost > 0
         AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= v_cut;
    END IF;
    INSERT INTO _la_debt SELECT 'movement', mm.id, mm.branch_id,
           COALESCE(public.ledger_day(ci.invoice_date), mm.movement_date), COALESCE(ci.created_at, mm.created_at),
           CASE WHEN mm.kind = 'opening' THEN 0 ELSE 1 END, mm.amount, mm.amount
      FROM money_movements mm
      LEFT JOIN invoices ci ON mm.source_table = 'invoices' AND mm.kind = 'refund' AND ci.id = mm.source_id
     WHERE mm.contact_id = p_contact AND mm.side = p_side AND mm.status = 'active' AND mm.effect = 'charge';
    INSERT INTO _la_cred SELECT mm.id, mm.branch_id, mm.movement_date, mm.created_at, mm.amount, mm.amount, mm.target_doc_type, mm.target_doc_id
      FROM money_movements mm WHERE mm.contact_id = p_contact AND mm.side = p_side AND mm.status = 'active' AND mm.effect = 'settle';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _la_frozen (id uuid) ON COMMIT DROP;
  TRUNCATE _la_frozen;
  INSERT INTO _la_frozen
  SELECT a.id FROM payment_allocations a
   WHERE a.tenant_id = p_tenant AND a.status = 'active' AND a.side = p_side
     AND a.contact_id IS NOT DISTINCT FROM p_contact
     AND (p_contact IS NOT NULL OR a.debt_id = p_invoice)
     AND EXISTS (SELECT 1 FROM fiscal_periods fp WHERE fp.tenant_id = p_tenant AND fp.status = 'closed'
                  AND a.effective_date BETWEEN fp.period_start AND fp.period_end)
     AND EXISTS (SELECT 1 FROM _la_cred cr WHERE cr.movement_id = a.movement_id)
     AND EXISTS (SELECT 1 FROM _la_debt db WHERE db.debt_type = a.debt_type AND db.debt_id = a.debt_id);
  UPDATE _la_cred cr SET rem = cr.rem - f.amt
    FROM (SELECT a.movement_id, sum(a.amount) amt FROM payment_allocations a JOIN _la_frozen z ON z.id = a.id GROUP BY 1) f
   WHERE f.movement_id = cr.movement_id;
  UPDATE _la_debt db SET rem = db.rem - f.amt
    FROM (SELECT a.debt_type, a.debt_id, sum(a.amount) amt FROM payment_allocations a JOIN _la_frozen z ON z.id = a.id GROUP BY 1, 2) f
   WHERE f.debt_type = db.debt_type AND f.debt_id = db.debt_id;

  FOR m IN SELECT * FROM _la_cred WHERE target_id IS NOT NULL AND rem > 0.005 ORDER BY md, ts, movement_id LOOP
    SELECT * INTO d FROM _la_debt WHERE debt_type = m.target_type AND debt_id = m.target_id AND rem > 0.005;
    IF FOUND THEN
      v_take := LEAST(m.rem, d.rem);
      INSERT INTO _la_want VALUES (m.movement_id, m.branch_id, d.debt_type, d.debt_id, d.branch_id, v_take, 'direct',
                                   public.ledger_effective_date(p_tenant, GREATEST(m.md, d.dd)));
      UPDATE _la_cred SET rem = rem - v_take WHERE movement_id = m.movement_id;
      UPDATE _la_debt SET rem = rem - v_take WHERE debt_type = d.debt_type AND debt_id = d.debt_id;
    END IF;
  END LOOP;

  IF p_contact IS NOT NULL THEN
    FOR m IN SELECT * FROM _la_cred WHERE rem > 0.005 ORDER BY md, ts, movement_id LOOP
      FOR d IN SELECT * FROM _la_debt WHERE rem > 0.005 ORDER BY first_flag, dd, ts, debt_id LOOP
        SELECT rem INTO v_take FROM _la_cred WHERE movement_id = m.movement_id;
        EXIT WHEN v_take <= 0.005;
        v_take := LEAST(v_take, d.rem);
        INSERT INTO _la_want VALUES (m.movement_id, m.branch_id, d.debt_type, d.debt_id, d.branch_id, v_take, 'fifo',
                                     public.ledger_effective_date(p_tenant, GREATEST(m.md, d.dd)));
        UPDATE _la_cred SET rem = rem - v_take WHERE movement_id = m.movement_id;
        UPDATE _la_debt SET rem = rem - v_take WHERE debt_type = d.debt_type AND debt_id = d.debt_id;
      END LOOP;
    END LOOP;
  END IF;

  UPDATE payment_allocations a SET status = 'superseded', superseded_at = now(), superseded_by_run = v_run
   WHERE a.tenant_id = p_tenant AND a.status = 'active' AND a.side = p_side
     AND a.contact_id IS NOT DISTINCT FROM p_contact
     AND (p_contact IS NOT NULL OR a.debt_id = p_invoice)
     AND NOT EXISTS (SELECT 1 FROM _la_frozen z WHERE z.id = a.id)
     AND NOT EXISTS (SELECT 1 FROM _la_want w
                      WHERE w.movement_id = a.movement_id AND w.debt_type = a.debt_type AND w.debt_id = a.debt_id
                        AND w.mode = a.mode AND round(w.amount, 2) = a.amount AND w.effective_date = a.effective_date);
  GET DIAGNOSTICS v_sup = ROW_COUNT;

  DELETE FROM _la_want w USING payment_allocations a
   WHERE a.tenant_id = p_tenant AND a.status = 'active' AND a.side = p_side
     AND a.contact_id IS NOT DISTINCT FROM p_contact
     AND w.movement_id = a.movement_id AND w.debt_type = a.debt_type AND w.debt_id = a.debt_id
     AND w.mode = a.mode AND round(w.amount, 2) = a.amount AND w.effective_date = a.effective_date;
  GET DIAGNOSTICS v_kept = ROW_COUNT;

  INSERT INTO payment_allocations (tenant_id, contact_id, side, movement_id, movement_branch_id, debt_type, debt_id,
                                   debt_branch_id, amount, mode, effective_date, run_id)
  SELECT p_tenant, p_contact, p_side, w.movement_id, w.movement_branch_id, w.debt_type, w.debt_id, w.debt_branch_id,
         round(w.amount, 2), w.mode, w.effective_date, v_run
    FROM _la_want w WHERE round(w.amount, 2) > 0;
  GET DIAGNOSTICS v_new = ROW_COUNT;

  RETURN jsonb_build_object('run', v_run, 'kept', v_kept, 'inserted', v_new, 'superseded', v_sup);
END
$fn$;

-- 4. Sync
CREATE OR REPLACE FUNCTION public.ledger_sync_contact(p_contact uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET client_min_messages TO warning
AS $fn$
DECLARE
  v_tenant uuid;
  v_cancel int := 0; v_ins int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM contacts WHERE id = p_contact;
  IF v_tenant IS NULL THEN RETURN jsonb_build_object('skipped', 'no contact'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || p_contact::text, 0));

  CREATE TEMP TABLE IF NOT EXISTS _ls_want ON COMMIT DROP AS SELECT * FROM public.ledger_desired_movements(NULL) WITH NO DATA;
  TRUNCATE _ls_want;
  INSERT INTO _ls_want SELECT * FROM public.ledger_desired_movements(p_contact);

  UPDATE money_movements mm
     SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'المصدر اتغير أو اتلغى (مزامنة الدفتر)'
   WHERE mm.contact_id = p_contact AND mm.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM _ls_want w
                      WHERE w.source_table = mm.source_table AND w.source_id = mm.source_id AND w.kind = mm.kind
                        AND w.side = mm.side AND w.effect = mm.effect AND w.branch_id = mm.branch_id
                        AND w.method IS NOT DISTINCT FROM mm.method AND w.amount = mm.amount
                        AND w.movement_date = mm.movement_date
                        AND w.target_doc_type IS NOT DISTINCT FROM mm.target_doc_type
                        AND w.target_doc_id IS NOT DISTINCT FROM mm.target_doc_id);
  GET DIAGNOSTICS v_cancel = ROW_COUNT;

  INSERT INTO money_movements (tenant_id, branch_id, contact_id, side, kind, effect, method, amount, movement_date,
                               target_doc_type, target_doc_id, source_table, source_id, treasury_id, notes)
  SELECT v_tenant, w.branch_id, p_contact, w.side, w.kind, w.effect, w.method, w.amount, w.movement_date,
         w.target_doc_type, w.target_doc_id, w.source_table, w.source_id, w.treasury_id,
         CASE WHEN w.fallback_branch THEN 'fallback_branch' END
    FROM _ls_want w
   WHERE w.amount > 0
     AND NOT EXISTS (SELECT 1 FROM money_movements mm
                      WHERE mm.status = 'active' AND mm.source_table = w.source_table AND mm.source_id = w.source_id
                        AND mm.kind = w.kind AND mm.side = w.side);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  RETURN jsonb_build_object('cancelled', v_cancel, 'inserted', v_ins,
    'customer', public.ledger_allocate(v_tenant, p_contact, 'customer'),
    'supplier', public.ledger_allocate(v_tenant, p_contact, 'supplier'));
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_sync_walkin(p_invoice uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET client_min_messages TO warning
AS $fn$
DECLARE i record; v_cancel int; v_ins int;
BEGIN
  SELECT id, tenant_id, contact_id INTO i FROM invoices WHERE id = p_invoice;
  IF i.id IS NULL OR i.contact_id IS NOT NULL THEN RETURN jsonb_build_object('skipped', true); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:inv:' || p_invoice::text, 0));

  CREATE TEMP TABLE IF NOT EXISTS _lw_want (source_id uuid, branch_id uuid, method text, amount numeric, movement_date date) ON COMMIT DROP;
  TRUNCATE _lw_want;
  INSERT INTO _lw_want
  SELECT ip.id, ip.branch_id, ip.payment_method, round(ip.amount, 2), public.ledger_day(ip.created_at)
    FROM invoice_payments ip
   WHERE ip.invoice_id = p_invoice AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL AND ip.amount > 0
     AND ip.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
     AND public.ledger_day(ip.created_at) >= public.ledger_cutoff();

  UPDATE money_movements mm SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'المصدر اتغير أو اتلغى (مزامنة الدفتر)'
   WHERE mm.contact_id IS NULL AND mm.target_doc_type = 'invoice' AND mm.target_doc_id = p_invoice AND mm.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM _lw_want w WHERE mm.source_table = 'invoice_payments' AND w.source_id = mm.source_id
                       AND w.branch_id = mm.branch_id AND w.method IS NOT DISTINCT FROM mm.method
                       AND w.amount = mm.amount AND w.movement_date = mm.movement_date);
  GET DIAGNOSTICS v_cancel = ROW_COUNT;

  INSERT INTO money_movements (tenant_id, branch_id, contact_id, side, kind, effect, method, amount, movement_date,
                               target_doc_type, target_doc_id, source_table, source_id)
  SELECT i.tenant_id, w.branch_id, NULL, 'customer', 'payment', 'settle', w.method, w.amount, w.movement_date,
         'invoice', p_invoice, 'invoice_payments', w.source_id
    FROM _lw_want w
   WHERE NOT EXISTS (SELECT 1 FROM money_movements mm WHERE mm.status = 'active' AND mm.source_table = 'invoice_payments'
                       AND mm.source_id = w.source_id AND mm.kind = 'payment' AND mm.side = 'customer');
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  RETURN jsonb_build_object('cancelled', v_cancel, 'inserted', v_ins,
                            'allocation', public.ledger_allocate(i.tenant_id, NULL, 'customer', p_invoice));
END
$fn$;

-- 5. Live capture (shadow)
CREATE OR REPLACE FUNCTION public.ledger_sync_safe(p_contact uuid, p_invoice uuid, p_context text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_key text := COALESCE(p_contact::text, 'inv:' || p_invoice::text);
BEGIN
  IF v_key IS NULL THEN RETURN; END IF;
  IF position('|' || v_key || '|' IN COALESCE(current_setting('ledger.done', true), '')) > 0 THEN RETURN; END IF;
  PERFORM set_config('ledger.done', COALESCE(current_setting('ledger.done', true), '') || '|' || v_key || '|', true);
  BEGIN
    IF p_contact IS NOT NULL THEN
      PERFORM public.ledger_sync_contact(p_contact);
    ELSE
      PERFORM public.ledger_sync_walkin(p_invoice);
    END IF;
    SET CONSTRAINTS public.trg_check_allocation_limits, public.trg_check_cancelled_movement_allocations IMMEDIATE;
    SET CONSTRAINTS public.trg_check_allocation_limits, public.trg_check_cancelled_movement_allocations DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO ledger_sync_errors (tenant_id, contact_id, invoice_id, context, error)
    VALUES ((SELECT tenant_id FROM contacts WHERE id = p_contact), p_contact, p_invoice, p_context, SQLERRM);
  END;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_capture_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE r record; v_c uuid; v_old uuid; v_inv uuid;
BEGIN
  IF COALESCE(current_setting('app.ledger_capture', true), '') = 'off' THEN RETURN NULL; END IF;
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  CASE TG_TABLE_NAME
    WHEN 'invoice_payments' THEN
      SELECT contact_id INTO v_c FROM invoices WHERE id = r.invoice_id;
      IF v_c IS NULL THEN v_inv := r.invoice_id; END IF;
    WHEN 'payment_transactions' THEN v_c := r.contact_id;
    WHEN 'vouchers' THEN v_c := r.party_id;
    WHEN 'customer_credit_log' THEN v_c := r.contact_id;
    WHEN 'supplier_payments' THEN v_c := r.contact_id;
    WHEN 'returns' THEN
      SELECT contact_id INTO v_c FROM invoices WHERE id = r.invoice_id;
      IF v_c IS NULL THEN v_inv := r.invoice_id; END IF;
    WHEN 'purchase_returns' THEN v_c := r.contact_id;
    WHEN 'invoices' THEN
      v_c := r.contact_id;
      IF v_c IS NULL THEN v_inv := r.id; END IF;
      IF TG_OP = 'UPDATE' AND OLD.contact_id IS DISTINCT FROM NEW.contact_id THEN v_old := OLD.contact_id; END IF;
    WHEN 'shipments' THEN
      v_c := r.contact_id;
      IF TG_OP = 'UPDATE' AND OLD.contact_id IS DISTINCT FROM NEW.contact_id THEN v_old := OLD.contact_id; END IF;
    WHEN 'contacts' THEN v_c := r.id;
    ELSE NULL;
  END CASE;
  IF v_c IS NOT NULL THEN
    PERFORM public.ledger_sync_safe(v_c, NULL, TG_TABLE_NAME);
  ELSIF v_inv IS NOT NULL THEN
    PERFORM public.ledger_sync_safe(NULL, v_inv, TG_TABLE_NAME);
  END IF;
  IF v_old IS NOT NULL THEN PERFORM public.ledger_sync_safe(v_old, NULL, TG_TABLE_NAME); END IF;
  RETURN NULL;
END
$fn$;

DO $trg$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_payments', 'payment_transactions', 'vouchers', 'customer_credit_log',
                           'supplier_payments', 'returns', 'purchase_returns', 'invoices', 'shipments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_ledger_capture ON public.%I', t);
    EXECUTE format('CREATE CONSTRAINT TRIGGER zz_ledger_capture AFTER INSERT OR UPDATE ON public.%I
                    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_capture_trg()', t);
  END LOOP;
END
$trg$;
DROP TRIGGER IF EXISTS zz_ledger_capture ON public.contacts;
CREATE CONSTRAINT TRIGGER zz_ledger_capture AFTER INSERT OR UPDATE OF opening_balance, type ON public.contacts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_capture_trg();

-- 6. Backfill
CREATE OR REPLACE FUNCTION public.ledger_backfill(p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE r record; v_contacts int := 0; v_walkin int := 0; v_err int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'ledger_backfill: super admin only' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT c.id FROM contacts c WHERE p_tenant IS NULL OR c.tenant_id = p_tenant ORDER BY c.tenant_id, c.id LOOP
    BEGIN
      PERFORM public.ledger_sync_contact(r.id);
      SET CONSTRAINTS public.trg_check_allocation_limits, public.trg_check_cancelled_movement_allocations IMMEDIATE;
      SET CONSTRAINTS public.trg_check_allocation_limits, public.trg_check_cancelled_movement_allocations DEFERRED;
      v_contacts := v_contacts + 1;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err + 1;
      INSERT INTO ledger_sync_errors (tenant_id, contact_id, context, error)
      VALUES ((SELECT tenant_id FROM contacts WHERE id = r.id), r.id, 'backfill', SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT i.id, i.tenant_id FROM invoices i
            WHERE i.contact_id IS NULL AND (p_tenant IS NULL OR i.tenant_id = p_tenant)
              AND EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.invoice_id = i.id) LOOP
    BEGIN
      PERFORM public.ledger_sync_walkin(r.id);
      SET CONSTRAINTS public.trg_check_allocation_limits, public.trg_check_cancelled_movement_allocations IMMEDIATE;
      SET CONSTRAINTS public.trg_check_allocation_limits, public.trg_check_cancelled_movement_allocations DEFERRED;
      v_walkin := v_walkin + 1;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err + 1;
      INSERT INTO ledger_sync_errors (tenant_id, invoice_id, context, error) VALUES (r.tenant_id, r.id, 'backfill', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('contacts', v_contacts, 'walkin_invoices', v_walkin, 'errors', v_err);
END
$fn$;

-- 7. Reports
CREATE OR REPLACE VIEW public.ledger_document_balances WITH (security_invoker = true) AS
SELECT 'invoice'::text AS doc_type, i.id AS doc_id, i.tenant_id, i.branch_id, i.contact_id, 'customer'::text AS side,
       public.ledger_day(i.invoice_date) AS doc_date, i.total AS amount,
       COALESCE(sum(a.amount) FILTER (WHERE a.mode = 'direct'), 0) AS paid_direct,
       COALESCE(sum(a.amount) FILTER (WHERE a.mode = 'fifo'), 0) AS paid_fifo,
       COALESCE(sum(a.amount) FILTER (WHERE a.is_cross_branch), 0) AS paid_from_other_branches,
       i.total - COALESCE(sum(a.amount), 0) AS remaining
  FROM invoices i
  LEFT JOIN payment_allocations a ON a.debt_type = 'invoice' AND a.debt_id = i.id AND a.status = 'active'
 WHERE i.status = 'active' AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff()
 GROUP BY i.id
UNION ALL
SELECT 'shipment', s.id, s.tenant_id, s.branch_id, s.contact_id, 'supplier',
       public.ledger_day(COALESCE(s.invoice_date, s.created_at)), s.total_cost,
       COALESCE(sum(a.amount) FILTER (WHERE a.mode = 'direct'), 0),
       COALESCE(sum(a.amount) FILTER (WHERE a.mode = 'fifo'), 0),
       COALESCE(sum(a.amount) FILTER (WHERE a.is_cross_branch), 0),
       s.total_cost - COALESCE(sum(a.amount), 0)
  FROM shipments s
  LEFT JOIN payment_allocations a ON a.debt_type = 'shipment' AND a.debt_id = s.id AND a.status = 'active'
 WHERE s.status = 'active' AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= public.ledger_cutoff()
 GROUP BY s.id;

CREATE OR REPLACE FUNCTION public.ledger_contact_side_balance(p_contact uuid, p_side text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT sum(i.total) FROM invoices i WHERE p_side = 'customer' AND i.contact_id = p_contact
                     AND i.status = 'active' AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff()), 0)
       + COALESCE((SELECT sum(s.total_cost) FROM shipments s WHERE p_side = 'supplier' AND s.contact_id = p_contact
                     AND s.status = 'active' AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= public.ledger_cutoff()), 0)
       + COALESCE((SELECT sum(CASE WHEN m.effect = 'charge' THEN m.amount ELSE -m.amount END) FROM money_movements m
                    WHERE m.contact_id = p_contact AND m.side = p_side AND m.status = 'active'), 0)
$$;

CREATE OR REPLACE FUNCTION public.ledger_reconciliation(p_tenant uuid DEFAULT NULL)
RETURNS TABLE (
  tenant_id uuid, contact_id uuid, contact_name text, contact_type text, side text,
  old_balance numeric, new_balance numeric, difference numeric,
  c_netting_settlement numeric,
  c_credit_use_not_money numeric,
  c_deposits_now_counted numeric,
  c_plan_payments_now_counted numeric,
  c_advance_use_rows numeric,
  c_cancel_cash_refunds numeric,
  c_opening_without_branch numeric,
  c_before_cutoff numeric,
  c_voided_plan_mirrors numeric,
  unexplained numeric,
  old_prepaid_credit numeric,
  fallback_branch_rows int)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_t uuid := COALESCE(p_tenant, public.current_tenant_id()); v_cut date := public.ledger_cutoff();
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (public.is_super_admin(auth.uid())
       OR (public.is_admin(auth.uid()) AND v_t = public.current_tenant_id())) THEN
    RAISE EXCEPTION 'ledger_reconciliation: admins only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH cc AS (
    SELECT c.id, c.tenant_id, c.name, c.type, c.branch_id, COALESCE(c.opening_balance, 0) AS ob, COALESCE(c.credit_balance, 0) AS cb
      FROM contacts c WHERE p_tenant IS NULL AND auth.uid() IS NULL OR c.tenant_id = v_t
  ),
  sides AS (SELECT cc.*, s.side FROM cc CROSS JOIN (VALUES ('customer'), ('supplier')) AS s(side)),
  calc AS (
    SELECT s.*,
      CASE WHEN s.side = 'customer' THEN
          (CASE WHEN s.branch_id IS NOT NULL THEN
             CASE WHEN s.type = 'customer' THEN s.ob WHEN s.type = 'both' THEN GREATEST(s.ob, 0) ELSE 0 END ELSE 0 END)
        + COALESCE((SELECT sum(i.total) FROM invoices i WHERE i.contact_id = s.id AND i.status = 'active'), 0)
        - COALESCE((SELECT sum(GREATEST(COALESCE(r.total_refund,0)-COALESCE(r.refund_cash_amount,0)-COALESCE(r.refund_transfer_amount,0),0))
                      FROM returns r JOIN invoices i ON i.id = r.invoice_id
                     WHERE i.contact_id = s.id AND COALESCE(r.status,'active') NOT IN ('draft','cancelled')), 0)
        - COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
                     WHERE i.contact_id = s.id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL), 0)
        - COALESCE((SELECT sum(v.amount) FROM vouchers v WHERE v.party_id = s.id AND v.type::text = 'receipt'
                     AND v.status = 'active' AND v.party_type::text = 'customer'), 0)
        + COALESCE((SELECT sum(v.amount) FROM vouchers v WHERE v.party_id = s.id AND v.type::text = 'payment'
                     AND v.status = 'active' AND v.party_type::text = 'customer'), 0)
      ELSE
          (CASE WHEN s.branch_id IS NOT NULL THEN
             CASE WHEN s.type = 'supplier' THEN -s.ob WHEN s.type = 'both' THEN GREATEST(-s.ob, 0) ELSE 0 END ELSE 0 END)
        + COALESCE((SELECT sum(sh.total_cost) FROM shipments sh WHERE sh.contact_id = s.id AND sh.status = 'active'), 0)
        - COALESCE((SELECT sum(GREATEST(COALESCE(pr.total_amount,0)-COALESCE(pr.refund_cash_amount,0)-COALESCE(pr.refund_transfer_amount,0),0))
                      FROM purchase_returns pr WHERE pr.contact_id = s.id AND pr.status = 'active'), 0)
        - COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp WHERE sp.contact_id = s.id), 0)
        - COALESCE((SELECT sum(v.amount) FROM vouchers v WHERE v.party_id = s.id AND v.type::text = 'payment'
                     AND v.status = 'active' AND v.party_type::text = 'supplier'), 0)
        + COALESCE((SELECT sum(v.amount) FROM vouchers v WHERE v.party_id = s.id AND v.type::text = 'receipt'
                     AND v.status = 'active' AND v.party_type::text = 'supplier'), 0)
      END AS old_bal,
      public.ledger_contact_side_balance(s.id, s.side) AS new_bal,
      CASE WHEN s.side = 'customer' THEN COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
            WHERE i.contact_id = s.id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL AND ip.payment_method = 'settlement'
              AND public.ledger_day(ip.created_at) >= v_cut), 0) ELSE 0 END AS k1,
      CASE WHEN s.side = 'customer' THEN COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
            WHERE i.contact_id = s.id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
              AND ip.payment_method IN ('credit_balance', 'credit_applied') AND public.ledger_day(ip.created_at) >= v_cut), 0) ELSE 0 END AS k2,
      -COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.contact_id = s.id AND m.side = s.side AND m.status = 'active'
                   AND m.source_table = 'customer_credit_log' AND m.effect = 'settle'), 0)
      + COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.contact_id = s.id AND m.side = s.side AND m.status = 'active'
                   AND m.source_table = 'customer_credit_log' AND m.effect = 'charge'), 0) AS k3,
      COALESCE((SELECT sum(CASE WHEN m.effect = 'charge' THEN m.amount ELSE -m.amount END) FROM money_movements m
                 WHERE m.contact_id = s.id AND m.side = s.side AND m.status = 'active' AND m.source_table = 'payment_transactions'), 0) AS k4,
      CASE WHEN s.side = 'supplier' THEN COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp WHERE sp.contact_id = s.id
            AND sp.treasury_id IS NULL AND COALESCE(sp.notes, '') LIKE 'خصم من الرصيد المسبق%'
            AND public.ledger_day(COALESCE(sp.paid_at, sp.created_at)) >= v_cut), 0) ELSE 0 END AS k5,
      COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.contact_id = s.id AND m.side = s.side AND m.status = 'active'
                 AND m.source_table = 'invoices' AND m.kind = 'refund'), 0) AS k6,
      COALESCE((SELECT sum(CASE WHEN m.effect = 'charge' THEN m.amount ELSE -m.amount END) FROM money_movements m
                 WHERE m.contact_id = s.id AND m.side = s.side AND m.status = 'active' AND m.kind = 'opening'
                   AND s.branch_id IS NULL), 0) AS k7,
      -( CASE WHEN s.side = 'customer' THEN
            COALESCE((SELECT sum(i.total) FROM invoices i WHERE i.contact_id = s.id AND i.status = 'active'
                        AND public.ledger_day(i.invoice_date) < v_cut), 0)
          - COALESCE((SELECT sum(GREATEST(COALESCE(r.total_refund,0)-COALESCE(r.refund_cash_amount,0)-COALESCE(r.refund_transfer_amount,0),0))
                        FROM returns r JOIN invoices i ON i.id = r.invoice_id WHERE i.contact_id = s.id
                         AND COALESCE(r.status,'active') NOT IN ('draft','cancelled')
                         AND public.ledger_day(COALESCE(r.invoice_date, r.created_at)) < v_cut), 0)
          - COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
                       WHERE i.contact_id = s.id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
                         AND ip.payment_method NOT IN ('settlement', 'credit_balance', 'credit_applied')
                         AND public.ledger_day(ip.created_at) < v_cut), 0)
          - COALESCE((SELECT sum(CASE WHEN v.type::text = 'receipt' THEN v.amount ELSE -v.amount END) FROM vouchers v
                       WHERE v.party_id = s.id AND v.status = 'active' AND v.party_type::text = 'customer' AND v.voucher_date < v_cut), 0)
         ELSE
            COALESCE((SELECT sum(sh.total_cost) FROM shipments sh WHERE sh.contact_id = s.id AND sh.status = 'active'
                        AND public.ledger_day(COALESCE(sh.invoice_date, sh.created_at)) < v_cut), 0)
          - COALESCE((SELECT sum(GREATEST(COALESCE(pr.total_amount,0)-COALESCE(pr.refund_cash_amount,0)-COALESCE(pr.refund_transfer_amount,0),0))
                        FROM purchase_returns pr WHERE pr.contact_id = s.id AND pr.status = 'active'
                         AND public.ledger_day(COALESCE(pr.invoice_date, pr.created_at)) < v_cut), 0)
          - COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp WHERE sp.contact_id = s.id
                       AND NOT (sp.treasury_id IS NULL AND COALESCE(sp.notes, '') LIKE 'خصم من الرصيد المسبق%')
                       AND public.ledger_day(COALESCE(sp.paid_at, sp.created_at)) < v_cut), 0)
          - COALESCE((SELECT sum(CASE WHEN v.type::text = 'payment' THEN v.amount ELSE -v.amount END) FROM vouchers v
                       WHERE v.party_id = s.id AND v.status = 'active' AND v.party_type::text = 'supplier' AND v.voucher_date < v_cut), 0)
         END
       + CASE WHEN s.side = 'customer' THEN
            -COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
                        WHERE i.contact_id = s.id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
                          AND ip.payment_method IN ('settlement', 'credit_balance', 'credit_applied')
                          AND public.ledger_day(ip.created_at) < v_cut), 0)
         ELSE
            -COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp WHERE sp.contact_id = s.id
                        AND sp.treasury_id IS NULL AND COALESCE(sp.notes, '') LIKE 'خصم من الرصيد المسبق%'
                        AND public.ledger_day(COALESCE(sp.paid_at, sp.created_at)) < v_cut), 0)
         END ) AS k8,
      CASE WHEN s.side = 'customer' THEN COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
            WHERE i.contact_id = s.id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
              AND ip.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
              AND public.ledger_day(ip.created_at) >= v_cut AND public.ledger_ip_is_voided_mirror(ip.id)), 0) ELSE 0 END AS k9,
      (SELECT count(*)::int FROM money_movements m WHERE m.contact_id = s.id AND m.side = s.side AND m.status = 'active'
         AND m.notes = 'fallback_branch') AS fb
    FROM sides s
  )
  SELECT k.tenant_id, k.id, k.name, k.type, k.side,
         round(k.old_bal, 2), round(k.new_bal, 2), round(k.new_bal - k.old_bal, 2),
         round(k.k1, 2), round(k.k2, 2), round(k.k3, 2), round(k.k4, 2), round(k.k5, 2), round(k.k6, 2), round(k.k7, 2), round(k.k8, 2),
         round(k.k9, 2),
         round((k.new_bal - k.old_bal) - (k.k1 + k.k2 + k.k3 + k.k4 + k.k5 + k.k6 + k.k7 + k.k8 + k.k9), 2),
         round(k.cb, 2), k.fb
    FROM calc k
   WHERE abs(k.old_bal) > 0.005 OR abs(k.new_bal) > 0.005;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_reconciliation_summary(p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'contact_sides', count(*),
    'matching', count(*) FILTER (WHERE abs(difference) <= 0.005),
    'explained_differences', count(*) FILTER (WHERE abs(difference) > 0.005 AND abs(unexplained) <= 0.005),
    'unexplained', count(*) FILTER (WHERE abs(unexplained) > 0.005),
    'netting_settlement', COALESCE(sum(c_netting_settlement), 0),
    'credit_use_not_money', COALESCE(sum(c_credit_use_not_money), 0),
    'deposits_now_counted', COALESCE(sum(c_deposits_now_counted), 0),
    'plan_payments_now_counted', COALESCE(sum(c_plan_payments_now_counted), 0),
    'advance_use_rows', COALESCE(sum(c_advance_use_rows), 0),
    'cancel_cash_refunds', COALESCE(sum(c_cancel_cash_refunds), 0),
    'opening_without_branch', COALESCE(sum(c_opening_without_branch), 0),
    'before_cutoff', COALESCE(sum(c_before_cutoff), 0),
    'voided_plan_mirrors', COALESCE(sum(c_voided_plan_mirrors), 0),
    'fallback_branch_rows', COALESCE(sum(fallback_branch_rows), 0),
    'sync_errors', (SELECT count(*) FROM ledger_sync_errors e WHERE p_tenant IS NULL OR e.tenant_id = p_tenant))
  FROM public.ledger_reconciliation(p_tenant)
$$;

REVOKE ALL ON FUNCTION public.ledger_fallback_branch(uuid, uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_ip_is_voided_mirror(uuid)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_desired_movements(uuid)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_effective_date(uuid, date)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_allocate(uuid, uuid, text, uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_sync_contact(uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_sync_walkin(uuid)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_sync_safe(uuid, uuid, text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_capture_trg()                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_backfill(uuid)                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_contact_side_balance(uuid, text)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_reconciliation(uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_reconciliation_summary(uuid)           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_reconciliation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_backfill(uuid), public.ledger_reconciliation_summary(uuid) TO service_role;
REVOKE ALL ON public.ledger_document_balances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ledger_document_balances TO service_role;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('ledger_reconciliation', '0055', 'read-only reconciliation report; company admins and super admin only')
ON CONFLICT (function_name) DO NOTHING;

DO $bf$
DECLARE v jsonb;
BEGIN
  v := public.ledger_backfill(NULL);
  RAISE NOTICE 'Step 6B backfill: %', v;
  RAISE NOTICE 'Step 6B reconciliation: %', public.ledger_reconciliation_summary(NULL);
END
$bf$;

DO $check$
DECLARE v_list text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Step 6B: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
END
$check$;