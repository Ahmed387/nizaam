-- 0137: partners — five cards, withdrawals from capital / profit / both with an automatic advance, the operating share
-- and the employee-partner's salary as SALARY expense before the split, advances taken back at the next distribution,
-- same-day edit then cancel + new (owner «نفذ», 2026-10-30 and «صح» on the five cards, 2026-11-03).
--
-- Cards (partner_cards):
--   المساهمات = initial_capital + every contribution (never goes down)
--   المسحوبات من رأس المال = every capital_withdrawal
--   رأس المال لحد النهارده = المساهمات − المسحوبات من رأس المال
--   صافي الربح = given to him (profit_share + operating_share + salary_share) − taken (profit_withdrawal + advance_settle
--                + the old «drawing», which always came out of 3850)
--   السلف = advances still open (active / partially_paid)
--   Example: put in 1,000,000, took 200,000 from capital → capital 800,000. Profit card 150,000; he asks 200,000 «من
--   الربح» → 150,000 from profit, 50,000 becomes an advance by itself (cards: profit 0, advance 50,000). Next month his
--   share is 30,000 → the 30,000 pays the advance back, 20,000 stays an advance, the profit card stays 0.
-- Money moves in a branch vessel the owner picks, on the day he picks: ONE till row (no automatic voucher) and ONE journal
-- entry in that branch (source treasury_row): contribution Dr 1100 / Cr 3100; withdrawal Cr 1100 against Dr 3100 (capital
-- part), Dr 3850 (profit part), Dr 1400 (the advance part). Cancel = a mirror till row on the original day + the entry
-- reversed on its own day + the advance it opened cancelled.
-- Operating share / salary from profit (post_partner_period_shares, before distributing that period): percent × the
-- period's net profit, booked Dr 5200 «الرواتب» / Cr 3850 — so what is left is what the partners split by capital
-- (distribute_profits refuses until they are booked). A loss period has no automatic amount: the owner types it.
-- Capital for the split (partner_capital_for_month): a withdrawal from capital lowers it from the first of the next month,
-- the same rule a contribution already follows. The old money doors (record_partner_transaction,
-- partner_withdraw_from_distribution, set_partner_capital) moved money without a till row — they now point to the new one.
-- Percent columns are fractions like capital_share (0.10 = 10%).

ALTER TABLE public.equity_partners
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role_kind text NOT NULL DEFAULT 'partner',
  ADD COLUMN IF NOT EXISTS salary_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS salary_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salary_percent numeric(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salary_base text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS salary_branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS salary_when text NOT NULL DEFAULT 'before';
ALTER TABLE public.equity_partners DROP CONSTRAINT IF EXISTS equity_partners_role_kind_chk;
ALTER TABLE public.equity_partners ADD CONSTRAINT equity_partners_role_kind_chk CHECK (role_kind IN ('partner', 'employee_partner'));
ALTER TABLE public.equity_partners DROP CONSTRAINT IF EXISTS equity_partners_salary_chk;
ALTER TABLE public.equity_partners ADD CONSTRAINT equity_partners_salary_chk CHECK (salary_mode IN ('none', 'fixed', 'percent')
  AND salary_base IN ('company', 'branch') AND salary_when IN ('before', 'after')
  AND salary_percent >= 0 AND salary_percent <= 1 AND operating_share >= 0 AND operating_share <= 1);

ALTER TABLE public.partner_transactions
  ADD COLUMN IF NOT EXISTS distribution_id uuid REFERENCES public.profit_distributions(id),
  ADD COLUMN IF NOT EXISTS movement_date date,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id),
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS period_from date,
  ADD COLUMN IF NOT EXISTS period_to date,
  ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.partner_transactions DROP CONSTRAINT IF EXISTS partner_transactions_transaction_type_check;
ALTER TABLE public.partner_transactions ADD CONSTRAINT partner_transactions_transaction_type_check CHECK (transaction_type IN
  ('contribution', 'drawing', 'profit_share', 'capital_adjustment',
   'capital_withdrawal', 'profit_withdrawal', 'advance_settle', 'operating_share', 'salary_share'));
CREATE INDEX IF NOT EXISTS partner_transactions_treasury_idx ON public.partner_transactions (related_treasury_id) WHERE related_treasury_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_transactions_distribution_idx ON public.partner_transactions (distribution_id) WHERE distribution_id IS NOT NULL;

ALTER TABLE public.partner_advances ADD COLUMN IF NOT EXISTS treasury_id uuid REFERENCES public.treasury(id);

-- the partner's own triggers stay out of the way of the new doors (they write the till and the books themselves)
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.trg_partner_tx_journal()'::regprocedure);
  IF position('app.partner_money' IN d) = 0 THEN
    IF position($o$IF TG_OP <> 'INSERT' OR COALESCE(NEW.amount,0) = 0 THEN RETURN NEW; END IF;$o$ IN d) = 0 THEN
      RAISE EXCEPTION '0137: trg_partner_tx_journal not the expected version';
    END IF;
    EXECUTE replace(d, $o$IF TG_OP <> 'INSERT' OR COALESCE(NEW.amount,0) = 0 THEN RETURN NEW; END IF;$o$,
      $n$IF TG_OP <> 'INSERT' OR COALESCE(NEW.amount,0) = 0 THEN RETURN NEW; END IF;
  -- 0137: partner_money / the distribution / the period shares write their own till row and journal entry
  IF COALESCE(current_setting('app.partner_money', true), '') = '1' THEN RETURN NEW; END IF;$n$);
  END IF;
  d := pg_get_functiondef('public.trg_partner_advance_journal()'::regprocedure);
  IF position('app.partner_money' IN d) = 0 THEN
    IF position($o$IF TG_OP = 'INSERT' AND COALESCE(NEW.amount,0) > 0 THEN$o$ IN d) = 0 THEN
      RAISE EXCEPTION '0137: trg_partner_advance_journal not the expected version';
    END IF;
    EXECUTE replace(d, $o$IF TG_OP = 'INSERT' AND COALESCE(NEW.amount,0) > 0 THEN$o$,
      $n$IF COALESCE(current_setting('app.partner_money', true), '') = '1' THEN RETURN NEW; END IF;   -- 0137: partner_money books it
  IF TG_OP = 'INSERT' AND COALESCE(NEW.amount,0) > 0 THEN$n$);
  END IF;
END
$mig$;

-- the day of a partner movement (back-dated ones carry movement_date)
CREATE OR REPLACE FUNCTION public.partner_tx_day(t public.partner_transactions)
 RETURNS date LANGUAGE sql IMMUTABLE AS $f$ SELECT coalesce(t.movement_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date) $f$;

-- capital used for the split of a month: what he had in on the 1st of that month (withdrawals from capital count too)
CREATE OR REPLACE FUNCTION public.partner_capital_for_month(p_partner_id uuid, p_month date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(p.initial_capital, 0)
       + coalesce((SELECT sum(CASE WHEN t.transaction_type = 'capital_withdrawal' THEN -t.amount ELSE t.amount END)
                     FROM public.partner_transactions t
                    WHERE t.partner_id = p.id AND t.transaction_type IN ('contribution', 'capital_withdrawal') AND coalesce(t.is_void, false) = false
                      AND coalesce(t.description, '') <> 'تعديل رأس المال المدفوع'
                      AND public.partner_tx_day(t) < date_trunc('month', p_month)::date), 0)
  FROM public.equity_partners p WHERE p.id = p_partner_id;
$function$;

-- the old balance view, with the new kinds signed right (contribution / profit in = +, any withdrawal / settle = −)
CREATE OR REPLACE VIEW public.v_partner_balances WITH (security_invoker = true) AS
 SELECT ep.id AS partner_id, ep.tenant_id,
    COALESCE(sum(CASE WHEN pt.transaction_type = 'contribution' AND NOT COALESCE(pt.is_void, false) THEN pt.amount ELSE 0 END), 0) AS total_contributions,
    COALESCE(sum(CASE WHEN pt.transaction_type IN ('drawing', 'capital_withdrawal', 'profit_withdrawal') AND NOT COALESCE(pt.is_void, false) THEN pt.amount ELSE 0 END), 0) AS total_drawings,
    COALESCE(sum(CASE WHEN pt.transaction_type IN ('profit_share', 'operating_share', 'salary_share') AND NOT COALESCE(pt.is_void, false) THEN pt.amount ELSE 0 END), 0) AS total_profit_share,
    COALESCE(sum(CASE WHEN COALESCE(pt.is_void, false) THEN 0
                      WHEN pt.transaction_type IN ('drawing', 'capital_withdrawal', 'profit_withdrawal', 'advance_settle') THEN -pt.amount
                      ELSE pt.amount END), 0) AS current_balance
   FROM public.equity_partners ep LEFT JOIN public.partner_transactions pt ON pt.partner_id = ep.id
  GROUP BY ep.id, ep.tenant_id;

-- the five cards (+ the lines under each) — the owner / admin, or the partner himself
CREATE OR REPLACE FUNCTION public.partner_cards(p_partner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p public.equity_partners%ROWTYPE; v_contrib numeric; v_capw numeric; v_in numeric; v_out numeric; v_adv numeric;
  v_legacy text := 'تعديل رأس المال المدفوع';
BEGIN
  SELECT * INTO p FROM public.equity_partners WHERE id = p_partner;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  IF NOT (public.is_super_admin(auth.uid()) OR (p.tenant_id = public.current_tenant_id()
          AND (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()) OR public.is_partner_owner(p_partner)))) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  -- «تعديل رأس المال المدفوع» rows only mirror initial_capital (set_partner_capital) — they are not counted twice
  SELECT coalesce(p.initial_capital, 0)
         + coalesce(sum(amount) FILTER (WHERE transaction_type IN ('contribution', 'capital_adjustment') AND coalesce(description, '') <> v_legacy), 0),
         coalesce(sum(amount) FILTER (WHERE transaction_type = 'capital_withdrawal'), 0),
         coalesce(sum(amount) FILTER (WHERE transaction_type IN ('profit_share', 'operating_share', 'salary_share')), 0),
         coalesce(sum(amount) FILTER (WHERE transaction_type IN ('profit_withdrawal', 'advance_settle')
                                         OR (transaction_type = 'drawing' AND coalesce(description, '') <> v_legacy)), 0)
    INTO v_contrib, v_capw, v_in, v_out
    FROM public.partner_transactions WHERE partner_id = p_partner AND NOT coalesce(is_void, false);
  SELECT coalesce(sum(remaining_amount), 0) INTO v_adv FROM public.partner_advances
   WHERE partner_id = p_partner AND status IN ('active', 'partially_paid') AND remaining_amount > 0;
  RETURN jsonb_build_object(
    'partner', jsonb_build_object('id', p.id, 'name', p.name, 'role_kind', p.role_kind, 'employee_id', p.employee_id,
      'capital_share', p.capital_share, 'operating_share', p.operating_share, 'is_active', p.is_active,
      'salary_mode', p.salary_mode, 'salary_amount', p.salary_amount, 'salary_percent', p.salary_percent,
      'salary_base', p.salary_base, 'salary_branch_id', p.salary_branch_id, 'salary_when', p.salary_when,
      'start_date', p.partnership_start_date, 'notes', p.notes, 'initial_capital', p.initial_capital),
    'contributions', round(v_contrib, 2), 'capital_withdrawals', round(v_capw, 2), 'capital', round(v_contrib - v_capw, 2),
    'profit', round(v_in - v_out, 2), 'profit_in', round(v_in, 2), 'profit_out', round(v_out, 2), 'advances', round(v_adv, 2),
    'movements', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'type', t.transaction_type, 'amount', t.amount,
        'date', public.partner_tx_day(t), 'created_at', t.created_at, 'description', t.description, 'branch_id', t.branch_id,
        'method', t.payment_method, 'void', coalesce(t.is_void, false), 'cancel_reason', t.cancel_reason,
        'distribution_id', t.distribution_id, 'treasury_id', t.related_treasury_id,
        'editable', NOT coalesce(t.is_void, false) AND t.transaction_type = 'contribution' AND t.related_treasury_id IS NOT NULL
                    AND (t.created_at AT TIME ZONE 'Africa/Cairo')::date = public.cairo_today(),
        'cancellable', NOT coalesce(t.is_void, false) AND t.related_treasury_id IS NOT NULL AND t.distribution_id IS NULL)
        ORDER BY public.partner_tx_day(t) DESC, t.created_at DESC)
      FROM public.partner_transactions t WHERE t.partner_id = p_partner AND t.amount <> 0), '[]'::jsonb),
    'advances_list', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount, 'remaining', a.remaining_amount,
        'date', a.advance_date, 'status', a.status, 'reason', a.reason,
        'paid_back', coalesce((SELECT sum(x.amount) FROM public.partner_advance_payments x WHERE x.advance_id = a.id AND x.status = 'active'), 0))
        ORDER BY a.advance_date DESC)
      FROM public.partner_advances a WHERE a.partner_id = p_partner), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.partners_overview()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(public.partner_cards(ep.id) - 'movements' - 'advances_list' ORDER BY ep.is_active DESC, ep.name), '[]'::jsonb)
    FROM public.equity_partners ep
   WHERE ep.tenant_id = public.current_tenant_id()
     AND (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid()) OR public.is_partner_owner(ep.id));
$function$;

-- put in / take out — the owner picks the branch, the vessel and the day
CREATE OR REPLACE FUNCTION public.partner_money(p_partner uuid, p_kind text, p_amount numeric, p_source text DEFAULT 'capital',
  p_capital_part numeric DEFAULT NULL, p_branch uuid DEFAULT NULL, p_method text DEFAULT 'cash', p_date date DEFAULT NULL, p_notes text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p public.equity_partners%ROWTYPE; c jsonb; v_day date := coalesce(p_date, public.cairo_today()); v_at timestamptz;
  v_cap numeric := 0; v_prof numeric := 0; v_take numeric := 0; v_adv numeric := 0; v_tr uuid; v_lines jsonb;
  v_pm text := coalesce(nullif(btrim(p_method), ''), 'cash'); v_adv_id uuid; v_desc text; v_amt numeric := round(p_amount, 2);
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'حركات الشركاء للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.equity_partners WHERE id = p_partner AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF p_branch IS NULL THEN RAISE EXCEPTION 'اختار الفرع اللي الفلوس هتدخل / تطلع منه'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch AND tenant_id = p.tenant_id) THEN RAISE EXCEPTION 'الفرع غير موجود'; END IF;
  IF NOT public.vessel_is_known(p.tenant_id, v_pm) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_pm; END IF;
  IF v_day > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ في المستقبل'; END IF;
  v_at := CASE WHEN v_day = public.cairo_today() THEN now() ELSE (v_day + time '12:00') AT TIME ZONE 'Africa/Cairo' END;
  PERFORM set_config('app.partner_money', '1', true);
  PERFORM set_config('app.skip_treasury_voucher', '1', true);

  IF p_kind = 'contribution' THEN
    v_desc := coalesce(nullif(btrim(p_notes), ''), 'مساهمة رأس مال — ' || p.name);
    INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by, payment_method, transaction_date, created_at)
    VALUES (p_branch, p.tenant_id, 'income', 'partner_contribution', v_amt, v_desc, p.id, auth.uid(), v_pm, v_day, v_at) RETURNING id INTO v_tr;
    INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, related_treasury_id,
                                             created_by, movement_date, branch_id, payment_method)
    VALUES (p.tenant_id, p.id, 'contribution', v_amt, v_desc, to_char(v_day, 'YYYY-MM'), v_tr, auth.uid(), v_day, p_branch, v_pm);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', v_amt, 'credit', 0, 'description', v_desc),
      jsonb_build_object('account_code', '3100', 'debit', 0, 'credit', v_amt, 'description', 'رأس مال ' || p.name));
    v_cap := v_amt;
  ELSIF p_kind = 'withdrawal' THEN
    c := public.partner_cards(p.id);
    v_cap := CASE p_source WHEN 'capital' THEN v_amt WHEN 'profit' THEN 0 WHEN 'split' THEN round(coalesce(p_capital_part, 0), 2) ELSE NULL END;
    IF v_cap IS NULL THEN RAISE EXCEPTION 'اختار: من رأس المال، ولا من الربح، ولا جزء من ده وجزء من ده'; END IF;
    IF v_cap < 0 OR v_cap > v_amt THEN RAISE EXCEPTION 'جزء رأس المال لازم يكون بين صفر و %', v_amt; END IF;
    IF v_cap > (c->>'capital')::numeric + 0.005 THEN
      RAISE EXCEPTION 'رأس ماله % بس — مينفعش يسحب منه %', (c->>'capital')::numeric, v_cap;
    END IF;
    v_prof := round(v_amt - v_cap, 2);
    v_take := least(v_prof, greatest((c->>'profit')::numeric, 0));
    v_adv := round(v_prof - v_take, 2);     -- what is above his profit becomes an advance by itself
    v_desc := coalesce(nullif(btrim(p_notes), ''), 'سحب شريك — ' || p.name);
    INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by, payment_method, transaction_date, created_at)
    VALUES (p_branch, p.tenant_id, 'expense', 'partner_withdrawal', v_amt, v_desc, p.id, auth.uid(), v_pm, v_day, v_at) RETURNING id INTO v_tr;
    IF v_cap > 0 THEN
      INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, related_treasury_id,
                                               created_by, movement_date, branch_id, payment_method)
      VALUES (p.tenant_id, p.id, 'capital_withdrawal', v_cap, v_desc || ' (من رأس المال)', to_char(v_day, 'YYYY-MM'), v_tr, auth.uid(), v_day, p_branch, v_pm);
    END IF;
    IF v_take > 0 THEN
      INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, related_treasury_id,
                                               created_by, movement_date, branch_id, payment_method)
      VALUES (p.tenant_id, p.id, 'profit_withdrawal', v_take, v_desc || ' (من الربح)', to_char(v_day, 'YYYY-MM'), v_tr, auth.uid(), v_day, p_branch, v_pm);
    END IF;
    IF v_adv > 0 THEN
      INSERT INTO public.partner_advances (tenant_id, partner_id, amount, remaining_amount, advance_date, installments_count, monthly_deduction,
                                           status, reason, created_by, treasury_id)
      VALUES (p.tenant_id, p.id, v_adv, v_adv, v_day, 1, v_adv, 'active', 'سحب أكتر من ربحه — بيتخصم من التوزيع الجاي', auth.uid(), v_tr)
      RETURNING id INTO v_adv_id;
    END IF;
    v_lines := jsonb_build_array(jsonb_build_object('account_code', '1100', 'debit', 0, 'credit', v_amt, 'description', v_desc));
    IF v_cap > 0 THEN v_lines := v_lines || jsonb_build_object('account_code', '3100', 'debit', v_cap, 'credit', 0, 'description', 'سحب من رأس مال ' || p.name); END IF;
    IF v_take > 0 THEN v_lines := v_lines || jsonb_build_object('account_code', '3850', 'debit', v_take, 'credit', 0, 'description', 'سحب من ربح ' || p.name); END IF;
    IF v_adv > 0 THEN v_lines := v_lines || jsonb_build_object('account_code', '1400', 'debit', v_adv, 'credit', 0, 'description', 'سلفة ' || p.name || ' (زيادة عن ربحه)'); END IF;
  ELSE
    RAISE EXCEPTION 'نوع الحركة غير معروف';
  END IF;

  PERFORM public.post_journal(p.tenant_id, v_day, v_desc, 'treasury_row', v_tr, v_lines);
  PERFORM set_config('app.skip_treasury_voucher', '0', true);
  PERFORM set_config('app.partner_money', '', true);
  RETURN jsonb_build_object('treasury_id', v_tr, 'capital', v_cap, 'profit', v_take, 'advance', v_adv, 'advance_id', v_adv_id,
                            'cards', public.partner_cards(p.id) - 'movements' - 'advances_list');
END $function$;

-- cancel = a mirror till row on the original day + the entry reversed + the advance it opened cancelled
CREATE OR REPLACE FUNCTION public.cancel_partner_transaction(p_tx uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t public.partner_transactions%ROWTYPE; r public.treasury%ROWTYPE; v_paid numeric; v_n int;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  SELECT * INTO t FROM public.partner_transactions WHERE id = p_tx AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR coalesce(t.is_void, false) THEN RAISE EXCEPTION 'الحركة غير موجودة أو ملغية'; END IF;
  IF t.distribution_id IS NOT NULL OR t.transaction_type IN ('profit_share', 'advance_settle') THEN RAISE EXCEPTION 'دي من توزيع — اعكس التوزيع نفسه'; END IF;
  IF t.transaction_type IN ('operating_share', 'salary_share') THEN RAISE EXCEPTION 'دي حصة فترة — الغيها من «حصص التشغيل والمرتبات»'; END IF;
  IF t.related_treasury_id IS NULL THEN RAISE EXCEPTION 'الحركة دي قديمة (من غير خزنة) — مينفعش تتلغي من هنا'; END IF;
  SELECT * INTO r FROM public.treasury WHERE id = t.related_treasury_id;
  -- the advance it opened must not be paid back yet
  SELECT coalesce(sum(x.amount), 0) INTO v_paid FROM public.partner_advances a JOIN public.partner_advance_payments x ON x.advance_id = a.id
   WHERE a.treasury_id = r.id AND x.status = 'active';
  IF v_paid > 0 THEN RAISE EXCEPTION 'السلفة اللي طلعت من السحب ده اتسدد منها % — اعكس التوزيع الأول', v_paid; END IF;
  -- every partner movement of the same till row goes together (a withdrawal can be capital + profit + advance)
  UPDATE public.partner_transactions SET is_void = true, cancel_reason = btrim(p_reason)
   WHERE related_treasury_id = r.id AND NOT coalesce(is_void, false);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.partner_advances SET status = 'cancelled', remaining_amount = 0, updated_at = now(),
         notes = coalesce(notes || E'\n', '') || 'اتلغى مع السحب: ' || btrim(p_reason)
   WHERE treasury_id = r.id AND status <> 'cancelled';
  PERFORM set_config('app.skip_treasury_voucher', '1', true);
  INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by, payment_method, transaction_date, created_at)
  VALUES (r.branch_id, r.tenant_id, CASE WHEN r.type = 'income' THEN 'expense'::treasury_type ELSE 'income'::treasury_type END,
          'partner_cancel', r.amount, 'إلغاء ' || coalesce(r.description, 'حركة شريك') || ' — ' || btrim(p_reason), r.reference_id, auth.uid(),
          r.payment_method, r.transaction_date, now());
  PERFORM set_config('app.skip_treasury_voucher', '0', true);
  PERFORM set_config('app.reverse_on_original_date', '1', true);
  PERFORM public.reverse_journal_for_source(r.tenant_id, 'treasury_row', r.id, 'إلغاء حركة شريك — ' || btrim(p_reason));
  PERFORM set_config('app.reverse_on_original_date', '', true);
  RETURN jsonb_build_object('voided', v_n, 'amount', r.amount);
END $function$;

-- a contribution can be corrected on its own (Cairo) day; after that: cancel + a new one
CREATE OR REPLACE FUNCTION public.edit_partner_contribution(p_tx uuid, p_amount numeric, p_notes text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t public.partner_transactions%ROWTYPE; v jsonb;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.partner_transactions WHERE id = p_tx AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR coalesce(t.is_void, false) THEN RAISE EXCEPTION 'الحركة غير موجودة أو ملغية'; END IF;
  IF t.transaction_type <> 'contribution' THEN RAISE EXCEPTION 'التعديل للمساهمة بس — غيرها الغيه واعمل حركة جديدة'; END IF;
  IF (t.created_at AT TIME ZONE 'Africa/Cairo')::date <> public.cairo_today() THEN
    RAISE EXCEPTION 'التعديل في نفس يوم الحركة بس — دلوقتي الغيها واعمل حركة جديدة';
  END IF;
  IF t.related_treasury_id IS NULL OR t.branch_id IS NULL THEN RAISE EXCEPTION 'الحركة دي قديمة — الغيها واعمل حركة جديدة'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  -- the old one leaves on its day, the corrected one comes in on the same day (the till ends up changed by the difference)
  PERFORM public.cancel_partner_transaction(p_tx, 'تعديل المبلغ ' || t.amount || ' ← ' || round(p_amount, 2));
  v := public.partner_money(t.partner_id, 'contribution', p_amount, 'capital', NULL, t.branch_id, t.payment_method,
                            t.movement_date, coalesce(nullif(btrim(p_notes), ''), t.description));
  RETURN v || jsonb_build_object('old', p_tx, 'difference', round(p_amount - t.amount, 2));
END $function$;

-- operating share / salary from profit for a period — what will be booked as salary expense before the split
CREATE OR REPLACE FUNCTION public.partner_period_shares_preview(p_from date, p_to date, p_overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id(); v_net numeric; v_ops numeric := 0; r record; v_rows jsonb := '[]'::jsonb;
  v_amt numeric; v_base numeric; v_key text; v_booked numeric; o jsonb := coalesce(p_overrides, '{}'::jsonb);
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'الفترة غلط'; END IF;
  -- shares already booked for this period are part of its expenses — put them back to get the profit before them
  SELECT coalesce(sum(amount), 0) INTO v_booked FROM public.partner_transactions WHERE tenant_id = v_t AND NOT coalesce(is_void, false)
     AND transaction_type IN ('operating_share', 'salary_share') AND period_from = p_from AND period_to = p_to;
  v_net := round((public.profit_statement_core(v_t, p_from, p_to, NULL)->'total'->>'net_profit')::numeric + v_booked, 2);
  FOR r IN SELECT * FROM public.equity_partners WHERE tenant_id = v_t AND is_active AND operating_share > 0 ORDER BY name LOOP
    v_key := r.id::text || ':operating';
    v_amt := CASE WHEN o ? v_key THEN round((o->>v_key)::numeric, 2) WHEN v_net > 0 THEN round(v_net * r.operating_share, 2) ELSE 0 END;
    v_ops := v_ops + v_amt;
    v_rows := v_rows || jsonb_build_object('key', v_key, 'partner_id', r.id, 'name', r.name, 'kind', 'operating_share',
      'percent', r.operating_share, 'base', v_net, 'branch_id', NULL, 'amount', v_amt, 'typed', o ? v_key, 'needs_owner', v_net <= 0 AND NOT o ? v_key);
  END LOOP;
  FOR r IN SELECT * FROM public.equity_partners WHERE tenant_id = v_t AND is_active AND salary_mode = 'percent' AND salary_percent > 0 ORDER BY name LOOP
    v_key := r.id::text || ':salary';
    v_base := round(CASE WHEN r.salary_base = 'branch' AND r.salary_branch_id IS NOT NULL
                         THEN (public.profit_statement_core(v_t, p_from, p_to, r.salary_branch_id)->'total'->>'net_profit')::numeric
                         ELSE v_net END
                    - CASE WHEN r.salary_when = 'after' THEN v_ops ELSE 0 END, 2);
    v_amt := CASE WHEN o ? v_key THEN round((o->>v_key)::numeric, 2) WHEN v_base > 0 THEN round(v_base * r.salary_percent, 2) ELSE 0 END;
    v_rows := v_rows || jsonb_build_object('key', v_key, 'partner_id', r.id, 'name', r.name, 'kind', 'salary_share',
      'percent', r.salary_percent, 'base', v_base, 'branch_id', CASE WHEN r.salary_base = 'branch' THEN r.salary_branch_id END,
      'salary_base', r.salary_base, 'salary_when', r.salary_when, 'amount', v_amt, 'typed', o ? v_key, 'needs_owner', v_base <= 0 AND NOT o ? v_key);
  END LOOP;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'net_before', v_net, 'rows', v_rows,
    'total', coalesce((SELECT sum((e->>'amount')::numeric) FROM jsonb_array_elements(v_rows) e), 0),
    'already', EXISTS (SELECT 1 FROM public.partner_transactions WHERE tenant_id = v_t AND NOT coalesce(is_void, false)
                         AND transaction_type IN ('operating_share', 'salary_share') AND period_from = p_from AND period_to = p_to));
END $function$;

CREATE OR REPLACE FUNCTION public.post_partner_period_shares(p_from date, p_to date, p_overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id(); v jsonb; x jsonb; v_tx uuid; v_je uuid; n int := 0;
BEGIN
  v := public.partner_period_shares_preview(p_from, p_to, p_overrides);
  IF (v->>'already')::boolean THEN RAISE EXCEPTION 'حصص التشغيل / المرتبات من الربح للفترة دي اتسجلت قبل كده'; END IF;
  IF jsonb_array_length(v->'rows') = 0 THEN RAISE EXCEPTION 'مفيش شريك ليه حصة تشغيل أو مرتب نسبة'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v->'rows') e WHERE (e->>'needs_owner')::boolean) THEN
    RAISE EXCEPTION 'الفترة خسرانة — اكتب مرتب / حصة كل واحد بنفسك (ولو مفيش اكتب صفر)';
  END IF;
  PERFORM set_config('app.partner_money', '1', true);
  FOR x IN SELECT value FROM jsonb_array_elements(v->'rows') LOOP
    IF (x->>'amount')::numeric < 0 THEN RAISE EXCEPTION 'المبلغ مينفعش يكون بالسالب'; END IF;
    -- a zero row is kept too: it says «the owner decided nothing for this period»
    INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by,
                                             movement_date, period_from, period_to, branch_id)
    VALUES (v_t, (x->>'partner_id')::uuid, x->>'kind', (x->>'amount')::numeric,
            CASE WHEN x->>'kind' = 'operating_share' THEN 'حصة تشغيل ' ELSE 'مرتب من الربح ' END || p_from || ' → ' || p_to,
            to_char(p_to, 'YYYY-MM'), auth.uid(), p_to, p_from, p_to, nullif(x->>'branch_id', '')::uuid)
    RETURNING id INTO v_tx;
    IF (x->>'amount')::numeric > 0 THEN
      v_je := public.post_journal(v_t, p_to, CASE WHEN x->>'kind' = 'operating_share' THEN 'حصة تشغيل — ' ELSE 'مرتب من الربح — ' END || (x->>'name'),
        'partner_transaction', v_tx,
        jsonb_build_array(jsonb_build_object('account_code', '5200', 'debit', (x->>'amount')::numeric, 'credit', 0, 'description', 'مرتبات الشركاء'),
                          jsonb_build_object('account_code', '3850', 'debit', 0, 'credit', (x->>'amount')::numeric, 'description', 'مستحق لـ ' || (x->>'name'))));
      IF nullif(x->>'branch_id', '') IS NOT NULL THEN
        UPDATE public.journal_entries SET branch_id = (x->>'branch_id')::uuid WHERE id = v_je;
      END IF;
    END IF;
    n := n + 1;
  END LOOP;
  PERFORM set_config('app.partner_money', '', true);
  RETURN jsonb_build_object('posted', n, 'preview', v);
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_partner_period_shares(p_from date, p_to date, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id(); r record; n int := 0;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  IF EXISTS (SELECT 1 FROM public.profit_distributions WHERE tenant_id = v_t AND status = 'posted' AND period_from = p_from AND period_to = p_to) THEN
    RAISE EXCEPTION 'الفترة دي اتوزعت — اعكس التوزيع الأول';
  END IF;
  FOR r IN SELECT * FROM public.partner_transactions WHERE tenant_id = v_t AND NOT coalesce(is_void, false)
              AND transaction_type IN ('operating_share', 'salary_share') AND period_from = p_from AND period_to = p_to FOR UPDATE LOOP
    UPDATE public.partner_transactions SET is_void = true, cancel_reason = btrim(p_reason) WHERE id = r.id;
    PERFORM set_config('app.reverse_on_original_date', '1', true);
    PERFORM public.reverse_journal_for_source(v_t, 'partner_transaction', r.id, 'إلغاء حصة فترة — ' || btrim(p_reason));
    PERFORM set_config('app.reverse_on_original_date', '', true);
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('voided', n);
END $function$;

-- the distribution: shares by capital (unchanged), then each partner's open advances are paid back from his share first
CREATE OR REPLACE FUNCTION public.distribute_profits(p_tenant_id uuid, p_fiscal_period_id uuid, p_total_amount numeric, p_distribution_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_period_from date DEFAULT NULL::date, p_period_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dist_id uuid; v_entry_id uuid; v_entry_number text; v_retained uuid; v_payable uuid; v_adv_acc uuid;
  v_line_order int := 1; v_ptx_id uuid; v_month_year text; v_from date; v_to date; v_avail jsonb;
  v_sum numeric := 0; v_n int := 0; v_count int; r record; v_amt numeric;
  a record; v_left numeric; v_off numeric; v_settled numeric := 0;
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

  -- 0137: the operating share / salary from profit are taken first (as salary expense)
  IF EXISTS (SELECT 1 FROM public.equity_partners WHERE tenant_id = p_tenant_id AND is_active
               AND (operating_share > 0 OR (salary_mode = 'percent' AND salary_percent > 0)))
     AND NOT EXISTS (SELECT 1 FROM public.partner_transactions WHERE tenant_id = p_tenant_id AND NOT coalesce(is_void, false)
               AND transaction_type IN ('operating_share', 'salary_share') AND period_from = v_from AND period_to = v_to) THEN
    RAISE EXCEPTION 'سجّل «حصص التشغيل والمرتبات من الربح» للفترة % → % الأول — بتتخصم قبل التوزيع', v_from, v_to;
  END IF;

  v_avail := public.available_to_distribute(p_tenant_id, v_from, v_to);
  IF p_total_amount > (v_avail->>'available')::numeric + 0.01 THEN
    RAISE EXCEPTION 'المبلغ (%) أكبر من المتاح للتوزيع عن الفترة % → % — صافي الربح % وسبق توزيع %',
      round(p_total_amount,2), v_from, v_to, round((v_avail->>'net_profit')::numeric,2), round((v_avail->>'already_distributed')::numeric,2)
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_retained FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '3800' LIMIT 1;
  SELECT id INTO v_payable  FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '3850' LIMIT 1;
  SELECT id INTO v_adv_acc  FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '1400' LIMIT 1;
  IF v_retained IS NULL OR v_payable IS NULL OR v_adv_acc IS NULL THEN RAISE EXCEPTION 'حسابات التوزيع (3800/3850/1400) غير موجودة'; END IF;

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

  PERFORM set_config('app.partner_money', '1', true);
  FOR r IN SELECT s.partner_id, s.name, round(sum(s.amount), 2) AS amount
             FROM public.partner_split_by_month(p_tenant_id, v_from, v_to, p_total_amount) s
            GROUP BY s.partner_id, s.name ORDER BY 3 DESC LOOP
    v_n := v_n + 1;
    v_amt := CASE WHEN v_n = v_count THEN round(p_total_amount - v_sum, 2) ELSE r.amount END;
    v_sum := v_sum + v_amt;
    CONTINUE WHEN v_amt = 0;

    INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by, movement_date, distribution_id)
    VALUES (p_tenant_id, r.partner_id, 'profit_share', v_amt, 'نصيب من توزيع ' || v_from || ' → ' || v_to, v_month_year, auth.uid(), p_distribution_date, v_dist_id)
    RETURNING id INTO v_ptx_id;
    INSERT INTO public.profit_distribution_lines (distribution_id, partner_id, share_percentage, amount, partner_transaction_id)
    VALUES (v_dist_id, r.partner_id, round(v_amt * 100 / p_total_amount, 4), v_amt, v_ptx_id);
    v_line_order := v_line_order + 1;
    INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
    VALUES (p_tenant_id, v_entry_id, v_payable, 0, v_amt, 'مستحق للشريك ' || r.name, v_line_order);

    -- 0137: his open advances are paid back from the share first, oldest first
    --   (share 30,000, advance 50,000 → 30,000 back, 20,000 stays an advance)
    v_left := v_amt;
    FOR a IN SELECT * FROM public.partner_advances WHERE partner_id = r.partner_id AND status IN ('active', 'partially_paid')
                AND remaining_amount > 0 ORDER BY advance_date, created_at FOR UPDATE LOOP
      EXIT WHEN v_left <= 0;
      v_off := least(v_left, a.remaining_amount);
      UPDATE public.partner_advances SET remaining_amount = round(remaining_amount - v_off, 2),
             status = CASE WHEN remaining_amount - v_off <= 0.005 THEN 'fully_paid' ELSE 'partially_paid' END, updated_at = now()
       WHERE id = a.id;
      INSERT INTO public.partner_advance_payments (advance_id, amount, payment_date, payment_method, reference_type, reference_id, notes, created_by, status)
      VALUES (a.id, v_off, p_distribution_date, 'profit_deduction', 'profit_distribution', v_dist_id, 'اتخصم من توزيع ' || v_from || ' → ' || v_to, auth.uid(), 'active');
      v_left := v_left - v_off;
    END LOOP;
    IF v_amt - v_left > 0 THEN
      v_settled := v_settled + (v_amt - v_left);
      INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by, movement_date, distribution_id)
      VALUES (p_tenant_id, r.partner_id, 'advance_settle', v_amt - v_left, 'سداد سلفة من توزيع ' || v_from || ' → ' || v_to, v_month_year, auth.uid(), p_distribution_date, v_dist_id);
      v_line_order := v_line_order + 1;
      INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (p_tenant_id, v_entry_id, v_payable, v_amt - v_left, 0, 'سداد سلفة ' || r.name || ' من نصيبه', v_line_order);
      v_line_order := v_line_order + 1;
      INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (p_tenant_id, v_entry_id, v_adv_acc, 0, v_amt - v_left, 'سلفة ' || r.name, v_line_order);
    END IF;
  END LOOP;
  PERFORM set_config('app.partner_money', '', true);

  UPDATE public.journal_entries je SET status = 'posted',
         total_debit  = coalesce((SELECT sum(debit)  FROM public.journal_entry_lines WHERE entry_id = v_entry_id), 0),
         total_credit = coalesce((SELECT sum(credit) FROM public.journal_entry_lines WHERE entry_id = v_entry_id), 0)
   WHERE je.id = v_entry_id;
  UPDATE public.profit_distributions SET journal_entry_id = v_entry_id WHERE id = v_dist_id;

  RETURN jsonb_build_object('distribution_id', v_dist_id, 'journal_entry_id', v_entry_id,
    'total_amount', p_total_amount, 'period_from', v_from, 'period_to', v_to, 'advances_settled', v_settled);
END $function$;

-- reversing a distribution also voids what it paid back (advance_settle); the advances open again (0136 already does that)
DO $mig$
DECLARE d text := pg_get_functiondef('public.reverse_profit_distribution(uuid,uuid,text)'::regprocedure);
  o text := '  -- Restore partner advances that were settled by this distribution';
BEGIN
  IF position('advance_settle' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0137: reverse_profit_distribution not the expected version'; END IF;
  EXECUTE replace(d, o, $n$  -- 0137: the advance paid back from this distribution is open again — its «سداد سلفة» (advance_settle) goes too
  UPDATE public.partner_transactions SET is_void = true, cancel_reason = 'عكس التوزيع: ' || coalesce(p_reason, '')
   WHERE distribution_id = p_distribution_id AND NOT coalesce(is_void, false);

$n$ || o);
END
$mig$;

-- the partner record itself (add / promote an employee / change his answers)
CREATE OR REPLACE FUNCTION public.save_partner(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id(); v_id uuid := nullif(p->>'id', '')::uuid; v_emp uuid := nullif(p->>'employee_id', '')::uuid;
  v_kind text := coalesce(nullif(p->>'role_kind', ''), 'partner'); v_mode text := coalesce(nullif(p->>'salary_mode', ''), 'none');
  v_user uuid; v_name text;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF v_kind = 'employee_partner' AND v_emp IS NULL THEN RAISE EXCEPTION '«موظف وشريك» محتاج تختار الموظف'; END IF;
  IF v_emp IS NOT NULL THEN
    SELECT user_id, name INTO v_user, v_name FROM public.employees WHERE id = v_emp AND tenant_id = v_t;
    IF NOT FOUND THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
    IF EXISTS (SELECT 1 FROM public.equity_partners WHERE employee_id = v_emp AND id IS DISTINCT FROM v_id) THEN
      RAISE EXCEPTION 'الموظف ده شريك بالفعل';
    END IF;
  END IF;
  v_name := coalesce(nullif(btrim(p->>'name'), ''), v_name);
  IF v_name IS NULL THEN RAISE EXCEPTION 'اكتب اسم الشريك'; END IF;
  IF v_kind = 'partner' THEN v_mode := 'none'; END IF;
  IF v_mode = 'percent' AND coalesce((p->>'salary_percent')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'اكتب نسبة المرتب'; END IF;
  IF v_mode = 'percent' AND p->>'salary_base' = 'branch' AND nullif(p->>'salary_branch_id', '') IS NULL THEN RAISE EXCEPTION 'اختار الفرع اللي المرتب نسبة من ربحه'; END IF;
  IF v_mode = 'fixed' AND coalesce((p->>'salary_amount')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'اكتب المرتب الثابت'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.equity_partners (tenant_id, name, partner_type, capital_share, operating_share, initial_capital, is_active,
      partnership_start_date, notes, employee_id, role_kind, salary_mode, salary_amount, salary_percent, salary_base, salary_branch_id, salary_when)
    VALUES (v_t, v_name, CASE WHEN coalesce((p->>'operating_share')::numeric, 0) > 0 THEN 'operating' ELSE 'capital' END,
            coalesce((p->>'capital_share')::numeric, 0), coalesce((p->>'operating_share')::numeric, 0), 0, true,
            coalesce(nullif(p->>'start_date', '')::date, public.cairo_today()), nullif(p->>'notes', ''), v_emp, v_kind, v_mode,
            CASE WHEN v_mode = 'fixed' THEN coalesce((p->>'salary_amount')::numeric, 0) ELSE 0 END,
            CASE WHEN v_mode = 'percent' THEN coalesce((p->>'salary_percent')::numeric, 0) ELSE 0 END,
            coalesce(nullif(p->>'salary_base', ''), 'company'),
            CASE WHEN p->>'salary_base' = 'branch' THEN nullif(p->>'salary_branch_id', '')::uuid END,
            coalesce(nullif(p->>'salary_when', ''), 'before'))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.equity_partners SET
      name = v_name, operating_share = coalesce((p->>'operating_share')::numeric, operating_share),
      partner_type = CASE WHEN coalesce((p->>'operating_share')::numeric, operating_share) > 0 THEN 'operating' ELSE 'capital' END,
      capital_share = coalesce((p->>'capital_share')::numeric, capital_share),
      notes = CASE WHEN p ? 'notes' THEN nullif(p->>'notes', '') ELSE notes END,
      partnership_start_date = coalesce(nullif(p->>'start_date', '')::date, partnership_start_date),
      employee_id = v_emp, role_kind = v_kind, salary_mode = v_mode,
      salary_amount = CASE WHEN v_mode = 'fixed' THEN coalesce((p->>'salary_amount')::numeric, salary_amount) ELSE 0 END,
      salary_percent = CASE WHEN v_mode = 'percent' THEN coalesce((p->>'salary_percent')::numeric, salary_percent) ELSE 0 END,
      salary_base = coalesce(nullif(p->>'salary_base', ''), salary_base),
      salary_branch_id = CASE WHEN coalesce(nullif(p->>'salary_base', ''), salary_base) = 'branch' THEN nullif(p->>'salary_branch_id', '')::uuid END,
      salary_when = coalesce(nullif(p->>'salary_when', ''), salary_when),
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    WHERE id = v_id AND tenant_id = v_t;
    IF NOT FOUND THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  END IF;
  -- a fixed salary is his monthly salary as an employee (payroll pays it like any salary)
  IF v_kind = 'employee_partner' AND v_mode = 'fixed' THEN
    UPDATE public.employees SET base_salary = (p->>'salary_amount')::numeric WHERE id = v_emp;
  END IF;
  -- the employee's login sees his partner page too
  IF v_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.partner_users WHERE user_id = v_user AND partner_id = v_id) THEN
    INSERT INTO public.partner_users (tenant_id, user_id, partner_id, is_active, created_by) VALUES (v_t, v_user, v_id, true, auth.uid());
  END IF;
  RETURN v_id;
END $function$;

-- the old money doors moved money without a till row — one door now
DO $mig$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['record_partner_transaction(uuid,text,numeric,text,text,uuid,uuid)',
                           'partner_withdraw_from_distribution(uuid,uuid,numeric,date,text)',
                           'set_partner_capital(uuid,numeric,boolean)'] LOOP
    IF to_regprocedure('public.' || split_part(f, '(', 1) || '_pre0137(' || split_part(f, '(', 2)) IS NULL THEN
      EXECUTE format('ALTER FUNCTION public.%s RENAME TO %I', f, split_part(f, '(', 1) || '_pre0137');
    END IF;
  END LOOP;
END
$mig$;
CREATE OR REPLACE FUNCTION public.record_partner_transaction(_partner_id uuid, _transaction_type text, _amount numeric, _description text, _month_year text, _treasury_id uuid DEFAULT NULL, _voucher_id uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SET search_path TO 'public'
AS $f$ BEGIN RAISE EXCEPTION 'حركات الشركاء بقت من صفحة الشريك: «مساهمة» أو «سحب» (بتختار الفرع والوعاء)'; END $f$;
CREATE OR REPLACE FUNCTION public.partner_withdraw_from_distribution(p_tenant_id uuid, p_partner_id uuid, p_amount numeric, p_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public'
AS $f$ BEGIN RAISE EXCEPTION 'السحب بقى من صفحة الشريك: «سحب» → من الربح (والزيادة بتبقى سلفة لوحدها)'; END $f$;
CREATE OR REPLACE FUNCTION public.set_partner_capital(_partner_id uuid, _amount numeric, _rebalance boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public'
AS $f$ BEGIN RAISE EXCEPTION 'رأس المال بيتغير بـ «مساهمة» أو «سحب من رأس المال» من صفحة الشريك'; END $f$;
REVOKE ALL ON FUNCTION public.record_partner_transaction_pre0137(uuid,text,numeric,text,text,uuid,uuid),
  public.partner_withdraw_from_distribution_pre0137(uuid,uuid,numeric,date,text), public.set_partner_capital_pre0137(uuid,numeric,boolean) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.partner_cards(uuid), public.partners_overview(),
  public.partner_money(uuid, text, numeric, text, numeric, uuid, text, date, text),
  public.edit_partner_contribution(uuid, numeric, text), public.cancel_partner_transaction(uuid, text),
  public.partner_period_shares_preview(date, date, jsonb), public.post_partner_period_shares(date, date, jsonb),
  public.cancel_partner_period_shares(date, date, text), public.save_partner(jsonb), public.partner_tx_day(public.partner_transactions) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_cards(uuid), public.partners_overview(),
  public.partner_money(uuid, text, numeric, text, numeric, uuid, text, date, text),
  public.edit_partner_contribution(uuid, numeric, text), public.cancel_partner_transaction(uuid, text),
  public.partner_period_shares_preview(date, date, jsonb), public.post_partner_period_shares(date, date, jsonb),
  public.cancel_partner_period_shares(date, date, text), public.save_partner(jsonb) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('partner_cards', '0137', 'partner: the five cards and their lines (owner / admin / the partner himself)'),
  ('partners_overview', '0137', 'partners: every partner with his cards'),
  ('partner_money', '0137', 'owner / admin: contribution or withdrawal (capital / profit / split, advance by itself)'),
  ('edit_partner_contribution', '0137', 'owner / admin: correct a contribution on its own day'),
  ('cancel_partner_transaction', '0137', 'owner / admin: cancel a partner movement (mirror till row + reversed entry)'),
  ('partner_period_shares_preview', '0137', 'owner / admin: operating share and salary from profit of a period'),
  ('post_partner_period_shares', '0137', 'owner / admin: book them as salary expense before the split'),
  ('cancel_partner_period_shares', '0137', 'owner / admin: cancel them before the period is distributed'),
  ('save_partner', '0137', 'owner / admin: add / change a partner (partner only, or employee and partner)')
ON CONFLICT DO NOTHING;
