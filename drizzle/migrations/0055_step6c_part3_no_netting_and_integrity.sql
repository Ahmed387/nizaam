-- Step 6C (0056) part 3 — no netting in snapshots, retired readers, archive-only contacts, integrity checks.
DO $snap$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.process_sale(uuid, uuid, numeric, numeric, numeric, text, numeric, text, jsonb, jsonb, numeric, numeric, date)'::regprocedure);
  IF position('INTO v_prev_balance FROM public.v_contact_balances' IN v_def) = 0
     OR position('INTO v_curr_balance FROM public.v_contact_balances' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Step 6C: process_sale balance snapshot not found';
  END IF;
  v_def := replace(v_def,
    'SELECT COALESCE(total_balance, 0) INTO v_prev_balance FROM public.v_contact_balances WHERE contact_id = p_customer_id;',
    'v_prev_balance := public.ledger_contact_side_balance(p_customer_id, ''customer'');');
  v_def := replace(v_def,
    'SELECT COALESCE(total_balance, 0) INTO v_curr_balance FROM public.v_contact_balances WHERE contact_id = p_customer_id;',
    'v_curr_balance := v_prev_balance + v_calc_total - COALESCE((SELECT sum(ip.amount) FROM public.invoice_payments ip
       WHERE ip.invoice_id = v_invoice_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
         AND ip.payment_method NOT IN (''credit_balance'', ''credit_applied'', ''settlement'')), 0);');
  EXECUTE v_def;

  v_def := pg_get_functiondef('public.capture_shipment_prev_balance()'::regprocedure);
  IF position('FROM public.v_contact_balances' IN v_def) = 0 THEN RAISE EXCEPTION 'Step 6C: shipment prev snapshot not found'; END IF;
  v_def := replace(v_def, 'SELECT COALESCE(total_balance, 0) INTO NEW.previous_balance
      FROM public.v_contact_balances WHERE contact_id = NEW.contact_id;',
      'NEW.previous_balance := public.ledger_contact_side_balance(NEW.contact_id, ''supplier'');');
  EXECUTE v_def;

  v_def := pg_get_functiondef('public.capture_shipment_curr_balance()'::regprocedure);
  IF position('FROM public.v_contact_balances' IN v_def) = 0 THEN RAISE EXCEPTION 'Step 6C: shipment curr snapshot not found'; END IF;
  v_def := replace(v_def, 'SELECT COALESCE(total_balance, 0) INTO v_curr
      FROM public.v_contact_balances WHERE contact_id = NEW.contact_id;',
      'v_curr := COALESCE(NEW.previous_balance, 0) + CASE WHEN public.ledger_day(COALESCE(NEW.invoice_date, NEW.created_at)) >= public.ledger_cutoff()
                                                       THEN COALESCE(NEW.total_cost, 0) ELSE 0 END;');
  EXECUTE v_def;
END
$snap$;

CREATE OR REPLACE FUNCTION public.supplier_outstanding_payable(_contact_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT GREATEST(COALESCE(public.ledger_contact_side_balance(_contact_id, 'supplier'), 0), 0);
$$;

REVOKE ALL ON public.v_contact_balances FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_supplier_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contact_branch_balances(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.doc_ledger_allocation(text, uuid, uuid[], date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoice_outstanding_debt(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supplier_outstanding_payable(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON VIEW public.v_contact_balances IS
  'Retired in Step 6C (netted customer and supplier sides). Screens read the unified ledger: contacts_page, contact_side_balances, ledger_contact_*.';

CREATE OR REPLACE FUNCTION public.delete_contact(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_ct uuid;
  v_name text;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'أرشفة جهة التعامل للإدارة فقط — مدير الفرع يرسل طلب موافقة' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id, name INTO v_ct, v_name FROM public.contacts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'جهة التعامل غير موجودة' USING ERRCODE = 'P0002'; END IF;
  IF v_ct IS DISTINCT FROM v_tenant AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'غير مصرح: جهة التعامل تخص شركة أخرى' USING ERRCODE = '42501';
  END IF;
  IF abs(COALESCE(public.ledger_contact_side_balance(p_id, 'customer'), 0)) > 0.005
     OR abs(COALESCE(public.ledger_contact_side_balance(p_id, 'supplier'), 0)) > 0.005 THEN
    RAISE EXCEPTION 'مينفعش أرشفة «%» وعليه أو ليه رصيد مفتوح — سوّي الحساب الأول', v_name;
  END IF;
  UPDATE public.contacts SET is_archived = true WHERE id = p_id;
  PERFORM public.log_audit_event('DELETE', 'Contact', p_id::text, NULL,
                                 jsonb_build_object('name', v_name, 'mode', 'archive'));
END
$fn$;

DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.contacts;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

DROP FUNCTION IF EXISTS public.get_branch_wallet_balances(uuid);
CREATE OR REPLACE FUNCTION public.get_branch_wallet_balances(p_branch_id uuid)
RETURNS TABLE (cash_balance numeric, vodafone_balance numeric, instapay_balance numeric, bank_balance numeric,
               other_balance numeric, total_balance numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.assert_access(p_branch_id, NULL);
  RETURN QUERY
  WITH t AS (
    SELECT COALESCE(NULLIF(tr.payment_method, ''), 'cash') AS pm,
           (CASE WHEN tr.type::text = 'income' THEN tr.amount ELSE -tr.amount END) AS signed
      FROM public.treasury tr WHERE tr.branch_id = p_branch_id
  )
  SELECT
    COALESCE(SUM(CASE WHEN pm = 'cash' THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm IN ('vodafone', 'wallet', 'etisalat', 'orange') THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm = 'instapay' THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm IN ('bank', 'bank_transfer') THEN signed ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pm NOT IN ('cash', 'vodafone', 'wallet', 'etisalat', 'orange', 'instapay', 'bank', 'bank_transfer') THEN signed ELSE 0 END), 0),
    COALESCE(SUM(signed), 0)
  FROM t;
END
$fn$;

DO $appr$
DECLARE v_def text;
  v_old text := 'DELETE FROM public.contacts WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;';
BEGIN
  v_def := pg_get_functiondef('public.process_approval_request()'::regprocedure);
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'Step 6C: approval contact delete not found'; END IF;
  EXECUTE replace(v_def, v_old,
    'IF abs(COALESCE(public.ledger_contact_side_balance(NEW.entity_id, ''customer''), 0)) > 0.005
           OR abs(COALESCE(public.ledger_contact_side_balance(NEW.entity_id, ''supplier''), 0)) > 0.005 THEN
          RAISE EXCEPTION ''مينفعش أرشفة جهة عليها أو ليها رصيد مفتوح — سوّي الحساب الأول'';
        END IF;
        UPDATE public.contacts SET is_archived = true WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;');
END
$appr$;

CREATE OR REPLACE FUNCTION public.system_integrity_audit(p_tenant uuid DEFAULT NULL)
RETURNS TABLE (check_code text, severity text, area text, title text, details text,
               contact_id uuid, contact_name text, branch_id uuid, branch_name text,
               doc_type text, doc_id uuid, doc_number text, amount numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
DECLARE v_t uuid; v_cut date := public.ledger_cutoff(); v_today date := public.cairo_today();
BEGIN
  IF auth.uid() IS NULL THEN
    v_t := p_tenant;
  ELSE
    v_t := public.assert_company_access(NULL);
    IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
      RAISE EXCEPTION 'فحص سلامة البيانات للإدارة فقط' USING ERRCODE = '42501';
    END IF;
    IF p_tenant IS NOT NULL AND public.is_super_admin(auth.uid()) THEN v_t := p_tenant; END IF;
  END IF;
  IF v_t IS NULL THEN RAISE EXCEPTION 'حدد الشركة'; END IF;

  RETURN QUERY
  SELECT 'O1', 'error', 'opening', 'رصيد افتتاحي + فواتير تاريخية لنفس الجهة',
         'الجهة ليها رصيد افتتاحي وكمان فواتير مُرحّلة من النظام القديم — الدين محسوب مرتين',
         c.id, c.name, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, round(c.opening_balance, 2)
    FROM contacts c
   WHERE c.tenant_id = v_t AND COALESCE(c.opening_balance, 0) <> 0 AND public.contact_has_legacy_docs(c.id)
  UNION ALL
  SELECT 'O2', 'warning', 'opening', 'رصيد افتتاحي متكرر كإيداع أو دفعة',
         'نفس مبلغ الرصيد الافتتاحي اتسجل تاني كحركة فلوس على نفس الجانب في ' || b.name || ' بتاريخ ' || m.movement_date,
         c.id, c.name, m.branch_id, b.name, NULL, NULL, public.ledger_movement_ref(m.source_table, m.source_id), m.amount
    FROM money_movements o
    JOIN contacts c ON c.id = o.contact_id
    JOIN money_movements m ON m.contact_id = o.contact_id AND m.side = o.side AND m.status = 'active'
                          AND m.kind IN ('payment', 'deposit') AND m.effect = o.effect AND m.amount = o.amount
                          AND m.movement_date <= v_cut + 60
    JOIN branches b ON b.id = m.branch_id
   WHERE o.tenant_id = v_t AND o.kind = 'opening' AND o.status = 'active' AND o.effect = 'settle'
  UNION ALL
  SELECT 'O3', 'warning', 'opening', 'حركة على فرع بديل',
         CASE WHEN m.kind = 'opening' THEN 'مفيش خزنة رئيسية (MAIN-TREASURY) للشركة ولا فرع للجهة، فالرصيد الافتتاحي اتسجل على أقدم فرع'
              ELSE 'إيداع تحت الحساب من غير فرع معروف، اتسجل على الخزنة الرئيسية' END,
         c.id, c.name, m.branch_id, b.name, NULL, NULL, NULL, m.amount
    FROM money_movements m JOIN contacts c ON c.id = m.contact_id JOIN branches b ON b.id = m.branch_id
   WHERE m.tenant_id = v_t AND m.status = 'active'
     AND CASE WHEN m.kind = 'opening' THEN public.ledger_opening_branch_is_fallback(m.tenant_id, m.contact_id)
              ELSE m.notes = 'fallback_branch' END
  UNION ALL
  SELECT 'O4', 'error', 'opening', 'نقدية افتتاحية مختلفة بين القيود والخزنة',
         'القيود: ' || COALESCE(j.amt, 0) || ' — الخزنة: ' || COALESCE(t.amt, 0),
         NULL, NULL, COALESCE(j.branch_id, t.branch_id), b.name, NULL, NULL, NULL,
         round(COALESCE(j.amt, 0) - COALESCE(t.amt, 0), 2)
    FROM (SELECT e.branch_id, sum(l.debit - l.credit) AS amt
            FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
            JOIN chart_of_accounts a ON a.id = l.account_id AND a.code = '1100'
           WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.source_type IN ('opening_balance', 'opening_balance_reversal')
           GROUP BY 1) j
    FULL JOIN (SELECT tr.branch_id, sum(CASE WHEN tr.type::text = 'income' THEN tr.amount ELSE -tr.amount END) AS amt
                 FROM treasury tr WHERE tr.tenant_id = v_t AND tr.category = 'رصيد افتتاحي' GROUP BY 1) t
           ON t.branch_id = j.branch_id
    LEFT JOIN branches b ON b.id = COALESCE(j.branch_id, t.branch_id)
   WHERE abs(COALESCE(j.amt, 0) - COALESCE(t.amt, 0)) > 0.005
  UNION ALL
  SELECT 'O5', 'warning', 'opening', 'مستند قبل 2026 مش متسدد ومش متغطي برصيد افتتاحي',
         'المستند تاريخه قبل بداية الدفتر الموحد ومتبقي عليه ' || round(x.rem, 2) || ' — يتحسب في الرصيد الافتتاحي أو يتقفل',
         x.contact_id, c.name, x.branch_id, b.name, x.t, x.id, x.num, round(x.rem, 2)
    FROM (SELECT i.contact_id, i.branch_id, 'invoice'::text AS t, i.id, i.invoice_number AS num,
                 i.total - COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id
                                       AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL), 0)
                         - COALESCE((SELECT sum(GREATEST(COALESCE(r.total_refund,0)-COALESCE(r.refund_cash_amount,0)-COALESCE(r.refund_transfer_amount,0),0))
                                       FROM returns r WHERE r.invoice_id = i.id AND COALESCE(r.status,'active') NOT IN ('draft','cancelled')), 0) AS rem
            FROM invoices i
           WHERE i.tenant_id = v_t AND i.status = 'active' AND i.contact_id IS NOT NULL
             AND public.ledger_day(i.invoice_date) < v_cut) x
    JOIN contacts c ON c.id = x.contact_id
    JOIN branches b ON b.id = x.branch_id
   WHERE x.rem > 0.005 AND COALESCE(c.opening_balance, 0) = 0 AND NOT public.contact_has_legacy_docs(c.id)
  UNION ALL
  SELECT 'L1', 'error', 'ledger', 'رصيد تحت الحساب ومديونية مفتوحة لنفس الجانب',
         'متبقي ' || s.open_remaining || ' ومقدم ' || s.advance || ' في نفس الوقت (غالباً فترة مقفولة)',
         s.contact_id, c.name, NULL, NULL, s.side, NULL, NULL, LEAST(s.open_remaining, s.advance)
    FROM public.ledger_side_balances(v_t, NULL, NULL) s JOIN contacts c ON c.id = s.contact_id
   WHERE s.open_remaining > 0.005 AND s.advance > 0.005
  UNION ALL
  SELECT 'L2', 'info', 'ledger', 'فلوس فرع اتسدد بيها مستند فرع تاني',
         'من ' || bm.name || ' إلى ' || bd.name || ' (' || x.n || ' توزيع)',
         x.contact_id, c.name, x.movement_branch_id, bm.name, x.side, NULL, NULL, x.amt
    FROM (SELECT pa.contact_id, pa.side, pa.movement_branch_id, pa.debt_branch_id, round(sum(pa.amount), 2) AS amt, count(*) AS n
            FROM payment_allocations pa
           WHERE pa.tenant_id = v_t AND pa.status = 'active' AND pa.is_cross_branch
           GROUP BY 1, 2, 3, 4) x
    JOIN contacts c ON c.id = x.contact_id
    JOIN branches bm ON bm.id = x.movement_branch_id
    JOIN branches bd ON bd.id = x.debt_branch_id
  UNION ALL
  SELECT 'L3', 'warning', 'ledger', 'دفعة محتمل تكون متسجلة مرتين',
         'نفس المبلغ ونفس اليوم لنفس الجهة من مصدرين: ' || public.ledger_movement_ref(m1.source_table, m1.source_id)
           || ' (' || b1.name || ') و ' || public.ledger_movement_ref(m2.source_table, m2.source_id) || ' (' || b2.name || ')',
         m1.contact_id, c.name, m1.branch_id, b1.name, m1.side, NULL, NULL, m1.amount
    FROM money_movements m1
    JOIN money_movements m2 ON m2.contact_id = m1.contact_id AND m2.side = m1.side AND m2.kind = m1.kind
                           AND m2.amount = m1.amount AND m2.movement_date = m1.movement_date
                           AND m2.status = 'active' AND m2.id > m1.id
                           AND (m2.source_table <> m1.source_table OR m2.branch_id <> m1.branch_id)
    JOIN contacts c ON c.id = m1.contact_id
    JOIN branches b1 ON b1.id = m1.branch_id
    JOIN branches b2 ON b2.id = m2.branch_id
   WHERE m1.tenant_id = v_t AND m1.status = 'active' AND m1.kind IN ('payment', 'deposit')
  UNION ALL
  SELECT 'L4', 'info', 'ledger', 'نفس الجهة ليها رصيد على الجانبين',
         'حساب العميل ' || COALESCE(sc.balance, 0) || ' / حساب المورد ' || COALESCE(ss.balance, 0) || ' — كل حساب لوحده',
         c.id, c.name, NULL, NULL, NULL, NULL, NULL, NULL::numeric
    FROM contacts c
    JOIN public.ledger_side_balances(v_t, NULL, NULL) sc ON sc.contact_id = c.id AND sc.side = 'customer'
    JOIN public.ledger_side_balances(v_t, NULL, NULL) ss ON ss.contact_id = c.id AND ss.side = 'supplier'
   WHERE c.tenant_id = v_t AND abs(sc.balance) > 0.005 AND abs(ss.balance) > 0.005
  UNION ALL
  SELECT 'L5', 'warning', 'ledger', 'الرصيد المسبق القديم مختلف عن مقدمات الدفتر',
         'contacts.credit_balance = ' || COALESCE(-c.credit_balance, 0) || ' / مقدم العميل في الدفتر = ' || COALESCE(s.advance, 0),
         c.id, c.name, NULL, NULL, 'customer', NULL, NULL, round(COALESCE(-c.credit_balance, 0) - COALESCE(s.advance, 0), 2)
    FROM contacts c
    LEFT JOIN public.ledger_side_balances(v_t, NULL, NULL) s ON s.contact_id = c.id AND s.side = 'customer'
   WHERE c.tenant_id = v_t AND abs(COALESCE(-c.credit_balance, 0) - COALESCE(s.advance, 0)) > 0.005
     AND (COALESCE(c.credit_balance, 0) <> 0 OR COALESCE(s.advance, 0) <> 0)
  UNION ALL
  SELECT 'L6', 'error', 'ledger', 'خطأ في مزامنة الدفتر', e.context || ': ' || e.error,
         e.contact_id, c.name, NULL, NULL, CASE WHEN e.invoice_id IS NOT NULL THEN 'invoice' END, e.invoice_id, NULL, NULL
    FROM ledger_sync_errors e LEFT JOIN contacts c ON c.id = e.contact_id
   WHERE e.tenant_id = v_t AND e.created_at > now() - interval '30 days'
  UNION ALL
  SELECT 'D1', 'error', 'documents', 'إجمالي فاتورة بيع مش مطابق لبنودها',
         'البنود ' || x.items || ' / الإجمالي قبل الخصم ' || i.subtotal || ' / الصافي المحسوب ' || round(i.subtotal - COALESCE(i.discount_amount,0) + COALESCE(i.vat_amount,0), 2) || ' / الإجمالي ' || i.total,
         i.contact_id, c.name, i.branch_id, b.name, 'invoice', i.id, i.invoice_number,
         round(i.total - (i.subtotal - COALESCE(i.discount_amount,0) + COALESCE(i.vat_amount,0)), 2)
    FROM invoices i
    JOIN branches b ON b.id = i.branch_id
    LEFT JOIN contacts c ON c.id = i.contact_id
    JOIN LATERAL (SELECT round(sum(ii.total), 2) AS items, count(*) AS n FROM invoice_items ii WHERE ii.invoice_id = i.id) x ON x.n > 0
   WHERE i.tenant_id = v_t AND i.status = 'active' AND NOT COALESCE(i.is_migrated, false)
     AND (abs(x.items - i.subtotal) > 0.05 OR abs(i.total - (i.subtotal - COALESCE(i.discount_amount,0) + COALESCE(i.vat_amount,0))) > 0.05)
  UNION ALL
  SELECT 'D2', 'error', 'documents', 'فاتورة ملغاة عليها فلوس مش متردة ولا متحولة رصيد',
         'مدفوع ' || x.paid || ' / مردود ' || COALESCE(i.refund_amount, 0) || ' / متحول رصيد ' || x.credit,
         i.contact_id, c.name, i.branch_id, b.name, 'invoice', i.id, i.invoice_number,
         round(x.paid - COALESCE(i.refund_amount, 0) - x.credit, 2)
    FROM invoices i
    JOIN branches b ON b.id = i.branch_id
    LEFT JOIN contacts c ON c.id = i.contact_id
    JOIN LATERAL (SELECT COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id AND ip.voided_at IS NULL
                                     AND ip.reverses_payment_id IS NULL AND ip.payment_method NOT IN ('credit_balance','credit_applied','settlement')), 0) AS paid,
                         COALESCE((SELECT sum(l.amount) FROM customer_credit_log l WHERE l.invoice_id = i.id AND l.type = 'credit_added'), 0) AS credit) x ON true
   WHERE i.tenant_id = v_t AND i.status = 'cancelled'
     AND x.paid - COALESCE(i.refund_amount, 0) - x.credit > 0.05
  UNION ALL
  SELECT 'D3', 'error', 'documents', 'مرتجع بيع أكبر من الكمية المباعة',
         'الصنف مرتجع منه ' || x.ret || ' والمباع ' || x.sold,
         i.contact_id, c.name, i.branch_id, b.name, 'invoice', i.id, i.invoice_number, x.ret - x.sold
    FROM (SELECT r.invoice_id, ri.product_id, sum(ri.quantity) AS ret,
                 COALESCE((SELECT sum(ii.quantity) FROM invoice_items ii WHERE ii.invoice_id = r.invoice_id AND ii.product_id = ri.product_id), 0) AS sold
            FROM returns r JOIN return_items ri ON ri.return_id = r.id
           WHERE r.tenant_id = v_t AND COALESCE(r.status, 'active') NOT IN ('draft', 'cancelled')
           GROUP BY 1, 2) x
    JOIN invoices i ON i.id = x.invoice_id
    JOIN branches b ON b.id = i.branch_id
    LEFT JOIN contacts c ON c.id = i.contact_id
   WHERE x.ret > x.sold
  UNION ALL
  SELECT 'D4', 'error', 'documents', 'مرتجع شراء أكبر من الكمية المشتراة',
         'الصنف مرتجع منه ' || x.ret || ' والمشترى ' || x.bought,
         s.contact_id, c.name, s.branch_id, b.name, 'shipment', s.id, s.shipment_number, x.ret - x.bought
    FROM (SELECT pr.shipment_id, pri.product_id, sum(pri.quantity) AS ret,
                 COALESCE((SELECT sum(si.quantity) FROM shipment_items si WHERE si.shipment_id = pr.shipment_id AND si.product_id = pri.product_id), 0) AS bought
            FROM purchase_returns pr JOIN purchase_return_items pri ON pri.purchase_return_id = pr.id
           WHERE pr.tenant_id = v_t AND pr.status = 'active' AND pr.shipment_id IS NOT NULL
           GROUP BY 1, 2) x
    JOIN shipments s ON s.id = x.shipment_id
    JOIN branches b ON b.id = s.branch_id
    LEFT JOIN contacts c ON c.id = s.contact_id
   WHERE x.ret > x.bought
  UNION ALL
  SELECT 'D5', 'error', 'documents', 'مرتجع ساري على مستند ملغي',
         'المرتجع ' || COALESCE(r.return_number, '') || ' ساري والفاتورة ملغاة',
         i.contact_id, c.name, r.branch_id, b.name, 'invoice', i.id, i.invoice_number, r.total_refund
    FROM returns r JOIN invoices i ON i.id = r.invoice_id
    LEFT JOIN branches b ON b.id = r.branch_id
    LEFT JOIN contacts c ON c.id = i.contact_id
   WHERE r.tenant_id = v_t AND COALESCE(r.status, 'active') NOT IN ('draft', 'cancelled') AND i.status <> 'active'
  UNION ALL
  SELECT 'D5', 'error', 'documents', 'مرتجع شراء ساري على فاتورة شراء ملغاة',
         'المرتجع ' || COALESCE(pr.return_number, '') || ' ساري وفاتورة الشراء ملغاة',
         s.contact_id, c.name, pr.branch_id, b.name, 'shipment', s.id, s.shipment_number, pr.total_amount
    FROM purchase_returns pr JOIN shipments s ON s.id = pr.shipment_id
    LEFT JOIN branches b ON b.id = pr.branch_id
    LEFT JOIN contacts c ON c.id = s.contact_id
   WHERE pr.tenant_id = v_t AND pr.status = 'active' AND s.status <> 'active'
  UNION ALL
  SELECT 'D6', 'warning', 'documents', 'إجمالي مرتجع بيع مش مطابق لبنوده أو لطريقة الرد',
         'البنود ' || COALESCE(x.items, 0) || ' / الإجمالي ' || r.total_refund || ' / نقدي+تحويل+رصيد ' ||
           (COALESCE(r.refund_cash_amount,0) + COALESCE(r.refund_transfer_amount,0) + COALESCE(r.refund_balance_amount,0)),
         i.contact_id, c.name, r.branch_id, b.name, 'sale_return', r.id, r.return_number, r.total_refund
    FROM returns r JOIN invoices i ON i.id = r.invoice_id
    LEFT JOIN branches b ON b.id = r.branch_id
    LEFT JOIN contacts c ON c.id = i.contact_id
    LEFT JOIN LATERAL (SELECT round(sum(ri.refund), 2) AS items, count(*) AS n FROM return_items ri WHERE ri.return_id = r.id) x ON true
   WHERE r.tenant_id = v_t AND COALESCE(r.status, 'active') NOT IN ('draft', 'cancelled') AND r.migration_batch_id IS NULL
     AND ((x.n > 0 AND abs(x.items - r.total_refund) > 0.05)
       OR (COALESCE(r.refund_cash_amount,0) + COALESCE(r.refund_transfer_amount,0) + COALESCE(r.refund_balance_amount,0) > 0.005
           AND abs(COALESCE(r.refund_cash_amount,0) + COALESCE(r.refund_transfer_amount,0) + COALESCE(r.refund_balance_amount,0) - r.total_refund) > 0.05))
  UNION ALL
  SELECT 'D6', 'warning', 'documents', 'إجمالي مرتجع شراء مش مطابق لبنوده أو لطريقة الرد',
         'البنود ' || COALESCE(x.items, 0) || ' / الإجمالي ' || pr.total_amount || ' / نقدي+تحويل+خصم ' ||
           (COALESCE(pr.refund_cash_amount,0) + COALESCE(pr.refund_transfer_amount,0) + COALESCE(pr.refund_balance_amount,0)),
         pr.contact_id, c.name, pr.branch_id, b.name, 'purchase_return', pr.id, pr.return_number, pr.total_amount
    FROM purchase_returns pr
    LEFT JOIN branches b ON b.id = pr.branch_id
    LEFT JOIN contacts c ON c.id = pr.contact_id
    LEFT JOIN LATERAL (SELECT round(sum(pri.total), 2) AS items, count(*) AS n FROM purchase_return_items pri WHERE pri.purchase_return_id = pr.id) x ON true
   WHERE pr.tenant_id = v_t AND pr.status = 'active' AND pr.migration_batch_id IS NULL
     AND ((x.n > 0 AND abs(x.items - pr.total_amount) > 0.05)
       OR (COALESCE(pr.refund_cash_amount,0) + COALESCE(pr.refund_transfer_amount,0) + COALESCE(pr.refund_balance_amount,0) > 0.005
           AND abs(COALESCE(pr.refund_cash_amount,0) + COALESCE(pr.refund_transfer_amount,0) + COALESCE(pr.refund_balance_amount,0) - pr.total_amount) > 0.05))
  UNION ALL
  SELECT 'T1', 'error', 'treasury', 'سند والخزنة مش متطابقين',
         CASE WHEN t.id IS NULL THEN 'السند ملوش حركة خزنة' ELSE 'السند ' || v.amount || ' / الخزنة ' || t.amount END,
         v.party_id, v.party_name, v.branch_id, b.name, 'voucher', v.id, v.voucher_number, v.amount
    FROM vouchers v
    JOIN branches b ON b.id = v.branch_id
    LEFT JOIN treasury t ON t.id = v.treasury_id
   WHERE v.tenant_id = v_t AND v.status::text = 'active' AND v.amount > 0
     AND (v.treasury_id IS NULL AND COALESCE(v.payment_method, 'cash') NOT IN ('credit_balance', 'balance')
          OR (t.id IS NOT NULL AND (abs(t.amount - v.amount) > 0.005 OR t.branch_id <> v.branch_id
              OR (t.type::text = 'income') <> (v.type::text = 'receipt'))))
  UNION ALL
  SELECT 'T2', 'error', 'treasury', 'سند ملغي وحركته لسه في الخزنة',
         'السند اتلغى ومفيش حركة عكسية ليه في الخزنة',
         v.party_id, v.party_name, v.branch_id, b.name, 'voucher', v.id, v.voucher_number, v.amount
    FROM vouchers v
    JOIN branches b ON b.id = v.branch_id
   WHERE v.tenant_id = v_t AND v.status::text = 'cancelled' AND v.treasury_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM treasury t WHERE t.id = v.treasury_id)
     AND NOT EXISTS (SELECT 1 FROM treasury x WHERE x.tenant_id = v_t AND x.reference_id = v.id AND x.id <> v.treasury_id)
     AND NOT EXISTS (SELECT 1 FROM treasury x WHERE x.tenant_id = v_t AND x.category = 'إلغاء سند' AND x.reference_id IN (v.id, v.treasury_id))
  UNION ALL
  SELECT 'T3', 'info', 'treasury', 'رصيد خزنة الفرع مختلف عن حسابات النقدية للفرع في القيود',
         'الخزنة ' || round(t.bal, 2) || ' / القيود (11xx) ' || round(COALESCE(g.bal, 0), 2)
           || ' — غالباً فلوس اتحصلت في فرع على فاتورة فرع تاني؛ بيتظبط مع قيود الحساب الجاري 1910 (المرحلة 5)',
         NULL, NULL, t.branch_id, b.name, NULL, NULL, NULL, round(t.bal - COALESCE(g.bal, 0), 2)
    FROM (SELECT tr.branch_id, sum(CASE WHEN tr.type::text = 'income' THEN tr.amount ELSE -tr.amount END) AS bal
            FROM treasury tr WHERE tr.tenant_id = v_t GROUP BY 1) t
    JOIN branches b ON b.id = t.branch_id
    LEFT JOIN (SELECT e.branch_id, sum(l.debit - l.credit) AS bal
                 FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
                 JOIN chart_of_accounts a ON a.id = l.account_id AND a.code LIKE '11%'
                WHERE e.tenant_id = v_t AND e.status = 'posted' GROUP BY 1) g ON g.branch_id = t.branch_id
   WHERE abs(t.bal - COALESCE(g.bal, 0)) > 0.05
  UNION ALL
  SELECT 'T3C', 'warning', 'treasury', 'إجمالي الخزائن مختلف عن إجمالي حسابات النقدية في القيود',
         'الخزائن ' || round(t.bal, 2) || ' / القيود (11xx) ' || round(COALESCE(g.bal, 0), 2),
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, round(t.bal - COALESCE(g.bal, 0), 2)
    FROM (SELECT sum(CASE WHEN tr.type::text = 'income' THEN tr.amount ELSE -tr.amount END) AS bal
            FROM treasury tr WHERE tr.tenant_id = v_t) t
    CROSS JOIN (SELECT sum(l.debit - l.credit) AS bal
                  FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
                  JOIN chart_of_accounts a ON a.id = l.account_id AND a.code LIKE '11%'
                 WHERE e.tenant_id = v_t AND e.status = 'posted') g
   WHERE abs(COALESCE(t.bal, 0) - COALESCE(g.bal, 0)) > 0.05
  UNION ALL
  SELECT 'T4', CASE WHEN tt.acknowledged_at IS NOT NULL THEN 'error' ELSE 'warning' END, 'treasury',
         CASE WHEN tt.acknowledged_at IS NOT NULL THEN 'تحويل خزنة متأكد ومش متضاف للفرع المستلم' ELSE 'تحويل خزنة معلق' END,
         'من ' || bf.name || ' إلى ' || bt.name || ' بتاريخ ' || public.ledger_day(tt.created_at),
         NULL, NULL, tt.from_branch_id, bf.name, 'treasury_transfer', tt.id, tt.reference_number, tt.amount
    FROM treasury_transfers tt
    JOIN branches bf ON bf.id = tt.from_branch_id
    JOIN branches bt ON bt.id = tt.to_branch_id
   WHERE tt.tenant_id = v_t AND tt.rejected_at IS NULL
     AND ((tt.acknowledged_at IS NULL AND tt.created_at < now() - interval '3 days')
       OR (tt.acknowledged_at IS NOT NULL AND tt.dest_credited_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM treasury x WHERE x.reference_id = tt.id AND x.branch_id = tt.to_branch_id AND x.type::text = 'income')))
  UNION ALL
  SELECT 'S1', 'warning', 'stock', 'كمية الصنف مختلفة عن مجموع دفعاته',
         p.name || ': الكمية ' || p.quantity || ' / الدفعات ' || x.rem,
         NULL, NULL, p.branch_id, b.name, 'product', p.id, p.sku, round(p.quantity - x.rem, 2)
    FROM products p
    JOIN branches b ON b.id = p.branch_id
    JOIN LATERAL (SELECT COALESCE(sum(pb.quantity_remaining), 0) AS rem, count(*) AS n FROM product_batches pb WHERE pb.product_id = p.id) x ON x.n > 0
   WHERE p.tenant_id = v_t AND p.archived_at IS NULL AND abs(p.quantity - x.rem) > 0.005
  UNION ALL
  SELECT 'S2', 'error', 'stock', 'رصيد صنف بالسالب', p.name || ': ' || p.quantity,
         NULL, NULL, p.branch_id, b.name, 'product', p.id, p.sku, p.quantity
    FROM products p JOIN branches b ON b.id = p.branch_id
   WHERE p.tenant_id = v_t AND p.quantity < 0
  UNION ALL
  SELECT 'S3', 'warning', 'stock', 'سجل حركة الصنف مختلف عن رصيده',
         p.name || ': آخر رصيد في السجل ' || x.bal || ' / الرصيد الحالي ' || p.quantity,
         NULL, NULL, p.branch_id, b.name, 'product', p.id, p.sku, p.quantity - x.bal
    FROM products p
    JOIN branches b ON b.id = p.branch_id
    JOIN LATERAL (SELECT sm.balance_after AS bal FROM stock_movements sm WHERE sm.product_id = p.id
                   ORDER BY sm.created_at DESC, sm.id DESC LIMIT 1) x ON true
   WHERE p.tenant_id = v_t AND p.archived_at IS NULL AND x.bal IS NOT NULL AND x.bal <> p.quantity
  UNION ALL
  SELECT 'S4', CASE WHEN COALESCE(st.received_quantity, 0) > st.quantity THEN 'error' ELSE 'warning' END, 'stock',
         CASE WHEN COALESCE(st.received_quantity, 0) > st.quantity THEN 'تحويل مخزني: المستلم أكبر من المرسل' ELSE 'تحويل مخزني معلق' END,
         'من ' || bf.name || ' إلى ' || bt.name || ' — مرسل ' || st.quantity || ' / مستلم ' || COALESCE(st.received_quantity::text, '—'),
         NULL, NULL, st.from_branch_id, bf.name, 'stock_transfer', st.id, NULL, st.quantity
    FROM stock_transfers st
    JOIN branches bf ON bf.id = st.from_branch_id
    JOIN branches bt ON bt.id = st.to_branch_id
   WHERE st.tenant_id = v_t
     AND (COALESCE(st.received_quantity, 0) > st.quantity
       OR (st.status::text = 'pending' AND st.created_at < now() - interval '3 days'))
  UNION ALL
  SELECT 'S5', 'error', 'stock', 'فاتورة شراء ملغاة ودفعاتها لسه في المخزن',
         'متبقي في الدفعات ' || x.rem,
         s.contact_id, c.name, s.branch_id, b.name, 'shipment', s.id, s.shipment_number, x.rem
    FROM shipments s
    JOIN branches b ON b.id = s.branch_id
    LEFT JOIN contacts c ON c.id = s.contact_id
    JOIN LATERAL (SELECT COALESCE(sum(pb.quantity_remaining), 0) AS rem FROM product_batches pb WHERE pb.shipment_id = s.id) x ON x.rem > 0
   WHERE s.tenant_id = v_t AND s.status = 'cancelled'
  UNION ALL
  SELECT 'J1', 'warning', 'journal', 'مستند من غير قيد يومية', 'مفيش قيد مرحّل للمستند',
         x.contact_id, c.name, x.branch_id, b.name, x.t, x.id, x.num, x.amt
    FROM (SELECT i.contact_id, i.branch_id, 'invoice'::text AS t, i.id, i.invoice_number AS num, i.total AS amt, 'invoice'::text AS st
            FROM invoices i WHERE i.tenant_id = v_t AND i.status = 'active' AND i.total > 0 AND NOT COALESCE(i.is_migrated, false)
          UNION ALL
          SELECT s.contact_id, s.branch_id, 'shipment', s.id, s.shipment_number, s.total_cost, 'shipment'
            FROM shipments s WHERE s.tenant_id = v_t AND s.status = 'active' AND s.total_cost > 0 AND NOT COALESCE(s.is_migrated, false)) x
    JOIN branches b ON b.id = x.branch_id
    LEFT JOIN contacts c ON c.id = x.contact_id
   WHERE NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.tenant_id = v_t AND e.source_type = x.st AND e.source_id = x.id AND e.status = 'posted')
  UNION ALL
  SELECT 'J2', 'error', 'journal', 'مستند ملغي وقيده لسه قايم', 'القيد ما اتعكسش بعد الإلغاء',
         x.contact_id, c.name, x.branch_id, b.name, x.t, x.id, x.num, x.amt
    FROM (SELECT i.contact_id, i.branch_id, 'invoice'::text AS t, i.id, i.invoice_number AS num, i.total AS amt, 'invoice'::text AS st
            FROM invoices i WHERE i.tenant_id = v_t AND i.status = 'cancelled'
          UNION ALL
          SELECT s.contact_id, s.branch_id, 'shipment', s.id, s.shipment_number, s.total_cost, 'shipment'
            FROM shipments s WHERE s.tenant_id = v_t AND s.status = 'cancelled'
          UNION ALL
          SELECT v.party_id, v.branch_id, 'voucher', v.id, v.voucher_number, v.amount, 'voucher'
            FROM vouchers v WHERE v.tenant_id = v_t AND v.status::text = 'cancelled') x
    JOIN branches b ON b.id = x.branch_id
    LEFT JOIN contacts c ON c.id = x.contact_id
   WHERE EXISTS (SELECT 1 FROM journal_entries e WHERE e.tenant_id = v_t AND e.source_type = x.st AND e.source_id = x.id
                    AND e.status = 'posted' AND e.reversed_by IS NULL)
     AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.tenant_id = v_t AND e.source_type = x.st || '_reversal' AND e.source_id = x.id
                    AND e.status = 'posted');
END
$fn$;

CREATE OR REPLACE FUNCTION public.system_integrity_audit_json(p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.severity, a.check_code), '[]'::jsonb) FROM public.system_integrity_audit(p_tenant) a
$$;

CREATE OR REPLACE FUNCTION public.system_integrity_summary(p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'checked_at', now(),
    'errors', count(*) FILTER (WHERE severity = 'error'),
    'warnings', count(*) FILTER (WHERE severity = 'warning'),
    'info', count(*) FILTER (WHERE severity = 'info'),
    'by_check', COALESCE((SELECT jsonb_object_agg(k, n) FROM (
        SELECT a.check_code AS k, count(*) AS n FROM public.system_integrity_audit(p_tenant) a GROUP BY 1) z), '{}'::jsonb))
  FROM public.system_integrity_audit(p_tenant)
$$;

REVOKE ALL ON FUNCTION public.get_branch_wallet_balances(uuid), public.system_integrity_audit(uuid),
  public.system_integrity_audit_json(uuid), public.system_integrity_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_wallet_balances(uuid), public.system_integrity_audit(uuid),
  public.system_integrity_audit_json(uuid), public.system_integrity_summary(uuid) TO authenticated, service_role;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('get_branch_wallet_balances','0056', 'read-only till balance; branch membership (assert_access)'),
  ('system_integrity_audit',    '0056', 'read-only integrity checks; company admins and super admin'),
  ('system_integrity_summary',  '0056', 'read-only integrity counts; company admins and super admin'),
  ('system_integrity_audit_json','0056', 'read-only integrity checks as one json value; company admins and super admin')
ON CONFLICT (function_name) DO UPDATE SET added_in = EXCLUDED.added_in, note = EXCLUDED.note;

DELETE FROM public.security_rpc_allowlist
 WHERE function_name IN ('contact_branch_balances', 'doc_ledger_allocation', 'invoice_outstanding_debt', 'supplier_outstanding_payable');

DO $bf$
DECLARE v jsonb;
BEGIN
  v := public.ledger_backfill(NULL);
  RAISE NOTICE 'Step 6C re-sync: %', v;
END
$bf$;

DO $check$
DECLARE v_list text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Step 6C: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
END
$check$;