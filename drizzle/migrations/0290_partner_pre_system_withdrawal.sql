-- 0290 (owner 2026-11-26 «(ج) تختار في كل مرة … نفذ»): «سحب قبل السيستم» — money a partner took before the system,
-- recorded like «رأس مال موجود بالفعل» in reverse: no till row, no journal entry. Each time the owner chooses:
--   'capital' = from his capital → his capital and % go down from the month he picks (row capital_withdrawal, existing);
--   'profit'  = his % stays → it counts as profit he already took (row profit_withdrawal, existing): his «صافي الربح»
--               card goes down and may show below zero until the next distribution covers it (no advance, no books).
-- «اتسحبت إمتى» reuses partner_transactions.deposited_on (the real day of the money).

-- capital per month: a pre-system capital withdrawal counts from ITS month (like existing capital), a till one from the next
DO $patch$
DECLARE d text := pg_get_functiondef('public.partner_capital_for_month(uuid, date)'::regprocedure); n text; a text; b text;
BEGIN
  a := $a$((t.transaction_type IN ('contribution', 'capital_withdrawal') AND public.partner_tx_day(t) < date_trunc('month', p_month)::date)$a$;
  b := $b$((t.transaction_type IN ('contribution', 'capital_withdrawal') AND NOT coalesce(t.existing_capital, false) AND public.partner_tx_day(t) < date_trunc('month', p_month)::date)
                        OR (t.transaction_type = 'capital_withdrawal' AND t.existing_capital
                            AND date_trunc('month', public.partner_tx_day(t))::date <= date_trunc('month', p_month)::date)$b$;
  IF position(a IN d) = 0 THEN RAISE EXCEPTION '0290: partner_capital_for_month text not found'; END IF;
  n := replace(d, a, b);
  EXECUTE n;
END $patch$;

CREATE OR REPLACE FUNCTION public._partner_tx_effective_month(t public.partner_transactions)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t.transaction_type IN ('capital_adjustment', 'capital_withdrawal') AND t.existing_capital THEN date_trunc('month', public.partner_tx_day(t))::date
    WHEN t.transaction_type IN ('contribution', 'capital_withdrawal') THEN (date_trunc('month', public.partner_tx_day(t)) + interval '1 month')::date
    ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public._partner_tx_effective_month(public.partner_transactions) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.partner_pre_system_withdrawal(p_partner uuid, p_amount numeric, p_day date, p_mode text,
                                                                p_withdrawn_on date DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_t uuid := public.current_tenant_id(); p public.equity_partners%ROWTYPE; v_id uuid; v_amt numeric := round(p_amount, 2); v_cap numeric;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.equity_partners WHERE id = p_partner AND tenant_id = v_t;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  IF NOT p.is_active THEN RAISE EXCEPTION 'الشريك ده موقوف'; END IF;
  IF coalesce(v_amt, 0) <= 0 THEN RAISE EXCEPTION 'اكتب المبلغ'; END IF;
  IF coalesce(p_mode, '') NOT IN ('capital', 'profit') THEN RAISE EXCEPTION 'اختار: من رأس ماله (نسبته تقل) ولا من الربح (نسبته زي ما هي)'; END IF;
  IF p_day IS NULL THEN RAISE EXCEPTION 'اختار من إمتى بيتحسب'; END IF;
  IF p_day > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ مينفعش يكون بعد النهارده'; END IF;
  IF p_withdrawn_on > public.cairo_today() THEN RAISE EXCEPTION 'يوم السحب مينفعش يكون بعد النهارده'; END IF;
  IF p_mode = 'capital' THEN
    v_cap := (public.partner_cards(p.id)->>'capital')::numeric;
    IF v_amt > v_cap + 0.005 THEN RAISE EXCEPTION 'رأس ماله % بس — مينفعش يتسحب منه %', v_cap, v_amt; END IF;
    PERFORM public._partner_capital_lock_check(v_t, date_trunc('month', p_day)::date);
  END IF;
  PERFORM set_config('app.partner_money', '1', true);
  INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by,
                                           movement_date, existing_capital, deposited_on)
  VALUES (v_t, p.id, CASE p_mode WHEN 'capital' THEN 'capital_withdrawal' ELSE 'profit_withdrawal' END, v_amt,
          'سحب قبل السيستم' || coalesce(' — ' || nullif(btrim(p_notes), ''), ''), to_char(p_day, 'YYYY-MM'), auth.uid(), p_day, true,
          coalesce(p_withdrawn_on, p_day))
  RETURNING id INTO v_id;
  PERFORM set_config('app.partner_money', '', true);
  RETURN v_id;
END $function$;

-- edit «موجود بالفعل» AND «سحب قبل السيستم» (same kind kept; to switch capital ↔ profit cancel and add again)
CREATE OR REPLACE FUNCTION public.edit_existing_capital(p_tx uuid, p_amount numeric, p_day date, p_deposited_on date,
                                                        p_notes text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE t public.partner_transactions%ROWTYPE; v_id uuid; v_desc text; v_amt numeric := round(p_amount, 2);
  v_dep date := coalesce(p_deposited_on, p_day); v_prefix text; v_cap numeric;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب التعديل'; END IF;
  SELECT * INTO t FROM public.partner_transactions WHERE id = p_tx AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR coalesce(t.is_void, false) THEN RAISE EXCEPTION 'الحركة غير موجودة أو ملغية'; END IF;
  IF NOT (t.existing_capital AND t.transaction_type IN ('capital_adjustment', 'capital_withdrawal', 'profit_withdrawal')) THEN
    RAISE EXCEPTION 'دي مش «رأس مال موجود بالفعل» ولا «سحب قبل السيستم»';
  END IF;
  v_prefix := CASE WHEN t.transaction_type = 'capital_adjustment' THEN 'رأس مال موجود بالفعل' ELSE 'سحب قبل السيستم' END;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'اكتب المبلغ'; END IF;
  IF p_day IS NULL THEN RAISE EXCEPTION 'اختار من إمتى بيتحسب'; END IF;
  IF p_day > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ مينفعش يكون بعد النهارده'; END IF;
  IF v_dep > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ مينفعش يكون بعد النهارده'; END IF;
  v_desc := CASE WHEN p_notes IS NULL THEN t.description ELSE v_prefix || coalesce(' — ' || nullif(btrim(p_notes), ''), '') END;
  IF v_amt = t.amount AND p_day = public.partner_tx_day(t) AND v_dep IS NOT DISTINCT FROM coalesce(t.deposited_on, public.partner_tx_day(t))
     AND v_desc IS NOT DISTINCT FROM t.description THEN
    RAISE EXCEPTION 'مفيش حاجة اتغيرت';
  END IF;
  IF t.transaction_type = 'capital_adjustment' AND EXISTS (SELECT 1 FROM public.partner_capital_settlements s
              WHERE s.tenant_id = t.tenant_id AND s.status = 'active' AND s.capital_by_partner ? t.partner_id::text) THEN
    RAISE EXCEPTION 'رأس المال ده اتقرر مصير فرقه — الغي القرار من «الفرق بين رأس المال والدفاتر» الأول';
  END IF;
  IF t.transaction_type = 'capital_withdrawal' THEN
    v_cap := (public.partner_cards(t.partner_id)->>'capital')::numeric + t.amount;
    IF v_amt > v_cap + 0.005 THEN RAISE EXCEPTION 'رأس ماله % بس — مينفعش يتسحب منه %', v_cap, v_amt; END IF;
  END IF;
  IF t.transaction_type <> 'profit_withdrawal'
     AND (v_amt <> t.amount OR date_trunc('month', p_day) <> date_trunc('month', public.partner_tx_day(t))) THEN
    PERFORM public._partner_capital_lock_check(t.tenant_id, least(date_trunc('month', p_day)::date, public._partner_tx_effective_month(t)));
  END IF;
  PERFORM set_config('app.partner_money', '1', true);
  INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by,
                                           movement_date, existing_capital, deposited_on, replaces, edited_by, edited_at, edit_reason)
  VALUES (t.tenant_id, t.partner_id, t.transaction_type, v_amt, v_desc, to_char(p_day, 'YYYY-MM'), t.created_by,
          p_day, true, v_dep, t.id, auth.uid(), now(), btrim(p_reason))
  RETURNING id INTO v_id;
  UPDATE public.partner_transactions SET is_void = true, cancel_reason = 'اتعدلت: ' || btrim(p_reason),
         cancelled_by = auth.uid(), cancelled_at = now(), replaced_by = v_id
   WHERE id = t.id;
  PERFORM set_config('app.partner_money', '', true);
  PERFORM public._partner_tx_move_files(t.id, v_id);
  RETURN v_id;
END $function$;

-- the cards: «تعديل» also for a pre-system withdrawal
DO $patch$
DECLARE d text := pg_get_functiondef('public.partner_cards(uuid)'::regprocedure); n text; a text; b text;
BEGIN
  a := $a$AND ((t.existing_capital AND t.transaction_type = 'capital_adjustment')$a$;
  b := $b$AND ((t.existing_capital AND t.transaction_type IN ('capital_adjustment', 'capital_withdrawal', 'profit_withdrawal'))$b$;
  IF position(a IN d) = 0 THEN RAISE EXCEPTION '0290: partner_cards editable text not found'; END IF;
  n := replace(d, a, b);
  EXECUTE n;
END $patch$;

-- «الفرق بين رأس المال والدفاتر»: a pre-system capital withdrawal lowers the recognised capital (so it is not counted
-- twice with a «سحب قبل السيستم» decision there)
DO $patch$
DECLARE d text := pg_get_functiondef('public.partner_capital_gap_info()'::regprocedure); n text;
BEGIN
  n := regexp_replace(d,
    'sum\(t\.amount\) FROM partner_transactions t WHERE t\.partner_id = p\.id AND t\.existing_capital\s+AND t\.transaction_type = ''capital_adjustment''',
    'sum(CASE WHEN t.transaction_type = ''capital_withdrawal'' THEN -t.amount ELSE t.amount END) FROM partner_transactions t WHERE t.partner_id = p.id AND t.existing_capital AND t.transaction_type IN (''capital_adjustment'', ''capital_withdrawal'')');
  IF n = d THEN RAISE EXCEPTION '0290: partner_capital_gap_info text not found'; END IF;
  EXECUTE n;
END $patch$;

GRANT EXECUTE ON FUNCTION public.partner_pre_system_withdrawal(uuid, numeric, date, text, date, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('partner_pre_system_withdrawal', '0290', 'owner / admin: money a partner took before the system (no till, no entry)')
ON CONFLICT DO NOTHING;
