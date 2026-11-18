-- 0252 (owner 2026-11-18 «فواتير البيع في شلبي للمعارض تتعمل فواتير شراء لكل معرض بداية من 1.9.2026 حتي وقتنا هذا»،
--       المرتجعات «نفذ»، الفلوس «مرتجعات بس»، «ده للفترة اللي فاتت بس»، «نفذ»):
-- 1/9 → 28/10 was already mirrored by the import; the 29/10 → 15/11 «سهل» loads gave each branch only its own files.
-- This makes, ONCE, through `sahl_import.do_op` (the system's own write paths, as the owner, import mode):
--   * a purchase in the branch from «المخزن الرئيسي» for every شلبى sale to «معرض سكة تلة / عبد المنعم الغربى (حساب خاص)»
--     dated ≥ 29/10 that has none (same day / time, same lines, credit, no money);
--   * a purchase return in the branch for every active شلبى sale return of those accounts dated ≥ 29/10 (on the mirror purchase of
--     its invoice; on account, no money) — incl. SR09381 (typed in the system on 15/11, dated 29/10, invoice 7414).
-- Branch sales to شلبى since 1/9 are all mirrored already (16 / 16); the 10 شلبى returns before 29/10 without a mirror are the
-- 0175 decision and stay. Then recost from 29/10, ledger_sync_safe, checks (tills = GL, unexplained 0). Dry-run: load5_run(false).

CREATE OR REPLACE FUNCTION sahl_import.load5_run(p_apply boolean)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
#variable_conflict use_column
DECLARE
  v_t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; v_max bigint; v_err text; v_run jsonb; r record;
  v_prods uuid[]; v_seq jsonb; v_res jsonb; v_gl jsonb; v_un jsonb; v_t0 timestamptz := clock_timestamp();
  v_main uuid := 'f409707e-e127-46f7-b53c-086e34c74a34';
BEGIN
  SELECT jsonb_object_agg(sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL
     AND sequencename IN ('invoice_seq', 'shipment_seq', 'sale_return_seq', 'purchase_return_seq', 'prior_year_return_seq', 'contact_settlement_seq');
  SELECT coalesce(max(id), 0) INTO v_max FROM sahl_import.ops;
  BEGIN
  PERFORM sahl_import.ctx();

  -- purchases: شلبى sales to the branches' accounts, ≥ 29/10, no mirror yet
  INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, mirror_of, payload)
  SELECT CASE WHEN c.name LIKE '%سكة%' THEN 'sekka' ELSE 'abdelmonem' END, o.day, o.tm, 1, 'purchase', 'بيع', NULL, o.no,
         -- the lines of the invoice AS IT IS in the system (IN47820 / 8533 had 6 prices corrected after «سهل»: 44,575 → 121,225)
         jsonb_build_object('contact', 'المخزن الرئيسي', 'pays', '[]'::jsonb, 'inv_no', NULL, 'sha_lines', true,
           'lines', (SELECT jsonb_agg(jsonb_build_object('sku', pp.sku, 'code', pp.sku, 'qty', ii.quantity, 'price', ii.selling_price,
                                       'disc', coalesce(ii.line_discount, 0), 'net', ii.quantity * ii.selling_price - coalesce(ii.line_discount, 0)) ORDER BY ii.id)
                       FROM public.invoice_items ii JOIN public.products pp ON pp.id = ii.product_id WHERE ii.invoice_id = i.id),
           'total', i.total, 'credit', i.total,
           'notes', 'من سجل شلبى: فاتورة بيع ' || o.no || ' (' || i.invoice_number || ') — ما اتسجلتش في الفرع (0252)')
    FROM sahl_import.ops o JOIN public.invoices i ON i.id = o.new_id JOIN public.contacts c ON c.id = i.contact_id
   WHERE o.branch = 'shalaby' AND o.kind = 'sale' AND o.status = 'done' AND o.mirror_of IS NULL
     AND c.internal_branch_id IS NOT NULL AND i.status = 'active' AND o.day >= DATE '2026-10-29'
     AND NOT EXISTS (SELECT 1 FROM sahl_import.ops m WHERE m.kind = 'purchase' AND m.mirror_of = o.no
                       AND m.branch = CASE WHEN c.name LIKE '%سكة%' THEN 'sekka' ELSE 'abdelmonem' END);

  -- purchase returns: شلبى sale returns from «سهل» on those accounts, ≥ 29/10
  INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, mirror_of, payload)
  SELECT CASE WHEN c.name LIKE '%سكة%' THEN 'sekka' ELSE 'abdelmonem' END, o.day, o.tm, 3, 'mirror_purchase_return', 'مرتجع بيع', NULL, o.no,
         jsonb_build_object('contact', 'المخزن الرئيسي', 'lines', o.payload->'lines', 'pays', '[]'::jsonb, 'inv_no', o.payload->'inv_no',
           'total', o.payload->'total', 'credit', o.payload->'total', 'sha_lines', true,
           'notes', 'من سجل شلبى: مرتجع بيع ' || o.no || ' (' || r.return_number || ') — ما اتسجلتش في الفرع (0252)')
    FROM sahl_import.ops o JOIN public.returns r ON r.id = o.new_id JOIN public.invoices i ON i.id = r.invoice_id
    JOIN public.contacts c ON c.id = i.contact_id
   WHERE o.branch = 'shalaby' AND o.kind = 'sale_return' AND o.status = 'done'
     AND c.internal_branch_id IS NOT NULL AND r.status = 'active' AND o.day >= DATE '2026-10-29'
     AND NOT EXISTS (SELECT 1 FROM sahl_import.ops m WHERE m.kind = 'mirror_purchase_return' AND m.mirror_of = o.no
                       AND m.branch = CASE WHEN c.name LIKE '%سكة%' THEN 'sekka' ELSE 'abdelmonem' END);

  -- the return typed in the system (not from «سهل»): SR09381 → its lines from return_items
  INSERT INTO sahl_import.ops (branch, day, tm, ord, kind, src_kind, no, mirror_of, payload)
  SELECT CASE WHEN c.name LIKE '%سكة%' THEN 'sekka' ELSE 'abdelmonem' END, (r.invoice_date AT TIME ZONE 'Africa/Cairo')::date,
         (r.invoice_date AT TIME ZONE 'Africa/Cairo')::time, 3, 'mirror_purchase_return', 'مرتجع بيع', NULL, NULL,
         jsonb_build_object('contact', 'المخزن الرئيسي', 'pays', '[]'::jsonb, 'inv_no', io.no, 'total', r.total_refund, 'credit', r.total_refund,
           'lines', (SELECT jsonb_agg(jsonb_build_object('sku', p.sku, 'code', p.sku, 'qty', ri.quantity, 'net', ri.refund, 'disc', 0,
                                       'price', round(ri.refund / ri.quantity, 4))) FROM public.return_items ri JOIN public.products p ON p.id = ri.product_id
                      WHERE ri.return_id = r.id),
           'notes', 'من سجل شلبى: مرتجع بيع ' || r.return_number || ' — ما اتسجلش في الفرع (0252)')
    FROM public.returns r JOIN public.invoices i ON i.id = r.invoice_id JOIN public.contacts c ON c.id = i.contact_id
    LEFT JOIN sahl_import.ops io ON io.new_id = i.id AND io.branch = 'shalaby' AND io.kind = 'sale'
   WHERE r.branch_id = 'f2b47364-4837-4e1b-84b0-e39f78940d59' AND r.status = 'active' AND c.internal_branch_id IS NOT NULL
     AND (r.invoice_date AT TIME ZONE 'Africa/Cairo')::date >= DATE '2026-10-29'
     AND NOT EXISTS (SELECT 1 FROM sahl_import.ops x WHERE x.new_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM sahl_import.ops m WHERE m.kind = 'mirror_purchase_return' AND m.payload->>'notes' LIKE '%' || r.return_number || '%');

  v_run := sahl_import.run_ops(DATE '2026-12-31', true);

  INSERT INTO public.doc_source_times (doc_id, tm)
  SELECT DISTINCT ON (o.new_id) o.new_id, o.tm FROM sahl_import.ops o WHERE o.id > v_max AND o.new_id IS NOT NULL AND o.tm IS NOT NULL ORDER BY o.new_id, o.id
  ON CONFLICT (doc_id) DO UPDATE SET tm = EXCLUDED.tm;

  SELECT array_agg(DISTINCT x.pid) INTO v_prods FROM (
    SELECT si.product_id pid FROM sahl_import.ops o JOIN public.shipment_items si ON si.shipment_id = o.new_id WHERE o.id > v_max AND o.kind = 'purchase'
    UNION SELECT pi.product_id FROM sahl_import.ops o JOIN public.purchase_return_items pi ON pi.purchase_return_id = o.new_id
     WHERE o.id > v_max AND o.kind = 'mirror_purchase_return') x WHERE x.pid IS NOT NULL;
  IF v_prods IS NOT NULL THEN PERFORM public.recost_product_sales(v_prods, TIMESTAMPTZ '2026-10-29 00:00+02'); END IF;

  PERFORM set_config('app.ledger_capture', '', true);
  PERFORM set_config('ledger.done', '', true);
  PERFORM public.ledger_sync_safe(v_main, NULL, 'load5');
  SET CONSTRAINTS ALL IMMEDIATE;

  SELECT jsonb_agg(jsonb_build_object('b', x->>'branch', 'diff', x->'difference')) INTO v_gl
    FROM jsonb_array_elements((SELECT to_jsonb(g)->'branches' FROM public.ledger_gl_reconciliation(v_t) g)) x;
  SELECT to_jsonb(s) INTO v_un FROM public.ledger_reconciliation_summary(v_t) s;
  v_res := jsonb_build_object('run', v_run, 'products_recosted', coalesce(array_length(v_prods, 1), 0),
    'docs', (SELECT jsonb_object_agg(k, c) FROM (SELECT o.branch || ':' || o.kind || ':' || o.status k, count(*) c FROM sahl_import.ops o WHERE o.id > v_max GROUP BY 1) z),
    'totals', (SELECT jsonb_object_agg(k, t) FROM (
        SELECT o.branch || ':' || o.kind k, sum(coalesce(s.total_cost, pr.total_amount)) t FROM sahl_import.ops o
          LEFT JOIN public.shipments s ON s.id = o.new_id LEFT JOIN public.purchase_returns pr ON pr.id = o.new_id
         WHERE o.id > v_max GROUP BY 1) z),
    'src_vs_doc', (SELECT count(*) FROM sahl_import.ops o LEFT JOIN public.shipments s ON s.id = o.new_id LEFT JOIN public.purchase_returns pr ON pr.id = o.new_id
         WHERE o.id > v_max AND abs(coalesce(s.total_cost, pr.total_amount, -1) - (o.payload->>'total')::numeric) > 0.01),
    'pr_without_invoice', (SELECT count(*) FROM sahl_import.ops o JOIN public.purchase_returns pr ON pr.id = o.new_id WHERE o.id > v_max AND pr.shipment_id IS NULL),
    'tills_vs_gl', v_gl, 'unexplained', v_un->'unexplained', 'cross_branch', (SELECT count(*) FROM payment_allocations WHERE is_cross_branch AND status = 'active'),
    'sync_errors', (SELECT count(*) FROM ledger_sync_errors WHERE context LIKE '%load5%' AND created_at > v_t0),
    'err', (SELECT left(max(error), 200) FROM ledger_sync_errors WHERE context LIKE '%load5%' AND created_at > v_t0),
    'secs', round(extract(epoch FROM clock_timestamp() - v_t0)));
  IF NOT p_apply THEN
    PERFORM setval(format('public.%I', k), (v_seq->>k)::bigint) FROM jsonb_object_keys(v_seq) k;
    RAISE EXCEPTION 'DRY %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_gl) x WHERE abs((x->>'diff')::numeric) > 0.01) OR abs(coalesce((v_un->>'unexplained')::numeric, 0)) > 0.01
     OR (v_res->>'src_vs_doc')::int > 0 THEN
    RAISE EXCEPTION 'load5 checks failed %', v_res;
  END IF;
  RETURN v_res;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM setval(format('public.%I', k), (v_seq->>k)::bigint) FROM jsonb_object_keys(v_seq) k;
    RAISE EXCEPTION '%', v_err;
  END;
END $fn$;
REVOKE ALL ON FUNCTION sahl_import.load5_run(boolean) FROM PUBLIC, anon, authenticated;

-- Run 2026-11-18: dry-run, then load5_run(true): 52 ops, 0 errors — سكة 18 purchases 1,133,095 + 8 purchase returns 89,825; عبدالمنعم 19 purchases 417,895 + 7 returns 66,000 (incl. SR09381); every mirror = its source to the piaster, all returns on their purchase; 83 products recosted from 29/10; tills unchanged and = GL; unexplained 0; nothing left unmirrored. Net profit 2026: سكة 594,024.35 → 581,663.82, عبدالمنعم 773,641.65 → 751,114.07 (their later sales of these items now carry the شلبى price as cost), شلبى unchanged.
