-- Step 6D part 5 (backfill runs separately in batches because of its size).
CREATE INDEX IF NOT EXISTS journal_entries_tenant_number_pattern_idx ON public.journal_entries (tenant_id, entry_number text_pattern_ops);

CREATE OR REPLACE FUNCTION public.system_integrity_audit_gl(p_tenant uuid)
RETURNS TABLE (check_code text, severity text, area text, title text, details text,
               contact_id uuid, contact_name text, branch_id uuid, branch_name text,
               doc_type text, doc_id uuid, doc_number text, amount numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE r jsonb;
BEGIN
  r := public.ledger_gl_reconciliation(p_tenant);
  IF abs((r->>'inter_branch_1910_total')::numeric) > 0.005 THEN
    check_code := 'G1'; severity := 'error'; area := 'journal'; title := 'الحساب الجاري بين الفروع (1910) مش صفر على مستوى الشركة';
    details := 'رصيد 1910 = ' || (r->>'inter_branch_1910_total'); amount := (r->>'inter_branch_1910_total')::numeric;
    contact_id := NULL; contact_name := NULL; branch_id := NULL; branch_name := NULL; doc_type := NULL; doc_id := NULL; doc_number := NULL;
    RETURN NEXT;
  END IF;
  IF abs((r->'customer_advances'->>'ledger')::numeric - (r->'customer_advances'->>'gl_2150')::numeric) > 0.05 THEN
    check_code := 'G2'; severity := 'warning'; area := 'journal'; title := 'مقدمات العملاء في القيود (2150) مختلفة عن الدفتر الموحد';
    details := 'الدفتر ' || (r->'customer_advances'->>'ledger') || ' / القيود ' || (r->'customer_advances'->>'gl_2150');
    amount := round((r->'customer_advances'->>'ledger')::numeric - (r->'customer_advances'->>'gl_2150')::numeric, 2);
    contact_id := NULL; contact_name := NULL; branch_id := NULL; branch_name := NULL; doc_type := NULL; doc_id := NULL; doc_number := NULL;
    RETURN NEXT;
  END IF;
  IF abs((r->'supplier_advances'->>'ledger')::numeric - (r->'supplier_advances'->>'gl_1460')::numeric) > 0.05 THEN
    check_code := 'G3'; severity := 'warning'; area := 'journal'; title := 'مقدماتنا عند الموردين في القيود (1460) مختلفة عن الدفتر الموحد';
    details := 'الدفتر ' || (r->'supplier_advances'->>'ledger') || ' / القيود ' || (r->'supplier_advances'->>'gl_1460');
    amount := round((r->'supplier_advances'->>'ledger')::numeric - (r->'supplier_advances'->>'gl_1460')::numeric, 2);
    contact_id := NULL; contact_name := NULL; branch_id := NULL; branch_name := NULL; doc_type := NULL; doc_id := NULL; doc_number := NULL;
    RETURN NEXT;
  END IF;
  IF (r->'not_posted'->>'movements')::int + (r->'not_posted'->>'allocations')::int > 0 THEN
    check_code := 'G4'; severity := 'error'; area := 'journal'; title := 'حركات في الدفتر الموحد من غير قيد';
    details := (r->'not_posted'->>'movements') || ' حركة فلوس و' || (r->'not_posted'->>'allocations') || ' توزيع — شغّل مزامنة القيود';
    amount := NULL;
    contact_id := NULL; contact_name := NULL; branch_id := NULL; branch_name := NULL; doc_type := NULL; doc_id := NULL; doc_number := NULL;
    RETURN NEXT;
  END IF;
  IF (r->>'old_entries_still_standing')::int > 0 THEN
    check_code := 'G5'; severity := 'error'; area := 'journal'; title := 'قيود قديمة لفلوس عملاء/موردين لسه قايمة';
    details := (r->>'old_entries_still_standing') || ' قيد — الفلوس دي بتتسجل من الدفتر الموحد';
    amount := NULL;
    contact_id := NULL; contact_name := NULL; branch_id := NULL; branch_name := NULL; doc_type := NULL; doc_id := NULL; doc_number := NULL;
    RETURN NEXT;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each_text(r->'opening'->'ledger') l
              WHERE abs(l.value::numeric - COALESCE((r->'opening'->'journal'->>l.key)::numeric, 0)) > 0.005) THEN
    check_code := 'G7'; severity := 'warning'; area := 'opening'; title := 'الأرصدة الافتتاحية في الدفتر مش مترحلة في القيود';
    details := 'الدفتر ' || (r->'opening'->>'ledger') || ' / القيود ' || (r->'opening'->>'journal')
               || ' — رحّل الأرصدة الافتتاحية من شاشتها (بيتعمل قيد عكسي للقديم ومفيش حذف)';
    amount := NULL;
    contact_id := NULL; contact_name := NULL; branch_id := NULL; branch_name := NULL; doc_type := NULL; doc_id := NULL; doc_number := NULL;
    RETURN NEXT;
  END IF;
  IF (r->'not_posted'->>'closed_period_skipped')::int > 0 THEN
    check_code := 'G6'; severity := 'info'; area := 'journal'; title := 'حركات جوه فترة مقفولة ما اتعدلتش';
    details := (r->'not_posted'->>'closed_period_skipped') || ' حركة/قيد في فترات مقفولة اتسابوا زي ما هم (قاعدة الفترات المقفولة)';
    amount := NULL;
    contact_id := NULL; contact_name := NULL; branch_id := NULL; branch_name := NULL; doc_type := NULL; doc_id := NULL; doc_number := NULL;
    RETURN NEXT;
  END IF;
END
$fn$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.system_integrity_audit(uuid)'::regprocedure);
  v_new := v_def;
  v_new := replace(v_new,
$a$  SELECT 'T3', 'info', 'treasury', 'رصيد خزنة الفرع مختلف عن حسابات النقدية للفرع في القيود',
         'الخزنة ' || round(t.bal, 2) || ' / القيود (11xx) ' || round(COALESCE(g.bal, 0), 2)
           || ' — غالباً فلوس اتحصلت في فرع على فاتورة فرع تاني؛ بيتظبط مع قيود الحساب الجاري 1910 (المرحلة 5)',$a$,
$b$  SELECT 'T3', 'warning', 'treasury', 'رصيد خزنة الفرع مختلف عن حسابات النقدية للفرع في القيود',
         'من 1 يناير 2026: الخزنة ' || round(t.bal, 2) || ' / القيود (11xx) ' || round(COALESCE(g.bal, 0), 2),$b$);
  v_new := replace(v_new,
$a$            FROM treasury tr WHERE tr.tenant_id = v_t GROUP BY 1) t$a$,
$b$            FROM treasury tr WHERE tr.tenant_id = v_t
             AND (COALESCE(tr.transaction_date, public.ledger_day(tr.created_at)) >= v_cut OR tr.category = 'رصيد افتتاحي') GROUP BY 1) t$b$);
  v_new := replace(v_new,
$a$                WHERE e.tenant_id = v_t AND e.status = 'posted' GROUP BY 1) g$a$,
$b$                WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.entry_date >= v_cut GROUP BY 1) g$b$);
  v_new := replace(v_new,
$a$            FROM treasury tr WHERE tr.tenant_id = v_t) t$a$,
$b$            FROM treasury tr WHERE tr.tenant_id = v_t
             AND (COALESCE(tr.transaction_date, public.ledger_day(tr.created_at)) >= v_cut OR tr.category = 'رصيد افتتاحي')) t$b$);
  v_new := replace(v_new,
$a$                 WHERE e.tenant_id = v_t AND e.status = 'posted') g$a$,
$b$                 WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.entry_date >= v_cut) g$b$);
  v_new := replace(v_new,
$a$   WHERE c.tenant_id = v_t AND abs(COALESCE(-c.credit_balance, 0) - COALESCE(s.advance, 0)) > 0.005$a$,
$b$   WHERE c.tenant_id = v_t AND c.type <> 'supplier' AND abs(COALESCE(-c.credit_balance, 0) - COALESCE(s.advance, 0)) > 0.005$b$);
  v_new := replace(v_new,
$a$  UNION ALL
  SELECT 'S1', 'warning', 'stock',$a$,
$b$  UNION ALL
  SELECT * FROM public.system_integrity_audit_gl(v_t)
  UNION ALL
  SELECT 'S1', 'warning', 'stock',$b$);
  IF v_new = v_def OR position('system_integrity_audit_gl' IN v_new) = 0 OR position('''T3'', ''warning''' IN v_new) = 0
     OR position('c.type <> ''supplier''' IN v_new) = 0 OR position('e.entry_date >= v_cut) g' IN v_new) = 0 THEN
    RAISE EXCEPTION 'Step 6D: system_integrity_audit patch did not apply';
  END IF;
  EXECUTE v_new;
END
$patch$;

CREATE TABLE IF NOT EXISTS public.ledger_credit_balance_snapshot (
  contact_id        uuid PRIMARY KEY REFERENCES public.contacts(id),
  tenant_id         uuid NOT NULL,
  contact_type      text,
  old_credit_balance numeric,
  ledger_customer_advance numeric,
  ledger_supplier_advance numeric,
  taken_at          timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ledger_credit_balance_snapshot TO service_role;
ALTER TABLE public.ledger_credit_balance_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ledger_credit_balance_snapshot FROM PUBLIC, anon, authenticated;
INSERT INTO public.ledger_credit_balance_snapshot (contact_id, tenant_id, contact_type, old_credit_balance,
                                                   ledger_customer_advance, ledger_supplier_advance)
SELECT c.id, c.tenant_id, c.type, c.credit_balance,
       public.ledger_side_advance(c.id, 'customer'), public.ledger_side_advance(c.id, 'supplier')
  FROM contacts c
 WHERE COALESCE(c.credit_balance, 0) <> 0
    OR EXISTS (SELECT 1 FROM money_movements m WHERE m.contact_id = c.id AND m.effect = 'settle' AND m.status = 'active')
ON CONFLICT (contact_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.opening_balances_reconciliation()
RETURNS TABLE (contact_id uuid, contact_name text, contact_type text, side text,
               opening_in_contact numeric, opening_in_ledger numeric,
               old_prepaid_credit numeric, ledger_advance_now numeric, status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_t uuid;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'مطابقة الأرصدة الافتتاحية للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH sides AS (
    SELECT c.id, c.name, c.type, c.opening_balance AS ob, s.side FROM contacts c
     CROSS JOIN LATERAL (SELECT unnest(CASE c.type WHEN 'customer' THEN ARRAY['customer'] WHEN 'supplier' THEN ARRAY['supplier']
                                                   ELSE ARRAY['customer', 'supplier'] END) AS side) s
     WHERE c.tenant_id = v_t
  ),
  mv AS (
    SELECT m.contact_id, m.side, sum(CASE WHEN m.effect = 'charge' THEN m.amount ELSE -m.amount END) AS amt
      FROM money_movements m WHERE m.tenant_id = v_t AND m.kind = 'opening' AND m.status = 'active' GROUP BY 1, 2
  ),
  x AS (
    SELECT s.*, round(CASE WHEN s.type = 'supplier' THEN -COALESCE(s.ob, 0)
                           WHEN s.type = 'customer' THEN COALESCE(s.ob, 0)
                           WHEN s.side = 'customer' THEN GREATEST(COALESCE(s.ob, 0), 0)
                           ELSE GREATEST(-COALESCE(s.ob, 0), 0) END, 2) AS want,
           round(COALESCE(mv.amt, 0), 2) AS got, snap.old_credit_balance AS old_cb,
           public.ledger_side_advance(s.id, s.side) AS adv
      FROM sides s
      LEFT JOIN mv ON mv.contact_id = s.id AND mv.side = s.side
      LEFT JOIN ledger_credit_balance_snapshot snap ON snap.contact_id = s.id
     WHERE COALESCE(s.ob, 0) <> 0 OR mv.amt IS NOT NULL OR snap.contact_id IS NOT NULL
  )
  SELECT x.id, x.name, x.type, x.side, x.want, x.got, x.old_cb, x.adv,
         CASE WHEN abs(x.want - x.got) > 0.005 THEN 'ledger_differs'
              WHEN x.old_cb IS NOT NULL AND x.side = CASE WHEN x.type = 'supplier' THEN 'supplier' ELSE 'customer' END
                   AND abs(CASE WHEN x.type = 'supplier' THEN x.old_cb ELSE -x.old_cb END - x.adv) > 0.005 THEN 'old_credit_differed'
              ELSE 'ok' END
    FROM x;
END
$fn$;

REVOKE ALL ON FUNCTION public.ledger_refresh_contact(uuid)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_doc_open(text, uuid)                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_doc_paid(text, uuid)                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_side_advance(uuid, text)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_mirror_credit_balance(uuid)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_contact_credit(uuid)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_period_closed(uuid, date)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_gl_post(uuid, uuid, date, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_gl_reverse(uuid, text)                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_voucher_is_contact_money(uuid)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_old_entry_is_contact_money(uuid)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_gl_sync(uuid, uuid, uuid)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_gl_retire_old(uuid)                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_gl_backfill(uuid)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_sync_safe(uuid, uuid, text)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_simulate_as_of(uuid, uuid, text, date, uuid)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_integrity_audit_gl(uuid)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_read_branch(uuid)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_read_product(uuid, text)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_read_shift(uuid)                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_company_object(uuid, boolean)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_admin()                                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_is_system_call()                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_cash_account(text)                             FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.ledger_document_status(text, uuid[], date),
  public.ledger_aging(text, uuid, date),
  public.ledger_contact_documents(uuid, text, uuid, date),
  public.ledger_gl_reconciliation(uuid),
  public.opening_balances_reconciliation()
TO authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.ledger_document_status(text, uuid[], date),
  public.ledger_aging(text, uuid, date),
  public.ledger_contact_documents(uuid, text, uuid, date),
  public.ledger_gl_reconciliation(uuid),
  public.opening_balances_reconciliation()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_gl_backfill(uuid) TO service_role;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('ledger_document_status',          '0057', 'read-only paid/remaining of listed documents, optionally as of a period end; tenant and branch membership'),
  ('ledger_aging',                    '0057', 'read-only aging per side, optionally as of a date; all-branches view for admins'),
  ('ledger_contact_documents',        '0057', 'read-only contact file documents, optionally as of a date; side permission and branch membership'),
  ('ledger_gl_reconciliation',        '0057', 'read-only books vs ledger (tills, 1910, 2150, 1460); company admins'),
  ('opening_balances_reconciliation', '0057', 'read-only opening balances vs ledger vs journal per contact and side; company admins'),
  ('apply_customer_credit',           '0057', 'customer side of the ledger only; writes nothing (FIFO applies advances)'),
  ('apply_supplier_credit',           '0057', 'supplier side of the ledger only; plan bookkeeping'),
  ('settle_contact_invoices_sovereign','0057', 'open amounts from the ledger; money recorded in the receiving branch'),
  ('process_sale_full',               '0057', 'advance check on the customer side of the ledger'),
  ('void_payment_transaction',        '0057', 'every payment transaction; till, fee, mirror invoice payment and plans reversed/recomputed; assert_access'),
  ('current_shift_schedule',          '0057', 'branch guard added (SEC-007)'),
  ('expected_opening_cash',           '0057', 'branch guard added (SEC-007)'),
  ('historical_stock_at',             '0057', 'branch guard added (SEC-007)'),
  ('get_available_quantity',          '0057', 'product/branch guard added (SEC-007)'),
  ('get_product_references_count',    '0057', 'product guard added (SEC-007)'),
  ('restore_product',                 '0057', 'product guard + inventory.update added (SEC-007)'),
  ('shift_cash_sales',                '0057', 'shift branch guard added (SEC-007)'),
  ('shift_payment_breakdown',         '0057', 'shift branch guard added (SEC-007)'),
  ('get_bank_reconciliation_summary', '0057', 'company guard added (SEC-007)'),
  ('get_budget_variance',             '0057', 'company guard added (SEC-007)'),
  ('preview_flexible_distribution',   '0057', 'company admin guard added (SEC-007)'),
  ('detect_anomalies',                '0057', 'admin guard added (SEC-007)'),
  ('generate_alerts',                 '0057', 'admin guard added (SEC-007)'),
  ('detect_orphaned_batches',         '0057', 'admin guard + own company rows only (SEC-007)'),
  ('release_reservation',             '0057', 'own company and branch only (SEC-007)'),
  ('release_reservations_for_draft',  '0057', 'own company and branch only (SEC-007)')
ON CONFLICT (function_name) DO UPDATE SET added_in = EXCLUDED.added_in, note = EXCLUDED.note;

DELETE FROM public.security_rpc_allowlist WHERE function_name IN ('ai_sql', 'ask_me_schema');

DO $check$
DECLARE v_list text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Step 6D: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
  IF has_function_privilege('authenticated', 'public.ai_sql(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Step 6D: ai_sql is still executable';
  END IF;
END
$check$;