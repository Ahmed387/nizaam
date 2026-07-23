
-- 1) Drop cache-maintenance triggers & functions
DROP TRIGGER IF EXISTS trg_partner_tx_balance ON public.partner_transactions;
DROP TRIGGER IF EXISTS trg_sync_partner_balance ON public.partner_transactions;
DROP FUNCTION IF EXISTS public.sync_partner_balance() CASCADE;
DROP FUNCTION IF EXISTS public.recompute_partner_balance(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.recompute_all_partner_balances(uuid) CASCADE;

-- 2) Ensure v_partner_balances is the sole source of truth and readable by clients
DROP VIEW IF EXISTS public.v_partner_balances CASCADE;
CREATE VIEW public.v_partner_balances
WITH (security_invoker = true)
AS
SELECT
  ep.id  AS partner_id,
  ep.tenant_id,
  COALESCE(SUM(CASE WHEN pt.transaction_type = 'contribution'      AND NOT COALESCE(pt.is_void,false) THEN pt.amount ELSE 0 END), 0) AS total_contributions,
  COALESCE(SUM(CASE WHEN pt.transaction_type = 'drawing'           AND NOT COALESCE(pt.is_void,false) THEN pt.amount ELSE 0 END), 0) AS total_drawings,
  COALESCE(SUM(CASE WHEN pt.transaction_type = 'profit_share'      AND NOT COALESCE(pt.is_void,false) THEN pt.amount ELSE 0 END), 0) AS total_profit_share,
  COALESCE(SUM(CASE
        WHEN COALESCE(pt.is_void,false) THEN 0
        WHEN pt.transaction_type = 'drawing' THEN -pt.amount
        ELSE pt.amount
      END), 0) AS current_balance
FROM public.equity_partners ep
LEFT JOIN public.partner_transactions pt ON pt.partner_id = ep.id
GROUP BY ep.id, ep.tenant_id;

GRANT SELECT ON public.v_partner_balances TO authenticated;
GRANT SELECT ON public.v_partner_balances TO anon;

-- 3) Rewrite RPCs to stop referencing cached columns

-- distribute_profits: drop the counter update on equity_partners
CREATE OR REPLACE FUNCTION public.distribute_profits(
  p_tenant_id uuid, p_fiscal_period_id uuid, p_total_amount numeric,
  p_distribution_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_dist_id UUID; v_entry_id UUID; v_entry_number TEXT;
  v_retained UUID; v_payable UUID; v_advance_asset UUID;
  v_total_share NUMERIC := 0; v_line_order INT := 0;
  v_ptx_id UUID; v_month_year TEXT;
  v_gross NUMERIC; v_offset NUMERIC; v_net_payable NUMERIC;
  v_adv_remaining NUMERIC;
  r RECORD; a RECORD;
BEGIN
  IF p_total_amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;
  SELECT COALESCE(SUM(capital_share),0) INTO v_total_share
  FROM public.equity_partners WHERE tenant_id=p_tenant_id AND is_active=true;
  IF v_total_share <= 0 THEN RAISE EXCEPTION 'لا يوجد شركاء نشطين'; END IF;

  SELECT id INTO v_retained FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='3800' LIMIT 1;
  SELECT id INTO v_payable  FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='3850' LIMIT 1;
  SELECT id INTO v_advance_asset FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='1400' LIMIT 1;
  IF v_retained IS NULL OR v_payable IS NULL THEN RAISE EXCEPTION 'حسابات التوزيع (3800/3850) غير موجودة'; END IF;

  v_month_year := to_char(p_distribution_date,'YYYY-MM');

  INSERT INTO public.profit_distributions (tenant_id, fiscal_period_id, distribution_date, total_amount, status, notes, created_by)
  VALUES (p_tenant_id, p_fiscal_period_id, p_distribution_date, p_total_amount, 'posted', p_notes, auth.uid())
  RETURNING id INTO v_dist_id;

  v_entry_number := 'DIST-'||to_char(p_distribution_date,'YYYYMMDD')||'-'||substring(v_dist_id::text,1,4);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (p_tenant_id, v_entry_number, p_distribution_date, 'توزيع أرباح على الشركاء', 'profit_distribution', v_dist_id, 'draft', 0, 0, auth.uid())
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES (p_tenant_id, v_entry_id, v_retained, p_total_amount, 0, 'توزيع أرباح', 1);
  v_line_order := 1;

  FOR r IN
    SELECT id, name, capital_share FROM public.equity_partners
    WHERE tenant_id=p_tenant_id AND is_active=true
  LOOP
    v_gross := round((p_total_amount * r.capital_share / v_total_share)::numeric, 2);
    v_offset := 0;
    FOR a IN
      SELECT id, remaining_amount FROM public.partner_advances
      WHERE partner_id=r.id AND status IN ('active','partially_paid') AND remaining_amount > 0
      ORDER BY advance_date ASC, created_at ASC
    LOOP
      EXIT WHEN v_offset >= v_gross;
      v_adv_remaining := LEAST(a.remaining_amount, v_gross - v_offset);
      IF v_adv_remaining > 0 THEN
        INSERT INTO public.partner_advance_payments (advance_id, payment_date, amount, payment_method, notes, created_by)
        VALUES (a.id, p_distribution_date, v_adv_remaining, 'profit_deduction', 'خصم من توزيع الأرباح', auth.uid());
        UPDATE public.partner_advances
        SET remaining_amount = remaining_amount - v_adv_remaining,
            status = CASE WHEN remaining_amount - v_adv_remaining <= 0 THEN 'fully_paid'
                          ELSE 'partially_paid' END
        WHERE id = a.id;
        v_offset := v_offset + v_adv_remaining;
      END IF;
    END LOOP;
    v_net_payable := v_gross - v_offset;

    INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by)
    VALUES (p_tenant_id, r.id, 'profit_share', v_net_payable,
            'نصيب من التوزيع'||CASE WHEN v_offset > 0 THEN ' (خصم سلفة: '||v_offset||')' ELSE '' END,
            v_month_year, auth.uid())
    RETURNING id INTO v_ptx_id;

    INSERT INTO public.profit_distribution_lines (distribution_id, partner_id, share_percentage, amount, partner_transaction_id)
    VALUES (v_dist_id, r.id, (r.capital_share/v_total_share)*100, v_gross, v_ptx_id);

    IF v_offset > 0 AND v_advance_asset IS NOT NULL THEN
      v_line_order := v_line_order + 1;
      INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (p_tenant_id, v_entry_id, v_advance_asset, 0, v_offset, 'تسوية سلفة الشريك '||r.name, v_line_order);
    END IF;
    IF v_net_payable > 0 THEN
      v_line_order := v_line_order + 1;
      INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (p_tenant_id, v_entry_id, v_payable, 0, v_net_payable, 'مستحق للشريك '||r.name, v_line_order);
    END IF;
  END LOOP;

  UPDATE public.journal_entries SET status = 'posted' WHERE id = v_entry_id;
  UPDATE public.profit_distributions SET journal_entry_id = v_entry_id WHERE id = v_dist_id;
  RETURN jsonb_build_object('distribution_id', v_dist_id, 'journal_entry_id', v_entry_id, 'total_amount', p_total_amount);
END $function$;

-- partner_withdraw_from_distribution: read balance from view
CREATE OR REPLACE FUNCTION public.partner_withdraw_from_distribution(
  p_tenant_id uuid, p_partner_id uuid, p_amount numeric,
  p_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_partner RECORD; v_balance numeric;
  v_cash UUID; v_payable UUID; v_entry_id UUID; v_entry_number TEXT;
  v_ptx_id UUID;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;
  SELECT * INTO v_partner FROM public.equity_partners
  WHERE id=p_partner_id AND tenant_id=p_tenant_id AND is_active=true;
  IF v_partner IS NULL THEN RAISE EXCEPTION 'الشريك غير موجود أو غير نشط'; END IF;

  SELECT COALESCE(current_balance,0) INTO v_balance
  FROM public.v_partner_balances WHERE partner_id = p_partner_id;
  v_balance := COALESCE(v_balance, 0);

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'الرصيد المتاح للسحب % أقل من المبلغ المطلوب %', v_balance, p_amount;
  END IF;

  SELECT id INTO v_cash FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='1100' LIMIT 1;
  SELECT id INTO v_payable FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='3850' LIMIT 1;
  IF v_cash IS NULL OR v_payable IS NULL THEN RAISE EXCEPTION 'الحسابات (1100/3850) غير موجودة'; END IF;

  INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by)
  VALUES (p_tenant_id, p_partner_id, 'drawing', p_amount,
          COALESCE(p_notes, 'سحب من رصيد توزيع الأرباح'),
          to_char(p_date,'YYYY-MM'), auth.uid())
  RETURNING id INTO v_ptx_id;

  v_entry_number := 'PW-'||to_char(p_date,'YYYYMMDD')||'-'||substring(gen_random_uuid()::text,1,4);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (p_tenant_id, v_entry_number, p_date,
          'سحب من رصيد التوزيع — '||v_partner.name,
          'partner_withdrawal', v_ptx_id, 'posted', p_amount, p_amount, auth.uid())
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES (p_tenant_id, v_entry_id, v_payable, p_amount, 0, 'سحب رصيد '||v_partner.name, 1),
         (p_tenant_id, v_entry_id, v_cash,    0, p_amount, 'صرف نقدي للشريك '||v_partner.name, 2);

  RETURN jsonb_build_object(
    'partner_transaction_id', v_ptx_id,
    'journal_entry_id', v_entry_id,
    'amount', p_amount,
    'remaining_balance', v_balance - p_amount
  );
END $function$;

-- record_partner_transaction: read balance from view
CREATE OR REPLACE FUNCTION public.record_partner_transaction(
  _partner_id uuid, _transaction_type text, _amount numeric,
  _description text DEFAULT NULL::text, _month_year text DEFAULT NULL::text,
  _treasury_id uuid DEFAULT NULL::uuid, _voucher_id uuid DEFAULT NULL::uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_tx_id UUID;
  v_current_balance NUMERIC;
BEGIN
  IF NOT is_admin(auth.uid()) AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can record partner transactions';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.equity_partners WHERE id = _partner_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF;

  IF _transaction_type ILIKE 'drawing%' OR _transaction_type ILIKE 'withdraw%' THEN
    SELECT COALESCE(current_balance,0) INTO v_current_balance
      FROM public.v_partner_balances WHERE partner_id = _partner_id;
    IF _amount > COALESCE(v_current_balance, 0) THEN
      RAISE EXCEPTION 'لا يمكن تنفيذ السحب. الرصيد المتاح: % ج. لطلب سلفة، تواصل مع المالك عبر /admin/partner-advances',
        to_char(COALESCE(v_current_balance, 0), 'FM999,999,990.00');
    END IF;
  END IF;

  INSERT INTO public.partner_transactions
    (tenant_id, partner_id, transaction_type, amount, description, month_year,
     related_treasury_id, related_voucher_id, created_by)
  VALUES (v_tenant, _partner_id, _transaction_type, _amount, _description,
          COALESCE(_month_year, to_char(CURRENT_DATE, 'YYYY-MM')),
          _treasury_id, _voucher_id, auth.uid())
  RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END; $function$;

-- reverse_profit_distribution: drop counter update
CREATE OR REPLACE FUNCTION public.reverse_profit_distribution(
  p_tenant_id uuid, p_distribution_id uuid, p_reason text DEFAULT 'Reversal'::text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_dist RECORD; v_line RECORD;
BEGIN
  SELECT * INTO v_dist FROM public.profit_distributions
   WHERE id = p_distribution_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التوزيع غير موجود'; END IF;
  IF v_dist.status = 'reversed' THEN RAISE EXCEPTION 'التوزيع سبق عكسه'; END IF;

  PERFORM public.reverse_journal_for_source(
    p_tenant_id, 'profit_distribution', p_distribution_id, COALESCE(p_reason, 'Reversal')
  );

  FOR v_line IN
    SELECT * FROM public.profit_distribution_lines WHERE distribution_id = p_distribution_id
  LOOP
    IF v_line.partner_transaction_id IS NOT NULL THEN
      UPDATE public.partner_transactions
        SET is_void = TRUE, description = COALESCE(description,'') || ' [REVERSED]'
      WHERE id = v_line.partner_transaction_id;
    END IF;

    INSERT INTO public.partner_transactions(
      tenant_id, partner_id, transaction_type, amount, description, month_year, created_by
    ) VALUES (
      p_tenant_id, v_line.partner_id, 'capital_adjustment',
      -v_line.amount,
      'عكس توزيع أرباح #' || substr(p_distribution_id::text,1,8) || ' — ' || COALESCE(p_reason,''),
      to_char(CURRENT_DATE,'YYYY-MM'), auth.uid()
    );
  END LOOP;

  DELETE FROM public.partner_advance_payments
   WHERE reference_type = 'profit_distribution' AND reference_id = p_distribution_id;

  UPDATE public.profit_distributions
    SET status = 'reversed',
        notes = COALESCE(notes,'') || E'\n[REVERSED] ' || COALESCE(p_reason,'')
  WHERE id = p_distribution_id;
END $function$;

-- system_health_check: use view for balances/snapshot
CREATE OR REPLACE FUNCTION public.system_health_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_email text; v_res jsonb := '{}'::jsonb; v_arr jsonb;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF LOWER(COALESCE(v_email,'')) <> 'an.ayoub98@gmail.com' AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised';
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

  -- 3. Partner balance vs transactions (always OK — view IS the source of truth)
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

-- 4) Finally: drop cached balance columns from equity_partners
ALTER TABLE public.equity_partners
  DROP COLUMN IF EXISTS current_balance,
  DROP COLUMN IF EXISTS total_contributions,
  DROP COLUMN IF EXISTS total_drawings,
  DROP COLUMN IF EXISTS total_profit_share;
