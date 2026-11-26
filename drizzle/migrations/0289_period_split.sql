-- 0289 (owner 2026-11-26, SPEC-partner-capital-records-period-split.md, module period-split): step 2 «وزّع الباقي» of
-- a period with a % or an amount the owner types per partner (the system suggests the capital split), a remainder the
-- owner either keeps in the company («سيب الباقي في الشركة» = retained earnings, still available later) or spreads on
-- the partners by the same ratios («وزّع الباقي على الشركا»), and a list of the distributions with «اعكس التوزيع».

ALTER TABLE public.profit_distributions
  ADD COLUMN IF NOT EXISTS split_mode text,          -- 'manual' = typed by the owner (0289); NULL = the automatic split
  ADD COLUMN IF NOT EXISTS rest_choice text,         -- 'keep' | 'spread' (what the owner chose for the remainder)
  ADD COLUMN IF NOT EXISTS available_at numeric;     -- what was available when it was made
ALTER TABLE public.profit_distribution_lines
  ADD COLUMN IF NOT EXISTS suggested_percentage numeric;   -- the capital split the system suggested (0289)

-- what step 2 needs for a period: profit, already distributed, available, salaries booked?, partners with their capital,
-- suggested % (the same month-by-month capital split as distribute_profits) and open advances
CREATE OR REPLACE FUNCTION public.period_split_preview(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_t uuid := public.current_tenant_id(); v_avail jsonb; v_pay_missing boolean; v_rows jsonb;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN RAISE EXCEPTION 'الفترة غلط'; END IF;
  v_avail := public.available_to_distribute(v_t, p_from, p_to);
  v_pay_missing := EXISTS (SELECT 1 FROM public.equity_partners ep JOIN public.partner_pay_rules pr ON pr.partner_id = ep.id
               WHERE ep.tenant_id = v_t AND ep.is_active AND pr.from_month <= p_to AND (pr.fixed_amount > 0 OR pr.percent > 0)
                 AND NOT EXISTS (SELECT 1 FROM public.partner_pay_rules z WHERE z.partner_id = pr.partner_id
                                   AND z.from_month > pr.from_month AND z.from_month <= date_trunc('month', p_from)::date))
     AND NOT EXISTS (SELECT 1 FROM public.partner_transactions WHERE tenant_id = v_t AND NOT coalesce(is_void, false)
               AND transaction_type IN ('operating_share', 'salary_share') AND period_from = p_from AND period_to = p_to);
  WITH sug AS (SELECT s.partner_id, sum(s.amount) AS w FROM public.partner_split_by_month(v_t, p_from, p_to, 1) s GROUP BY s.partner_id),
       tot AS (SELECT nullif(sum(w), 0) AS w FROM sug)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'partner_id', ep.id, 'name', ep.name,
           'capital_start', public.partner_capital_for_month(ep.id, p_from),
           'capital_end', public.partner_capital_for_month(ep.id, p_to),
           'suggested', round(coalesce(sug.w / tot.w, 0), 6),
           'in_period', coalesce(sug.w, 0) > 0,
           'advances', coalesce((SELECT sum(a.remaining_amount) FROM public.partner_advances a
                                  WHERE a.partner_id = ep.id AND a.status IN ('active', 'partially_paid') AND a.remaining_amount > 0), 0))
           ORDER BY coalesce(sug.w, 0) DESC, ep.name), '[]'::jsonb)
    INTO v_rows
    FROM public.equity_partners ep CROSS JOIN tot LEFT JOIN sug ON sug.partner_id = ep.id
   WHERE ep.tenant_id = v_t AND ep.is_active;
  RETURN jsonb_build_object('from', p_from, 'to', p_to,
    'net_profit', (v_avail->>'net_profit')::numeric, 'already', (v_avail->>'already_distributed')::numeric,
    'available', (v_avail->>'available')::numeric, 'pay_missing', v_pay_missing, 'partners', v_rows);
END $function$;

-- step 2 with the owner's amounts: same entry / advances / rows as distribute_profits, amounts as typed
CREATE OR REPLACE FUNCTION public.distribute_profits_manual(p_from date, p_to date, p_lines jsonb, p_notes text DEFAULT NULL,
                                                            p_rest text DEFAULT 'keep')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_t uuid := public.current_tenant_id(); v_avail numeric; v_total numeric; v_n int; v_bad int; v_day date;
  v_dist_id uuid; v_entry_id uuid; v_entry_number text; v_retained uuid; v_payable uuid; v_adv_acc uuid; v_line_order int := 1;
  v_ptx_id uuid; v_month_year text; v_settled numeric := 0; r record; a record; v_left numeric; v_off numeric; v_sug_tot numeric;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN RAISE EXCEPTION 'الفترة غلط'; END IF;
  IF coalesce(p_rest, '') NOT IN ('keep', 'spread') THEN RAISE EXCEPTION 'اختار: الباقي يفضل في الشركة ولا يتوزع على الشركا'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'مفيش سطور توزيع'; END IF;
  -- 0137: the partners' salaries / % of the period are booked first
  IF (public.period_split_preview(p_from, p_to)->>'pay_missing')::boolean THEN
    RAISE EXCEPTION 'سجّل «مرتبات الشركاء» للفترة % → % الأول (خطوة 1) — بتتخصم قبل التوزيع', p_from, p_to;
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _split_lines (partner_id uuid, amount numeric) ON COMMIT DROP;
  TRUNCATE _split_lines;
  INSERT INTO _split_lines SELECT x.partner_id, round(coalesce(x.amount, 0), 2) FROM jsonb_to_recordset(p_lines) AS x(partner_id uuid, amount numeric);
  IF EXISTS (SELECT 1 FROM _split_lines WHERE amount < 0) THEN RAISE EXCEPTION 'مينفعش مبلغ بالسالب'; END IF;
  IF EXISTS (SELECT partner_id FROM _split_lines GROUP BY partner_id HAVING count(*) > 1) THEN RAISE EXCEPTION 'شريك متكرر في التوزيع'; END IF;
  SELECT count(*) INTO v_bad FROM _split_lines l
   WHERE NOT EXISTS (SELECT 1 FROM public.equity_partners ep WHERE ep.id = l.partner_id AND ep.tenant_id = v_t AND ep.is_active);
  IF v_bad > 0 THEN RAISE EXCEPTION 'فيه شريك مش موجود أو موقوف'; END IF;
  DELETE FROM _split_lines WHERE amount = 0;
  SELECT count(*), coalesce(sum(amount), 0) INTO v_n, v_total FROM _split_lines;
  IF v_total <= 0 THEN RAISE EXCEPTION 'اكتب نصيب شريك واحد على الأقل'; END IF;
  v_avail := ((public.available_to_distribute(v_t, p_from, p_to))->>'available')::numeric;
  IF v_total > v_avail + 0.01 THEN
    RAISE EXCEPTION 'الإجمالي % أكبر من المتاح للتوزيع % عن الفترة % → %', v_total, round(v_avail, 2), p_from, p_to USING ERRCODE = 'check_violation';
  END IF;
  IF p_rest = 'spread' AND abs(v_total - v_avail) > 0.01 THEN
    RAISE EXCEPTION 'اخترت «وزّع الباقي على الشركا» — الإجمالي لازم يبقى المتاح كله (%)', round(v_avail, 2);
  END IF;
  SELECT id INTO v_retained FROM public.chart_of_accounts WHERE tenant_id = v_t AND code = '3800' LIMIT 1;
  SELECT id INTO v_payable  FROM public.chart_of_accounts WHERE tenant_id = v_t AND code = '3850' LIMIT 1;
  SELECT id INTO v_adv_acc  FROM public.chart_of_accounts WHERE tenant_id = v_t AND code = '1400' LIMIT 1;
  IF v_retained IS NULL OR v_payable IS NULL OR v_adv_acc IS NULL THEN RAISE EXCEPTION 'حسابات التوزيع (3800/3850/1400) غير موجودة'; END IF;
  v_day := least(p_to, public.cairo_today());
  v_month_year := to_char(v_day, 'YYYY-MM');
  SELECT nullif(sum(s.amount), 0) INTO v_sug_tot FROM public.partner_split_by_month(v_t, p_from, p_to, 1) s;
  INSERT INTO public.profit_distributions (tenant_id, distribution_date, total_amount, status, notes, created_by, period_from, period_to,
                                           split_mode, rest_choice, available_at)
  VALUES (v_t, v_day, v_total, 'posted',
          coalesce(nullif(btrim(p_notes), '') || ' — ', '') || 'نسب يدوية من المالك'
            || CASE WHEN v_total < v_avail - 0.01 THEN ' — الباقي ' || round(v_avail - v_total, 2) || ' اتساب في الشركة' ELSE '' END,
          auth.uid(), p_from, p_to, 'manual', p_rest, round(v_avail, 2))
  RETURNING id INTO v_dist_id;
  v_entry_number := 'DIST-' || to_char(v_day, 'YYYYMMDD') || '-' || substring(v_dist_id::text, 1, 4);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (v_t, v_entry_number, v_day, 'توزيع أرباح على الشركاء (نسب يدوية)', 'profit_distribution', v_dist_id, 'draft', 0, 0, auth.uid())
  RETURNING id INTO v_entry_id;
  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES (v_t, v_entry_id, v_retained, v_total, 0, 'توزيع أرباح', 1);
  PERFORM set_config('app.partner_money', '1', true);
  FOR r IN SELECT l.partner_id, ep.name, l.amount,
                  (SELECT sum(s.amount) FROM public.partner_split_by_month(v_t, p_from, p_to, 1) s WHERE s.partner_id = l.partner_id) / v_sug_tot AS sug
             FROM _split_lines l JOIN public.equity_partners ep ON ep.id = l.partner_id ORDER BY l.amount DESC LOOP
    INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by, movement_date, distribution_id)
    VALUES (v_t, r.partner_id, 'profit_share', r.amount, 'نصيب من توزيع ' || p_from || ' → ' || p_to, v_month_year, auth.uid(), v_day, v_dist_id)
    RETURNING id INTO v_ptx_id;
    INSERT INTO public.profit_distribution_lines (distribution_id, partner_id, share_percentage, amount, partner_transaction_id, suggested_percentage)
    VALUES (v_dist_id, r.partner_id, round(r.amount * 100 / v_total, 4), r.amount, v_ptx_id, round(coalesce(r.sug, 0) * 100, 4));
    v_line_order := v_line_order + 1;
    INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
    VALUES (v_t, v_entry_id, v_payable, 0, r.amount, 'مستحق للشريك ' || r.name, v_line_order);
    -- 0137: his open advances are paid back from the share first, oldest first
    v_left := r.amount;
    FOR a IN SELECT * FROM public.partner_advances WHERE partner_id = r.partner_id AND status IN ('active', 'partially_paid')
                AND remaining_amount > 0 ORDER BY advance_date, created_at FOR UPDATE LOOP
      EXIT WHEN v_left <= 0;
      v_off := least(v_left, a.remaining_amount);
      UPDATE public.partner_advances SET remaining_amount = round(remaining_amount - v_off, 2),
             status = CASE WHEN remaining_amount - v_off <= 0.005 THEN 'fully_paid' ELSE 'partially_paid' END, updated_at = now()
       WHERE id = a.id;
      INSERT INTO public.partner_advance_payments (advance_id, amount, payment_date, payment_method, reference_type, reference_id, notes, created_by, status)
      VALUES (a.id, v_off, v_day, 'profit_deduction', 'profit_distribution', v_dist_id, 'اتخصم من توزيع ' || p_from || ' → ' || p_to, auth.uid(), 'active');
      v_left := v_left - v_off;
    END LOOP;
    IF r.amount - v_left > 0 THEN
      v_settled := v_settled + (r.amount - v_left);
      INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by, movement_date, distribution_id)
      VALUES (v_t, r.partner_id, 'advance_settle', r.amount - v_left, 'سداد سلفة من توزيع ' || p_from || ' → ' || p_to, v_month_year, auth.uid(), v_day, v_dist_id);
      v_line_order := v_line_order + 1;
      INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (v_t, v_entry_id, v_payable, r.amount - v_left, 0, 'سداد سلفة ' || r.name || ' من نصيبه', v_line_order);
      v_line_order := v_line_order + 1;
      INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (v_t, v_entry_id, v_adv_acc, 0, r.amount - v_left, 'سلفة ' || r.name, v_line_order);
    END IF;
  END LOOP;
  PERFORM set_config('app.partner_money', '', true);
  UPDATE public.journal_entries je SET status = 'posted',
         total_debit  = coalesce((SELECT sum(debit)  FROM public.journal_entry_lines WHERE entry_id = v_entry_id), 0),
         total_credit = coalesce((SELECT sum(credit) FROM public.journal_entry_lines WHERE entry_id = v_entry_id), 0)
   WHERE je.id = v_entry_id;
  UPDATE public.profit_distributions SET journal_entry_id = v_entry_id WHERE id = v_dist_id;
  RETURN jsonb_build_object('distribution_id', v_dist_id, 'journal_entry_id', v_entry_id, 'total_amount', v_total,
    'available', round(v_avail, 2), 'kept', round(greatest(v_avail - v_total, 0), 2), 'advances_settled', v_settled, 'day', v_day);
END $function$;

-- the distributions with each partner's share (and the suggested %) for the distribution tab
CREATE OR REPLACE FUNCTION public.profit_distributions_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_t uuid := public.current_tenant_id();
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'day', d.distribution_date, 'from', d.period_from, 'to', d.period_to, 'total', d.total_amount, 'status', d.status,
      'mode', coalesce(d.split_mode, 'auto'), 'rest', d.rest_choice, 'available', d.available_at, 'notes', d.notes,
      'by', (SELECT pr.name FROM public.profiles pr WHERE pr.id = d.created_by),
      'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('partner_id', l.partner_id, 'name', ep.name, 'amount', l.amount,
                  'pct', l.share_percentage, 'suggested', l.suggested_percentage) ORDER BY l.amount DESC)
                FROM public.profit_distribution_lines l JOIN public.equity_partners ep ON ep.id = l.partner_id
               WHERE l.distribution_id = d.id), '[]'::jsonb))
      ORDER BY d.distribution_date DESC, d.created_at DESC)
    FROM public.profit_distributions d WHERE d.tenant_id = v_t), '[]'::jsonb);
END $function$;

-- «اعكس التوزيع» from the partners page (owner / admin, reason required)
CREATE OR REPLACE FUNCTION public.reverse_period_distribution(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب العكس'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profit_distributions WHERE id = p_id AND tenant_id = public.current_tenant_id()) THEN
    RAISE EXCEPTION 'التوزيع غير موجود';
  END IF;
  PERFORM public.reverse_profit_distribution(public.current_tenant_id(), p_id, btrim(p_reason));
END $function$;

GRANT EXECUTE ON FUNCTION public.period_split_preview(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.distribute_profits_manual(date, date, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.profit_distributions_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_period_distribution(uuid, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('period_split_preview', '0289', 'owner / admin: step 2 of the partners distribution — profit, available, suggested split'),
  ('distribute_profits_manual', '0289', 'owner / admin: distribute a period with typed amounts'),
  ('profit_distributions_list', '0289', 'owner / admin: distributions with each partner''s share'),
  ('reverse_period_distribution', '0289', 'owner / admin: reverse a distribution with a reason')
ON CONFLICT DO NOTHING;
