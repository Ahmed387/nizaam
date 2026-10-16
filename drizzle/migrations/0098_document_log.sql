-- 0098 — «سجل المستندات» (owner request 2026-10-16): every step on a sale / purchase invoice, sale / purchase
-- return, receipt / payment voucher is one row: when it really happened, who did it, what (in Arabic), the
-- document's number and date, and the document's fields AFTER the step. Clicking a row shows before → after.
-- The old audit_log is kept as is (append-only); it missed voucher / purchase-return edits and named rows by id.
--   document_events            the log (append-only; written only by the triggers / backfill below)
--   _doc_event_snapshot()      the document's display fields from its row
--   _doc_event_classify()      UPDATE → one event per kind of change (cancel / date / amount / party / notes / method)
--   doc_events_trg             AFTER INSERT / UPDATE on invoices, shipments, returns, purchase_returns, vouchers
--   doc_payment_events_trg     money on a document: invoice_payments (sale), payment_transactions of a purchase plan
--   document_log_page()        the screen's reader (invoker — RLS decides what a user sees)
-- A failure here never blocks the business action (the triggers swallow their own errors).

CREATE TABLE IF NOT EXISTS public.document_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  branch_id   uuid,
  doc_type    text NOT NULL CHECK (doc_type IN ('sale','purchase','sale_return','purchase_return','receipt','payment')),
  doc_id      uuid NOT NULL,
  action      text NOT NULL,
  changes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id     uuid,
  user_name   text,
  at          timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL DEFAULT 'live'
);
CREATE INDEX IF NOT EXISTS document_events_tenant_at ON public.document_events (tenant_id, at DESC, id);
CREATE INDEX IF NOT EXISTS document_events_branch_at ON public.document_events (branch_id, at DESC, id);
CREATE INDEX IF NOT EXISTS document_events_doc ON public.document_events (doc_id, at);
ALTER TABLE public.document_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_events FROM anon, authenticated;
GRANT SELECT ON public.document_events TO authenticated;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.document_events'::regclass AND polname = 'document_events_read') THEN
    CREATE POLICY document_events_read ON public.document_events FOR SELECT TO authenticated USING (
      (SELECT is_super_admin((SELECT auth.uid())))
      OR (tenant_id = (SELECT current_tenant_id())
          AND ((SELECT is_admin((SELECT auth.uid())))
               OR (SELECT is_viewer((SELECT auth.uid())))
               OR branch_id = ANY ((SELECT my_branch_ids())::uuid[]))));
  END IF;
END $p$;

-- the display fields of a document row (party name resolved now; a later rename does not rewrite history)
CREATE OR REPLACE FUNCTION public._doc_event_snapshot(p_table text, r jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_party uuid; v_name text; v_ref text; s jsonb;
BEGIN
  IF p_table = 'invoices' THEN
    v_party := (r->>'contact_id')::uuid;
    s := jsonb_build_object('number', r->>'invoice_number', 'date', r->>'invoice_date', 'amount', (r->>'total')::numeric,
           'recipient', r->>'recipient_name', 'notes', r->>'notes');
  ELSIF p_table = 'shipments' THEN
    v_party := (r->>'contact_id')::uuid;
    s := jsonb_build_object('number', r->>'shipment_number', 'date', r->>'invoice_date', 'amount', (r->>'total_cost')::numeric,
           'recipient', r->>'received_by', 'notes', r->>'notes');
  ELSIF p_table = 'returns' THEN
    SELECT i.contact_id, i.invoice_number INTO v_party, v_ref FROM invoices i WHERE i.id = (r->>'invoice_id')::uuid;
    s := jsonb_build_object('number', r->>'return_number', 'date', r->>'invoice_date', 'amount', (r->>'total_refund')::numeric,
           'recipient', r->>'recipient_name', 'notes', r->>'notes', 'reason', r->>'reason', 'ref_number', v_ref,
           'refund_cash', (r->>'refund_cash_amount')::numeric, 'refund_transfer', (r->>'refund_transfer_amount')::numeric,
           'refund_balance', (r->>'refund_balance_amount')::numeric, 'method', r->>'refund_method');
  ELSIF p_table = 'purchase_returns' THEN
    v_party := (r->>'contact_id')::uuid;
    SELECT s2.shipment_number INTO v_ref FROM shipments s2 WHERE s2.id = (r->>'shipment_id')::uuid;
    s := jsonb_build_object('number', r->>'return_number', 'date', r->>'invoice_date', 'amount', (r->>'total_amount')::numeric,
           'recipient', r->>'recipient_name', 'notes', r->>'notes', 'reason', r->>'reason', 'ref_number', v_ref,
           'refund_cash', (r->>'refund_cash_amount')::numeric, 'refund_transfer', (r->>'refund_transfer_amount')::numeric,
           'refund_balance', (r->>'refund_balance_amount')::numeric, 'method', r->>'refund_method');
  ELSE -- vouchers
    v_party := NULLIF(r->>'party_id', '')::uuid;
    v_name := r->>'party_name';
    SELECT c.name INTO v_ref FROM voucher_categories c WHERE c.id = NULLIF(r->>'category_id', '')::uuid;
    s := jsonb_build_object('number', r->>'voucher_number', 'date', r->>'voucher_date', 'amount', (r->>'amount')::numeric,
           'recipient', r->>'recipient_name', 'notes', r->>'description', 'method', r->>'payment_method', 'category', v_ref);
  END IF;
  IF v_party IS NOT NULL THEN SELECT c.name INTO v_name FROM contacts c WHERE c.id = v_party; END IF;
  RETURN s || jsonb_build_object('status', COALESCE(r->>'status', 'active'), 'party_id', v_party, 'party_name', v_name);
END $f$;

-- an UPDATE → the kinds of change it made: [{action, changes}]
CREATE OR REPLACE FUNCTION public._doc_event_classify(p_table text, o jsonb, n jsonb)
RETURNS TABLE(action text, changes jsonb) LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $f$
DECLARE
  f_date text := CASE p_table WHEN 'vouchers' THEN 'voucher_date' ELSE 'invoice_date' END;
  f_amt text[] := CASE p_table WHEN 'invoices' THEN ARRAY['total','subtotal','discount_amount','vat_amount']
                               WHEN 'shipments' THEN ARRAY['total_cost','discount_amount','vat_amount','total_extra_costs']
                               WHEN 'returns' THEN ARRAY['total_refund','refund_cash_amount','refund_transfer_amount','refund_balance_amount']
                               WHEN 'purchase_returns' THEN ARRAY['total_amount','refund_cash_amount','refund_transfer_amount','refund_balance_amount']
                               ELSE ARRAY['amount','fee_amount'] END;
  f_party text[] := CASE p_table WHEN 'vouchers' THEN ARRAY['party_id','party_name'] WHEN 'returns' THEN ARRAY['invoice_id'] ELSE ARRAY['contact_id'] END;
  f_note text[] := CASE p_table WHEN 'vouchers' THEN ARRAY['recipient_name','description'] WHEN 'shipments' THEN ARRAY['received_by','notes']
                                WHEN 'invoices' THEN ARRAY['recipient_name','notes'] ELSE ARRAY['recipient_name','notes','reason'] END;
  f text; c jsonb;
BEGIN
  IF COALESCE(o->>'status','active') <> 'cancelled' AND n->>'status' = 'cancelled' THEN
    RETURN QUERY SELECT 'cancel'::text, jsonb_build_object('status', jsonb_build_object('old', o->>'status', 'new', n->>'status'),
                                                        'reason', jsonb_build_object('old', null, 'new', n->>'cancel_reason'));
  END IF;
  IF (o->>f_date) IS DISTINCT FROM (n->>f_date) THEN
    RETURN QUERY SELECT 'date'::text, jsonb_build_object(f_date, jsonb_build_object('old', o->>f_date, 'new', n->>f_date));
  END IF;
  c := '{}'::jsonb;
  FOREACH f IN ARRAY f_amt LOOP
    IF (o->>f)::numeric IS DISTINCT FROM (n->>f)::numeric THEN c := c || jsonb_build_object(f, jsonb_build_object('old', o->>f, 'new', n->>f)); END IF;
  END LOOP;
  IF c <> '{}'::jsonb THEN RETURN QUERY SELECT 'amount'::text, c; END IF;
  c := '{}'::jsonb;
  FOREACH f IN ARRAY f_party LOOP
    IF (o->>f) IS DISTINCT FROM (n->>f) THEN c := c || jsonb_build_object(f, jsonb_build_object('old', o->>f, 'new', n->>f)); END IF;
  END LOOP;
  IF c <> '{}'::jsonb THEN RETURN QUERY SELECT 'party'::text, c; END IF;
  c := '{}'::jsonb;
  FOREACH f IN ARRAY f_note LOOP
    IF NULLIF(o->>f,'') IS DISTINCT FROM NULLIF(n->>f,'') THEN c := c || jsonb_build_object(f, jsonb_build_object('old', o->>f, 'new', n->>f)); END IF;
  END LOOP;
  IF c <> '{}'::jsonb THEN RETURN QUERY SELECT 'annotations'::text, c; END IF;
  IF p_table = 'vouchers' AND (o->>'payment_method') IS DISTINCT FROM (n->>'payment_method') THEN
    RETURN QUERY SELECT 'method'::text, jsonb_build_object('payment_method', jsonb_build_object('old', o->>'payment_method', 'new', n->>'payment_method'));
  END IF;
END $f$;

CREATE OR REPLACE FUNCTION public._doc_event_type(p_table text, r jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE p_table WHEN 'invoices' THEN 'sale' WHEN 'shipments' THEN 'purchase' WHEN 'returns' THEN 'sale_return'
                      WHEN 'purchase_returns' THEN 'purchase_return'
                      ELSE CASE WHEN r->>'type' = 'receipt' THEN 'receipt' ELSE 'payment' END END
$f$;

CREATE OR REPLACE FUNCTION public._doc_event_user()
RETURNS TABLE(uid uuid, uname text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT auth.uid(), COALESCE((SELECT p.name FROM profiles p WHERE p.id = auth.uid()), CASE WHEN auth.uid() IS NULL THEN 'النظام' END)
$f$;

CREATE OR REPLACE FUNCTION public.doc_events_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE n jsonb := to_jsonb(NEW); o jsonb; u record; x record; s jsonb; v_create uuid;
BEGIN
  BEGIN
    SELECT * INTO u FROM public._doc_event_user();
    s := public._doc_event_snapshot(TG_TABLE_NAME, n);
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.document_events(tenant_id, branch_id, doc_type, doc_id, action, snapshot, user_id, user_name)
      VALUES (NEW.tenant_id, NEW.branch_id, public._doc_event_type(TG_TABLE_NAME, n), NEW.id, 'create', s, u.uid, u.uname);
    ELSE
      o := to_jsonb(OLD);
      -- the save itself (total / date / notes set right after the insert, same user, within 10 s) is part of «إنشاء»:
      -- the create row takes the document as it ended up; a cancel is always its own row
      SELECT e.id INTO v_create FROM public.document_events e
       WHERE e.doc_id = NEW.id AND e.action = 'create' AND e.at > now() - interval '10 seconds'
         AND e.user_id IS NOT DISTINCT FROM u.uid
       ORDER BY e.at DESC LIMIT 1;
      FOR x IN SELECT * FROM public._doc_event_classify(TG_TABLE_NAME, o, n) LOOP
        IF v_create IS NOT NULL AND x.action <> 'cancel' THEN
          UPDATE public.document_events SET snapshot = s WHERE id = v_create;
        ELSE
          INSERT INTO public.document_events(tenant_id, branch_id, doc_type, doc_id, action, changes, snapshot, user_id, user_name)
          VALUES (NEW.tenant_id, NEW.branch_id, public._doc_event_type(TG_TABLE_NAME, n), NEW.id, x.action, x.changes, s, u.uid, u.uname);
        END IF;
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'document_events: %', SQLERRM;
  END;
  RETURN NULL;
END $f$;

-- money on a document: a sale's invoice_payments; a purchase's plan payment_transactions (a sale plan is mirrored
-- into invoice_payments, so it is logged there once)
CREATE OR REPLACE FUNCTION public.doc_payment_events_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE u record; v_doc uuid; v_type text; v_tbl text; r jsonb; v_act text; v_ch jsonb; v_amt numeric; v_method text;
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'invoice_payments' THEN
      IF NEW.reverses_payment_id IS NOT NULL THEN RETURN NULL; END IF;
      v_doc := NEW.invoice_id; v_type := 'sale'; v_tbl := 'invoices';
      SELECT to_jsonb(i) INTO r FROM invoices i WHERE i.id = v_doc;
    ELSE
      IF NEW.reverses_tx_id IS NOT NULL OR NEW.payment_plan_id IS NULL THEN RETURN NULL; END IF;
      SELECT pp.reference_id INTO v_doc FROM payment_plans pp WHERE pp.id = NEW.payment_plan_id AND pp.reference_type = 'shipment';
      IF v_doc IS NULL THEN RETURN NULL; END IF;
      v_type := 'purchase'; v_tbl := 'shipments';
      SELECT to_jsonb(s) INTO r FROM shipments s WHERE s.id = v_doc;
    END IF;
    IF r IS NULL THEN RETURN NULL; END IF;
    v_amt := NEW.amount; v_method := NEW.payment_method;
    IF TG_OP = 'INSERT' THEN
      v_act := 'payment_add';
      v_ch := jsonb_build_object('payment', jsonb_build_object('old', null, 'new', jsonb_build_object('amount', v_amt, 'method', v_method, 'at', NEW.created_at)));
    ELSIF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL THEN
      v_act := 'payment_void';
      v_ch := jsonb_build_object('payment', jsonb_build_object('old', jsonb_build_object('amount', v_amt, 'method', v_method, 'at', OLD.created_at), 'new', null),
                                 'reason', jsonb_build_object('old', null, 'new', NEW.void_reason));
    ELSIF OLD.created_at IS DISTINCT FROM NEW.created_at AND NEW.voided_at IS NULL THEN
      v_act := 'payment_move';
      v_ch := jsonb_build_object('payment_date', jsonb_build_object('old', OLD.created_at, 'new', NEW.created_at), 'amount', jsonb_build_object('old', v_amt, 'new', v_amt));
    ELSE
      RETURN NULL;
    END IF;
    SELECT * INTO u FROM public._doc_event_user();
    INSERT INTO public.document_events(tenant_id, branch_id, doc_type, doc_id, action, changes, snapshot, user_id, user_name)
    VALUES ((r->>'tenant_id')::uuid, (r->>'branch_id')::uuid, v_type, v_doc, v_act, v_ch, public._doc_event_snapshot(v_tbl, r), u.uid, u.uname);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'document_events (payment): %', SQLERRM;
  END;
  RETURN NULL;
END $f$;

REVOKE ALL ON FUNCTION public._doc_event_snapshot(text, jsonb), public._doc_event_classify(text, jsonb, jsonb), public._doc_event_type(text, jsonb),
  public._doc_event_user(), public.doc_events_trg(), public.doc_payment_events_trg() FROM PUBLIC, anon, authenticated;

DO $t$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices','shipments','returns','purchase_returns','vouchers'] LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER zz_doc_events AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.doc_events_trg()', t);
  END LOOP;
  CREATE OR REPLACE TRIGGER zz_doc_payment_events AFTER INSERT OR UPDATE OF voided_at, created_at ON public.invoice_payments
    FOR EACH ROW EXECUTE FUNCTION public.doc_payment_events_trg();
  CREATE OR REPLACE TRIGGER zz_doc_payment_events AFTER INSERT OR UPDATE OF voided_at, created_at ON public.payment_transactions
    FOR EACH ROW EXECUTE FUNCTION public.doc_payment_events_trg();
END $t$;

-- the screen: one page of events with the filters; the party / number search runs on the snapshot
CREATE OR REPLACE FUNCTION public.document_log_page(
  p_branch uuid DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
  p_doc_types text[] DEFAULT NULL, p_actions text[] DEFAULT NULL, p_user uuid DEFAULT NULL,
  p_q text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $f$
  WITH f AS (
    SELECT e.* FROM document_events e
     WHERE (p_branch IS NULL OR e.branch_id = p_branch)
       AND (p_from IS NULL OR e.at >= (p_from::timestamp AT TIME ZONE 'Africa/Cairo'))
       AND (p_to IS NULL OR e.at < ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo'))
       AND (p_doc_types IS NULL OR e.doc_type = ANY (p_doc_types))
       AND (p_actions IS NULL OR e.action = ANY (p_actions))
       AND (p_user IS NULL OR e.user_id = p_user)
       AND (NULLIF(btrim(p_q), '') IS NULL
            OR e.snapshot->>'number' ILIKE '%' || btrim(p_q) || '%'
            OR e.snapshot->>'party_name' ILIKE '%' || btrim(p_q) || '%'
            OR e.snapshot->>'ref_number' ILIKE '%' || btrim(p_q) || '%'
            OR e.user_name ILIKE '%' || btrim(p_q) || '%'
            OR EXISTS (SELECT 1 FROM contacts c WHERE c.id = NULLIF(e.snapshot->>'party_id','')::uuid AND c.phone ILIKE '%' || btrim(p_q) || '%'))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM f),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.at DESC, p.id)
                        FROM (SELECT f.*, b.name AS branch_name FROM f LEFT JOIN branches b ON b.id = f.branch_id
                               ORDER BY f.at DESC, f.id LIMIT p_limit OFFSET p_offset) p), '[]'::jsonb),
    'users', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('id', e.user_id, 'name', e.user_name))
                         FROM document_events e WHERE e.user_id IS NOT NULL AND (p_branch IS NULL OR e.branch_id = p_branch)), '[]'::jsonb))
$f$;
GRANT EXECUTE ON FUNCTION public.document_log_page(uuid, date, date, text[], text[], uuid, text, int, int) TO authenticated;

CREATE INDEX IF NOT EXISTS audit_log_entity_id_idx ON public.audit_log (entity, entity_id, created_at);

-- history (once): creates and cancels from the documents themselves, edits from audit_log's old / new rows,
-- money from invoice_payments / purchase-plan payment_transactions. Marked source = 'history'.
DO $h$
BEGIN
  IF EXISTS (SELECT 1 FROM public.document_events WHERE source = 'history') THEN RETURN; END IF;

  -- creates: the snapshot is the document as first saved (the «old» of its first logged edit) or as it is now
  INSERT INTO public.document_events(tenant_id, branch_id, doc_type, doc_id, action, snapshot, user_id, user_name, at, source)
  SELECT d.tenant_id, d.branch_id, public._doc_event_type(d.tbl, d.r), d.id, 'create',
         public._doc_event_snapshot(d.tbl, COALESCE(fe.old_row, d.r)), d.uid,
         COALESCE(d.uname, (SELECT p.name FROM profiles p WHERE p.id = d.uid)), d.created_at, 'history'
  FROM (
    SELECT 'invoices' tbl, i.id, i.tenant_id, i.branch_id, i.created_at, to_jsonb(i) r, i.cashier_id uid, NULL::text uname FROM invoices i
    UNION ALL
    SELECT 'shipments', s.id, s.tenant_id, s.branch_id, s.created_at, to_jsonb(s),
           (SELECT a.user_id FROM audit_log a WHERE a.entity = 'shipment' AND a.action = 'CREATE' AND a.entity_id = s.id::text LIMIT 1),
           (SELECT a.user_name FROM audit_log a WHERE a.entity = 'shipment' AND a.action = 'CREATE' AND a.entity_id = s.id::text LIMIT 1) FROM shipments s
    UNION ALL
    SELECT 'returns', x.id, x.tenant_id, x.branch_id, x.created_at, to_jsonb(x), x.created_by, NULL FROM returns x
    UNION ALL
    SELECT 'purchase_returns', x.id, x.tenant_id, x.branch_id, x.created_at, to_jsonb(x), x.created_by, NULL FROM purchase_returns x
    UNION ALL
    SELECT 'vouchers', v.id, v.tenant_id, v.branch_id, v.created_at, to_jsonb(v), v.created_by, v.created_by_name FROM vouchers v
  ) d
  LEFT JOIN LATERAL (
    SELECT a.details->'old' AS old_row FROM audit_log a
     WHERE a.entity = d.tbl AND a.action = 'UPDATE' AND a.entity_id = d.id::text AND a.details ? 'old'
     ORDER BY a.created_at, a.id LIMIT 1) fe ON true
  WHERE d.tenant_id IS NOT NULL;

  -- edits logged with their old / new rows (cancels come from the documents below)
  INSERT INTO public.document_events(tenant_id, branch_id, doc_type, doc_id, action, changes, snapshot, user_id, user_name, at, source)
  SELECT a.tenant_id, COALESCE(NULLIF(a.details->'new'->>'branch_id','')::uuid, a.branch_id),
         public._doc_event_type(a.entity, a.details->'new'), a.entity_id::uuid, c.action, c.changes,
         public._doc_event_snapshot(a.entity, a.details->'new'), a.user_id, a.user_name, a.created_at, 'history'
    FROM audit_log a
    CROSS JOIN LATERAL public._doc_event_classify(a.entity, a.details->'old', a.details->'new') c
   WHERE a.entity IN ('invoices','shipments','returns') AND a.action = 'UPDATE'
     AND a.details ? 'old' AND a.details ? 'new' AND c.action <> 'cancel' AND a.tenant_id IS NOT NULL
     AND a.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND EXISTS (SELECT 1 FROM invoices WHERE id = a.entity_id::uuid UNION ALL SELECT 1 FROM shipments WHERE id = a.entity_id::uuid
                 UNION ALL SELECT 1 FROM returns WHERE id = a.entity_id::uuid);

  -- cancels
  INSERT INTO public.document_events(tenant_id, branch_id, doc_type, doc_id, action, changes, snapshot, user_id, user_name, at, source)
  SELECT d.tenant_id, d.branch_id, public._doc_event_type(d.tbl, d.r), d.id, 'cancel',
         jsonb_build_object('status', jsonb_build_object('old', 'active', 'new', 'cancelled'), 'reason', jsonb_build_object('old', null, 'new', d.r->>'cancel_reason')),
         public._doc_event_snapshot(d.tbl, d.r), d.uid, (SELECT p.name FROM profiles p WHERE p.id = d.uid), d.at, 'history'
  FROM (
    SELECT 'invoices' tbl, i.id, i.tenant_id, i.branch_id, to_jsonb(i) r, i.cancelled_by uid, i.cancelled_at at FROM invoices i WHERE i.status = 'cancelled'
    UNION ALL SELECT 'shipments', s.id, s.tenant_id, s.branch_id, to_jsonb(s), s.cancelled_by, s.cancelled_at FROM shipments s WHERE s.status = 'cancelled'
    UNION ALL SELECT 'returns', x.id, x.tenant_id, x.branch_id, to_jsonb(x), x.cancelled_by, x.cancelled_at FROM returns x WHERE x.status = 'cancelled'
    UNION ALL SELECT 'purchase_returns', x.id, x.tenant_id, x.branch_id, to_jsonb(x), x.cancelled_by, x.cancelled_at FROM purchase_returns x WHERE x.status = 'cancelled'
    UNION ALL SELECT 'vouchers', v.id, v.tenant_id, v.branch_id, to_jsonb(v), v.cancelled_by, v.cancelled_at FROM vouchers v WHERE v.status = 'cancelled'
  ) d WHERE d.at IS NOT NULL AND d.tenant_id IS NOT NULL;

  -- money on sale invoices
  INSERT INTO public.document_events(tenant_id, branch_id, doc_type, doc_id, action, changes, snapshot, user_id, user_name, at, source)
  SELECT i.tenant_id, i.branch_id, 'sale', i.id, 'payment_add',
         jsonb_build_object('payment', jsonb_build_object('old', null, 'new', jsonb_build_object('amount', ip.amount, 'method', ip.payment_method, 'at', ip.created_at))),
         public._doc_event_snapshot('invoices', to_jsonb(i)), NULL, ip.received_by_name, ip.created_at, 'history'
    FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
   WHERE ip.reverses_payment_id IS NULL;
  INSERT INTO public.document_events(tenant_id, branch_id, doc_type, doc_id, action, changes, snapshot, user_id, user_name, at, source)
  SELECT i.tenant_id, i.branch_id, 'sale', i.id, 'payment_void',
         jsonb_build_object('payment', jsonb_build_object('old', jsonb_build_object('amount', ip.amount, 'method', ip.payment_method, 'at', ip.created_at), 'new', null),
                            'reason', jsonb_build_object('old', null, 'new', ip.void_reason)),
         public._doc_event_snapshot('invoices', to_jsonb(i)), ip.voided_by, (SELECT p.name FROM profiles p WHERE p.id = ip.voided_by), ip.voided_at, 'history'
    FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
   WHERE ip.reverses_payment_id IS NULL AND ip.voided_at IS NOT NULL;

  -- money on purchase invoices (their plan)
  INSERT INTO public.document_events(tenant_id, branch_id, doc_type, doc_id, action, changes, snapshot, user_id, user_name, at, source)
  SELECT s.tenant_id, s.branch_id, 'purchase', s.id, 'payment_add',
         jsonb_build_object('payment', jsonb_build_object('old', null, 'new', jsonb_build_object('amount', pt.amount, 'method', pt.payment_method, 'at', pt.created_at))),
         public._doc_event_snapshot('shipments', to_jsonb(s)), pt.created_by, (SELECT p.name FROM profiles p WHERE p.id = pt.created_by), pt.created_at, 'history'
    FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id AND pp.reference_type = 'shipment'
    JOIN shipments s ON s.id = pp.reference_id
   WHERE pt.reverses_tx_id IS NULL;
  INSERT INTO public.document_events(tenant_id, branch_id, doc_type, doc_id, action, changes, snapshot, user_id, user_name, at, source)
  SELECT s.tenant_id, s.branch_id, 'purchase', s.id, 'payment_void',
         jsonb_build_object('payment', jsonb_build_object('old', jsonb_build_object('amount', pt.amount, 'method', pt.payment_method, 'at', pt.created_at), 'new', null),
                            'reason', jsonb_build_object('old', null, 'new', pt.void_reason)),
         public._doc_event_snapshot('shipments', to_jsonb(s)), pt.voided_by, (SELECT p.name FROM profiles p WHERE p.id = pt.voided_by), pt.voided_at, 'history'
    FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id AND pp.reference_type = 'shipment'
    JOIN shipments s ON s.id = pp.reference_id
   WHERE pt.reverses_tx_id IS NULL AND pt.voided_at IS NOT NULL;
END $h$;

-- history: edits within 10 s of the create are the save itself — folded into the create row
WITH q AS (
  SELECT e.id, c.id AS create_id, e.snapshot, e.at,
         row_number() OVER (PARTITION BY c.id ORDER BY e.at DESC, e.id) rn
    FROM document_events e JOIN document_events c ON c.doc_id = e.doc_id AND c.action = 'create'
   WHERE e.source = 'history' AND e.action IN ('date','amount','annotations','party','method')
     AND e.at - c.at < interval '10 seconds' AND e.at >= c.at)
UPDATE document_events c SET snapshot = q.snapshot FROM q WHERE q.create_id = c.id AND q.rn = 1;
WITH q AS (
  SELECT e.id FROM document_events e JOIN document_events c ON c.doc_id = e.doc_id AND c.action = 'create'
   WHERE e.source = 'history' AND e.action IN ('date','amount','annotations','party','method')
     AND e.at - c.at < interval '10 seconds' AND e.at >= c.at)
DELETE FROM document_events e USING q WHERE e.id = q.id;
