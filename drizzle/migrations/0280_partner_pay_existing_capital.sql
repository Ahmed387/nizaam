-- 0280 Partners page from the start (owner 2026-11-25):
--  1) «موجود بالفعل»: an old contribution that counts in his capital (and so in his % of the profit) with NO till row and NO
--     journal entry — `partner_existing_capital(partner, amount, from_day, notes)`; it counts from the month of its day.
--     Kept as a capital_adjustment row flagged `existing_capital`; cancelled by `cancel_partner_transaction` (no till, no entry).
--     Example: الحاج ناصر 5,000,000 + محمد ناصر 5,000,000 «موجود بالفعل» → 50% / 50%, tills and books unchanged.
--  2) «مرتب الشريك» per month, chosen by the owner: fixed / % of the profit / both, and the % from the WHOLE profit or from
--     what is left after the fixed salaries (`partner_pay_rules`, one row per partner per month it starts; it holds until the
--     next one — `set_partner_pay_rule`). Order every month: fixed (paid in a loss month too) → % (0 in a loss month) → the
--     rest by capital. Booked by `post_partner_period_shares` (Dr 5200 / Cr 3850, as before): fixed = salary_share,
--     % = operating_share. Example 300,000, محمد 10,000 + 10% after fixed: 10,000 + 29,000, the 261,000 left split by capital.
--  The old fields operating_share / salary_mode stay in the table but no longer drive the shares (all 0 / none on A & N).

-- ── 1) «موجود بالفعل» ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.partner_transactions ADD COLUMN IF NOT EXISTS existing_capital boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.partner_existing_capital(p_partner uuid, p_amount numeric, p_day date, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id(); p public.equity_partners%ROWTYPE; v_id uuid;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.equity_partners WHERE id = p_partner AND tenant_id = v_t;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  IF NOT p.is_active THEN RAISE EXCEPTION 'الشريك ده موقوف'; END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'اكتب المبلغ'; END IF;
  IF p_day IS NULL THEN RAISE EXCEPTION 'اختار من إمتى بيتحسب'; END IF;
  IF p_day > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ مينفعش يكون بعد النهارده'; END IF;
  PERFORM set_config('app.partner_money', '1', true);       -- no automatic journal entry
  INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by,
                                           movement_date, existing_capital)
  VALUES (v_t, p_partner, 'capital_adjustment', round(p_amount, 2),
          'رأس مال موجود بالفعل' || coalesce(' — ' || nullif(btrim(p_notes), ''), ''), to_char(p_day, 'YYYY-MM'), auth.uid(), p_day, true)
  RETURNING id INTO v_id;
  PERFORM set_config('app.partner_money', '', true);
  RETURN v_id;
END $$;

-- cancel: a «موجود بالفعل» row has no till row and no entry — it is only marked cancelled
DO $p$
DECLARE d text := pg_get_functiondef('public.cancel_partner_transaction(uuid,text)'::regprocedure);
  old_ text := $o$  IF t.related_treasury_id IS NULL THEN RAISE EXCEPTION 'الحركة دي قديمة (من غير خزنة) — مينفعش تتلغي من هنا'; END IF;$o$;
  new_ text := $n$  IF t.existing_capital THEN
    UPDATE public.partner_transactions SET is_void = true, cancel_reason = btrim(p_reason) WHERE id = t.id;
    RETURN jsonb_build_object('voided', 1, 'amount', t.amount, 'existing_capital', true);
  END IF;
  IF t.related_treasury_id IS NULL THEN RAISE EXCEPTION 'الحركة دي قديمة (من غير خزنة) — مينفعش تتلغي من هنا'; END IF;$n$;
BEGIN
  IF position(old_ in d) = 0 THEN RAISE EXCEPTION '0280: cancel_partner_transaction text not found'; END IF;
  EXECUTE replace(d, old_, new_);
END $p$;

-- the cards: «موجود بالفعل» is cancellable and says so
DO $p$
DECLARE d text := pg_get_functiondef('public.partner_cards(uuid)'::regprocedure);
  old_ text := $o$'cancellable', NOT coalesce(t.is_void, false) AND t.related_treasury_id IS NOT NULL AND t.distribution_id IS NULL)$o$;
  new_ text := $n$'existing', t.existing_capital,
        'cancellable', NOT coalesce(t.is_void, false) AND (t.related_treasury_id IS NOT NULL OR t.existing_capital) AND t.distribution_id IS NULL)$n$;
BEGIN
  IF position(old_ in d) = 0 THEN RAISE EXCEPTION '0280: partner_cards text not found'; END IF;
  EXECUTE replace(d, old_, new_);
END $p$;

-- capital of a month: a «موجود بالفعل» row counts from the month of its day (a contribution into a till: from the next month)
CREATE OR REPLACE FUNCTION public.partner_capital_for_month(p_partner_id uuid, p_month date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(p.initial_capital, 0)
       + coalesce((SELECT sum(CASE WHEN t.transaction_type = 'capital_withdrawal' THEN -t.amount ELSE t.amount END)
                     FROM public.partner_transactions t
                    WHERE t.partner_id = p.id AND coalesce(t.is_void, false) = false
                      AND coalesce(t.description, '') <> 'تعديل رأس المال المدفوع'
                      AND ((t.transaction_type IN ('contribution', 'capital_withdrawal') AND public.partner_tx_day(t) < date_trunc('month', p_month)::date)
                        OR (t.transaction_type = 'capital_adjustment' AND t.existing_capital
                            AND date_trunc('month', public.partner_tx_day(t))::date <= date_trunc('month', p_month)::date)
                        OR (t.transaction_type = 'capital_adjustment' AND NOT t.existing_capital AND t.related_treasury_id IS NULL
                            AND public.partner_tx_day(t) <= date_trunc('month', p_month)::date))), 0)
  FROM public.equity_partners p WHERE p.id = p_partner_id;
$$;

-- ── 2) «مرتب الشريك» per month ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_pay_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.equity_partners(id) ON DELETE CASCADE,
  from_month date NOT NULL CHECK (from_month = date_trunc('month', from_month)::date),
  fixed_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (fixed_amount >= 0),
  percent numeric(7,4) NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 1),
  percent_base text NOT NULL DEFAULT 'after_fixed' CHECK (percent_base IN ('all', 'after_fixed')),
  notes text,
  set_by uuid, set_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, from_month)
);
ALTER TABLE public.partner_pay_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_pay_rules_read ON public.partner_pay_rules;
CREATE POLICY partner_pay_rules_read ON public.partner_pay_rules FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND ((SELECT public.is_owner(auth.uid())) OR (SELECT public.is_admin(auth.uid())) OR public.is_partner_owner(partner_id)));
REVOKE INSERT, UPDATE, DELETE ON public.partner_pay_rules FROM anon, authenticated;
GRANT SELECT ON public.partner_pay_rules TO authenticated;
DROP POLICY IF EXISTS suspended_block_write ON public.partner_pay_rules;
CREATE POLICY suspended_block_write ON public.partner_pay_rules AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()))
  WITH CHECK ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()));

-- the rule of a month = the last one that started on / before it
CREATE OR REPLACE FUNCTION public.partner_pay_rule_for(p_partner uuid, p_month date)
RETURNS public.partner_pay_rules LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM public.partner_pay_rules WHERE partner_id = p_partner AND from_month <= date_trunc('month', p_month)::date
   ORDER BY from_month DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.partner_pay_rule_for(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_partner_pay_rule(p_partner uuid, p_from_month date, p_fixed numeric, p_percent numeric,
                                                      p_percent_base text DEFAULT 'after_fixed', p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id(); v_m date := date_trunc('month', p_from_month)::date; v_id uuid;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.equity_partners WHERE id = p_partner AND tenant_id = v_t) THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  IF p_from_month IS NULL THEN RAISE EXCEPTION 'اختار الشهر'; END IF;
  IF coalesce(p_fixed, 0) < 0 OR coalesce(p_percent, 0) < 0 OR coalesce(p_percent, 0) > 1 THEN RAISE EXCEPTION 'المرتب / النسبة غلط'; END IF;
  IF coalesce(p_percent_base, '') NOT IN ('all', 'after_fixed') THEN RAISE EXCEPTION 'اختار النسبة من الربح كله ولا بعد المرتبات الثابتة'; END IF;
  -- a month already booked keeps what was booked: cancel its shares first
  IF EXISTS (SELECT 1 FROM public.partner_transactions WHERE tenant_id = v_t AND partner_id = p_partner AND NOT coalesce(is_void, false)
               AND transaction_type IN ('operating_share', 'salary_share') AND period_to >= v_m) THEN
    RAISE EXCEPTION 'مرتب الشريك للشهر ده أو بعده اتسجل خلاص — الغي «مرتبات الشركاء» للفترة دي الأول';
  END IF;
  INSERT INTO public.partner_pay_rules (tenant_id, partner_id, from_month, fixed_amount, percent, percent_base, notes, set_by)
  VALUES (v_t, p_partner, v_m, round(coalesce(p_fixed, 0), 2), round(coalesce(p_percent, 0), 4), p_percent_base, nullif(btrim(p_notes), ''), auth.uid())
  ON CONFLICT (partner_id, from_month) DO UPDATE SET fixed_amount = EXCLUDED.fixed_amount, percent = EXCLUDED.percent,
     percent_base = EXCLUDED.percent_base, notes = EXCLUDED.notes, set_by = EXCLUDED.set_by, set_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- preview of a period: month by month, fixed → % → the rest by capital
CREATE OR REPLACE FUNCTION public.partner_period_shares_preview(p_from date, p_to date, p_overrides jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id(); o jsonb := coalesce(p_overrides, '{}'::jsonb);
  m date; m_from date; m_to date; v_net numeric; v_booked numeric; v_fixed_all numeric; v_base numeric; v_net_all numeric := 0;
  p record; ru public.partner_pay_rules; v_months jsonb := '[]'::jsonb; v_rows jsonb := '[]'::jsonb; v_lines jsonb;
  acc jsonb := '{}'::jsonb; k text; v_amt numeric; v_key text;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'الفترة غلط'; END IF;
  m := date_trunc('month', p_from)::date;
  WHILE m <= p_to LOOP
    m_from := greatest(m, p_from); m_to := least((m + interval '1 month - 1 day')::date, p_to);
    -- the month's net BEFORE the partners' pay (what was already booked as their pay is added back)
    SELECT coalesce(sum(amount), 0) INTO v_booked FROM public.partner_transactions WHERE tenant_id = v_t AND NOT coalesce(is_void, false)
       AND transaction_type IN ('operating_share', 'salary_share') AND movement_date BETWEEN m_from AND m_to;
    v_net := round((public.profit_statement_core(v_t, m_from, m_to, NULL)->'total'->>'net_profit')::numeric + v_booked, 2);
    v_net_all := v_net_all + v_net;
    -- 1) fixed of every partner
    v_fixed_all := 0; v_lines := '[]'::jsonb;
    FOR p IN SELECT * FROM public.equity_partners WHERE tenant_id = v_t AND is_active ORDER BY name LOOP
      ru := public.partner_pay_rule_for(p.id, m);
      CONTINUE WHEN ru.id IS NULL;
      IF ru.fixed_amount > 0 THEN
        v_fixed_all := v_fixed_all + ru.fixed_amount;
        k := p.id::text || ':salary';
        acc := jsonb_set(acc, ARRAY[k], coalesce(acc->k, jsonb_build_object('partner_id', p.id, 'name', p.name, 'kind', 'salary_share', 'amount', 0, 'base', 0))
               || jsonb_build_object('amount', coalesce((acc->k->>'amount')::numeric, 0) + ru.fixed_amount));
        v_lines := v_lines || jsonb_build_object('partner_id', p.id, 'name', p.name, 'kind', 'fixed', 'amount', ru.fixed_amount);
      END IF;
    END LOOP;
    -- 2) % of the profit (0 in a loss month)
    FOR p IN SELECT * FROM public.equity_partners WHERE tenant_id = v_t AND is_active ORDER BY name LOOP
      ru := public.partner_pay_rule_for(p.id, m);
      CONTINUE WHEN ru.id IS NULL OR ru.percent <= 0;
      v_base := CASE WHEN ru.percent_base = 'all' THEN v_net ELSE v_net - v_fixed_all END;
      v_amt := round(greatest(v_base, 0) * ru.percent, 2);
      k := p.id::text || ':operating';
      acc := jsonb_set(acc, ARRAY[k], coalesce(acc->k, jsonb_build_object('partner_id', p.id, 'name', p.name, 'kind', 'operating_share', 'amount', 0, 'base', 0))
             || jsonb_build_object('amount', coalesce((acc->k->>'amount')::numeric, 0) + v_amt, 'base', coalesce((acc->k->>'base')::numeric, 0) + greatest(v_base, 0),
                                   'percent', ru.percent, 'percent_base', ru.percent_base));
      v_lines := v_lines || jsonb_build_object('partner_id', p.id, 'name', p.name, 'kind', 'percent', 'percent', ru.percent,
                                               'percent_base', ru.percent_base, 'base', round(v_base, 2), 'amount', v_amt);
    END LOOP;
    v_months := v_months || jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'from', m_from, 'to', m_to, 'net_before', v_net,
      'pay', coalesce((SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(v_lines) x), 0), 'lines', v_lines);
    m := (m + interval '1 month')::date;
  END LOOP;
  -- rows (one per partner and kind), the owner may type another amount
  FOR k IN SELECT jsonb_object_keys(acc) ORDER BY 1 LOOP
    v_key := k;
    v_amt := CASE WHEN o ? v_key THEN round((o->>v_key)::numeric, 2) ELSE round((acc->k->>'amount')::numeric, 2) END;
    v_rows := v_rows || (acc->k || jsonb_build_object('key', v_key, 'computed', round((acc->k->>'amount')::numeric, 2),
                                                      'amount', v_amt, 'typed', o ? v_key, 'needs_owner', false, 'branch_id', NULL));
  END LOOP;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'net_before', v_net_all, 'months', v_months, 'rows', v_rows,
    'total', coalesce((SELECT sum((e->>'amount')::numeric) FROM jsonb_array_elements(v_rows) e), 0),
    'already', EXISTS (SELECT 1 FROM public.partner_transactions WHERE tenant_id = v_t AND NOT coalesce(is_void, false)
                         AND transaction_type IN ('operating_share', 'salary_share') AND period_from = p_from AND period_to = p_to));
END $$;

-- post: same entries as before; a 0 row is skipped (nothing to book), the descriptions say «مرتب ثابت» / «نسبة من الربح»
CREATE OR REPLACE FUNCTION public.post_partner_period_shares(p_from date, p_to date, p_overrides jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id(); v jsonb; x jsonb; v_tx uuid; n int := 0;
BEGIN
  v := public.partner_period_shares_preview(p_from, p_to, p_overrides);
  IF (v->>'already')::boolean THEN RAISE EXCEPTION 'مرتبات الشركاء للفترة دي اتسجلت قبل كده'; END IF;
  IF jsonb_array_length(v->'rows') = 0 THEN RAISE EXCEPTION 'مفيش شريك ليه مرتب في الفترة دي'; END IF;
  PERFORM set_config('app.partner_money', '1', true);
  FOR x IN SELECT value FROM jsonb_array_elements(v->'rows') LOOP
    IF (x->>'amount')::numeric < 0 THEN RAISE EXCEPTION 'المبلغ مينفعش يكون بالسالب'; END IF;
    CONTINUE WHEN (x->>'amount')::numeric = 0;
    INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by,
                                             movement_date, period_from, period_to)
    VALUES (v_t, (x->>'partner_id')::uuid, x->>'kind', (x->>'amount')::numeric,
            CASE WHEN x->>'kind' = 'salary_share' THEN 'مرتب ثابت ' ELSE 'نسبة من الربح ' END || p_from || ' → ' || p_to,
            to_char(p_to, 'YYYY-MM'), auth.uid(), p_to, p_from, p_to)
    RETURNING id INTO v_tx;
    PERFORM public.post_journal(v_t, p_to, CASE WHEN x->>'kind' = 'salary_share' THEN 'مرتب ثابت — ' ELSE 'نسبة من الربح — ' END || (x->>'name'),
      'partner_transaction', v_tx,
      jsonb_build_array(jsonb_build_object('account_code', '5200', 'debit', (x->>'amount')::numeric, 'credit', 0, 'description', 'مرتبات الشركاء'),
                        jsonb_build_object('account_code', '3850', 'debit', 0, 'credit', (x->>'amount')::numeric, 'description', 'مستحق لـ ' || (x->>'name'))));
    n := n + 1;
  END LOOP;
  PERFORM set_config('app.partner_money', '', true);
  IF n = 0 THEN RAISE EXCEPTION 'كل المبالغ صفر — مفيش حاجة تتسجل'; END IF;
  RETURN jsonb_build_object('posted', n, 'preview', v);
END $$;

-- the distribution refuses until the partners' pay of the period is booked (when the period has any)
DO $p$
DECLARE d text := pg_get_functiondef('public.distribute_profits(uuid,uuid,numeric,date,text,date,date)'::regprocedure);
  old_ text := $o$  IF EXISTS (SELECT 1 FROM public.equity_partners WHERE tenant_id = p_tenant_id AND is_active
               AND (operating_share > 0 OR (salary_mode = 'percent' AND salary_percent > 0)))$o$;
  new_ text := $n$  IF EXISTS (SELECT 1 FROM public.equity_partners ep JOIN public.partner_pay_rules pr ON pr.partner_id = ep.id
               WHERE ep.tenant_id = p_tenant_id AND ep.is_active AND pr.from_month <= v_to
                 AND (pr.fixed_amount > 0 OR pr.percent > 0)
                 AND NOT EXISTS (SELECT 1 FROM public.partner_pay_rules z WHERE z.partner_id = pr.partner_id
                                   AND z.from_month > pr.from_month AND z.from_month <= date_trunc('month', v_from)::date))$n$;
BEGIN
  IF position(old_ in d) = 0 THEN RAISE EXCEPTION '0280: distribute_profits text not found'; END IF;
  EXECUTE replace(d, old_, new_);
END $p$;

-- browser doors
GRANT EXECUTE ON FUNCTION public.partner_existing_capital(uuid, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_partner_pay_rule(uuid, date, numeric, numeric, text, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('partner_existing_capital', '0280', 'partners: old capital «موجود بالفعل» — no till, no entry (owner / admin)'),
  ('set_partner_pay_rule', '0280', 'partners: monthly pay fixed / % / both (owner / admin)')
ON CONFLICT (function_name) DO NOTHING;
