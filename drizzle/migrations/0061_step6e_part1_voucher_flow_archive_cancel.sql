-- Step 6E (0058) part 1: voucher money class, ledger money flow, archive invoice cancellation (J / K), pre-2026 guard.
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS flow_class text
  CHECK (flow_class IN ('customer', 'supplier', 'internal', 'customer_refund', 'operating', 'other_income'));
COMMENT ON COLUMN public.vouchers.flow_class IS
  'Step 6E: customer = money from customers (collections, cash sales, deposits); supplier = money to / back from suppliers; customer_refund = money back to customers; internal = transfers, partners, staff advances, opening; operating = expenses; other_income = other receipts.';

CREATE OR REPLACE FUNCTION public.voucher_flow_class_of(p_type text, p_party_type text, p_source_type text,
                                                        p_category_id uuid, p_treasury_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN COALESCE(t.is_fee, false) OR c.system_key = 'transfer_fee' OR t.category IN ('fee', 'fee_edit', 'fee_void')
      OR EXISTS (SELECT 1 FROM expenses e WHERE e.id = t.reference_id AND COALESCE(e.is_fee, false))
      THEN CASE WHEN p_type = 'receipt' THEN 'other_income' ELSE 'operating' END
    WHEN p_type = 'receipt' THEN CASE
      WHEN p_party_type = 'supplier'
        OR t.category IN ('purchase_return', 'payment_out_void', 'purchase_return_refund')
        OR t.category = 'payment_edit_reversal'
        OR EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.treasury_id = p_treasury_id AND pt.direction = 'out' AND pt.contact_id IS NOT NULL)
        THEN 'supplier'
      WHEN p_party_type = 'customer' OR p_source_type = 'credit_deposit'
        OR c.system_key IN ('cash_sale', 'installment', 'credit_deposit')
        OR t.category IN ('customer_payment', 'contact_settlement', 'contact_settlement_surplus', 'payment_in', 'sales',
                          'sales_extra_payment', 'payment_edit_new', 'pre_order_deposit', 'return_cancel')
        OR EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.treasury_id = p_treasury_id AND pt.direction = 'in' AND pt.contact_id IS NOT NULL)
        THEN 'customer'
      WHEN c.system_key IN ('branch_transfer_in', 'partner_capital')
        OR t.category IN ('transfer', 'transfer_in', 'branch_transfer_in', 'capital_allocation', 'partner_contribution',
                          'partner_advance_repayment', 'advance_repayment', 'رصيد افتتاحي', 'إلغاء سند')
        THEN 'internal'
      ELSE 'other_income' END
    ELSE CASE
      WHEN p_party_type = 'supplier' OR c.system_key = 'supplier_payment'
        OR t.category IN ('supplier_payment', 'purchase_shipment_payment', 'purchase_return_cancel')
        OR (t.category = 'payment_out'
            AND EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.treasury_id = p_treasury_id AND pt.contact_id IS NOT NULL))
        OR t.category = 'payment_edit_new'
        THEN 'supplier'
      WHEN p_party_type = 'customer' OR c.system_key = 'customer_return'
        OR t.category IN ('sales_refund', 'return', 'sale_return', 'payment_in_void', 'payment_edit_reversal', 'pre_order_refund')
        THEN 'customer_refund'
      WHEN c.system_key IN ('branch_transfer_out', 'advance', 'partner_withdrawal')
        OR t.category IN ('transfer', 'transfer_out', 'branch_transfer_out', 'capital_allocation', 'partner_withdrawal',
                          'partner_advance', 'advance', 'رصيد افتتاحي', 'إلغاء سند', 'transfer_refund')
        THEN 'internal'
      ELSE 'operating' END
  END
  FROM (SELECT 1) one
  LEFT JOIN voucher_categories c ON c.id = p_category_id
  LEFT JOIN treasury t ON t.id = p_treasury_id
$$;

CREATE OR REPLACE FUNCTION public.voucher_set_flow_class()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  NEW.flow_class := public.voucher_flow_class_of(NEW.type::text, NEW.party_type::text, NEW.source_type, NEW.category_id, NEW.treasury_id);
  IF COALESCE(current_setting('app.contact_money', true), '') = '1' AND NEW.flow_class IN ('other_income', 'operating')
     AND NOT EXISTS (SELECT 1 FROM treasury t WHERE t.id = NEW.treasury_id AND COALESCE(t.is_fee, false)) THEN
    NEW.flow_class := CASE WHEN NEW.type::text = 'receipt' THEN 'customer' ELSE 'supplier' END;
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS aa_voucher_flow_class ON public.vouchers;
CREATE TRIGGER aa_voucher_flow_class BEFORE INSERT ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.voucher_set_flow_class();

DO $bf$
DECLARE v_trg text[];
BEGIN
  PERFORM set_config('lock_timeout', '15s', true);
  SELECT array_agg(t.tgname ORDER BY t.tgname) INTO v_trg
    FROM pg_trigger t WHERE t.tgrelid = 'public.vouchers'::regclass AND NOT t.tgisinternal AND t.tgenabled <> 'D';
  FOR i IN 1 .. COALESCE(array_length(v_trg, 1), 0) LOOP
    EXECUTE format('ALTER TABLE public.vouchers DISABLE TRIGGER %I', v_trg[i]);
  END LOOP;
  UPDATE public.vouchers v
     SET flow_class = public.voucher_flow_class_of(v.type::text, v.party_type::text, v.source_type, v.category_id, v.treasury_id)
   WHERE v.flow_class IS DISTINCT FROM public.voucher_flow_class_of(v.type::text, v.party_type::text, v.source_type, v.category_id, v.treasury_id);
  FOR i IN 1 .. COALESCE(array_length(v_trg, 1), 0) LOOP
    EXECUTE format('ALTER TABLE public.vouchers ENABLE TRIGGER %I', v_trg[i]);
  END LOOP;
END
$bf$;

CREATE OR REPLACE FUNCTION public.ledger_invoice_is_archive(p_doc_date timestamptz, p_created_at timestamptz,
                                                            p_is_migrated boolean, p_batch uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT public.ledger_day(p_doc_date) < public.ledger_cutoff()
     AND (public.ledger_day(COALESCE(p_created_at, p_doc_date)) < public.ledger_cutoff()
          OR COALESCE(p_is_migrated, false) OR p_batch IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION public.ledger_archive_paid_in_ledger(p_invoice uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(round(sum(ip.amount), 2), 0)
    FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
   WHERE ip.invoice_id = p_invoice AND i.contact_id IS NOT NULL
     AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL AND ip.amount > 0
     AND ip.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
     AND public.ledger_day(ip.created_at) >= public.ledger_cutoff()
     AND NOT public.ledger_ip_is_voided_mirror(ip.id)
$$;

CREATE OR REPLACE FUNCTION public.ledger_archive_due_at_cutoff(p_invoice uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT round(GREATEST(i.total, 0)
               - (LEAST(GREATEST(COALESCE(i.total_paid_before_cancel, 0), 0), GREATEST(i.total, 0))
                  - LEAST(public.ledger_archive_paid_in_ledger(i.id),
                          LEAST(GREATEST(COALESCE(i.total_paid_before_cancel, 0), 0), GREATEST(i.total, 0)))), 2)
    FROM invoices i WHERE i.id = p_invoice
$$;

CREATE OR REPLACE FUNCTION public.ledger_archive_cancel_parts(p_invoice uuid)
RETURNS TABLE (j numeric, r1200 numeric, cash numeric, forfeit numeric, net numeric, vat numeric,
               cancel_day date, branch_id uuid, tenant_id uuid, contact_id uuid, invoice_number text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT round(q.inc - q.p26 + q.credit, 2),
         round(q.due - q.inc, 2),
         round(q.cash, 2),
         round(q.paid - q.cash - q.credit, 2),
         round(GREATEST(i.total, 0) - COALESCE(i.vat_amount, 0), 2),
         round(COALESCE(i.vat_amount, 0), 2),
         public.ledger_day(i.cancelled_at), i.branch_id, i.tenant_id, i.contact_id, i.invoice_number
    FROM invoices i
    LEFT JOIN contacts ct ON ct.id = i.contact_id
    CROSS JOIN LATERAL (SELECT LEAST(GREATEST(COALESCE(i.total_paid_before_cancel, 0), 0), GREATEST(i.total, 0)) AS paid) pp
    CROSS JOIN LATERAL (SELECT LEAST(public.ledger_archive_paid_in_ledger(i.id), pp.paid) AS p26) p6
    CROSS JOIN LATERAL (SELECT GREATEST(i.total, 0) - (pp.paid - p6.p26) AS due) dd
    CROSS JOIN LATERAL (
      SELECT CASE WHEN i.contact_id IS NOT NULL AND COALESCE(ct.type::text, '') <> 'supplier' AND COALESCE(ct.opening_balance, 0) > 0
                  THEN GREATEST(ct.opening_balance - COALESCE((
                         SELECT sum(public.ledger_archive_due_at_cutoff(x.id)) FROM invoices x
                          WHERE x.contact_id = i.contact_id AND x.id <> i.id AND x.status = 'cancelled' AND x.cancelled_at IS NOT NULL
                            AND public.ledger_invoice_is_archive(x.invoice_date, x.created_at, x.is_migrated, x.migration_batch_id)
                            AND public.ledger_day(x.cancelled_at) >= public.ledger_cutoff()
                            AND (x.cancelled_at, x.id) < (i.cancelled_at, i.id)), 0), 0)
                  ELSE 0 END AS room) rm
    CROSS JOIN LATERAL (
      SELECT dd.due, pp.paid, p6.p26,
             LEAST(dd.due, rm.room) AS inc,
             CASE WHEN i.refund_method = 'cash' THEN LEAST(COALESCE(i.refund_amount, 0), pp.paid) ELSE 0 END AS cash,
             CASE WHEN i.refund_method = 'credit' AND i.contact_id IS NOT NULL THEN pp.paid ELSE 0 END AS credit) q
   WHERE i.id = p_invoice AND i.status = 'cancelled' AND i.cancelled_at IS NOT NULL
     AND public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
     AND public.ledger_day(i.cancelled_at) >= public.ledger_cutoff()
$$;

CREATE OR REPLACE FUNCTION public.ledger_money_flow(p_side text, p_branch_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
                                                    p_contact uuid DEFAULT NULL)
RETURNS TABLE (method text, money_in numeric, money_out numeric, movements int)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_tenant uuid;
BEGIN
  IF p_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'side غير صحيح'; END IF;
  IF p_branch_id IS NULL THEN RAISE EXCEPTION 'حدد الفرع'; END IF;
  v_tenant := public.ledger_read_scope(p_branch_id, p_side);
  RETURN QUERY
  SELECT x.mth, round(sum(x.m_in), 2), round(sum(x.m_out), 2), sum(x.n)::int
    FROM (
      SELECT COALESCE(m.method, 'cash') AS mth,
             CASE WHEN m.direction = 'in' THEN m.amount ELSE 0 END AS m_in,
             CASE WHEN m.direction = 'out' THEN m.amount ELSE 0 END AS m_out, 1 AS n
        FROM money_movements m
       WHERE m.tenant_id = v_tenant AND m.branch_id = p_branch_id AND m.side = p_side AND m.status = 'active'
         AND m.kind IN ('payment', 'deposit', 'refund')
         AND NOT (m.source_table = 'invoices' AND EXISTS (SELECT 1 FROM public.ledger_archive_cancel_parts(m.source_id)))
         AND (p_from IS NULL OR m.movement_date >= p_from) AND (p_to IS NULL OR m.movement_date <= p_to)
         AND (p_contact IS NULL OR m.contact_id = p_contact)
      UNION ALL
      SELECT 'cash', 0, p.cash, 1
        FROM invoices i CROSS JOIN LATERAL public.ledger_archive_cancel_parts(i.id) p
       WHERE p_side = 'customer' AND i.tenant_id = v_tenant AND i.branch_id = p_branch_id
         AND i.status = 'cancelled' AND i.refund_method = 'cash' AND p.cash > 0
         AND public.ledger_day(i.invoice_date) < public.ledger_cutoff()
         AND (p_from IS NULL OR p.cancel_day >= p_from) AND (p_to IS NULL OR p.cancel_day <= p_to)
         AND (p_contact IS NULL OR i.contact_id = p_contact)
    ) x
   GROUP BY 1;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_archive_cancel_lines(p_invoice uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_agg(jsonb_build_object('account_code', x.code, 'debit', x.dr, 'credit', x.cr, 'description', x.d) ORDER BY x.o)
    FROM public.ledger_archive_cancel_parts(p_invoice) p
    CROSS JOIN LATERAL (VALUES
      (1, '4900', p.net, 0::numeric, 'مرتجع مبيعات — إلغاء فاتورة ' || p.invoice_number || ' (قبل 2026)'),
      (2, '2200', p.vat, 0::numeric, 'عكس ضريبة فاتورة ملغاة ' || p.invoice_number),
      (3, '2150', 0::numeric, GREATEST(p.j, 0), 'رصيد للعميل من إلغاء الفاتورة'),
      (3, '1200', GREATEST(-p.j, 0), 0::numeric, 'استرجاع ما دفعه العميل في 2026 على الفاتورة الملغاة ' || p.invoice_number),
      (4, '1200', 0::numeric, p.r1200, 'باقي فاتورة ملغاة ' || p.invoice_number),
      (5, '1100', 0::numeric, p.cash, 'رد فلوس فاتورة ملغاة ' || p.invoice_number),
      (6, '4200', 0::numeric, p.forfeit, 'مبلغ مدفوع على فاتورة ملغاة ولم يُرد ' || p.invoice_number)) x(o, code, dr, cr, d)
   WHERE x.dr > 0.004 OR x.cr > 0.004
$$;

CREATE OR REPLACE FUNCTION public.ledger_archive_shipment_due(p_shipment uuid)
RETURNS TABLE (due numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT round(GREATEST(s.total_cost, 0) - LEAST(GREATEST(s.total_cost, 0), COALESCE((
           SELECT sum(pt.amount) FROM payment_plans pp JOIN payment_transactions pt ON pt.payment_plan_id = pp.id
            WHERE pp.reference_type = 'shipment' AND pp.reference_id = s.id AND pt.direction = 'out'
              AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL AND pt.amount > 0
              AND pt.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
              AND public.ledger_day(pt.created_at) < public.ledger_cutoff()), 0)), 2)
    FROM shipments s WHERE s.id = p_shipment
$$;

CREATE OR REPLACE FUNCTION public.ledger_archive_shipment_parts(p_shipment uuid)
RETURNS TABLE (k numeric, due numeric, inc numeric, paid_before numeric, cancel_day date, branch_id uuid, contact_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH pay AS (
    SELECT s0.id AS sid,
           COALESCE(sum(pt.amount) FILTER (WHERE public.ledger_day(pt.created_at) < public.ledger_cutoff()), 0) AS p25
      FROM shipments s0
      LEFT JOIN payment_plans pp ON pp.reference_type = 'shipment' AND pp.reference_id = s0.id
      LEFT JOIN payment_transactions pt ON pt.payment_plan_id = pp.id AND pt.direction = 'out'
            AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL AND pt.amount > 0
            AND pt.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
     GROUP BY s0.id)
  SELECT round(q.inc + q.p25, 2), round(q.due, 2), round(q.inc, 2), round(q.p25, 2),
         public.ledger_day(s.cancelled_at), s.branch_id, s.contact_id
    FROM shipments s
    JOIN contacts ct ON ct.id = s.contact_id
    JOIN pay ON pay.sid = s.id
    CROSS JOIN LATERAL (SELECT LEAST(pay.p25, GREATEST(s.total_cost, 0)) AS p25) p
    CROSS JOIN LATERAL (SELECT GREATEST(s.total_cost, 0) - p.p25 AS due) d
    CROSS JOIN LATERAL (
      SELECT CASE WHEN ct.type::text IN ('supplier', 'both') AND COALESCE(ct.opening_balance, 0) < 0
                  THEN GREATEST(-ct.opening_balance - COALESCE((
                         SELECT sum(x2.due) FROM shipments x
                          CROSS JOIN LATERAL public.ledger_archive_shipment_due(x.id) x2
                          WHERE x.contact_id = s.contact_id AND x.id <> s.id AND x.status = 'cancelled' AND x.cancelled_at IS NOT NULL
                            AND public.ledger_invoice_is_archive(COALESCE(x.invoice_date::timestamptz, x.created_at), x.created_at, x.is_migrated, x.migration_batch_id)
                            AND public.ledger_day(x.cancelled_at) >= public.ledger_cutoff()
                            AND (x.cancelled_at, x.id) < (s.cancelled_at, s.id)), 0), 0)
                  ELSE 0 END AS room) rm
    CROSS JOIN LATERAL (SELECT d.due, p.p25, LEAST(d.due, rm.room) AS inc) q
   WHERE s.id = p_shipment AND s.status = 'cancelled' AND s.cancelled_at IS NOT NULL
     AND public.ledger_invoice_is_archive(COALESCE(s.invoice_date::timestamptz, s.created_at), s.created_at, s.is_migrated, s.migration_batch_id)
     AND public.ledger_day(s.cancelled_at) >= public.ledger_cutoff()
$$;

-- capture rules (K) and (J); the stored body has no comment markers, so the anchors are the next SELECTs
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ledger_desired_movements(uuid)'::regprocedure);
  v_new := regexp_replace(v_def, 'UNION ALL\s+SELECT ''purchase_returns'', pr\.id',
$b$UNION ALL
  SELECT 'shipments', s.id, 'return_credit', 'supplier', 'settle',
         s.branch_id, NULL, p.k, p.cancel_day, NULL, NULL, NULL, false
    FROM shipments s CROSS JOIN LATERAL public.ledger_archive_shipment_parts(s.id) p
   WHERE s.contact_id = c.id AND s.status = 'cancelled' AND p.k > 0.005
  UNION ALL
  SELECT 'purchase_returns', pr.id$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6E: capture rule (K) anchor not found'; END IF;
  v_def := v_new;
  v_new := regexp_replace(v_def, 'UNION ALL\s+SELECT ''returns'', r\.id',
$b$UNION ALL
  SELECT 'invoices', i.id,
         CASE WHEN p.j > 0 THEN 'return_credit' ELSE 'refund' END, 'customer',
         CASE WHEN p.j > 0 THEN 'settle' ELSE 'charge' END,
         i.branch_id, CASE WHEN p.j > 0 THEN NULL ELSE 'cash' END, abs(p.j), p.cancel_day, NULL, NULL, NULL, false
    FROM invoices i CROSS JOIN LATERAL public.ledger_archive_cancel_parts(i.id) p
   WHERE i.contact_id = c.id AND i.status = 'cancelled' AND public.ledger_day(i.invoice_date) < v_cut
     AND abs(p.j) > 0.005
  UNION ALL
  SELECT 'returns', r.id$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6E: capture rule (J) anchor not found'; END IF;
  EXECUTE v_new;
END
$patch$;

CREATE OR REPLACE FUNCTION public.ledger_movement_ref(p_source_table text, p_source_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE p_source_table
    WHEN 'vouchers' THEN (SELECT v.voucher_number FROM vouchers v WHERE v.id = p_source_id)
    WHEN 'invoice_payments' THEN (SELECT 'دفعة على ' || i.invoice_number || COALESCE(' #' || NULLIF(ip.reference_number, ''), '')
                                    FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id WHERE ip.id = p_source_id)
    WHEN 'payment_transactions' THEN (SELECT COALESCE(NULLIF(pt.reference_number, ''), 'دفعة') FROM payment_transactions pt WHERE pt.id = p_source_id)
    WHEN 'supplier_payments' THEN (SELECT COALESCE(NULLIF(sp.notes, ''), 'دفعة مورد') FROM supplier_payments sp WHERE sp.id = p_source_id)
    WHEN 'returns' THEN (SELECT COALESCE(r.return_number, 'مرتجع بيع') FROM returns r WHERE r.id = p_source_id)
    WHEN 'purchase_returns' THEN (SELECT COALESCE(pr.return_number, 'مرتجع شراء') FROM purchase_returns pr WHERE pr.id = p_source_id)
    WHEN 'invoices' THEN (SELECT 'إلغاء فاتورة ' || i.invoice_number FROM invoices i WHERE i.id = p_source_id)
    WHEN 'shipments' THEN (SELECT 'إلغاء فاتورة شراء ' || COALESCE(sh.shipment_number, '') || ' (قبل 2026)' FROM shipments sh WHERE sh.id = p_source_id)
    WHEN 'customer_credit_log' THEN 'إيداع تحت الحساب'
    WHEN 'contacts' THEN 'رصيد افتتاحي'
  END
$$;

ALTER TABLE public.ledger_gl_links DROP CONSTRAINT IF EXISTS ledger_gl_links_ref_type_check;
ALTER TABLE public.ledger_gl_links ADD CONSTRAINT ledger_gl_links_ref_type_check
  CHECK (ref_type IN ('movement', 'allocation', 'walkin_refund', 'retired', 'archive_cancel'));

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ledger_gl_sync(uuid,uuid,uuid)'::regprocedure);
  v_new := replace(v_def,
$a$    v_lines := CASE
      WHEN m.side = 'customer' AND m.kind IN ('payment', 'deposit') THEN jsonb_build_array($a$,
$b$    v_lines := CASE
      WHEN m.side = 'customer' AND m.source_table = 'invoices' AND m.kind IN ('return_credit', 'refund')
           AND EXISTS (SELECT 1 FROM public.ledger_archive_cancel_parts(m.source_id))
        THEN public.ledger_archive_cancel_lines(m.source_id)
      WHEN m.side = 'customer' AND m.kind IN ('payment', 'deposit') THEN jsonb_build_array($b$);
  v_new := replace(v_new,
$a$     ORDER BY 1
  LOOP
    v_j := public.ledger_gl_reverse(k.journal_id, 'عكس قيد الدفتر الموحد');$a$,
$b$    UNION ALL
    SELECT l.* FROM ledger_gl_links l JOIN invoices x ON x.id = l.ref_id
     WHERE l.ref_type = 'archive_cancel' AND l.status = 'posted'
       AND ((p_contact IS NOT NULL AND x.contact_id = p_contact)
            OR (p_contact IS NULL AND x.contact_id IS NULL AND x.id = p_invoice))
       AND NOT EXISTS (SELECT 1 FROM public.ledger_archive_cancel_parts(x.id) p WHERE abs(p.j) <= 0.005)
     ORDER BY 1
  LOOP
    v_j := public.ledger_gl_reverse(k.journal_id, 'عكس قيد الدفتر الموحد');$b$);
  v_new := replace(v_new,
$a$  RETURN jsonb_build_object('reversed', v_rev, 'movements', v_mv,$a$,
$b$  -- (5) Step 6E: archive invoice cancelled with nothing credited to a customer (walk-in, or paid and given
  --     back in cash / kept): the same combined entry under its own link
  FOR i IN
    SELECT x.id FROM invoices x
     WHERE x.tenant_id = p_tenant AND x.status = 'cancelled'
       AND ((p_contact IS NOT NULL AND x.contact_id = p_contact)
            OR (p_contact IS NULL AND x.contact_id IS NULL AND x.id = p_invoice))
       AND public.ledger_day(x.invoice_date) < public.ledger_cutoff()
       AND EXISTS (SELECT 1 FROM public.ledger_archive_cancel_parts(x.id) p WHERE abs(p.j) <= 0.005)
       AND NOT EXISTS (SELECT 1 FROM ledger_gl_links l WHERE l.ref_type = 'archive_cancel' AND l.ref_id = x.id AND l.status = 'posted')
  LOOP
    SELECT p.* INTO a FROM public.ledger_archive_cancel_parts(i.id) p;
    IF public.ledger_period_closed(p_tenant, a.cancel_day) THEN
      INSERT INTO ledger_gl_skipped (tenant_id, ref_type, ref_id, entry_date, reason)
      VALUES (p_tenant, 'archive_cancel', i.id, a.cancel_day, 'closed_period') ON CONFLICT DO NOTHING;
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;
    v_j := public.ledger_gl_post(p_tenant, a.branch_id, a.cancel_day, 'الدفتر الموحد — إلغاء فاتورة ' || a.invoice_number || ' (قبل 2026)',
                                 'ledger_archive_cancel', i.id, public.ledger_archive_cancel_lines(i.id));
    INSERT INTO ledger_gl_links (tenant_id, ref_type, ref_id, part, journal_id) VALUES (p_tenant, 'archive_cancel', i.id, 'main', v_j);
    v_wr := v_wr + 1;
  END LOOP;

  RETURN jsonb_build_object('reversed', v_rev, 'movements', v_mv,$b$);
  IF v_new = v_def OR position('ledger_archive_cancel_lines(m.source_id)' IN v_new) = 0
     OR position($q$m.kind IN ('return_credit', 'refund')$q$ IN v_new) = 0
     OR position($q$l.ref_type = 'archive_cancel' AND l.status = 'posted'$q$ IN v_new) = 0
     OR position('(5) Step 6E' IN v_new) = 0 THEN
    RAISE EXCEPTION 'Step 6E: ledger_gl_sync patch did not apply';
  END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.ledger_gl_backfill(uuid)'::regprocedure);
  v_new := replace(v_def,
$a$    FOR r IN SELECT DISTINCT mm.contact_id FROM money_movements mm WHERE mm.tenant_id = t.id AND mm.contact_id IS NOT NULL LOOP$a$,
$b$    FOR r IN SELECT mm.contact_id FROM money_movements mm WHERE mm.tenant_id = t.id AND mm.contact_id IS NOT NULL
             UNION
             SELECT i.contact_id FROM invoices i
              WHERE i.tenant_id = t.id AND i.contact_id IS NOT NULL AND i.status = 'cancelled'
                AND public.ledger_day(i.invoice_date) < public.ledger_cutoff()
                AND public.ledger_day(i.cancelled_at) >= public.ledger_cutoff() LOOP$b$);
  v_new := replace(v_new,
$a$                  AND COALESCE(i.refund_amount, 0) > 0 AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff()) x LOOP$a$,
$b$                  AND COALESCE(i.refund_amount, 0) > 0 AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff()
               UNION
               SELECT i.id FROM invoices i
                WHERE i.tenant_id = t.id AND i.contact_id IS NULL AND i.status = 'cancelled'
                  AND public.ledger_day(i.invoice_date) < public.ledger_cutoff()
                  AND public.ledger_day(i.cancelled_at) >= public.ledger_cutoff()) x LOOP$b$);
  IF v_new = v_def OR position('SELECT i.contact_id FROM invoices i' IN v_new) = 0
     OR position('AND public.ledger_day(i.cancelled_at) >= public.ledger_cutoff()) x LOOP' IN v_new) = 0 THEN
    RAISE EXCEPTION 'Step 6E: ledger_gl_backfill patch did not apply';
  END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.trg_invoice_journal()'::regprocedure);
  v_new := replace(v_def,
$a$  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN$a$,
$b$  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
        AND public.ledger_invoice_is_archive(NEW.invoice_date, NEW.created_at, NEW.is_migrated, NEW.migration_batch_id)
        AND public.ledger_day(COALESCE(NEW.cancelled_at, now())) >= public.ledger_cutoff() THEN
    NULL;   -- Step 6E: posted from the ledger as a sales return (4900) on the cancellation day
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6E: trg_invoice_journal patch did not apply'; END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.trg_invoice_status_cogs()'::regprocedure);
  v_new := replace(v_def,
$a$    ELSE
      -- non-active: remove COGS entry$a$,
$b$    ELSIF public.ledger_invoice_is_archive(NEW.invoice_date, NEW.created_at, NEW.is_migrated, NEW.migration_batch_id)
          OR EXISTS (SELECT 1 FROM public.journal_entries je
                      WHERE je.source_type = 'invoice_cogs' AND je.source_id = NEW.id
                        AND public.ledger_period_closed(je.tenant_id, je.entry_date)) THEN
      PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'invoice_cogs', NEW.id,
                'إلغاء فاتورة ' || NEW.invoice_number || ' — رجوع البضاعة للمخزن');   -- Step 6E
    ELSE
      -- non-active: remove COGS entry$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6E: trg_invoice_status_cogs patch did not apply'; END IF;
  EXECUTE v_new;
END
$patch$;

CREATE OR REPLACE FUNCTION public.ledger_voucher_is_contact_money(p_voucher uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM vouchers v
      LEFT JOIN treasury t ON t.id = v.treasury_id
     WHERE v.id = p_voucher
       AND (
            (v.party_type::text IN ('customer', 'supplier') AND v.party_id IS NOT NULL)
         OR v.source_type = 'credit_deposit'
         OR t.category IN ('contact_settlement', 'contact_settlement_surplus')
         OR (t.category IN ('customer_payment', 'supplier_payment')
             AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = t.reference_id))
         OR EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.treasury_id = t.id AND pt.contact_id IS NOT NULL
                      AND public.ledger_day(COALESCE((SELECT o.created_at FROM payment_transactions o WHERE o.id = pt.reverses_tx_id), pt.created_at)) >= public.ledger_cutoff())
         OR (t.category = 'sales_refund'
             AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = t.reference_id AND i.status = 'cancelled'
                           AND i.refund_method = 'cash' AND COALESCE(i.refund_amount, 0) > 0
                           AND public.ledger_day(COALESCE(i.cancelled_at, i.invoice_date)) >= public.ledger_cutoff()
                           AND (public.ledger_day(i.invoice_date) >= public.ledger_cutoff()
                                OR public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id))))
       )
  )
$$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ledger_old_entry_is_contact_money(uuid)'::regprocedure);
  v_new := regexp_replace(v_def,
    '(AND public\.ledger_voucher_is_contact_money\(e\.source_id\)\))\)\)',
    $b$\1
         OR (e.source_type = 'invoice_reversal' AND EXISTS (
               SELECT 1 FROM invoices i WHERE i.id = e.source_id AND i.status = 'cancelled'
                 AND public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
                 AND public.ledger_day(COALESCE(i.cancelled_at, e.created_at)) >= public.ledger_cutoff()))))$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6E: ledger_old_entry_is_contact_money patch did not apply'; END IF;
  EXECUTE v_new;

  FOREACH v_def IN ARRAY ARRAY[pg_get_functiondef('public.ledger_gl_retire_old(uuid)'::regprocedure),
                               pg_get_functiondef('public.ledger_gl_reconciliation(uuid)'::regprocedure)] LOOP
    v_new := replace(v_def, $a$('invoice_payment', 'supplier_payment', 'voucher')$a$,
                            $b$('invoice_payment', 'supplier_payment', 'voucher', 'invoice_reversal')$b$);
    IF v_new = v_def THEN RAISE EXCEPTION 'Step 6E: retire source list not found'; END IF;
    EXECUTE v_new;
  END LOOP;
END
$patch$;

CREATE OR REPLACE FUNCTION public.guard_pre_ledger_document_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_cut date := public.ledger_cutoff(); v_new date; v_old date;
BEGIN
  IF COALESCE(current_setting('app.allow_pre_ledger_date', true), '') = '1' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_migrated, false) OR NEW.migration_batch_id IS NOT NULL THEN RETURN NEW; END IF;
  v_new := public.ledger_day(COALESCE(NEW.invoice_date::timestamptz, NEW.created_at, now()));
  IF TG_OP = 'INSERT' THEN
    IF v_new < v_cut AND public.ledger_day(COALESCE(NEW.created_at, now())) >= v_cut THEN
      RAISE EXCEPTION 'تاريخ المستند (%) قبل بداية الدفتر الموحد (%). المستندات القديمة مكانها الأرشيف والرصيد الافتتاحي — سجّل المستند بتاريخ من % أو عدّل الرصيد الافتتاحي للجهة.',
        v_new, v_cut, v_cut USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.invoice_date IS DISTINCT FROM OLD.invoice_date THEN
    v_old := public.ledger_day(COALESCE(OLD.invoice_date::timestamptz, OLD.created_at));
    IF (v_new < v_cut) <> (v_old < v_cut) THEN
      RAISE EXCEPTION 'مينفعش تنقل تاريخ المستند من قبل بداية الدفتر الموحد (%) لبعدها أو العكس (من % إلى %).', v_cut, v_old, v_new
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS a1_guard_pre_ledger_date ON public.invoices;
CREATE TRIGGER a1_guard_pre_ledger_date BEFORE INSERT OR UPDATE OF invoice_date ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_pre_ledger_document_date();
DROP TRIGGER IF EXISTS a1_guard_pre_ledger_date ON public.shipments;
CREATE TRIGGER a1_guard_pre_ledger_date BEFORE INSERT OR UPDATE OF invoice_date ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.guard_pre_ledger_document_date();

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ledger_reconciliation(uuid)'::regprocedure);
  v_new := replace(v_def,
$a$      COALESCE((SELECT sum(m.amount) FROM money_movements m WHERE m.contact_id = s.id AND m.side = s.side AND m.status = 'active'
                 AND m.source_table = 'invoices' AND m.kind = 'refund'), 0) AS k6,$a$,
$b$      COALESCE((SELECT sum(CASE WHEN m.effect = 'charge' THEN m.amount ELSE -m.amount END) FROM money_movements m
                 WHERE m.contact_id = s.id AND m.side = s.side AND m.status = 'active'
                   AND m.source_table IN ('invoices', 'shipments') AND m.kind IN ('refund', 'return_credit')), 0) AS k6,$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6E: ledger_reconciliation patch did not apply'; END IF;
  EXECUTE v_new;
END
$patch$;