-- 1) Guard: active partners' capital_share must never exceed 100%
CREATE OR REPLACE FUNCTION public.enforce_partner_shares_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_total numeric;
BEGIN
  SELECT COALESCE(SUM(capital_share),0) INTO v_total
  FROM public.equity_partners
  WHERE tenant_id = NEW.tenant_id AND is_active = true AND id <> NEW.id;

  IF NEW.is_active THEN
    v_total := v_total + COALESCE(NEW.capital_share,0);
  END IF;

  IF v_total > 1.0001 THEN
    RAISE EXCEPTION 'مجموع نسب الشركاء لا يمكن أن يتجاوز 100%% — المجموع بعد الحفظ سيكون %%%',
      round(v_total*100, 2)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_partner_shares_total ON public.equity_partners;
CREATE TRIGGER trg_partner_shares_total
BEFORE INSERT OR UPDATE OF capital_share, is_active ON public.equity_partners
FOR EACH ROW EXECUTE FUNCTION public.enforce_partner_shares_total();

-- 2) Track the period each distribution covers
ALTER TABLE public.profit_distributions
  ADD COLUMN IF NOT EXISTS period_from date,
  ADD COLUMN IF NOT EXISTS period_to   date;

UPDATE public.profit_distributions
   SET period_from = COALESCE(period_from, date_trunc('month', distribution_date)::date),
       period_to   = COALESCE(period_to, (date_trunc('month', distribution_date) + interval '1 month - 1 day')::date)
 WHERE period_from IS NULL OR period_to IS NULL;

-- 3) Helper: how much is still distributable for a period
CREATE OR REPLACE FUNCTION public.available_to_distribute(p_tenant_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_np jsonb; v_already numeric;
BEGIN
  v_np := public.compute_net_profit_for_period(p_tenant_id, p_from, p_to);
  SELECT COALESCE(SUM(total_amount),0) INTO v_already
  FROM public.profit_distributions
  WHERE tenant_id = p_tenant_id
    AND status = 'posted'
    AND period_from IS NOT NULL AND period_to IS NOT NULL
    AND period_from <= p_to AND period_to >= p_from;

  RETURN jsonb_build_object(
    'net_profit', (v_np->>'net_profit')::numeric,
    'already_distributed', v_already,
    'available', GREATEST((v_np->>'net_profit')::numeric - v_already, 0),
    'detail', v_np
  );
END $$;

GRANT EXECUTE ON FUNCTION public.available_to_distribute(uuid, date, date) TO authenticated;

-- 4) distribute_profits with period + guards
DROP FUNCTION IF EXISTS public.distribute_profits(uuid, uuid, numeric, date, text);

CREATE OR REPLACE FUNCTION public.distribute_profits(
  p_tenant_id uuid,
  p_fiscal_period_id uuid,
  p_total_amount numeric,
  p_distribution_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL::text,
  p_period_from date DEFAULT NULL::date,
  p_period_to date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dist_id UUID; v_entry_id UUID; v_entry_number TEXT;
  v_retained UUID; v_payable UUID; v_advance_asset UUID;
  v_total_share NUMERIC := 0; v_line_order INT := 0;
  v_ptx_id UUID; v_month_year TEXT;
  v_gross NUMERIC; v_offset NUMERIC; v_net_payable NUMERIC;
  v_adv_remaining NUMERIC;
  v_from date; v_to date; v_avail jsonb;
  r RECORD; a RECORD;
BEGIN
  IF p_total_amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;

  -- resolve period (fallback: fiscal period, else the month of the distribution date)
  v_from := p_period_from; v_to := p_period_to;
  IF v_from IS NULL OR v_to IS NULL THEN
    IF p_fiscal_period_id IS NOT NULL THEN
      SELECT period_start, period_end INTO v_from, v_to
      FROM public.fiscal_periods WHERE id = p_fiscal_period_id;
    END IF;
  END IF;
  IF v_from IS NULL OR v_to IS NULL THEN
    v_from := date_trunc('month', p_distribution_date)::date;
    v_to   := (date_trunc('month', p_distribution_date) + interval '1 month - 1 day')::date;
  END IF;

  SELECT COALESCE(SUM(capital_share),0) INTO v_total_share
  FROM public.equity_partners WHERE tenant_id=p_tenant_id AND is_active=true;
  IF v_total_share <= 0 THEN RAISE EXCEPTION 'لا يوجد شركاء نشطين'; END IF;
  IF abs(v_total_share - 1) > 0.0001 THEN
    RAISE EXCEPTION 'مجموع نسب الشركاء = %%%، لازم يكون 100%% بالظبط قبل التوزيع',
      round(v_total_share*100, 2) USING ERRCODE = 'check_violation';
  END IF;

  -- Guard: never distribute more than what's actually available for this period
  v_avail := public.available_to_distribute(p_tenant_id, v_from, v_to);
  IF p_total_amount > (v_avail->>'available')::numeric + 0.01 THEN
    RAISE EXCEPTION 'المبلغ (%) أكبر من المتاح للتوزيع عن الفترة % → % — صافي الربح % وسبق توزيع %',
      round(p_total_amount,2), v_from, v_to,
      round((v_avail->>'net_profit')::numeric,2),
      round((v_avail->>'already_distributed')::numeric,2)
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_retained FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='3800' LIMIT 1;
  SELECT id INTO v_payable  FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='3850' LIMIT 1;
  SELECT id INTO v_advance_asset FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='1400' LIMIT 1;
  IF v_retained IS NULL OR v_payable IS NULL THEN RAISE EXCEPTION 'حسابات التوزيع (3800/3850) غير موجودة'; END IF;

  v_month_year := to_char(p_distribution_date,'YYYY-MM');

  INSERT INTO public.profit_distributions (tenant_id, fiscal_period_id, distribution_date, total_amount, status, notes, created_by, period_from, period_to)
  VALUES (p_tenant_id, p_fiscal_period_id, p_distribution_date, p_total_amount, 'posted', p_notes, auth.uid(), v_from, v_to)
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

  UPDATE public.journal_entries je SET status = 'posted',
       total_debit  = COALESCE((SELECT SUM(debit)  FROM public.journal_entry_lines WHERE entry_id = v_entry_id), 0),
       total_credit = COALESCE((SELECT SUM(credit) FROM public.journal_entry_lines WHERE entry_id = v_entry_id), 0)
     WHERE je.id = v_entry_id;
  UPDATE public.profit_distributions SET journal_entry_id = v_entry_id WHERE id = v_dist_id;

  RETURN jsonb_build_object('distribution_id', v_dist_id, 'journal_entry_id', v_entry_id,
    'total_amount', p_total_amount, 'period_from', v_from, 'period_to', v_to);
END $$;

GRANT EXECUTE ON FUNCTION public.distribute_profits(uuid, uuid, numeric, date, text, date, date) TO authenticated;

-- 5) preview reflects what is really available
CREATE OR REPLACE FUNCTION public.preview_flexible_distribution(p_tenant_id uuid, p_from date, p_to date, p_amount numeric DEFAULT NULL::numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_np jsonb; v_avail jsonb; v_total_amount numeric; v_total_share numeric;
  v_partners jsonb := '[]'::jsonb; v_gross numeric; v_offset numeric;
  r RECORD; v_adv numeric;
BEGIN
  v_np := public.compute_net_profit_for_period(p_tenant_id, p_from, p_to);
  v_avail := public.available_to_distribute(p_tenant_id, p_from, p_to);
  v_total_amount := COALESCE(p_amount, (v_avail->>'available')::numeric);

  SELECT COALESCE(SUM(capital_share),0) INTO v_total_share
  FROM public.equity_partners WHERE tenant_id=p_tenant_id AND is_active=true;

  IF v_total_amount <= 0 THEN
    RETURN jsonb_build_object('net_profit', v_np, 'distributable', v_total_amount,
      'already_distributed', (v_avail->>'already_distributed')::numeric,
      'available', (v_avail->>'available')::numeric,
      'shares_total_pct', round(v_total_share*100,2), 'partners', '[]'::jsonb);
  END IF;

  FOR r IN
    SELECT id, name, capital_share FROM public.equity_partners
    WHERE tenant_id=p_tenant_id AND is_active=true ORDER BY name
  LOOP
    v_gross := round((v_total_amount * r.capital_share / NULLIF(v_total_share,0))::numeric, 2);
    SELECT COALESCE(SUM(remaining_amount),0) INTO v_adv
    FROM public.partner_advances
    WHERE partner_id=r.id AND status IN ('active','partially_paid');
    v_offset := LEAST(v_adv, v_gross);
    v_partners := v_partners || jsonb_build_array(jsonb_build_object(
      'partner_id', r.id, 'name', r.name,
      'share_pct', round(((r.capital_share/NULLIF(v_total_share,0))*100)::numeric, 2),
      'gross', v_gross, 'advance_offset', v_offset, 'net_payable', v_gross - v_offset,
      'outstanding_advances', v_adv
    ));
  END LOOP;

  RETURN jsonb_build_object('net_profit', v_np, 'distributable', v_total_amount,
    'already_distributed', (v_avail->>'already_distributed')::numeric,
    'available', (v_avail->>'available')::numeric,
    'shares_total_pct', round(v_total_share*100,2), 'partners', v_partners);
END $$;