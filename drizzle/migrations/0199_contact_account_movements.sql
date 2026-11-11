-- 0199: owner 2026-11-11 «التعامل الأول والأخير في السيستم … دائن ومدين ورصيد» — the contact file shows ONE movements table
-- (التاريخ، الوقت، رقم الحركة، الحركة، لنا، علينا، الرصيد، الملاحظات) instead of the two side accounts / open-closed invoices.
--   ledger_contact_statement_x  = the body of ledger_contact_statement + where each line comes from (ev_ts, src_table, src_id);
--   ledger_contact_statement    = now a thin wrapper over it (same columns, same numbers — checked on 400 accounts before / after);
--   doc_source_times            = the time of day «سهل» printed on a document (from sahl_import.ops), kept in public so the
--                                 screen never depends on the import schema; no policies — read only through the function;
--   contact_account_movements   = contact_net_statement's lines + line_time, notes, src_table, src_id.
--     line_time: the «سهل» time of the document when known, else the entry time when the row was entered on its own day
--     (a back-dated entry has no honest time → NULL). Reads only; nothing is allocated or changed.
CREATE OR REPLACE FUNCTION public.ledger_contact_statement_x(p_contact uuid, p_side text, p_branch_id uuid DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(line_no integer, line_date date, line_type text, reference text, branch_name text, description text, debit numeric, credit numeric,
              balance numeric, doc_type text, doc_id uuid, branch_id uuid, ev_ts timestamptz, src_table text, src_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
           CASE WHEN dr.debt_type = 'movement' THEN NULL ELSE dr.debt_id END AS did,
           CASE WHEN dr.debt_type = 'invoice' THEN 'invoices' WHEN dr.debt_type = 'shipment' THEN 'shipments'
                ELSE (SELECT m.source_table FROM money_movements m WHERE m.id = dr.debt_id) END AS st,
           CASE WHEN dr.debt_type IN ('invoice', 'shipment') THEN dr.debt_id
                ELSE (SELECT m.source_id FROM money_movements m WHERE m.id = dr.debt_id) END AS sid
      FROM public.ledger_debt_rows(v_tenant, p_contact) dr
     WHERE dr.side = p_side AND (p_branch_id IS NULL OR dr.branch_id = p_branch_id)
    UNION ALL
    SELECT m.movement_date, 2, m.created_at, m.id, public.ledger_kind_label(m.side, m.kind, m.effect),
           public.ledger_movement_ref(m.source_table, m.source_id), m.branch_id,
           CASE WHEN m.method IS NOT NULL THEN m.method END, 0, m.amount, NULL, NULL, m.source_table, m.source_id
      FROM money_movements m
     WHERE m.tenant_id = v_tenant AND m.contact_id = p_contact AND m.side = p_side AND m.status = 'active'
       AND m.effect = 'settle' AND (p_branch_id IS NULL OR m.branch_id = p_branch_id)
    UNION ALL
    SELECT pa.effective_date, 3, pa.created_at, pa.id, 'سداد من فرع آخر',
           (SELECT b.name FROM branches b WHERE b.id = pa.movement_branch_id), pa.debt_branch_id,
           'اتسدد من فلوس متسجلة في فرع تاني (حساب جاري بين الفروع 1910)', 0, pa.amount, NULL, NULL, NULL, NULL
      FROM payment_allocations pa
     WHERE p_branch_id IS NOT NULL AND pa.tenant_id = v_tenant AND pa.contact_id = p_contact AND pa.side = p_side
       AND pa.status = 'active' AND pa.is_cross_branch AND pa.debt_branch_id = p_branch_id
    UNION ALL
    SELECT pa.effective_date, 3, pa.created_at, pa.id, 'استخدام في فرع آخر',
           (SELECT b.name FROM branches b WHERE b.id = pa.debt_branch_id), pa.movement_branch_id,
           'فلوس اتسجلت هنا واتسدد بيها مستند في فرع تاني (حساب جاري بين الفروع 1910)', pa.amount, 0, NULL, NULL, NULL, NULL
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
  SELECT 0, p_from, 'رصيد أول المدة'::text, NULL::text, NULL::text, NULL::text, 0::numeric, 0::numeric, round(pre.v, 2), NULL::text, NULL::uuid, NULL::uuid,
         NULL::timestamptz, NULL::text, NULL::uuid
    FROM pre WHERE p_from IS NOT NULL
  UNION ALL
  SELECT o.rn::int, o.d, o.t, o.ref, (SELECT b.name FROM branches b WHERE b.id = o.br), o.descr,
         round(o.dr_amt, 2), round(o.cr_amt, 2), round(o.run, 2), o.dt, o.did, o.br, o.ts, o.st, o.sid
    FROM ordered o
   WHERE (p_from IS NULL OR o.d >= p_from) AND (p_to IS NULL OR o.d <= p_to)
   ORDER BY 1;
END
$function$;
REVOKE ALL ON FUNCTION public.ledger_contact_statement_x(uuid, text, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_contact_statement_x(uuid, text, uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.ledger_contact_statement(p_contact uuid, p_side text, p_branch_id uuid DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(line_no integer, line_date date, line_type text, reference text, branch_name text, description text, debit numeric, credit numeric,
              balance numeric, doc_type text, doc_id uuid, branch_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT x.line_no, x.line_date, x.line_type, x.reference, x.branch_name, x.description, x.debit, x.credit, x.balance, x.doc_type, x.doc_id, x.branch_id
    FROM public.ledger_contact_statement_x(p_contact, p_side, p_branch_id, p_from, p_to) x ORDER BY 1
$function$;

CREATE TABLE IF NOT EXISTS public.doc_source_times (doc_id uuid PRIMARY KEY, tm time NOT NULL);
ALTER TABLE public.doc_source_times ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doc_source_times FROM anon, authenticated;
DO $mig$
BEGIN
  IF to_regclass('sahl_import.ops') IS NULL THEN RETURN; END IF;
  INSERT INTO public.doc_source_times (doc_id, tm)
  SELECT DISTINCT ON (o.new_id) o.new_id, o.tm FROM sahl_import.ops o WHERE o.new_id IS NOT NULL AND o.tm IS NOT NULL ORDER BY o.new_id, o.id
  ON CONFLICT (doc_id) DO UPDATE SET tm = EXCLUDED.tm;
END
$mig$;

CREATE OR REPLACE FUNCTION public.contact_account_movements(p_contact uuid, p_branch_id uuid DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(line_no integer, line_date date, line_time time, line_type text, reference text, branch_name text, description text, notes text,
              debit numeric, credit numeric, balance numeric, doc_type text, doc_id uuid, branch_id uuid, src_table text, src_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  WITH c AS (SELECT * FROM public.ledger_contact_statement_x(p_contact, 'customer', p_branch_id, p_from, p_to)),
       s AS (SELECT * FROM public.ledger_contact_statement_x(p_contact, 'supplier', p_branch_id, p_from, p_to)),
       o AS (SELECT coalesce((SELECT c.balance FROM c WHERE c.line_no = 0), 0) - coalesce((SELECT s.balance FROM s WHERE s.line_no = 0), 0) AS bal,
                    coalesce((SELECT c.line_date FROM c WHERE c.line_no = 0), (SELECT s.line_date FROM s WHERE s.line_no = 0)) AS d),
       m AS (SELECT 1 AS sd, c.line_no AS n, c.line_date, c.line_type, c.reference, c.branch_name, c.description, c.debit, c.credit, c.doc_type, c.doc_id, c.branch_id,
                    c.ev_ts, c.src_table, c.src_id
               FROM c WHERE c.line_no > 0
             UNION ALL
             SELECT 2, s.line_no, s.line_date, s.line_type, s.reference, s.branch_name, s.description, s.credit, s.debit, s.doc_type, s.doc_id, s.branch_id,
                    s.ev_ts, s.src_table, s.src_id
               FROM s WHERE s.line_no > 0),
       r AS (SELECT row_number() OVER (ORDER BY m.line_date, (m.line_type LIKE 'رصيد افتتاحي%') DESC, m.sd, m.n)::int AS rn, m.* FROM m)
  SELECT 0, o.d, NULL::time, 'رصيد أول المدة'::text, NULL::text, NULL::text, NULL::text, NULL::text, 0::numeric, 0::numeric, round(o.bal, 2),
         NULL::text, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid FROM o
  UNION ALL
  SELECT r.rn, r.line_date,
         coalesce((SELECT t.tm FROM public.doc_source_times t WHERE t.doc_id = r.src_id),
                  (SELECT t.tm FROM public.doc_source_times t JOIN public.invoice_payments ip ON ip.invoice_id = t.doc_id WHERE r.src_table = 'invoice_payments' AND ip.id = r.src_id),
                  CASE WHEN (r.ev_ts AT TIME ZONE 'Africa/Cairo')::date = r.line_date THEN date_trunc('minute', (r.ev_ts AT TIME ZONE 'Africa/Cairo'))::time END),
         r.line_type, r.reference, r.branch_name, r.description,
         CASE r.src_table
           WHEN 'invoices' THEN (SELECT i.notes FROM public.invoices i WHERE i.id = r.src_id)
           WHEN 'shipments' THEN (SELECT sh.notes FROM public.shipments sh WHERE sh.id = r.src_id)
           WHEN 'vouchers' THEN (SELECT v.description FROM public.vouchers v WHERE v.id = r.src_id)
           WHEN 'returns' THEN (SELECT coalesce(nullif(x.notes, ''), x.reason) FROM public.returns x WHERE x.id = r.src_id)
           WHEN 'purchase_returns' THEN (SELECT coalesce(nullif(x.notes, ''), x.reason) FROM public.purchase_returns x WHERE x.id = r.src_id)
           WHEN 'invoice_payments' THEN (SELECT i.notes FROM public.invoices i JOIN public.invoice_payments ip ON ip.invoice_id = i.id WHERE ip.id = r.src_id)
         END,
         r.debit, r.credit, round((SELECT o.bal FROM o) + sum(r.debit - r.credit) OVER (ORDER BY r.rn), 2), r.doc_type, r.doc_id, r.branch_id, r.src_table, r.src_id
    FROM r
  ORDER BY 1
$fn$;
REVOKE ALL ON FUNCTION public.contact_account_movements(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_account_movements(uuid, uuid, date, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
