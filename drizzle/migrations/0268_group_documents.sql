-- 0268 (owner 2026-11-18 «كله يتبعت … تضيف السند مع الفاتورة وترسلو في pdf مرة واحده … اسم الPDF فيه رقم المستند واسم
-- الفرع واسم الموظف … لما مستند يتلغي يتبعت اتلغى»): every new sale / purchase / sale return / purchase return / receipt /
-- payment voucher goes to the company's Telegram GROUP as ONE PDF; the vouchers saved WITH a document (its own payment
-- or refund) are inside that document's PDF, not sent again; a cancelled one → a short «اتلغى» message.
-- A queue filled by triggers (never blocks a save), sent by the `telegram` edge function (mode 'docs') from the
-- «telegram-send» cron. Off by default per company (`tenant_ops_settings.tg_docs_enabled`), on for A&N.

ALTER TABLE public.tenant_ops_settings ADD COLUMN IF NOT EXISTS tg_docs_enabled boolean NOT NULL DEFAULT false;
UPDATE public.tenant_ops_settings SET tg_docs_enabled = true WHERE tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';

CREATE TABLE IF NOT EXISTS public.tg_doc_queue (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sale', 'purchase', 'sale_return', 'purchase_return', 'voucher')),
  doc_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('create', 'cancel')),
  created_at timestamptz NOT NULL DEFAULT now(),
  next_try_at timestamptz NOT NULL DEFAULT now() + interval '60 seconds',   -- wait for the rest of the save
  state text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'sent', 'skipped', 'failed')),
  tries int NOT NULL DEFAULT 0,
  error text,
  sent_at timestamptz,
  UNIQUE (kind, doc_id, event)
);
CREATE INDEX IF NOT EXISTS tg_doc_queue_due ON public.tg_doc_queue (next_try_at) WHERE state = 'waiting';
ALTER TABLE public.tg_doc_queue ENABLE ROW LEVEL SECURITY;  -- server only
REVOKE ALL ON public.tg_doc_queue FROM anon, authenticated;

-- ---------------------------------------------------------------- enqueue (triggers)
CREATE OR REPLACE FUNCTION public.tg_doc_enqueue_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_kind text := TG_ARGV[0]; v_event text; j jsonb := to_jsonb(NEW);
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN v_event := 'create';
    ELSIF coalesce(to_jsonb(OLD)->>'status', '') <> 'cancelled' AND j->>'status' = 'cancelled' THEN v_event := 'cancel';
    ELSE RETURN NULL; END IF;
    IF public.sahl_import_mode() OR j->>'migration_batch_id' IS NOT NULL OR coalesce((j->>'is_migrated')::boolean, false) THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM tenant_ops_settings s JOIN tenant_owner_contact c ON c.tenant_id = s.tenant_id
                    WHERE s.tenant_id = (j->>'tenant_id')::uuid AND s.tg_docs_enabled AND c.tg_group_chat_id IS NOT NULL) THEN
      RETURN NULL;
    END IF;
    INSERT INTO tg_doc_queue (tenant_id, kind, doc_id, event, next_try_at)
    VALUES ((j->>'tenant_id')::uuid, v_kind, NEW.id, v_event, now() + CASE WHEN v_event = 'create' THEN interval '60 seconds' ELSE interval '20 seconds' END)
    ON CONFLICT (kind, doc_id, event) DO NOTHING;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'tg_doc_enqueue: %', SQLERRM;   -- never block a business action
  END;
  RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION public.tg_doc_enqueue_trg() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER zz_tg_doc_queue AFTER INSERT OR UPDATE OF status ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.tg_doc_enqueue_trg('sale');
CREATE TRIGGER zz_tg_doc_queue AFTER INSERT OR UPDATE OF status ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.tg_doc_enqueue_trg('purchase');
CREATE TRIGGER zz_tg_doc_queue AFTER INSERT OR UPDATE OF status ON public.returns FOR EACH ROW EXECUTE FUNCTION public.tg_doc_enqueue_trg('sale_return');
CREATE TRIGGER zz_tg_doc_queue AFTER INSERT OR UPDATE OF status ON public.purchase_returns FOR EACH ROW EXECUTE FUNCTION public.tg_doc_enqueue_trg('purchase_return');
CREATE TRIGGER zz_tg_doc_queue AFTER INSERT OR UPDATE OF status ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.tg_doc_enqueue_trg('voucher');

-- ---------------------------------------------------------------- the vouchers saved WITH a document (its own money)
CREATE OR REPLACE FUNCTION public.tg_doc_vouchers(p_doc uuid, p_doc_created timestamptz)
RETURNS SETOF public.vouchers LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT v.* FROM vouchers v JOIN treasury t ON t.id = v.treasury_id
   WHERE (t.reference_id = p_doc
          OR t.id IN (SELECT pt.treasury_id FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id
                       WHERE pp.reference_id = p_doc AND pt.treasury_id IS NOT NULL))
     AND v.created_at BETWEEN p_doc_created - interval '5 seconds' AND p_doc_created + interval '2 minutes'
   ORDER BY v.created_at, v.voucher_number
$f$;
REVOKE ALL ON FUNCTION public.tg_doc_vouchers(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_method_label(p_tenant uuid, p_method text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT coalesce((SELECT nullif(label, '') FROM transfer_fees WHERE tenant_id = p_tenant AND payment_method = p_method LIMIT 1),
    CASE p_method WHEN 'cash' THEN 'كاش' WHEN 'instapay' THEN 'إنستاباي' WHEN 'vodafone_cash' THEN 'فودافون كاش'
                  WHEN 'bank_transfer' THEN 'تحويل بنكي' WHEN 'credit' THEN 'آجل' ELSE coalesce(p_method, '—') END)
$f$;
REVOKE ALL ON FUNCTION public.tg_method_label(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- what goes in the PDF / message
CREATE OR REPLACE FUNCTION public.tg_doc_payload(p_q bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  q tg_doc_queue; d jsonb; v_branch uuid; v_created timestamptz; v_lines jsonb := '[]'; v_pay jsonb := '[]';
  v_party text; v_emp text; v_title text; v_number text; v_date timestamptz; v_total numeric; v_extra jsonb := '{}';
  v_cancel jsonb; v_status text; v_notes text; v_recipient text; vrow record; v_doctype text;
BEGIN
  SELECT * INTO q FROM tg_doc_queue WHERE id = p_q;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF q.kind = 'sale' THEN
    SELECT to_jsonb(i) INTO d FROM invoices i WHERE id = q.doc_id;
    v_title := 'فاتورة بيع'; v_doctype := 'sale'; v_number := d->>'invoice_number'; v_total := (d->>'total')::numeric;
    v_party := coalesce((SELECT name FROM contacts WHERE id = (d->>'contact_id')::uuid), 'عميل نقدي');
    SELECT coalesce(jsonb_agg(jsonb_build_object('name', ii.product_name, 'qty', ii.quantity,
             'price', coalesce(ii.final_price, ii.selling_price), 'total', ii.total) ORDER BY ii.id), '[]')
      INTO v_lines FROM invoice_items ii WHERE ii.invoice_id = q.doc_id;
    v_extra := jsonb_build_object('subtotal', d->'subtotal', 'discount', d->'discount_amount', 'vat', d->'vat_amount');
    v_emp := (SELECT name FROM profiles WHERE id = (d->>'cashier_id')::uuid);
  ELSIF q.kind = 'purchase' THEN
    SELECT to_jsonb(s) INTO d FROM shipments s WHERE id = q.doc_id;
    v_title := 'فاتورة شراء'; v_doctype := 'purchase'; v_number := d->>'shipment_number'; v_total := (d->>'total_cost')::numeric;
    v_party := coalesce((SELECT name FROM contacts WHERE id = (d->>'contact_id')::uuid), '—');
    SELECT coalesce(jsonb_agg(jsonb_build_object('name', si.product_name, 'qty', si.quantity, 'price', si.cost_price, 'total', si.total) ORDER BY si.id), '[]')
      INTO v_lines FROM shipment_items si WHERE si.shipment_id = q.doc_id;
    v_extra := jsonb_build_object('discount', d->'discount_amount', 'vat', d->'vat_amount', 'extra_costs', d->'total_extra_costs');
  ELSIF q.kind = 'sale_return' THEN
    SELECT to_jsonb(r) INTO d FROM returns r WHERE id = q.doc_id;
    v_title := 'مرتجع بيع'; v_doctype := 'sale_return'; v_number := d->>'return_number'; v_total := (d->>'total_refund')::numeric;
    v_party := coalesce((SELECT c.name FROM invoices i JOIN contacts c ON c.id = i.contact_id WHERE i.id = (d->>'invoice_id')::uuid), 'عميل نقدي');
    SELECT coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'qty', ri.quantity,
             'price', CASE WHEN ri.quantity > 0 THEN round(ri.refund / ri.quantity, 2) END, 'total', ri.refund) ORDER BY ri.id), '[]')
      INTO v_lines FROM return_items ri LEFT JOIN products p ON p.id = ri.product_id WHERE ri.return_id = q.doc_id;
    v_extra := jsonb_build_object('on_invoice', (SELECT invoice_number FROM invoices WHERE id = (d->>'invoice_id')::uuid));
  ELSIF q.kind = 'purchase_return' THEN
    SELECT to_jsonb(r) INTO d FROM purchase_returns r WHERE id = q.doc_id;
    v_title := 'مرتجع شراء'; v_doctype := 'purchase_return'; v_number := d->>'return_number'; v_total := (d->>'total_amount')::numeric;
    v_party := coalesce((SELECT name FROM contacts WHERE id = (d->>'contact_id')::uuid), '—');
    SELECT coalesce(jsonb_agg(jsonb_build_object('name', pri.product_name, 'qty', pri.quantity, 'price', pri.unit_cost, 'total', pri.total) ORDER BY pri.id), '[]')
      INTO v_lines FROM purchase_return_items pri WHERE pri.purchase_return_id = q.doc_id;
    v_extra := jsonb_build_object('on_invoice', (SELECT shipment_number FROM shipments WHERE id = (d->>'shipment_id')::uuid));
  ELSE
    SELECT to_jsonb(v) INTO d FROM vouchers v WHERE id = q.doc_id;
    v_doctype := CASE WHEN d->>'type' = 'receipt' THEN 'receipt' ELSE 'payment' END;
    v_title := CASE WHEN d->>'type' = 'receipt' THEN 'سند قبض' ELSE 'سند صرف' END;
    v_number := d->>'voucher_number'; v_total := (d->>'amount')::numeric;
    v_party := coalesce(nullif(d->>'party_name', ''), (SELECT name FROM contacts WHERE id = (d->>'party_id')::uuid), '—');
    v_emp := nullif(d->>'created_by_name', '');
    v_extra := jsonb_build_object('method', public.tg_method_label(q.tenant_id, d->>'payment_method'), 'fee', d->'fee_amount',
      'category', (SELECT name FROM voucher_categories WHERE id = (d->>'category_id')::uuid), 'description', d->>'description');
  END IF;
  IF d IS NULL THEN RETURN jsonb_build_object('skip', true, 'why', 'المستند مش موجود'); END IF;

  v_branch := (d->>'branch_id')::uuid;
  v_created := (d->>'created_at')::timestamptz;
  v_date := coalesce((d->>'invoice_date')::timestamptz, (d->>'voucher_date')::date::timestamptz, v_created);
  v_status := d->>'status'; v_notes := nullif(d->>'notes', ''); v_recipient := nullif(d->>'recipient_name', '');

  -- a voucher saved WITH a document is in that document's PDF
  IF q.kind = 'voucher' AND q.event = 'create' THEN
    IF EXISTS (SELECT 1 FROM treasury t WHERE t.id = (d->>'treasury_id')::uuid AND (
          EXISTS (SELECT 1 FROM invoices x WHERE x.id = t.reference_id AND abs(extract(epoch FROM x.created_at - v_created)) < 120)
       OR EXISTS (SELECT 1 FROM shipments x WHERE x.id = t.reference_id AND abs(extract(epoch FROM x.created_at - v_created)) < 120)
       OR EXISTS (SELECT 1 FROM returns x WHERE x.id = t.reference_id AND abs(extract(epoch FROM x.created_at - v_created)) < 120)
       OR EXISTS (SELECT 1 FROM purchase_returns x WHERE x.id = t.reference_id AND abs(extract(epoch FROM x.created_at - v_created)) < 120)
       OR EXISTS (SELECT 1 FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id
                    JOIN shipments x ON x.id = pp.reference_id
                   WHERE pt.treasury_id = t.id AND abs(extract(epoch FROM x.created_at - v_created)) < 120))) THEN
      RETURN jsonb_build_object('skip', true, 'why', 'السند ده اتبعت جوه مستنده');
    END IF;
  END IF;

  IF q.kind <> 'voucher' THEN
    FOR vrow IN SELECT * FROM public.tg_doc_vouchers(q.doc_id, v_created) LOOP
      v_pay := v_pay || jsonb_build_object('number', vrow.voucher_number, 'type', vrow.type::text,
        'method', public.tg_method_label(q.tenant_id, vrow.payment_method), 'amount', vrow.amount, 'status', vrow.status::text);
    END LOOP;
  END IF;

  -- the one who made it: the document log, else the document's own column
  v_emp := coalesce((SELECT e.user_name FROM document_events e WHERE e.doc_id = q.doc_id AND e.action = 'create' ORDER BY e.at LIMIT 1),
                    v_emp, (SELECT name FROM profiles WHERE id = (d->>'created_by')::uuid), '—');

  IF q.event = 'cancel' THEN
    v_cancel := jsonb_build_object('reason', coalesce(d->>'cancel_reason', ''),
      'by', coalesce((SELECT name FROM profiles WHERE id = (d->>'cancelled_by')::uuid),
                     (SELECT e.user_name FROM document_events e WHERE e.doc_id = q.doc_id AND e.action = 'cancel' ORDER BY e.at DESC LIMIT 1), '—'),
      'at', coalesce(d->>'cancelled_at', now()::text));
  ELSIF v_status = 'cancelled' THEN
    RETURN jsonb_build_object('skip', true, 'why', 'اتلغى قبل ما يتبعت');
  END IF;

  RETURN jsonb_build_object(
    'id', q.id, 'kind', q.kind, 'doc_type', v_doctype, 'event', q.event, 'title', v_title, 'number', v_number,
    'company', (SELECT name FROM tenants WHERE id = q.tenant_id), 'branch', (SELECT name FROM branches WHERE id = v_branch),
    'date', v_date, 'created_at', v_created, 'party', v_party, 'employee', v_emp, 'recipient', v_recipient, 'notes', v_notes,
    'total', v_total, 'extra', v_extra, 'lines', v_lines, 'payments', v_pay, 'cancel', v_cancel,
    'chat', (SELECT tg_group_chat_id FROM tenant_owner_contact WHERE tenant_id = q.tenant_id),
    'link', '/branch/' || v_branch::text || CASE q.kind WHEN 'sale' THEN '/sales/' WHEN 'purchase' THEN '/shipments/'
                                                WHEN 'voucher' THEN '/vouchers/' WHEN 'sale_return' THEN '/sale-returns/'
                                                ELSE '/purchase-returns/' END || q.doc_id::text);
END $f$;
REVOKE ALL ON FUNCTION public.tg_doc_payload(bigint) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- for the edge function (service role)
CREATE OR REPLACE FUNCTION public.tg_docs_pending(p_limit int DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE out jsonb := '[]'; r record;
BEGIN
  FOR r IN SELECT id FROM tg_doc_queue WHERE state = 'waiting' AND next_try_at <= now()
            ORDER BY created_at, id LIMIT greatest(1, least(p_limit, 30)) FOR UPDATE SKIP LOCKED LOOP
    UPDATE tg_doc_queue SET next_try_at = now() + interval '10 minutes' WHERE id = r.id;   -- a lease while it is sent
    out := out || jsonb_build_array(coalesce(public.tg_doc_payload(r.id), jsonb_build_object('skip', true)) || jsonb_build_object('id', r.id));
  END LOOP;
  RETURN out;
END $f$;
REVOKE ALL ON FUNCTION public.tg_docs_pending(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_docs_pending(int) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_doc_mark(p_id bigint, p_state text, p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE q tg_doc_queue;
BEGIN
  SELECT * INTO q FROM tg_doc_queue WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_state IN ('sent', 'skipped') THEN
    UPDATE tg_doc_queue SET state = p_state, sent_at = now(), error = left(p_error, 300) WHERE id = p_id;
    IF p_state = 'sent' THEN UPDATE tenant_owner_contact SET tg_last_sent_at = now() WHERE tenant_id = q.tenant_id; END IF;
  ELSE
    UPDATE tg_doc_queue SET tries = tries + 1, error = left(p_error, 300),
           state = CASE WHEN tries + 1 >= 5 THEN 'failed' ELSE 'waiting' END,
           next_try_at = now() + (interval '5 minutes' * (tries + 1)) WHERE id = p_id;
    UPDATE tenant_owner_contact SET tg_last_error = left('الجروب: ' || coalesce(p_error, ''), 300), tg_last_error_at = now() WHERE tenant_id = q.tenant_id;
  END IF;
END $f$;
REVOKE ALL ON FUNCTION public.tg_doc_mark(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_doc_mark(bigint, text, text) TO service_role;

-- the 5-minute tick also sends the documents
CREATE OR REPLACE FUNCTION public.tg_send_tick()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE n int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM eta_documents WHERE tg_state = 'pending') THEN
    PERFORM public.nizam_cron_call('telegram', jsonb_build_object('mode', 'send')); n := n + 1;
  END IF;
  IF EXISTS (SELECT 1 FROM tg_doc_queue WHERE state = 'waiting' AND next_try_at <= now()) THEN
    PERFORM public.nizam_cron_call('telegram', jsonb_build_object('mode', 'docs')); n := n + 1;
  END IF;
  RETURN n;
END $function$;

-- ---------------------------------------------------------------- the owner's switch on the settings page
CREATE OR REPLACE FUNCTION public.tg_docs_set(p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_t uuid;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'للمالك بس' USING ERRCODE = '42501'; END IF;
  INSERT INTO tenant_ops_settings (tenant_id, tg_docs_enabled, updated_by) VALUES (v_t, p_enabled, auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET tg_docs_enabled = p_enabled, updated_at = now(), updated_by = auth.uid();
  RETURN p_enabled;
END $f$;
REVOKE ALL ON FUNCTION public.tg_docs_set(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_docs_set(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_link_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_t uuid; c record;
BEGIN
  v_t := public.assert_company_access(NULL);
  SELECT * INTO c FROM tenant_owner_contact WHERE tenant_id = v_t;
  RETURN jsonb_build_object(
    'owner_linked', c.tg_chat_id IS NOT NULL, 'owner_linked_at', c.tg_linked_at,
    'group_linked', c.tg_group_chat_id IS NOT NULL, 'group_title', c.tg_group_title, 'group_linked_at', c.tg_group_linked_at,
    'waiting', CASE WHEN c.tg_link_expires > now() THEN c.tg_link_purpose END,
    'docs_enabled', coalesce((SELECT tg_docs_enabled FROM tenant_ops_settings WHERE tenant_id = v_t), false),
    'docs_sent_today', (SELECT count(*) FROM tg_doc_queue WHERE tenant_id = v_t AND state = 'sent'
                         AND sent_at >= ((now() AT TIME ZONE 'Africa/Cairo')::date::timestamp AT TIME ZONE 'Africa/Cairo')),
    'docs_failed', (SELECT count(*) FROM tg_doc_queue WHERE tenant_id = v_t AND state = 'failed'));
END $f$;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('tg_docs_set', '0268', 'owner: send every document to the Telegram group on / off')
ON CONFLICT (function_name) DO NOTHING;

-- documents should reach the group within about a minute or two: the tick runs every minute (it calls the edge
-- function only when something is due)
SELECT cron.alter_job(jobid, schedule := '* * * * *') FROM cron.job WHERE jobname = 'telegram-send';
