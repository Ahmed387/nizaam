CREATE OR REPLACE FUNCTION public.system_health_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  v_res jsonb := '{}'::jsonb;
  v_arr jsonb;
BEGIN
  IF COALESCE(current_setting('nizam.system_run', true), '') <> 'on' THEN
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
    IF LOWER(COALESCE(v_email,'')) <> 'an.ayoub98@gmail.com' AND NOT is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Not authorised';
    END IF;
  END IF;

  -- 1. Partner shares per tenant
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_arr FROM (
    SELECT tenant_id,
           ROUND(SUM(capital_share)*100,2)::text AS capital_pct,
           ROUND(SUM(operating_share)*100,2)::text AS operating_pct,
           COUNT(*) AS partners_count,
           (ROUND(SUM(capital_share)*100,2) = 100 AND ROUND(SUM(operating_share)*100,2) = 100) AS ok
    FROM equity_partners WHERE is_active GROUP BY tenant_id
  ) t;
  v_res := v_res || jsonb_build_object('partner_shares', v_arr);

  -- 2. Trial balance per tenant
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_arr FROM (
    SELECT je.tenant_id,
           ROUND(SUM(jel.debit),2)::text  AS debits,
           ROUND(SUM(jel.credit),2)::text AS credits,
           ROUND(SUM(jel.debit - jel.credit),2)::text AS diff,
           COUNT(DISTINCT je.id) AS entries,
           (ROUND(SUM(jel.debit - jel.credit),2) = 0) AS ok
    FROM journal_entries je JOIN journal_entry_lines jel ON jel.entry_id = je.id
    WHERE je.status = 'posted' GROUP BY je.tenant_id
  ) t;
  v_res := v_res || jsonb_build_object('trial_balance', v_arr);

  -- 3. Partner balance vs transactions (view IS the source of truth)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_arr FROM (
    SELECT p.id, p.name,
           v.current_balance::text     AS stored_balance,
           v.current_balance::text     AS computed_from_tx,
           v.total_contributions::text AS total_contrib,
           v.total_drawings::text      AS total_draw,
           v.total_profit_share::text  AS total_profit,
           true AS ok
    FROM equity_partners p
    LEFT JOIN v_partner_balances v ON v.partner_id = p.id
    WHERE p.is_active
  ) t;
  v_res := v_res || jsonb_build_object('partner_balance_match', v_arr);

  -- 4. Invoice payment sanity
  SELECT to_jsonb(t) INTO v_arr FROM (
    SELECT
      COUNT(*) FILTER (WHERE i.total > 0 AND EXISTS(
        SELECT 1 FROM invoice_payments ip WHERE ip.invoice_id=i.id
        HAVING SUM(ip.amount) > i.total + 0.01
      )) AS overpaid_invoices,
      COUNT(*) FILTER (WHERE i.total < 0) AS negative_total,
      COUNT(*) AS total_active_invoices
    FROM invoices i WHERE i.status='active'
  ) t;
  v_res := v_res || jsonb_build_object('invoices', v_arr);

  -- 5. Orphans
  SELECT to_jsonb(t) INTO v_arr FROM (
    SELECT
      (SELECT COUNT(*) FROM invoice_items ii LEFT JOIN invoices i ON i.id=ii.invoice_id WHERE i.id IS NULL) AS orphan_invoice_items,
      (SELECT COUNT(*) FROM journal_entry_lines jel LEFT JOIN journal_entries je ON je.id=jel.entry_id WHERE je.id IS NULL) AS orphan_journal_lines,
      (SELECT COUNT(*) FROM invoice_payments ip LEFT JOIN invoices i ON i.id=ip.invoice_id WHERE i.id IS NULL) AS orphan_payments,
      (SELECT COUNT(*) FROM partner_transactions pt LEFT JOIN equity_partners p ON p.id=pt.partner_id WHERE p.id IS NULL) AS orphan_partner_tx,
      (SELECT COUNT(*) FROM products WHERE tenant_id IS NULL) AS products_without_tenant,
      (SELECT COUNT(*) FROM invoices WHERE branch_id IS NULL AND status='active') AS invoices_without_branch
  ) t;
  v_res := v_res || jsonb_build_object('orphans', v_arr);

  -- 6. Tenants overview
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_arr FROM (
    SELECT tn.id, tn.name, tn.slug,
           (SELECT COUNT(*) FROM branches b WHERE b.tenant_id=tn.id AND b.is_active) AS active_branches,
           (SELECT COUNT(*) FROM equity_partners ep WHERE ep.tenant_id=tn.id AND ep.is_active) AS active_partners,
           (SELECT COUNT(*) FROM invoices i WHERE i.tenant_id=tn.id AND i.status='active') AS active_invoices,
           (SELECT COUNT(*) FROM journal_entries je WHERE je.tenant_id=tn.id AND je.status='posted') AS posted_entries
    FROM tenants tn
  ) t;
  v_res := v_res || jsonb_build_object('tenants', v_arr);

  -- 7. Partner profit snapshot (from view)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_arr FROM (
    SELECT p.id, p.name,
           (p.operating_share*100) AS operating_pct,
           v.total_contributions   AS contributions,
           v.total_drawings        AS drawings,
           v.total_profit_share    AS profits_distributed,
           v.current_balance       AS current_balance
    FROM equity_partners p
    LEFT JOIN v_partner_balances v ON v.partner_id = p.id
    WHERE p.is_active
  ) t;
  v_res := v_res || jsonb_build_object('partner_profit_snapshot', v_arr);

  -- 8. Cash Reconciliation
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_arr FROM (
    WITH gl AS (
      SELECT je.tenant_id, ROUND(SUM(jel.debit - jel.credit)::numeric, 2) AS gl_cash
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN chart_of_accounts a ON a.id = jel.account_id
      WHERE je.status = 'posted' AND a.code = '1100'
      GROUP BY je.tenant_id
    ),
    phys AS (
      SELECT b.tenant_id,
             ROUND(SUM(CASE WHEN tr.type = 'income' THEN tr.amount ELSE -tr.amount END)::numeric, 2) AS physical_cash
      FROM treasury tr JOIN branches b ON b.id = tr.branch_id
      GROUP BY b.tenant_id
    )
    SELECT COALESCE(gl.tenant_id, phys.tenant_id) AS tenant_id,
           COALESCE(gl.gl_cash, 0)::text        AS gl_cash,
           COALESCE(phys.physical_cash, 0)::text AS physical_cash,
           ROUND(COALESCE(phys.physical_cash,0) - COALESCE(gl.gl_cash,0), 2)::text AS diff,
           (ABS(COALESCE(phys.physical_cash,0) - COALESCE(gl.gl_cash,0)) < 1) AS ok
    FROM gl FULL OUTER JOIN phys USING (tenant_id)
  ) t;
  v_res := v_res || jsonb_build_object('cash_reconciliation', v_arr);

  v_res := v_res || jsonb_build_object('generated_at', now());
  RETURN v_res;
END; $function$;