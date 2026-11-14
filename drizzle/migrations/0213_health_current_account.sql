-- 0213 — «صحة النظام» for the current account (owner «شيلها كلها / ضيفها» 2026-11-14).
-- Removed from system_integrity_audit (they were about the hidden allocation engine): L1 «له فلوس تحت حسابه وعليه
-- فواتير مفتوحة», L2 «فلوس فرع اتسدد بيها مستند فرع تاني», L4 «نفس الجهة ليها رصيد على الجانبين», L5 «الرصيد المسبق
-- القديم مختلف عن مقدمات الدفتر». Added:
--   G1 (error)  per branch: accounts in the books (1200 − 2100) = Σ the accounts' balances in that branch
--   G2 (error)  the old pools 2150 / 1460 are 0 (nothing posts there since 0212)
--   G3 (error)  an account's total = the sum of its balances in the branches
-- ledger_gl_reconciliation: same tills / 1910 / not-posted checks; «advances» replaced by `accounts` per branch and
-- `pools`; allocations are no longer expected in the books; a return on account has no entry of its own.

CREATE OR REPLACE FUNCTION public.ca_branch_accounts(p_tenant uuid)
 RETURNS TABLE(branch_id uuid, branch_name text, gl_net numeric, ledger_net numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH gl AS (
    SELECT e.branch_id, sum(CASE WHEN a.code = '1200' THEN l.debit - l.credit ELSE 0 END)
                      + sum(CASE WHEN a.code = '2100' THEN l.debit - l.credit ELSE 0 END) AS net
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = p_tenant AND e.status = 'posted' AND a.code IN ('1200', '2100')
     GROUP BY 1
  )
  SELECT b.id, b.name, round(COALESCE(g.net, 0), 2),
         round(COALESCE((SELECT sum(CASE WHEN s.side = 'customer' THEN s.balance ELSE -s.balance END)
                           FROM public.ledger_side_balances(p_tenant, b.id, NULL) s), 0), 2)
    FROM branches b LEFT JOIN gl g ON g.branch_id = b.id
   WHERE b.tenant_id = p_tenant;
$function$;
REVOKE ALL ON FUNCTION public.ca_branch_accounts(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ledger_gl_reconciliation(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; v jsonb; v_cut date := public.ledger_cutoff();
BEGIN
  IF auth.uid() IS NULL THEN
    v_t := p_tenant;
  ELSE
    v_t := public.assert_company_access(NULL);
    IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
      RAISE EXCEPTION 'مطابقة القيود للإدارة فقط' USING ERRCODE = '42501';
    END IF;
    IF p_tenant IS NOT NULL AND public.is_super_admin(auth.uid()) THEN v_t := p_tenant; END IF;
  END IF;
  WITH gl AS (
    SELECT a.code, e.branch_id, sum(l.debit - l.credit) AS bal
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.entry_date >= v_cut
       AND a.code IN ('1100', '1110', '1910')
     GROUP BY 1, 2
  ),
  pools AS (
    SELECT a.code, sum(l.debit - l.credit) AS bal
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = v_t AND e.status = 'posted' AND a.code IN ('2150', '1460')
     GROUP BY 1
  ),
  till AS (
    SELECT tr.branch_id, sum(CASE WHEN tr.type::text = 'income' THEN tr.amount ELSE -tr.amount END) AS bal
      FROM treasury tr
     WHERE tr.tenant_id = v_t AND (COALESCE(tr.transaction_date, public.ledger_day(tr.created_at)) >= v_cut OR tr.category = 'رصيد افتتاحي')
     GROUP BY 1
  ),
  acc AS (SELECT * FROM public.ca_branch_accounts(v_t)),
  branches_cmp AS (
    SELECT b.id, b.name, round(COALESCE(t.bal, 0), 2) AS till,
           round(COALESCE((SELECT sum(g.bal) FROM gl g WHERE g.branch_id = b.id AND g.code IN ('1100', '1110')), 0), 2) AS gl_cash,
           round(COALESCE((SELECT sum(g.bal) FROM gl g WHERE g.branch_id = b.id AND g.code = '1910'), 0), 2) AS gl_1910,
           COALESCE(x.gl_net, 0) AS acc_gl, COALESCE(x.ledger_net, 0) AS acc_ledger
      FROM branches b LEFT JOIN till t ON t.branch_id = b.id LEFT JOIN acc x ON x.branch_id = b.id
     WHERE b.tenant_id = v_t
  )
  SELECT jsonb_build_object(
    'from', v_cut,
    'branches', COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id', id, 'branch', name, 'till', till, 'gl_cash', gl_cash,
                                     'difference', round(till - gl_cash, 2), 'inter_branch_1910', gl_1910,
                                     'accounts_gl', acc_gl, 'accounts_ledger', acc_ledger,
                                     'accounts_difference', round(acc_gl - acc_ledger, 2)) ORDER BY name)
                            FROM branches_cmp WHERE till <> 0 OR gl_cash <> 0 OR gl_1910 <> 0 OR acc_gl <> 0 OR acc_ledger <> 0), '[]'::jsonb),
    'inter_branch_1910_total', round(COALESCE((SELECT sum(bal) FROM gl WHERE code = '1910'), 0), 2),
    'pools', jsonb_build_object(
        '2150', round(COALESCE((SELECT bal FROM pools WHERE code = '2150'), 0), 2),
        '1460', round(COALESCE((SELECT bal FROM pools WHERE code = '1460'), 0), 2)),
    'accounts', jsonb_build_object(
        'gl', COALESCE((SELECT round(sum(acc_gl), 2) FROM branches_cmp), 0),
        'ledger', COALESCE((SELECT round(sum(acc_ledger), 2) FROM branches_cmp), 0)),
    'not_posted', jsonb_build_object(
        'movements', (SELECT count(*) FROM money_movements mm WHERE mm.tenant_id = v_t AND mm.status = 'active'
                        AND mm.kind NOT IN ('opening', 'return_credit')
                        AND NOT EXISTS (SELECT 1 FROM ledger_gl_links l WHERE l.ref_type = 'movement' AND l.ref_id = mm.id AND l.status = 'posted')
                        AND NOT public.ledger_period_closed(v_t, mm.movement_date)),
        'allocations', 0,
        'closed_period_skipped', (SELECT count(*) FROM ledger_gl_skipped s WHERE s.tenant_id = v_t)),
    'old_entries_still_standing', (SELECT count(*) FROM journal_entries je
        WHERE je.tenant_id = v_t AND je.status = 'posted' AND je.reversed_by IS NULL AND je.entry_date >= v_cut - 1
          AND je.source_type IN ('invoice_payment', 'supplier_payment', 'voucher', 'invoice_reversal')
          AND NOT EXISTS (SELECT 1 FROM ledger_gl_links l WHERE l.ref_type = 'retired' AND l.ref_id = je.id)
          AND NOT public.ledger_period_closed(v_t, je.entry_date)
          AND public.ledger_old_entry_is_contact_money(je.id)),
    'retired_old_entries', (SELECT count(*) FROM ledger_gl_links l WHERE l.tenant_id = v_t AND l.ref_type = 'retired')
  ) INTO v;
  RETURN v;
END
$function$;

-- system_integrity_audit: drop L1 / L2 / L4 / L5, add G1–G3 before L6
DO $mig$
DECLARE d text; p1 int; p2 int;
BEGIN
  d := pg_get_functiondef('public.system_integrity_audit'::regproc);
  p1 := position($s$  SELECT 'L1'$s$ in d); p2 := position($s$  SELECT 'L3'$s$ in d);
  IF p1 = 0 OR p2 <= p1 THEN RAISE EXCEPTION '0213: L1..L3 not found'; END IF;
  d := left(d, p1 - 1) || substr(d, p2);
  p1 := position($s$  SELECT 'L4'$s$ in d); p2 := position($s$  SELECT 'L6'$s$ in d);
  IF p1 = 0 OR p2 <= p1 THEN RAISE EXCEPTION '0213: L4..L6 not found'; END IF;
  d := left(d, p1 - 1) || $s$  SELECT 'G1', 'error', 'ledger', 'حسابات العملاء والموردين في القيود مختلفة عن أرصدة الحسابات',
         'الفرع: القيود (عملاء − موردين) ' || x.gl_net || ' / أرصدة الحسابات ' || x.ledger_net,
         NULL::uuid, NULL::text, x.branch_id, x.branch_name, NULL, NULL, NULL, round(x.gl_net - x.ledger_net, 2)
    FROM public.ca_branch_accounts(v_t) x
   WHERE abs(x.gl_net - x.ledger_net) > 1
  UNION ALL
  SELECT 'G2', 'error', 'ledger', 'حساب مقدمات قديم فيه رصيد',
         'حساب ' || a.code || ' المفروض صفر — كل الفلوس بقت على حسابات العملاء والموردين مباشرة',
         NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL, NULL, NULL, round(sum(l.debit - l.credit), 2)
    FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
   WHERE e.tenant_id = v_t AND e.status = 'posted' AND a.code IN ('2150', '1460')
   GROUP BY a.code HAVING abs(sum(l.debit - l.credit)) > 0.005
  UNION ALL
  SELECT 'G3', 'error', 'ledger', 'رصيد الحساب الإجمالي مختلف عن مجموع أرصدته في الفروع',
         'الإجمالي ' || t.bal || ' / مجموع الفروع ' || COALESCE(br.bal, 0),
         t.contact_id, c.name, NULL, NULL, NULL, NULL, NULL, round(t.bal - COALESCE(br.bal, 0), 2)
    FROM (SELECT s.contact_id, sum(CASE WHEN s.side = 'customer' THEN s.balance ELSE -s.balance END) AS bal
            FROM public.ledger_side_balances(v_t, NULL, NULL) s GROUP BY 1) t
    LEFT JOIN (SELECT s.contact_id, sum(CASE WHEN s.side = 'customer' THEN s.balance ELSE -s.balance END) AS bal
                 FROM branches b CROSS JOIN LATERAL public.ledger_side_balances(v_t, b.id, NULL) s
                WHERE b.tenant_id = v_t GROUP BY 1) br ON br.contact_id = t.contact_id
    JOIN contacts c ON c.id = t.contact_id
   WHERE abs(t.bal - COALESCE(br.bal, 0)) > 0.01
  UNION ALL
$s$ || substr(d, p2);
  EXECUTE d;
END
$mig$;

-- the opening screen shows each account's opening branch (and sends it back on «ترحيل»)
DO $mig$
DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.get_opening_balances'::regproc); o := d;
  d := replace(d, $s$jsonb_build_object('contact_id', id, 'amount', opening_balance))$s$,
                  $s$jsonb_build_object('contact_id', id, 'amount', opening_balance, 'branch_id', public.ledger_opening_branch(tenant_id, id)))$s$);
  IF d = o THEN RAISE EXCEPTION '0213: get_opening_balances contacts not found'; END IF;
  EXECUTE d;
END
$mig$;
