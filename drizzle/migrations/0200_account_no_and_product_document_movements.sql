-- 0200: owner 2026-11-11 (the «مدين / دائن» screens, stages 2–4).
-- 1) contacts.account_no — «رقم الحساب»: one number per account inside the company, by creation order; new accounts get max + 1.
--    `contacts_page` returns it. The old «سهل» numbers stay in the import staging (reference only).
-- 2) doc_source_times is readable by signed-in users (a time of day is not sensitive) so invoker functions can show it.
-- 3) product_document_movements(product): the item's movements built from its DOCUMENTS (sale / purchase invoices, both
--    returns, before-2026 returns) — owner «حركة الصنف تتبني من المستندات نفسها». What the documents do not explain
--    (opening stock, counts, adjustments) is ONE first row «رصيد أول المدة وتسويات», so the last balance = the item's quantity.
--    Reads only (invoker, RLS of the tables applies).
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS account_no integer;
UPDATE public.contacts c SET account_no = z.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id)::int AS rn FROM public.contacts) z
 WHERE z.id = c.id AND c.account_no IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_account_no_uidx ON public.contacts (tenant_id, account_no);
CREATE OR REPLACE FUNCTION public.contacts_set_account_no() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.account_no IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('contacts_account_no:' || coalesce(NEW.tenant_id::text, '')));
    SELECT coalesce(max(c.account_no), 0) + 1 INTO NEW.account_no FROM public.contacts c WHERE c.tenant_id IS NOT DISTINCT FROM NEW.tenant_id;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS zz_contacts_account_no ON public.contacts;
CREATE TRIGGER zz_contacts_account_no BEFORE INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contacts_set_account_no();

DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.contacts_page(uuid,text,text,text[],integer,integer)'::regprocedure);
  IF position('c.account_no' in d) = 0 THEN
    d := replace(d, 'SELECT c.id, c.name, c.phone, c.contact_person,', 'SELECT c.id, c.account_no, c.name, c.phone, c.contact_person,');
    d := replace(d, 'SELECT b.id, b.name, b.phone, b.contact_person,', 'SELECT b.id, b.account_no, b.name, b.phone, b.contact_person,');
    IF position('c.account_no' in d) = 0 OR position('b.account_no' in d) = 0 THEN RAISE EXCEPTION '0200: contacts_page not patched'; END IF;
    EXECUTE d;
  END IF;
END
$mig$;

GRANT SELECT ON public.doc_source_times TO authenticated;
DROP POLICY IF EXISTS doc_source_times_read ON public.doc_source_times;
CREATE POLICY doc_source_times_read ON public.doc_source_times FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.product_document_movements(p_product uuid)
RETURNS TABLE(line_no integer, line_date date, line_time time, kind text, doc_number text, contact_name text, qty_in numeric, qty_out numeric,
              balance numeric, unit_price numeric, src_table text, src_id uuid, branch_id uuid, branch_name text)
LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  WITH p AS (SELECT pr.id, pr.branch_id, pr.quantity FROM public.products pr WHERE pr.id = p_product),
  ev AS (
    SELECT (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date AS d, i.created_at AS ts, 2 AS o, 'فاتورة بيع'::text AS k, i.invoice_number AS no,
           (SELECT c.name FROM public.contacts c WHERE c.id = i.contact_id) AS cn, 0::numeric AS qi, ii.quantity::numeric AS qo,
           ii.selling_price::numeric AS up, 'invoices'::text AS st, i.id AS sid, i.branch_id AS br
      FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id WHERE ii.product_id = p_product AND i.status = 'active'
    UNION ALL
    SELECT s.arrival_date, s.created_at, 1, 'فاتورة شراء', s.shipment_number, (SELECT c.name FROM public.contacts c WHERE c.id = s.contact_id),
           si.quantity, 0, si.cost_price, 'shipments', s.id, s.branch_id
      FROM public.shipment_items si JOIN public.shipments s ON s.id = si.shipment_id WHERE si.product_id = p_product AND s.status = 'active'
    UNION ALL
    SELECT (r.invoice_date AT TIME ZONE 'Africa/Cairo')::date, r.created_at, 1, 'مرتجع بيع', r.return_number,
           (SELECT c.name FROM public.contacts c JOIN public.invoices i ON i.contact_id = c.id WHERE i.id = r.invoice_id),
           x.quantity, 0, CASE WHEN x.quantity <> 0 THEN round(x.refund / x.quantity, 2) END, 'returns', r.id, r.branch_id
      FROM public.return_items x JOIN public.returns r ON r.id = x.return_id WHERE x.product_id = p_product AND r.status = 'active'
    UNION ALL
    SELECT (r.invoice_date AT TIME ZONE 'Africa/Cairo')::date, r.created_at, 2, 'مرتجع شراء', r.return_number,
           (SELECT c.name FROM public.contacts c WHERE c.id = r.contact_id), 0, x.quantity, x.unit_cost, 'purchase_returns', r.id, r.branch_id
      FROM public.purchase_return_items x JOIN public.purchase_returns r ON r.id = x.purchase_return_id WHERE x.product_id = p_product AND r.status = 'active'
    UNION ALL
    SELECT y.return_date, y.created_at, 1, 'مرتجع بيع (فاتورة قبل 2026)', y.return_number, (SELECT c.name FROM public.contacts c WHERE c.id = y.contact_id),
           (e->>'quantity')::numeric, 0, nullif(e->>'price', '')::numeric, 'prior_year_returns', y.id, y.branch_id
      FROM public.prior_year_returns y CROSS JOIN LATERAL jsonb_array_elements(y.items) e WHERE (e->>'product_id')::uuid = p_product
  ),
  op AS (SELECT (SELECT p.quantity FROM p) - coalesce((SELECT sum(ev.qi - ev.qo) FROM ev), 0) AS q),
  r AS (SELECT row_number() OVER (ORDER BY ev.d, ev.o, ev.ts, ev.sid)::int AS rn, ev.* FROM ev)
  SELECT 0, NULL::date, NULL::time, 'رصيد أول المدة وتسويات'::text, NULL::text, NULL::text,
         greatest(op.q, 0), greatest(-op.q, 0), op.q, NULL::numeric, NULL::text, NULL::uuid, (SELECT p.branch_id FROM p),
         (SELECT b.name FROM public.branches b WHERE b.id = (SELECT p.branch_id FROM p))
    FROM op WHERE EXISTS (SELECT 1 FROM p)
  UNION ALL
  SELECT r.rn, r.d,
         coalesce((SELECT t.tm FROM public.doc_source_times t WHERE t.doc_id = r.sid),
                  CASE WHEN (r.ts AT TIME ZONE 'Africa/Cairo')::date = r.d THEN date_trunc('minute', (r.ts AT TIME ZONE 'Africa/Cairo'))::time END),
         r.k, r.no, r.cn, r.qi, r.qo, (SELECT op.q FROM op) + sum(r.qi - r.qo) OVER (ORDER BY r.rn), r.up, r.st, r.sid, r.br,
         (SELECT b.name FROM public.branches b WHERE b.id = r.br)
    FROM r
  ORDER BY 1
$fn$;
REVOKE ALL ON FUNCTION public.product_document_movements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_document_movements(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
