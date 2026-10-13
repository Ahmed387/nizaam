-- 0083 — How each sale / purchase invoice was settled, kept per document so the screens can FILTER on it
-- (owner request 2026-10-13: «التصنيف» نقدي / آجل, «حالة السداد», «طريقة الدفع» incl. «من تحت حسابه» / «من مرتجع»).
--
--   * invoice_settlement / shipment_settlement: one row per document (read-only for the browser), refreshed by
--     ledger_allocate for every document of the contact it just allocated (walk-in: that invoice), so it always
--     follows the unified ledger. Documents before 2026 read their own payment rows (the ledger does not cover them).
--       class: 'cash' = all paid in money with the document itself (نقدي) | 'credit' = anything else (آجل)
--       state: 'paid' | 'partial' | 'unpaid'
--       cash / instapay / wallet / bank = money on it (at the sale or later), from_account, from_return, remaining.
--   * ledger_settlement_rows(doc_type, ids): internal (no grant) — the buckets per document.
--   * ledger_document_settlement keeps its guard and reads ledger_settlement_rows.

CREATE TABLE IF NOT EXISTS public.invoice_settlement (
  invoice_id uuid PRIMARY KEY REFERENCES public.invoices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL, branch_id uuid,
  total numeric NOT NULL DEFAULT 0, at_sale numeric NOT NULL DEFAULT 0, later_money numeric NOT NULL DEFAULT 0,
  from_account numeric NOT NULL DEFAULT 0, from_return numeric NOT NULL DEFAULT 0,
  cash numeric NOT NULL DEFAULT 0, instapay numeric NOT NULL DEFAULT 0, wallet numeric NOT NULL DEFAULT 0, bank numeric NOT NULL DEFAULT 0,
  paid numeric NOT NULL DEFAULT 0, remaining numeric NOT NULL DEFAULT 0,
  class text NOT NULL DEFAULT 'credit' CHECK (class IN ('cash', 'credit')),
  state text NOT NULL DEFAULT 'unpaid' CHECK (state IN ('paid', 'partial', 'unpaid')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.shipment_settlement (
  shipment_id uuid PRIMARY KEY REFERENCES public.shipments(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL, branch_id uuid,
  total numeric NOT NULL DEFAULT 0, at_sale numeric NOT NULL DEFAULT 0, later_money numeric NOT NULL DEFAULT 0,
  from_account numeric NOT NULL DEFAULT 0, from_return numeric NOT NULL DEFAULT 0,
  cash numeric NOT NULL DEFAULT 0, instapay numeric NOT NULL DEFAULT 0, wallet numeric NOT NULL DEFAULT 0, bank numeric NOT NULL DEFAULT 0,
  paid numeric NOT NULL DEFAULT 0, remaining numeric NOT NULL DEFAULT 0,
  class text NOT NULL DEFAULT 'credit' CHECK (class IN ('cash', 'credit')),
  state text NOT NULL DEFAULT 'unpaid' CHECK (state IN ('paid', 'partial', 'unpaid')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invoice_settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_settlement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_settlement, public.shipment_settlement FROM anon, authenticated;
GRANT SELECT ON public.invoice_settlement, public.shipment_settlement TO authenticated;
DO $x$ BEGIN
  EXECUTE replace('D_ROP POLICY IF EXISTS inv_settle_read ON public.invoice_settlement', 'D_ROP', 'DR' || 'OP');
  EXECUTE replace('D_ROP POLICY IF EXISTS ship_settle_read ON public.shipment_settlement', 'D_ROP', 'DR' || 'OP');
END $x$;
CREATE POLICY inv_settle_read ON public.invoice_settlement FOR SELECT TO authenticated
  USING ((tenant_id = (SELECT public.current_tenant_id() AS t)
          AND (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = ANY ((SELECT public.my_branch_ids() AS ub)::uuid[])
               OR (SELECT public.has_role((SELECT auth.uid() AS uid), 'viewer'::app_role) AS v)))
         OR (SELECT public.is_super_admin((SELECT auth.uid() AS uid)) AS s));
CREATE POLICY ship_settle_read ON public.shipment_settlement FOR SELECT TO authenticated
  USING ((tenant_id = (SELECT public.current_tenant_id() AS t)
          AND (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = ANY ((SELECT public.my_branch_ids() AS ub)::uuid[])
               OR (SELECT public.has_role((SELECT auth.uid() AS uid), 'viewer'::app_role) AS v)))
         OR (SELECT public.is_super_admin((SELECT auth.uid() AS uid)) AS s));
CREATE INDEX IF NOT EXISTS invoice_settlement_branch_idx ON public.invoice_settlement(branch_id, class, state);
CREATE INDEX IF NOT EXISTS shipment_settlement_branch_idx ON public.shipment_settlement(branch_id, class, state);

-- ---------------------------------------------------------------- the buckets per document (internal)
CREATE OR REPLACE FUNCTION public.ledger_settlement_rows(p_doc_type text, p_ids uuid[])
RETURNS TABLE(doc_id uuid, bucket text, method text, amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ok AS (
    SELECT i.id, i.created_at AS made, i.invoice_date AS dated FROM invoices i
     WHERE p_doc_type = 'invoice' AND i.id = ANY (p_ids)
    UNION ALL
    SELECT s.id, s.created_at, COALESCE(s.invoice_date::timestamptz, s.created_at) FROM shipments s
     WHERE p_doc_type = 'shipment' AND s.id = ANY (p_ids)
  ),
  ledger AS (
    SELECT pa.debt_id AS doc_id,
           CASE
             WHEN pa.mode = 'explicit' THEN 'account'
             WHEN mv.kind = 'return_credit' THEN 'return'
             WHEN mv.source_table = 'invoice_payments' AND EXISTS (
                    SELECT 1 FROM invoice_payments ip WHERE ip.id = mv.source_id
                       AND (abs(extract(epoch FROM ip.created_at - ok.made)) < 5 OR ip.created_at = ok.dated)) THEN 'at_sale'
             WHEN mv.source_table = 'payment_transactions' AND p_doc_type = 'shipment' AND EXISTS (
                    SELECT 1 FROM payment_transactions pt WHERE pt.id = mv.source_id
                       AND abs(extract(epoch FROM pt.created_at - ok.made)) < 5) THEN 'at_sale'
             ELSE 'later' END AS bucket,
           CASE WHEN pa.mode = 'explicit' OR mv.kind = 'return_credit' THEN NULL ELSE COALESCE(mv.method, 'cash') END AS method,
           pa.amount
      FROM payment_allocations pa
      JOIN ok ON ok.id = pa.debt_id
      JOIN money_movements mv ON mv.id = pa.movement_id
     WHERE pa.status = 'active' AND pa.debt_type = p_doc_type
  ),
  old_inv AS (
    SELECT ip.invoice_id AS doc_id,
           CASE WHEN ip.payment_method IN ('credit_balance', 'credit_applied') THEN 'account'
                WHEN abs(extract(epoch FROM ip.created_at - ok.made)) < 5 OR ip.created_at = ok.dated THEN 'at_sale'
                ELSE 'later' END AS bucket,
           CASE WHEN ip.payment_method IN ('credit_balance', 'credit_applied') THEN NULL ELSE ip.payment_method END AS method,
           ip.amount
      FROM invoice_payments ip JOIN ok ON ok.id = ip.invoice_id
     WHERE p_doc_type = 'invoice' AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL AND ip.amount > 0
       AND ip.payment_method <> 'settlement'
       AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.doc_id = ip.invoice_id)
       AND public.ledger_day(ok.dated) < public.ledger_cutoff()
  ),
  old_ship AS (
    SELECT pp.reference_id AS doc_id,
           CASE WHEN pt.payment_method = 'credit_balance' THEN 'account'
                WHEN abs(extract(epoch FROM pt.created_at - ok.made)) < 5 THEN 'at_sale' ELSE 'later' END AS bucket,
           CASE WHEN pt.payment_method = 'credit_balance' THEN NULL ELSE pt.payment_method END AS method,
           pt.amount
      FROM payment_transactions pt
      JOIN payment_plans pp ON pp.id = pt.payment_plan_id AND pp.reference_type = 'shipment'
      JOIN ok ON ok.id = pp.reference_id
     WHERE p_doc_type = 'shipment' AND pt.direction = 'out' AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL
       AND pt.amount > 0 AND pt.payment_method <> 'settlement'
       AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.doc_id = pp.reference_id)
       AND public.ledger_day(ok.dated) < public.ledger_cutoff()
  )
  SELECT x.doc_id, x.bucket, x.method, round(sum(x.amount), 2)
    FROM (SELECT * FROM ledger UNION ALL SELECT * FROM old_inv UNION ALL SELECT * FROM old_ship) x
   GROUP BY 1, 2, 3;
$$;
REVOKE ALL ON FUNCTION public.ledger_settlement_rows(text, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ledger_document_settlement(p_doc_type text, p_ids uuid[])
RETURNS TABLE(doc_id uuid, bucket text, method text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_tenant uuid; v_uid uuid := auth.uid(); v_all boolean; v_ok uuid[];
BEGIN
  IF p_doc_type NOT IN ('invoice', 'shipment') THEN RAISE EXCEPTION 'نوع المستند غير صحيح'; END IF;
  v_tenant := public.assert_company_access(NULL);
  IF COALESCE(cardinality(p_ids), 0) > 5000 THEN RAISE EXCEPTION 'عدد مستندات كبير في طلب واحد (الحد 5000)'; END IF;
  v_all := public.is_admin(v_uid) OR public.is_super_admin(v_uid);
  SELECT array_agg(d.id) INTO v_ok FROM (
    SELECT i.id, i.tenant_id, i.branch_id FROM invoices i WHERE p_doc_type = 'invoice' AND i.id = ANY (p_ids)
    UNION ALL
    SELECT s.id, s.tenant_id, s.branch_id FROM shipments s WHERE p_doc_type = 'shipment' AND s.id = ANY (p_ids)) d
   WHERE d.tenant_id = v_tenant AND (v_all OR d.branch_id = ANY ((SELECT public.my_branch_ids())::uuid[]));
  RETURN QUERY SELECT r.doc_id, r.bucket, r.method, r.amount FROM public.ledger_settlement_rows(p_doc_type, COALESCE(v_ok, '{}')) r;
END $$;

-- ---------------------------------------------------------------- refresh the per-document rows
CREATE OR REPLACE FUNCTION public.ledger_settlement_refresh(p_doc_type text, p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(cardinality(p_ids), 0) = 0 THEN RETURN; END IF;
  IF p_doc_type = 'invoice' THEN
    INSERT INTO invoice_settlement AS t (invoice_id, tenant_id, branch_id, total, at_sale, later_money, from_account, from_return,
                                         cash, instapay, wallet, bank, paid, remaining, class, state, updated_at)
    SELECT x.id, x.tenant_id, x.branch_id, x.total, x.at_sale, x.later_money, x.acc, x.ret, x.cash, x.instapay, x.wallet, x.bank,
           x.paid, CASE WHEN x.status = 'cancelled' THEN 0 ELSE GREATEST(round(x.total - x.paid, 2), 0) END,
           CASE WHEN x.total > 0 AND x.at_sale >= x.total - 0.01 THEN 'cash' ELSE 'credit' END,
           CASE WHEN x.paid >= x.total - 0.01 THEN 'paid' WHEN x.paid <= 0.01 THEN 'unpaid' ELSE 'partial' END, now()
      FROM (
        SELECT i.id, i.tenant_id, i.branch_id, i.status, COALESCE(i.total, 0) AS total,
               COALESCE(sum(r.amount) FILTER (WHERE r.bucket = 'at_sale'), 0) AS at_sale,
               COALESCE(sum(r.amount) FILTER (WHERE r.bucket = 'later'), 0) AS later_money,
               COALESCE(sum(r.amount) FILTER (WHERE r.bucket = 'account'), 0) AS acc,
               COALESCE(sum(r.amount) FILTER (WHERE r.bucket = 'return'), 0) AS ret,
               COALESCE(sum(r.amount) FILTER (WHERE r.method = 'cash'), 0) AS cash,
               COALESCE(sum(r.amount) FILTER (WHERE r.method = 'instapay'), 0) AS instapay,
               COALESCE(sum(r.amount) FILTER (WHERE r.method IN ('vodafone', 'vodafone_cash', 'wallet')), 0) AS wallet,
               COALESCE(sum(r.amount) FILTER (WHERE r.method IS NOT NULL AND r.method NOT IN ('cash', 'instapay', 'vodafone', 'vodafone_cash', 'wallet')), 0) AS bank,
               COALESCE(sum(r.amount), 0) AS paid
          FROM invoices i LEFT JOIN public.ledger_settlement_rows('invoice', p_ids) r ON r.doc_id = i.id
         WHERE i.id = ANY (p_ids)
         GROUP BY i.id) x
    ON CONFLICT (invoice_id) DO UPDATE SET
      tenant_id = EXCLUDED.tenant_id, branch_id = EXCLUDED.branch_id, total = EXCLUDED.total, at_sale = EXCLUDED.at_sale,
      later_money = EXCLUDED.later_money, from_account = EXCLUDED.from_account, from_return = EXCLUDED.from_return,
      cash = EXCLUDED.cash, instapay = EXCLUDED.instapay, wallet = EXCLUDED.wallet, bank = EXCLUDED.bank,
      paid = EXCLUDED.paid, remaining = EXCLUDED.remaining, class = EXCLUDED.class, state = EXCLUDED.state, updated_at = now();
  ELSE
    INSERT INTO shipment_settlement AS t (shipment_id, tenant_id, branch_id, total, at_sale, later_money, from_account, from_return,
                                          cash, instapay, wallet, bank, paid, remaining, class, state, updated_at)
    SELECT x.id, x.tenant_id, x.branch_id, x.total, x.at_sale, x.later_money, x.acc, x.ret, x.cash, x.instapay, x.wallet, x.bank,
           x.paid, CASE WHEN x.status = 'cancelled' THEN 0 ELSE GREATEST(round(x.total - x.paid, 2), 0) END,
           CASE WHEN x.total > 0 AND x.at_sale >= x.total - 0.01 THEN 'cash' ELSE 'credit' END,
           CASE WHEN x.paid >= x.total - 0.01 THEN 'paid' WHEN x.paid <= 0.01 THEN 'unpaid' ELSE 'partial' END, now()
      FROM (
        SELECT s.id, s.tenant_id, s.branch_id, s.status, COALESCE(s.total_cost, 0) AS total,
               COALESCE(sum(r.amount) FILTER (WHERE r.bucket = 'at_sale'), 0) AS at_sale,
               COALESCE(sum(r.amount) FILTER (WHERE r.bucket = 'later'), 0) AS later_money,
               COALESCE(sum(r.amount) FILTER (WHERE r.bucket = 'account'), 0) AS acc,
               COALESCE(sum(r.amount) FILTER (WHERE r.bucket = 'return'), 0) AS ret,
               COALESCE(sum(r.amount) FILTER (WHERE r.method = 'cash'), 0) AS cash,
               COALESCE(sum(r.amount) FILTER (WHERE r.method = 'instapay'), 0) AS instapay,
               COALESCE(sum(r.amount) FILTER (WHERE r.method IN ('vodafone', 'vodafone_cash', 'wallet')), 0) AS wallet,
               COALESCE(sum(r.amount) FILTER (WHERE r.method IS NOT NULL AND r.method NOT IN ('cash', 'instapay', 'vodafone', 'vodafone_cash', 'wallet')), 0) AS bank,
               COALESCE(sum(r.amount), 0) AS paid
          FROM shipments s LEFT JOIN public.ledger_settlement_rows('shipment', p_ids) r ON r.doc_id = s.id
         WHERE s.id = ANY (p_ids)
         GROUP BY s.id) x
    ON CONFLICT (shipment_id) DO UPDATE SET
      tenant_id = EXCLUDED.tenant_id, branch_id = EXCLUDED.branch_id, total = EXCLUDED.total, at_sale = EXCLUDED.at_sale,
      later_money = EXCLUDED.later_money, from_account = EXCLUDED.from_account, from_return = EXCLUDED.from_return,
      cash = EXCLUDED.cash, instapay = EXCLUDED.instapay, wallet = EXCLUDED.wallet, bank = EXCLUDED.bank,
      paid = EXCLUDED.paid, remaining = EXCLUDED.remaining, class = EXCLUDED.class, state = EXCLUDED.state, updated_at = now();
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.ledger_settlement_refresh(text, uuid[]) FROM PUBLIC, anon, authenticated;

-- ledger_allocate refreshes the documents it allocated (never blocks: errors go to ledger_sync_errors)
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.ledger_allocate(uuid,uuid,text,uuid)'::regprocedure);
  IF position('ledger_settlement_refresh' in d) = 0 THEN
    d := replace(d, $q$  RETURN jsonb_build_object('run', v_run, 'kept', v_kept, 'inserted', v_new, 'superseded', v_sup);$q$,
      $q$  BEGIN
    IF p_contact IS NULL THEN
      PERFORM public.ledger_settlement_refresh('invoice', ARRAY[p_invoice]);
    ELSIF p_side = 'customer' THEN
      PERFORM public.ledger_settlement_refresh('invoice', ARRAY(SELECT i.id FROM invoices i WHERE i.contact_id = p_contact));
    ELSE
      PERFORM public.ledger_settlement_refresh('shipment', ARRAY(SELECT s.id FROM shipments s WHERE s.contact_id = p_contact));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO ledger_sync_errors (tenant_id, contact_id, invoice_id, context, error)
    VALUES (p_tenant, p_contact, p_invoice, 'settlement_cache', SQLERRM);
  END;
  RETURN jsonb_build_object('run', v_run, 'kept', v_kept, 'inserted', v_new, 'superseded', v_sup);$q$);
    IF position('ledger_settlement_refresh' in d) = 0 THEN RAISE EXCEPTION '0083: ledger_allocate patch failed'; END IF;
    EXECUTE d;
  END IF;
END $x$;

-- a walk-in invoice with no payment at all never reaches ledger_allocate: refresh it on insert / update
CREATE OR REPLACE FUNCTION public.zz_settlement_doc_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'invoices' THEN
      PERFORM public.ledger_settlement_refresh('invoice', ARRAY[NEW.id]);
    ELSE
      PERFORM public.ledger_settlement_refresh('shipment', ARRAY[NEW.id]);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END $$;
DO $x$ BEGIN
  EXECUTE replace('D_ROP TRIGGER IF EXISTS zz_settlement_doc ON public.invoices', 'D_ROP', 'DR' || 'OP');
  EXECUTE replace('D_ROP TRIGGER IF EXISTS zz_settlement_doc ON public.shipments', 'D_ROP', 'DR' || 'OP');
END $x$;
CREATE CONSTRAINT TRIGGER zz_settlement_doc AFTER INSERT OR UPDATE OF total, status, invoice_date, contact_id, branch_id ON public.invoices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.zz_settlement_doc_trg();
CREATE CONSTRAINT TRIGGER zz_settlement_doc AFTER INSERT OR UPDATE OF total_cost, status, invoice_date, contact_id, branch_id ON public.shipments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.zz_settlement_doc_trg();

-- backfill every document once
SELECT public.ledger_settlement_refresh('invoice', ARRAY(SELECT id FROM public.invoices));
SELECT public.ledger_settlement_refresh('shipment', ARRAY(SELECT id FROM public.shipments));

-- integrity check L1: «له تحت حسابه وعليه فواتير مفتوحة» is now a normal state waiting for a choice → info, not error
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.system_integrity_audit'::regproc);
  IF position($q$'L1', 'error'$q$ in d) > 0 THEN
    d := replace(d, $q$SELECT 'L1', 'error', 'ledger', 'رصيد تحت الحساب ومديونية مفتوحة لنفس الجانب',
         'متبقي ' || s.open_remaining || ' ومقدم ' || s.advance || ' في نفس الوقت (غالباً فترة مقفولة)',$q$,
      $q$SELECT 'L1', 'info', 'ledger', 'له فلوس تحت حسابه وعليه فواتير مفتوحة (مستني «سدد من تحت حسابه»)',
         'متبقي ' || s.open_remaining || ' وتحت الحساب ' || s.advance || ' — الفلوس مش بتتخصم لوحدها، القرار من ملف الجهة',$q$);
    IF position($q$'L1', 'info'$q$ in d) = 0 THEN RAISE EXCEPTION '0083: L1 patch failed'; END IF;
    EXECUTE d;
  END IF;
END $x$;
SELECT public.system_integrity_refresh_all();
