-- 0067 — Partners: transparent profit split by month, capital changes count from the NEXT month,
-- and partner advances retired.
--
-- Owner's rule: a capital increase made during a month changes the partners' percentages starting the
-- first day of the following month. So each month of a distribution is split with the shares that were
-- in force in that month:
--   capital of a partner for month M = paid-in capital (equity_partners.initial_capital, i.e. the capital
--   at the partnership start) + every contribution dated BEFORE the first day of M.
--   share for month M = his capital for M ÷ total capital of all active partners for M.
-- A distribution over several months is spread over the months in proportion to each month's net profit
-- (months with a loss carry no weight); if no month is profitable, the last month's shares are used.
--
-- Partner advances are removed from the business: the screens are gone, the RPCs are no longer callable,
-- and distributions no longer deduct advances. Historical rows (none on this database) are kept.
--
-- Also: COGS journals were dated by created_at (the import day), which put a whole year of COGS into
-- September 2026; they now use the invoice date. Invoice reversals are dated like the entry they reverse.

-- ───────────────────────── COGS / reversal dates ─────────────────────────
DO $$ DECLARE d text; n text; BEGIN
  d := pg_get_functiondef('public.post_invoice_cogs'::regproc);
  IF position('AT TIME ZONE ''Africa/Cairo'')::date AS entry_date' IN d) = 0 THEN
    n := replace(d, $x$SELECT i.id, i.tenant_id, i.branch_id, i.invoice_number, i.created_at::date AS entry_date, i.status$x$,
                    $x$SELECT i.id, i.tenant_id, i.branch_id, i.invoice_number, (coalesce(i.invoice_date, i.created_at) AT TIME ZONE 'Africa/Cairo')::date AS entry_date, i.status$x$);
    IF n = d THEN RAISE EXCEPTION 'post_invoice_cogs: text not found'; END IF;
    EXECUTE n;
  END IF;
END $$;
SELECT count(*) FROM (SELECT public.post_invoice_cogs(id) FROM public.invoices WHERE status = 'active') x;
UPDATE public.journal_entries r SET entry_date = o.entry_date
  FROM public.journal_entries o
 WHERE o.reversed_by = r.id AND r.source_type = 'invoice_reversal' AND r.entry_date <> o.entry_date;

-- ───────────────────────── partner capital by month ─────────────────────────
CREATE OR REPLACE FUNCTION public.partner_capital_for_month(p_partner_id uuid, p_month date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(p.initial_capital, 0)
       + coalesce((SELECT sum(t.amount) FROM public.partner_transactions t
                    WHERE t.partner_id = p.id AND t.transaction_type = 'contribution' AND coalesce(t.is_void, false) = false
                      AND coalesce(t.description, '') <> 'تعديل رأس المال المدفوع'
                      AND (t.created_at AT TIME ZONE 'Africa/Cairo')::date < date_trunc('month', p_month)::date), 0)
  FROM public.equity_partners p WHERE p.id = p_partner_id;
$$;

/** Shares in force in a month (capital as of the end of the previous month). */
CREATE OR REPLACE FUNCTION public.partner_shares_for_month(p_tenant_id uuid, p_month date)
RETURNS TABLE(partner_id uuid, name text, capital numeric, share numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (
    SELECT p.id, p.name, public.partner_capital_for_month(p.id, p_month) AS cap
      FROM public.equity_partners p
     WHERE p.tenant_id = p_tenant_id AND p.is_active
       AND (p.partnership_start_date IS NULL OR p.partnership_start_date <= (date_trunc('month', p_month) + interval '1 month - 1 day')::date)
  )
  SELECT c.id, c.name::text, round(c.cap, 2),
         CASE WHEN sum(c.cap) OVER () > 0 THEN c.cap / sum(c.cap) OVER () ELSE 0 END
    FROM c;
$$;

/** Split an amount over the months of a period and over the partners, month by month. */
CREATE OR REPLACE FUNCTION public.partner_split_by_month(p_tenant_id uuid, p_from date, p_to date, p_amount numeric)
RETURNS TABLE(partner_id uuid, name text, month date, month_profit numeric, month_weight numeric, share numeric, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m date; v_np numeric; v_total_pos numeric := 0; v_last date; v_months date[] := '{}'; v_profits numeric[] := '{}';
BEGIN
  m := date_trunc('month', p_from)::date;
  WHILE m <= p_to LOOP
    v_np := coalesce((public.compute_net_profit_for_period(p_tenant_id, greatest(m, p_from),
                       least((m + interval '1 month - 1 day')::date, p_to)) ->> 'net_profit')::numeric, 0);
    v_months := v_months || m;
    v_profits := v_profits || v_np;
    v_total_pos := v_total_pos + greatest(v_np, 0);
    v_last := m;
    m := (m + interval '1 month')::date;
  END LOOP;

  RETURN QUERY
  WITH x AS (SELECT u.month, u.profit,
                    CASE WHEN v_total_pos > 0 THEN greatest(u.profit, 0) / v_total_pos
                         ELSE CASE WHEN u.month = v_last THEN 1 ELSE 0 END END AS w
               FROM unnest(v_months, v_profits) AS u(month, profit))
  SELECT s.partner_id, s.name, x.month, round(x.profit, 2), round(x.w, 6), round(s.share, 6),
         round(p_amount * x.w * s.share, 2)
    FROM x CROSS JOIN LATERAL public.partner_shares_for_month(p_tenant_id, x.month) s
   ORDER BY s.name, x.month;
END $$;

-- ───────────────────────── preview (no advances any more) ─────────────────────────
CREATE OR REPLACE FUNCTION public.preview_flexible_distribution__unguarded(p_tenant_id uuid, p_from date, p_to date, p_amount numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_np jsonb; v_avail jsonb; v_total_amount numeric; v_partners jsonb;
BEGIN
  v_np := public.compute_net_profit_for_period(p_tenant_id, p_from, p_to);
  v_avail := public.available_to_distribute(p_tenant_id, p_from, p_to);
  v_total_amount := coalesce(p_amount, (v_avail->>'available')::numeric);

  IF coalesce(v_total_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('net_profit', v_np, 'distributable', coalesce(v_total_amount, 0),
      'already_distributed', (v_avail->>'already_distributed')::numeric, 'available', (v_avail->>'available')::numeric,
      'shares_total_pct', 100, 'rule', 'next_month', 'partners', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(p ORDER BY p->>'name'), '[]'::jsonb) INTO v_partners FROM (
    SELECT jsonb_build_object(
      'partner_id', s.partner_id, 'name', s.name,
      'share_pct', round(sum(s.amount) * 100 / nullif(v_total_amount, 0), 2),
      'gross', round(sum(s.amount), 2), 'advance_offset', 0, 'net_payable', round(sum(s.amount), 2), 'outstanding_advances', 0,
      'months', jsonb_agg(jsonb_build_object('month', to_char(s.month, 'YYYY-MM'), 'profit', s.month_profit,
                                             'weight', s.month_weight, 'share_pct', round(s.share * 100, 2), 'amount', s.amount) ORDER BY s.month)) AS p
      FROM public.partner_split_by_month(p_tenant_id, p_from, p_to, v_total_amount) s
     GROUP BY s.partner_id, s.name) q;

  RETURN jsonb_build_object('net_profit', v_np, 'distributable', v_total_amount,
    'already_distributed', (v_avail->>'already_distributed')::numeric, 'available', (v_avail->>'available')::numeric,
    'shares_total_pct', 100, 'rule', 'next_month', 'partners', v_partners);
END $$;

-- ───────────────────────── posting (no advances any more) ─────────────────────────
CREATE OR REPLACE FUNCTION public.distribute_profits(p_tenant_id uuid, p_fiscal_period_id uuid, p_total_amount numeric,
  p_distribution_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL, p_period_from date DEFAULT NULL, p_period_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dist_id uuid; v_entry_id uuid; v_entry_number text; v_retained uuid; v_payable uuid;
  v_line_order int := 1; v_ptx_id uuid; v_month_year text; v_from date; v_to date; v_avail jsonb;
  v_sum numeric := 0; v_n int := 0; v_count int; r record; v_amt numeric;
BEGIN
  IF p_total_amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF p_tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'غير مصرح'; END IF;

  v_from := p_period_from; v_to := p_period_to;
  IF (v_from IS NULL OR v_to IS NULL) AND p_fiscal_period_id IS NOT NULL THEN
    SELECT period_start, period_end INTO v_from, v_to FROM public.fiscal_periods WHERE id = p_fiscal_period_id;
  END IF;
  IF v_from IS NULL OR v_to IS NULL THEN
    v_from := date_trunc('month', p_distribution_date)::date;
    v_to   := (date_trunc('month', p_distribution_date) + interval '1 month - 1 day')::date;
  END IF;

  v_avail := public.available_to_distribute(p_tenant_id, v_from, v_to);
  IF p_total_amount > (v_avail->>'available')::numeric + 0.01 THEN
    RAISE EXCEPTION 'المبلغ (%) أكبر من المتاح للتوزيع عن الفترة % → % — صافي الربح % وسبق توزيع %',
      round(p_total_amount,2), v_from, v_to, round((v_avail->>'net_profit')::numeric,2), round((v_avail->>'already_distributed')::numeric,2)
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_retained FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '3800' LIMIT 1;
  SELECT id INTO v_payable  FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '3850' LIMIT 1;
  IF v_retained IS NULL OR v_payable IS NULL THEN RAISE EXCEPTION 'حسابات التوزيع (3800/3850) غير موجودة'; END IF;

  SELECT count(DISTINCT s.partner_id) INTO v_count FROM public.partner_split_by_month(p_tenant_id, v_from, v_to, p_total_amount) s;
  IF coalesce(v_count, 0) = 0 THEN RAISE EXCEPTION 'لا يوجد شركاء نشطين برأس مال'; END IF;

  v_month_year := to_char(p_distribution_date, 'YYYY-MM');
  INSERT INTO public.profit_distributions (tenant_id, fiscal_period_id, distribution_date, total_amount, status, notes, created_by, period_from, period_to)
  VALUES (p_tenant_id, p_fiscal_period_id, p_distribution_date, p_total_amount, 'posted',
          coalesce(p_notes || ' — ', '') || 'النسب حسب رأس المال الساري في كل شهر (الزيادة تسري من أول الشهر التالي)', auth.uid(), v_from, v_to)
  RETURNING id INTO v_dist_id;

  v_entry_number := 'DIST-' || to_char(p_distribution_date, 'YYYYMMDD') || '-' || substring(v_dist_id::text, 1, 4);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (p_tenant_id, v_entry_number, p_distribution_date, 'توزيع أرباح على الشركاء', 'profit_distribution', v_dist_id, 'draft', 0, 0, auth.uid())
  RETURNING id INTO v_entry_id;
  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES (p_tenant_id, v_entry_id, v_retained, p_total_amount, 0, 'توزيع أرباح', 1);

  FOR r IN SELECT s.partner_id, s.name, round(sum(s.amount), 2) AS amount
             FROM public.partner_split_by_month(p_tenant_id, v_from, v_to, p_total_amount) s
            GROUP BY s.partner_id, s.name ORDER BY 3 DESC LOOP
    v_n := v_n + 1;
    -- rounding: the last partner takes the cents left over so the entry balances exactly
    v_amt := CASE WHEN v_n = v_count THEN round(p_total_amount - v_sum, 2) ELSE r.amount END;
    v_sum := v_sum + v_amt;
    CONTINUE WHEN v_amt = 0;

    INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by)
    VALUES (p_tenant_id, r.partner_id, 'profit_share', v_amt, 'نصيب من توزيع ' || v_from || ' → ' || v_to, v_month_year, auth.uid())
    RETURNING id INTO v_ptx_id;
    INSERT INTO public.profit_distribution_lines (distribution_id, partner_id, share_percentage, amount, partner_transaction_id)
    VALUES (v_dist_id, r.partner_id, round(v_amt * 100 / p_total_amount, 4), v_amt, v_ptx_id);
    v_line_order := v_line_order + 1;
    INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
    VALUES (p_tenant_id, v_entry_id, v_payable, 0, v_amt, 'مستحق للشريك ' || r.name, v_line_order);
  END LOOP;

  UPDATE public.journal_entries je SET status = 'posted',
         total_debit  = coalesce((SELECT sum(debit)  FROM public.journal_entry_lines WHERE entry_id = v_entry_id), 0),
         total_credit = coalesce((SELECT sum(credit) FROM public.journal_entry_lines WHERE entry_id = v_entry_id), 0)
   WHERE je.id = v_entry_id;
  UPDATE public.profit_distributions SET journal_entry_id = v_entry_id WHERE id = v_dist_id;

  RETURN jsonb_build_object('distribution_id', v_dist_id, 'journal_entry_id', v_entry_id,
    'total_amount', p_total_amount, 'period_from', v_from, 'period_to', v_to);
END $$;

-- ───────────────────────── retire partner advances ─────────────────────────
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('create_partner_advance','record_partner_advance_payment','cancel_partner_advance',
                                'mark_partner_advance_installments_overdue') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;
REVOKE INSERT, UPDATE, DELETE ON public.partner_advances, public.partner_advance_payments, public.partner_advance_installments FROM anon, authenticated;

-- grants for the new helpers
REVOKE ALL ON FUNCTION public.partner_capital_for_month(uuid, date), public.partner_shares_for_month(uuid, date),
  public.partner_split_by_month(uuid, date, date, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_capital_for_month(uuid, date), public.partner_shares_for_month(uuid, date),
  public.partner_split_by_month(uuid, date, date, numeric) TO service_role;
