-- 0222 — «الفواتير الإلكترونية الواردة» compared with our purchases (owner 2026-11-15 «اعمل تجربة … وصلح المشاكل … وعاوزك
-- تعمل صفحة للفواتير الالكترونية الواردة»). Read-only towards the books: nothing here creates, changes or cancels a document,
-- a till row or an entry — it only links an ETA document to a purchase invoice that already exists.
--   * the ETA supplier (issuer tax id) is linked by the owner / admin to one or more supplier accounts (eta_issuer_links);
--   * eta_auto_match pairs each ETA invoice of a linked supplier with ONE active purchase invoice of those accounts:
--     total within 1 pound (or 0.1 %), our invoice dated from 10 days before to 30 days after the ETA issue day, nearest
--     amount then nearest day, a purchase used once — test 2026-11-15: شركة فريش 9 of 17 paired one-to-one (difference ≤ 0.05);
--   * a document can be linked by hand, unlinked, or marked «مش فاتورة شراء» (an expense: Vodafone, PayMob …);
--   * fixes found by the live test: type «i» stored lower-case (normalised to upper); the first sync read only 30 days,
--     `eta_backfill_from(date)` reads older months (their notifications are not sent — they are history, marked seen);
--   * `detail` = the full ETA document (lines), read on demand by eta-sync mode 'detail' and kept.
ALTER TABLE public.eta_documents
  ADD COLUMN IF NOT EXISTS match_shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_mode text CHECK (match_mode IN ('auto', 'manual', 'ignored')),
  ADD COLUMN IF NOT EXISTS match_note text,
  ADD COLUMN IF NOT EXISTS matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS matched_by uuid,
  ADD COLUMN IF NOT EXISTS detail jsonb,
  ADD COLUMN IF NOT EXISTS detail_at timestamptz;
CREATE INDEX IF NOT EXISTS eta_documents_match ON public.eta_documents (match_shipment_id) WHERE match_shipment_id IS NOT NULL;

UPDATE public.eta_documents SET type_name = upper(type_name) WHERE type_name <> upper(type_name);
UPDATE public.eta_documents SET type_name = upper(raw->>'typeName') WHERE type_name IS NULL AND raw ? 'typeName';

CREATE TABLE IF NOT EXISTS public.eta_issuer_links (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  issuer_id text NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (tenant_id, issuer_id, contact_id)
);
ALTER TABLE public.eta_issuer_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.eta_issuer_links FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.eta_can_read()
 RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()) OR public.has_permission(auth.uid(), 'admin_eta.view')) THEN
    RAISE EXCEPTION 'مش مسموح' USING ERRCODE = '42501';
  END IF;
  RETURN v_t;
END
$function$;
REVOKE ALL ON FUNCTION public.eta_can_read() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.eta_can_write()
 RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'الربط بفواتير الشراء للمالك أو المدير بس' USING ERRCODE = '42501';
  END IF;
  RETURN v_t;
END
$function$;
REVOKE ALL ON FUNCTION public.eta_can_write() FROM PUBLIC, anon, authenticated;

-- one-to-one pairing of unmatched ETA invoices of linked suppliers with active purchase invoices of those accounts
CREATE OR REPLACE FUNCTION public.eta_auto_match(p_tenant uuid)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; n int := 0;
BEGIN
  -- an auto pair whose purchase was cancelled is released
  UPDATE eta_documents d SET match_shipment_id = NULL, match_mode = NULL, matched_at = NULL
   WHERE d.tenant_id = p_tenant AND d.match_mode = 'auto'
     AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.id = d.match_shipment_id AND s.status = 'active');
  FOR r IN
    WITH docs AS (
      SELECT d.id, d.total, (d.date_issued AT TIME ZONE 'Africa/Cairo')::date AS day, l.contact_id
        FROM eta_documents d JOIN eta_issuer_links l ON l.tenant_id = d.tenant_id AND l.issuer_id = d.issuer_id
       WHERE d.tenant_id = p_tenant AND d.match_mode IS NULL AND d.status = 'Valid' AND d.type_name = 'I'
    ), cand AS (
      SELECT docs.id AS doc_id, s.id AS ship_id,
             abs(s.total_cost - docs.total) AS amt_diff,
             abs((s.invoice_date AT TIME ZONE 'Africa/Cairo')::date - docs.day) AS day_diff
        FROM docs JOIN shipments s ON s.contact_id = docs.contact_id AND s.tenant_id = p_tenant AND s.status = 'active'
       WHERE abs(s.total_cost - docs.total) <= greatest(1, docs.total * 0.001)
         AND (s.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN docs.day - 10 AND docs.day + 30
         AND NOT EXISTS (SELECT 1 FROM eta_documents x WHERE x.match_shipment_id = s.id)
    )
    SELECT * FROM cand ORDER BY amt_diff, day_diff, doc_id
  LOOP
    UPDATE eta_documents SET match_shipment_id = r.ship_id, match_mode = 'auto', matched_at = now()
     WHERE id = r.doc_id AND match_mode IS NULL
       AND NOT EXISTS (SELECT 1 FROM eta_documents x WHERE x.match_shipment_id = r.ship_id);
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END
$function$;
REVOKE ALL ON FUNCTION public.eta_auto_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eta_auto_match(uuid) TO service_role;

-- the page: every ETA document of the period with its pairing
CREATE OR REPLACE FUNCTION public.eta_documents_list(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid;
BEGIN
  v_t := public.eta_can_read();
  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY x->>'date_issued' DESC, x->>'id') FROM (
    SELECT jsonb_build_object(
      'id', d.id, 'eta_uuid', d.eta_uuid, 'internal_id', d.internal_id, 'type_name', d.type_name,
      'issuer_id', d.issuer_id, 'issuer_name', regexp_replace(d.issuer_name, '^\d+\s*', ''),
      'date_issued', d.date_issued, 'date_received', d.date_received,
      'net_amount', d.net_amount, 'total_discount', d.total_discount, 'total', d.total, 'vat', round(d.total - d.net_amount, 2),
      'status', d.status, 'status_reason', d.status_reason, 'public_url', d.public_url, 'seen_at', d.seen_at,
      'cancel_requested', NULLIF(d.raw->>'cancelRequestDate', '') IS NOT NULL,
      'reject_requested', NULLIF(d.raw->>'rejectRequestDate', '') IS NOT NULL,
      'has_detail', d.detail IS NOT NULL,
      'linked', EXISTS (SELECT 1 FROM eta_issuer_links l WHERE l.tenant_id = v_t AND l.issuer_id = d.issuer_id),
      'match_mode', d.match_mode, 'match_note', d.match_note,
      'match', CASE WHEN s.id IS NOT NULL THEN jsonb_build_object(
          'shipment_id', s.id, 'number', s.shipment_number, 'branch_id', s.branch_id, 'branch', b.name,
          'contact', c.name, 'date', (s.invoice_date AT TIME ZONE 'Africa/Cairo')::date, 'total', s.total_cost,
          'status', s.status, 'diff', round(s.total_cost - d.total, 2),
          'days', (s.invoice_date AT TIME ZONE 'Africa/Cairo')::date - (d.date_issued AT TIME ZONE 'Africa/Cairo')::date) END
    ) AS x
      FROM eta_documents d
      LEFT JOIN shipments s ON s.id = d.match_shipment_id
      LEFT JOIN branches b ON b.id = s.branch_id
      LEFT JOIN contacts c ON c.id = s.contact_id
     WHERE d.tenant_id = v_t
       AND (p_from IS NULL OR (d.date_issued AT TIME ZONE 'Africa/Cairo')::date >= p_from)
       AND (p_to IS NULL OR (d.date_issued AT TIME ZONE 'Africa/Cairo')::date <= p_to)
  ) z), '[]'::jsonb);
END
$function$;

-- suppliers on the portal: totals, linked accounts and name suggestions
CREATE OR REPLACE FUNCTION public.eta_issuers()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid;
BEGIN
  v_t := public.eta_can_read();
  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'total')::numeric DESC) FROM (
    SELECT jsonb_build_object(
      'issuer_id', i.issuer_id, 'issuer_name', i.issuer_name, 'count', i.n, 'total', i.total,
      'matched', i.matched, 'ignored', i.ignored, 'open', i.n - i.matched - i.ignored,
      'links', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
                           FROM eta_issuer_links l JOIN contacts c ON c.id = l.contact_id
                          WHERE l.tenant_id = v_t AND l.issuer_id = i.issuer_id), '[]'::jsonb),
      'suggest', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)) FROM (
          SELECT c.id, c.name FROM contacts c
           WHERE c.tenant_id = v_t AND c.type IN ('supplier', 'both') AND c.merged_into IS NULL AND NOT COALESCE(c.is_archived, false)
             AND EXISTS (SELECT 1 FROM unnest(i.words) w WHERE public.normalize_ar_name(c.name) LIKE '%' || w || '%')
             AND NOT EXISTS (SELECT 1 FROM eta_issuer_links l WHERE l.tenant_id = v_t AND l.issuer_id = i.issuer_id AND l.contact_id = c.id)
           ORDER BY (SELECT count(*) FROM shipments s WHERE s.contact_id = c.id AND s.status = 'active') DESC
           LIMIT 5) c), '[]'::jsonb)
    ) AS x
    FROM (
      SELECT d.issuer_id, regexp_replace(max(d.issuer_name), '^\d+\s*', '') AS issuer_name, count(*) AS n,
             round(sum(CASE WHEN d.type_name = 'C' THEN -d.total ELSE d.total END) FILTER (WHERE d.status = 'Valid'), 2) AS total,
             count(*) FILTER (WHERE d.match_mode IN ('auto', 'manual')) AS matched,
             count(*) FILTER (WHERE d.match_mode = 'ignored') AS ignored,
             ARRAY(SELECT w FROM unnest(string_to_array(public.normalize_ar_name(regexp_replace(max(d.issuer_name), '^\d+\s*', '')), ' ')) w
                    WHERE length(w) >= 4 AND w NOT IN ('شركه', 'شركة', 'للتجاره', 'للتجارة', 'والتوزيع', 'للاجهزه', 'للأجهزة',
                          'المنزليه', 'المنزلية', 'والتوكيلات', 'مصر', 'للتكنولوجيا', 'وخدمات', 'الالكترونى', 'الدفع', 'egypt',
                          'telecommunications', 'للانظمه', 'الالكترونية', 'اليكتريك')) AS words
        FROM eta_documents d WHERE d.tenant_id = v_t GROUP BY d.issuer_id
    ) i
  ) z), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.eta_link_issuer(p_issuer_id text, p_contacts uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; n int;
BEGIN
  v_t := public.eta_can_write();
  IF NOT EXISTS (SELECT 1 FROM eta_documents WHERE tenant_id = v_t AND issuer_id = p_issuer_id) THEN RAISE EXCEPTION 'المورد ده مش في الفواتير الواردة'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_contacts, '{}')) c WHERE NOT EXISTS (
       SELECT 1 FROM contacts x WHERE x.id = c AND x.tenant_id = v_t AND x.type IN ('supplier', 'both'))) THEN
    RAISE EXCEPTION 'اختار حساب مورد من حسابات الشركة';
  END IF;
  DELETE FROM eta_issuer_links WHERE tenant_id = v_t AND issuer_id = p_issuer_id AND contact_id <> ALL (COALESCE(p_contacts, '{}'));
  INSERT INTO eta_issuer_links (tenant_id, issuer_id, contact_id, created_by)
  SELECT v_t, p_issuer_id, c, auth.uid() FROM unnest(COALESCE(p_contacts, '{}')) c ON CONFLICT DO NOTHING;
  -- auto pairs that no longer belong to a linked account are released
  UPDATE eta_documents d SET match_shipment_id = NULL, match_mode = NULL, matched_at = NULL
   WHERE d.tenant_id = v_t AND d.issuer_id = p_issuer_id AND d.match_mode = 'auto'
     AND NOT EXISTS (SELECT 1 FROM shipments s JOIN eta_issuer_links l ON l.contact_id = s.contact_id AND l.tenant_id = v_t AND l.issuer_id = p_issuer_id
                      WHERE s.id = d.match_shipment_id);
  n := public.eta_auto_match(v_t);
  RETURN jsonb_build_object('matched', n);
END
$function$;

-- purchases to pick from when linking by hand: the linked accounts (or every supplier), nearest amount first
CREATE OR REPLACE FUNCTION public.eta_shipment_candidates(p_doc uuid, p_search text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; d record; v_linked boolean;
BEGIN
  v_t := public.eta_can_write();
  SELECT * INTO d FROM eta_documents WHERE id = p_doc AND tenant_id = v_t;
  IF d.id IS NULL THEN RAISE EXCEPTION 'الفاتورة مش موجودة'; END IF;
  v_linked := EXISTS (SELECT 1 FROM eta_issuer_links l WHERE l.tenant_id = v_t AND l.issuer_id = d.issuer_id);
  RETURN COALESCE((SELECT jsonb_agg(x) FROM (
    SELECT jsonb_build_object('shipment_id', s.id, 'number', s.shipment_number, 'branch', b.name, 'contact', c.name,
             'date', (s.invoice_date AT TIME ZONE 'Africa/Cairo')::date, 'total', s.total_cost,
             'diff', round(s.total_cost - d.total, 2),
             'taken', EXISTS (SELECT 1 FROM eta_documents x WHERE x.match_shipment_id = s.id AND x.id <> d.id)) AS x
      FROM shipments s JOIN contacts c ON c.id = s.contact_id JOIN branches b ON b.id = s.branch_id
     WHERE s.tenant_id = v_t AND s.status = 'active'
       AND (NOT v_linked OR s.contact_id IN (SELECT l.contact_id FROM eta_issuer_links l WHERE l.tenant_id = v_t AND l.issuer_id = d.issuer_id))
       AND (s.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN (d.date_issued AT TIME ZONE 'Africa/Cairo')::date - 60
                                                                AND (d.date_issued AT TIME ZONE 'Africa/Cairo')::date + 60
       AND (NULLIF(btrim(p_search), '') IS NULL OR s.shipment_number ILIKE '%' || btrim(p_search) || '%'
            OR public.normalize_ar_name(c.name) LIKE '%' || public.normalize_ar_name(btrim(p_search)) || '%')
     ORDER BY abs(s.total_cost - d.total), abs((s.invoice_date AT TIME ZONE 'Africa/Cairo')::date - (d.date_issued AT TIME ZONE 'Africa/Cairo')::date)
     LIMIT 30) z), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.eta_set_match(p_doc uuid, p_action text, p_shipment uuid DEFAULT NULL, p_note text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid;
BEGIN
  v_t := public.eta_can_write();
  IF NOT EXISTS (SELECT 1 FROM eta_documents WHERE id = p_doc AND tenant_id = v_t) THEN RAISE EXCEPTION 'الفاتورة مش موجودة'; END IF;
  IF p_action = 'link' THEN
    IF NOT EXISTS (SELECT 1 FROM shipments s WHERE s.id = p_shipment AND s.tenant_id = v_t AND s.status = 'active') THEN
      RAISE EXCEPTION 'فاتورة الشراء مش موجودة أو ملغاة';
    END IF;
    IF EXISTS (SELECT 1 FROM eta_documents x WHERE x.match_shipment_id = p_shipment AND x.id <> p_doc) THEN
      RAISE EXCEPTION 'فاتورة الشراء دي مربوطة بفاتورة إلكترونية تانية — فكّها الأول';
    END IF;
    UPDATE eta_documents SET match_shipment_id = p_shipment, match_mode = 'manual', match_note = NULLIF(btrim(p_note), ''),
           matched_at = now(), matched_by = auth.uid() WHERE id = p_doc;
  ELSIF p_action = 'ignore' THEN
    UPDATE eta_documents SET match_shipment_id = NULL, match_mode = 'ignored', match_note = NULLIF(btrim(p_note), ''),
           matched_at = now(), matched_by = auth.uid() WHERE id = p_doc;
  ELSIF p_action = 'clear' THEN
    -- back to «not paired»; the automatic pairing does not take it again by itself only when the owner marked it by hand
    UPDATE eta_documents SET match_shipment_id = NULL, match_mode = NULL, match_note = NULL, matched_at = now(), matched_by = auth.uid()
     WHERE id = p_doc;
  ELSE
    RAISE EXCEPTION 'إجراء غلط';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.eta_backfill_from(p_from date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; s record;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'للمالك بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM eta_settings WHERE tenant_id = v_t FOR UPDATE;
  IF s.tenant_id IS NULL OR NOT s.enabled THEN RAISE EXCEPTION 'شغّل الاستقبال الأول من الإعدادات'; END IF;
  IF p_from IS NULL OR p_from < date '2020-01-01' OR p_from >= public.cairo_today() THEN RAISE EXCEPTION 'التاريخ غلط'; END IF;
  -- eta-sync reads from synced_until − 8 days, so this makes the next runs start on p_from
  UPDATE eta_settings SET synced_until = (p_from + 8)::timestamp AT TIME ZONE 'Africa/Cairo', last_manual_at = NULL
   WHERE tenant_id = v_t;
  PERFORM public.nizam_cron_call('eta-sync', jsonb_build_object('tenant_id', v_t));
  RETURN jsonb_build_object('ok', true, 'from', p_from);
END
$function$;

-- ingest: type upper-case; a NEW document older than 3 days (first sync / a backfill) is history — saved as seen, no
-- notification; then the automatic pairing runs
CREATE OR REPLACE FUNCTION public.eta_ingest(p_tenant uuid, p_docs jsonb, p_until timestamptz, p_error text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d jsonb; v_old text; v_new int := 0; v_changed int := 0; v_id uuid; u record; v_title text; v_body text; v_recent boolean;
BEGIN
  FOR d IN SELECT * FROM jsonb_array_elements(COALESCE(p_docs, '[]'::jsonb)) LOOP
    CONTINUE WHEN NULLIF(d->>'uuid', '') IS NULL;
    SELECT status INTO v_old FROM eta_documents WHERE tenant_id = p_tenant AND eta_uuid = d->>'uuid';
    v_recent := COALESCE(NULLIF(d->>'dateTimeReceived', '')::timestamptz, NULLIF(d->>'dateTimeIssued', '')::timestamptz, now())
                >= now() - interval '3 days';
    INSERT INTO eta_documents (tenant_id, eta_uuid, submission_uuid, long_id, public_url, internal_id, type_name, type_version,
      issuer_id, issuer_name, issuer_type, receiver_id, receiver_name, date_issued, date_received,
      total_sales, total_discount, net_amount, total, status, status_reason, raw, seen_at)
    VALUES (p_tenant, d->>'uuid', d->>'submissionUUID', d->>'longId', d->>'publicUrl', d->>'internalId', upper(d->>'typeName'),
      d->>'typeVersionName', d->>'issuerId', d->>'issuerName', d->>'issuerType', d->>'receiverId', d->>'receiverName',
      NULLIF(d->>'dateTimeIssued', '')::timestamptz, NULLIF(d->>'dateTimeReceived', '')::timestamptz,
      NULLIF(d->>'totalSales', '')::numeric, NULLIF(d->>'totalDiscount', '')::numeric, NULLIF(d->>'netAmount', '')::numeric,
      NULLIF(d->>'total', '')::numeric, d->>'status', d->>'documentStatusReason', d, CASE WHEN v_recent THEN NULL ELSE now() END)
    ON CONFLICT (tenant_id, eta_uuid) DO UPDATE SET status = EXCLUDED.status, status_reason = EXCLUDED.status_reason,
      public_url = COALESCE(EXCLUDED.public_url, eta_documents.public_url), raw = EXCLUDED.raw, updated_at = now()
    RETURNING id INTO v_id;
    v_title := NULL;
    IF v_old IS NULL THEN
      v_new := v_new + 1;
      IF v_recent THEN v_title := 'فاتورة إلكترونية واردة من ' || COALESCE(regexp_replace(d->>'issuerName', '^\d+\s*', ''), 'مورد'); END IF;
    ELSIF v_old IS DISTINCT FROM d->>'status' AND d->>'status' IN ('Cancelled', 'Rejected') THEN
      v_changed := v_changed + 1;
      v_title := CASE d->>'status' WHEN 'Cancelled' THEN 'اتلغت' ELSE 'اترفضت' END || ' فاتورة إلكترونية من '
                 || COALESCE(regexp_replace(d->>'issuerName', '^\d+\s*', ''), 'مورد');
      UPDATE eta_documents SET seen_at = NULL WHERE id = v_id;
    END IF;
    IF v_title IS NOT NULL THEN
      v_body := COALESCE(d->>'internalId', '') || ' — ' ||
                to_char(COALESCE(NULLIF(d->>'total', '')::numeric, 0), 'FM999,999,999,990.00') || ' جنيه — ' ||
                to_char((NULLIF(d->>'dateTimeIssued', '')::timestamptz) AT TIME ZONE 'Africa/Cairo', 'DD/MM/YYYY');
      FOR u IN SELECT DISTINCT ur.user_id FROM user_roles ur WHERE ur.tenant_id = p_tenant AND ur.role IN ('owner', 'admin') LOOP
        INSERT INTO notifications (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
        VALUES (p_tenant, u.user_id, v_title, v_body, 'eta_received', '/admin/eta-invoices', 'eta_documents', v_id);
      END LOOP;
    END IF;
  END LOOP;
  UPDATE eta_settings SET last_sync_at = now(), last_error = p_error,
         synced_until = CASE WHEN p_error IS NULL AND p_until IS NOT NULL THEN p_until ELSE synced_until END
   WHERE tenant_id = p_tenant;
  RETURN jsonb_build_object('new', v_new, 'changed', v_changed, 'matched', public.eta_auto_match(p_tenant));
END
$function$;

CREATE OR REPLACE FUNCTION public.eta_save_detail(p_tenant uuid, p_uuid text, p_detail jsonb)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  UPDATE eta_documents SET detail = p_detail, detail_at = now() WHERE tenant_id = p_tenant AND eta_uuid = p_uuid
$function$;
REVOKE ALL ON FUNCTION public.eta_save_detail(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eta_save_detail(uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.eta_document_detail(p_doc uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; r jsonb;
BEGIN
  v_t := public.eta_can_read();
  SELECT jsonb_build_object('eta_uuid', eta_uuid, 'detail', detail, 'detail_at', detail_at) INTO r
    FROM eta_documents WHERE id = p_doc AND tenant_id = v_t;
  IF r IS NULL THEN RAISE EXCEPTION 'الفاتورة مش موجودة'; END IF;
  RETURN r;
END
$function$;

REVOKE ALL ON FUNCTION public.eta_documents_list(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eta_issuers() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eta_link_issuer(text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eta_shipment_candidates(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eta_set_match(uuid, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eta_backfill_from(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eta_document_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eta_documents_list(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eta_issuers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.eta_link_issuer(text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eta_shipment_candidates(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eta_set_match(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eta_backfill_from(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eta_document_detail(uuid) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('eta_documents_list', '0222', 'received e-invoices with their purchase pairing'),
  ('eta_issuers', '0222', 'ETA suppliers, links and suggestions'),
  ('eta_link_issuer', '0222', 'owner / admin: link an ETA supplier to supplier accounts'),
  ('eta_shipment_candidates', '0222', 'owner / admin: purchases to pair by hand'),
  ('eta_set_match', '0222', 'owner / admin: pair / unpair / ignore an ETA document'),
  ('eta_backfill_from', '0222', 'owner: read older ETA months'),
  ('eta_document_detail', '0222', 'cached lines of one ETA document')
ON CONFLICT DO NOTHING;
