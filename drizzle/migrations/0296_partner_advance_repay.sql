-- 0296: partner advances — how they are paid back (owner «نفذ» 2026-11-27, items 4 / 4أ / 4ب / 6)
--  * «رد سلفة» in cash: partner_advance_repay(partner, amount, branch, vessel, date, notes, account) — the money comes INTO the
--    chosen branch till / vessel (till row 'partner_advance_repay', no voucher) and the advances go down oldest first;
--    entry Dr cash of that vessel / Cr 1400 on its day.
--  * (أ) from his capital, no money: partner_advance_from_capital(partner, amount, date, reason) — a capital_withdrawal row
--    with no till (counts from the month of its day: money out), the advances go down oldest first; entry Dr 3100 / Cr 1400.
--  * cancel_partner_advance_repay(ref, reason): either one cancelled on ITS day (mirror till row / void row, entry reversed on
--    its own day, the advances open again). cancel_partner_transaction sends the capital one here.
--  * (ب) equity_partners.max_advance (NULL = no limit), set_partner_advance_limit: a withdrawal whose advance would pass it is
--    refused in partner_money.
--  * (6) partner_advances.repay_mode 'profit' (default) | 'salary' | 'both' + monthly instalment, set_partner_advance_repay
--    (changeable later): salary / both = a linked employee advance (advances.partner_advance_id, no money, no entry) that the
--    payroll deducts like any employee advance; each deduction moves to the partner advance (partner_advance_payments
--    'salary', entry Dr 1450 / Cr 1400 on the salary's book day) and a cancelled salary gives it back. A 'salary' advance is
--    skipped by the profit distribution; 'both' is paid by both. The linked row always mirrors the partner advance's remaining.
-- Old advances: unchanged ('profit').

-- ── columns ─────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.equity_partners ADD COLUMN IF NOT EXISTS max_advance numeric;
DO $$ BEGIN
  ALTER TABLE public.equity_partners ADD CONSTRAINT equity_partners_max_advance_chk CHECK (max_advance IS NULL OR max_advance >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.partner_advances ADD COLUMN IF NOT EXISTS repay_mode text NOT NULL DEFAULT 'profit';
DO $$ BEGIN
  ALTER TABLE public.partner_advances ADD CONSTRAINT partner_advances_repay_mode_chk CHECK (repay_mode IN ('profit', 'salary', 'both'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.advances ADD COLUMN IF NOT EXISTS partner_advance_id uuid REFERENCES public.partner_advances(id);
CREATE UNIQUE INDEX IF NOT EXISTS advances_partner_advance_uq ON public.advances (partner_advance_id) WHERE partner_advance_id IS NOT NULL AND status = 'active';
ALTER TABLE public.partner_advance_payments DROP CONSTRAINT IF EXISTS partner_advance_payments_payment_method_check;
ALTER TABLE public.partner_advance_payments ADD CONSTRAINT partner_advance_payments_payment_method_check
  CHECK (payment_method IN ('treasury', 'profit_deduction', 'manual', 'cash_till', 'capital', 'salary'));

-- the old payment trigger booked Dr 1100 / Cr 1400 for every non-profit payment: the new doors book their own entry
DO $$
DECLARE d text; s1 text := 'IF NEW.payment_method = ''profit_deduction'' THEN RETURN NEW; END IF;';
BEGIN
  d := pg_get_functiondef('public.trg_partner_advance_payment_journal()'::regprocedure);
  IF position(s1 in d) = 0 THEN RAISE EXCEPTION '0296: trg_partner_advance_payment_journal text not found'; END IF;
  d := replace(d, s1, 'IF NEW.payment_method IN (''profit_deduction'', ''cash_till'', ''capital'', ''salary'') THEN RETURN NEW; END IF;  -- 0296');
  EXECUTE d;
END $$;

-- ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- pay the open advances of a partner oldest first (p_only_mode NULL = every mode); returns what was applied
CREATE OR REPLACE FUNCTION public._partner_advances_apply(p_partner uuid, p_amount numeric, p_day date, p_method text,
                                                          p_ref_type text, p_ref uuid, p_notes text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a record; v_left numeric := round(p_amount, 2); v_off numeric; v_done numeric := 0;
BEGIN
  FOR a IN SELECT * FROM public.partner_advances WHERE partner_id = p_partner AND status IN ('active', 'partially_paid')
              AND remaining_amount > 0 ORDER BY advance_date, created_at FOR UPDATE LOOP
    EXIT WHEN v_left <= 0;
    v_off := least(v_left, a.remaining_amount);
    UPDATE public.partner_advances SET remaining_amount = round(remaining_amount - v_off, 2),
           status = CASE WHEN round(remaining_amount - v_off, 2) <= 0 THEN 'fully_paid' ELSE 'partially_paid' END
     WHERE id = a.id;
    INSERT INTO public.partner_advance_payments (advance_id, amount, payment_date, payment_method, reference_type, reference_id, notes, created_by, status)
    VALUES (a.id, v_off, p_day, p_method, p_ref_type, p_ref, p_notes, auth.uid(), 'active');
    v_left := round(v_left - v_off, 2); v_done := round(v_done + v_off, 2);
  END LOOP;
  RETURN v_done;
END $$;
REVOKE ALL ON FUNCTION public._partner_advances_apply(uuid, numeric, date, text, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- give back what a cancelled repayment paid (its payment rows, by reference)
CREATE OR REPLACE FUNCTION public._partner_advances_unapply(p_ref_type text, p_ref uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE x record; v_done numeric := 0;
BEGIN
  FOR x IN SELECT * FROM public.partner_advance_payments WHERE reference_type = p_ref_type AND reference_id = p_ref AND status = 'active' FOR UPDATE LOOP
    UPDATE public.partner_advance_payments SET status = 'cancelled', cancelled_at = now() WHERE id = x.id;
    UPDATE public.partner_advances SET remaining_amount = round(remaining_amount + x.amount, 2),
           status = CASE WHEN round(remaining_amount + x.amount, 2) >= amount THEN 'active' ELSE 'partially_paid' END
     WHERE id = x.advance_id AND status <> 'cancelled';
    v_done := round(v_done + x.amount, 2);
  END LOOP;
  RETURN v_done;
END $$;
REVOKE ALL ON FUNCTION public._partner_advances_unapply(text, uuid) FROM PUBLIC, anon, authenticated;

-- ── «رد سلفة» in cash ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_advance_repay(p_partner uuid, p_amount numeric, p_branch uuid, p_method text DEFAULT 'cash',
                                                        p_date date DEFAULT NULL, p_notes text DEFAULT NULL, p_account text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p public.equity_partners%ROWTYPE; v_day date := coalesce(p_date, public.cairo_today()); v_amt numeric := round(p_amount, 2);
  v_pm text := coalesce(nullif(btrim(p_method), ''), 'cash'); v_open numeric; v_tr uuid; v_desc text; v_at timestamptz; v_done numeric;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'حركات الشركاء للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.equity_partners WHERE id = p_partner AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF p_branch IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch AND tenant_id = p.tenant_id) THEN RAISE EXCEPTION 'اختار الفرع اللي الفلوس هتدخل خزنته'; END IF;
  IF NOT public.vessel_is_known(p.tenant_id, v_pm) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_pm; END IF;
  PERFORM public.assert_vessel_account(v_pm, p_account, p_account);
  IF v_day > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ في المستقبل'; END IF;
  SELECT coalesce(sum(remaining_amount), 0) INTO v_open FROM public.partner_advances
   WHERE partner_id = p.id AND status IN ('active', 'partially_paid') AND remaining_amount > 0;
  IF v_open <= 0 THEN RAISE EXCEPTION 'مفيش سلف مفتوحة على %', p.name; END IF;
  IF v_amt > v_open + 0.005 THEN RAISE EXCEPTION 'السلف المفتوحة على % = % بس', p.name, v_open; END IF;
  v_at := CASE WHEN v_day = public.cairo_today() THEN now() ELSE (v_day + time '12:00') AT TIME ZONE 'Africa/Cairo' END;
  v_desc := 'رد سلفة — ' || p.name || coalesce(' — ' || nullif(btrim(p_notes), ''), '');
  PERFORM set_config('app.partner_money', '1', true);
  PERFORM set_config('app.skip_treasury_voucher', '1', true);
  INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by, payment_method, transaction_date, created_at, transfer_to_account)
  VALUES (p_branch, p.tenant_id, 'income', 'partner_advance_repay', v_amt, v_desc, p.id, auth.uid(), v_pm, v_day, v_at, nullif(btrim(p_account), ''))
  RETURNING id INTO v_tr;
  v_done := public._partner_advances_apply(p.id, v_amt, v_day, 'cash_till', 'treasury', v_tr, v_desc);
  PERFORM public.post_journal(p.tenant_id, v_day, v_desc, 'treasury_row', v_tr, jsonb_build_array(
    jsonb_build_object('account_code', public.ledger_cash_account(v_pm), 'debit', v_amt, 'credit', 0, 'description', v_desc),
    jsonb_build_object('account_code', '1400', 'debit', 0, 'credit', v_amt, 'description', 'سداد سلفة ' || p.name)));
  PERFORM set_config('app.skip_treasury_voucher', '0', true);
  PERFORM set_config('app.partner_money', '', true);
  RETURN jsonb_build_object('treasury_id', v_tr, 'paid', v_done, 'left', round(v_open - v_done, 2));
END $$;

-- ── (أ) from his capital, no money ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_advance_from_capital(p_partner uuid, p_amount numeric, p_date date DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p public.equity_partners%ROWTYPE; c jsonb; v_day date := coalesce(p_date, public.cairo_today()); v_amt numeric := round(p_amount, 2);
  v_open numeric; v_tx uuid; v_desc text; v_done numeric; v_month date;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'حركات الشركاء للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.equity_partners WHERE id = p_partner AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF v_day > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ في المستقبل'; END IF;
  IF v_day < DATE '2026-01-01' THEN RAISE EXCEPTION 'التاريخ لازم يكون من يناير 2026'; END IF;
  SELECT coalesce(sum(remaining_amount), 0) INTO v_open FROM public.partner_advances
   WHERE partner_id = p.id AND status IN ('active', 'partially_paid') AND remaining_amount > 0;
  IF v_open <= 0 THEN RAISE EXCEPTION 'مفيش سلف مفتوحة على %', p.name; END IF;
  IF v_amt > v_open + 0.005 THEN RAISE EXCEPTION 'السلف المفتوحة على % = % بس', p.name, v_open; END IF;
  c := public.partner_cards(p.id);
  IF v_amt > (c->>'capital')::numeric + 0.005 THEN RAISE EXCEPTION 'رأس ماله % بس', (c->>'capital')::numeric; END IF;
  v_month := date_trunc('month', v_day)::date;   -- money out: his capital is lower from the month of the day
  PERFORM public._partner_capital_lock_check(p.tenant_id, v_month);
  v_desc := 'سداد سلفة من رأس ماله' || coalesce(' — ' || nullif(btrim(p_reason), ''), '');
  INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by, movement_date, counts_from)
  VALUES (p.tenant_id, p.id, 'capital_withdrawal', v_amt, v_desc, to_char(v_day, 'YYYY-MM'), auth.uid(), v_day, v_month)
  RETURNING id INTO v_tx;
  IF public._partner_first_negative_month(p.id, greatest(v_month, (date_trunc('month', public.cairo_today()) + interval '1 month')::date)) IS NOT NULL THEN
    RAISE EXCEPTION 'رأس مال % هيبقى بالسالب في شهر %', p.name,
      to_char(public._partner_first_negative_month(p.id, greatest(v_month, (date_trunc('month', public.cairo_today()) + interval '1 month')::date)), 'YYYY-MM');
  END IF;
  v_done := public._partner_advances_apply(p.id, v_amt, v_day, 'capital', 'partner_transaction', v_tx, v_desc);
  PERFORM public.post_journal(p.tenant_id, v_day, v_desc || ' — ' || p.name, 'partner_adv_capital', v_tx, jsonb_build_array(
    jsonb_build_object('account_code', '3100', 'debit', v_amt, 'credit', 0, 'description', 'سداد سلفة ' || p.name || ' من رأس ماله'),
    jsonb_build_object('account_code', '1400', 'debit', 0, 'credit', v_amt, 'description', 'سداد سلفة ' || p.name)));
  RETURN jsonb_build_object('tx_id', v_tx, 'paid', v_done, 'left', round(v_open - v_done, 2),
                            'cards', public.partner_cards(p.id) - 'movements' - 'advances_list');
END $$;

-- ── cancel either, on its own day ───────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_partner_advance_repay(p_ref uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.treasury%ROWTYPE; t public.partner_transactions%ROWTYPE; v_back numeric;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  SELECT * INTO r FROM public.treasury WHERE id = p_ref AND tenant_id = public.current_tenant_id() AND category = 'partner_advance_repay' FOR UPDATE;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.treasury WHERE category = 'partner_cancel' AND reference_id = r.reference_id
                 AND description LIKE 'إلغاء ' || r.description || ' — %' AND transaction_date = r.transaction_date AND amount = r.amount) THEN
      RAISE EXCEPTION 'الرد ده ملغي قبل كده';
    END IF;
    v_back := public._partner_advances_unapply('treasury', r.id);
    PERFORM set_config('app.skip_treasury_voucher', '1', true);
    INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by, payment_method, transaction_date, created_at)
    VALUES (r.branch_id, r.tenant_id, 'expense', 'partner_cancel', r.amount, 'إلغاء ' || r.description || ' — ' || btrim(p_reason), r.reference_id, auth.uid(),
            r.payment_method, r.transaction_date, now());
    PERFORM set_config('app.skip_treasury_voucher', '0', true);
    PERFORM set_config('app.reverse_on_original_date', '1', true);
    PERFORM public.reverse_journal_for_source(r.tenant_id, 'treasury_row', r.id, 'إلغاء رد سلفة — ' || btrim(p_reason));
    PERFORM set_config('app.reverse_on_original_date', '', true);
    RETURN jsonb_build_object('kind', 'cash', 'amount', r.amount, 'advances_back', v_back);
  END IF;
  SELECT * INTO t FROM public.partner_transactions WHERE id = p_ref AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.partner_advance_payments WHERE reference_type = 'partner_transaction' AND reference_id = t.id) THEN
    RAISE EXCEPTION 'رد السلفة ده غير موجود';
  END IF;
  IF coalesce(t.is_void, false) THEN RAISE EXCEPTION 'الرد ده ملغي قبل كده'; END IF;
  PERFORM public._partner_capital_lock_check(t.tenant_id, public._partner_tx_effective_month(t));
  v_back := public._partner_advances_unapply('partner_transaction', t.id);
  UPDATE public.partner_transactions SET is_void = true, cancel_reason = btrim(p_reason), cancelled_by = auth.uid(), cancelled_at = now() WHERE id = t.id;
  PERFORM set_config('app.reverse_on_original_date', '1', true);
  PERFORM public.reverse_journal_for_source(t.tenant_id, 'partner_adv_capital', t.id, 'إلغاء سداد سلفة من رأس المال — ' || btrim(p_reason));
  PERFORM set_config('app.reverse_on_original_date', '', true);
  RETURN jsonb_build_object('kind', 'capital', 'amount', t.amount, 'advances_back', v_back);
END $$;

-- the movements table cancels a capital row through cancel_partner_transaction: send «سداد سلفة من رأس ماله» here
DO $$
DECLARE d text; s1 text := '  IF t.related_treasury_id IS NULL THEN RAISE EXCEPTION ''الحركة دي قديمة (من غير خزنة) — مينفعش تتلغي من هنا''; END IF;';
BEGIN
  d := pg_get_functiondef('public.cancel_partner_transaction(uuid,text)'::regprocedure);
  IF position(s1 in d) = 0 THEN RAISE EXCEPTION '0296: cancel_partner_transaction text not found'; END IF;
  d := replace(d, s1, '  IF t.related_treasury_id IS NULL AND EXISTS (SELECT 1 FROM public.partner_advance_payments WHERE reference_type = ''partner_transaction'' AND reference_id = t.id) THEN
    RETURN public.cancel_partner_advance_repay(t.id, p_reason);   -- 0296
  END IF;
' || s1);
  EXECUTE d;
END $$;

-- ── (ب) maximum advance per partner ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_partner_advance_limit(p_partner uuid, p_max numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p public.equity_partners%ROWTYPE;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.equity_partners WHERE id = p_partner AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  IF p_max IS NOT NULL AND p_max < 0 THEN RAISE EXCEPTION 'الحد مينفعش يكون بالسالب'; END IF;
  UPDATE public.equity_partners SET max_advance = CASE WHEN p_max IS NULL THEN NULL ELSE round(p_max, 2) END WHERE id = p.id;
  RETURN jsonb_build_object('max_advance', CASE WHEN p_max IS NULL THEN NULL ELSE round(p_max, 2) END);
END $$;

DO $$
DECLARE d text; s1 text := '    IF v_adv > 0 THEN
      INSERT INTO public.partner_advances';
BEGIN
  d := pg_get_functiondef('public.partner_money(uuid,text,numeric,text,numeric,uuid,text,date,text,text,date)'::regprocedure);
  IF position(s1 in d) = 0 THEN RAISE EXCEPTION '0296: partner_money text not found'; END IF;
  d := replace(d, s1, '    -- 0296: the maximum advance of this partner (NULL = no limit)
    IF v_adv > 0 AND p.max_advance IS NOT NULL
       AND coalesce((SELECT sum(remaining_amount) FROM public.partner_advances WHERE partner_id = p.id AND status IN (''active'', ''partially_paid'')), 0) + v_adv > p.max_advance + 0.005 THEN
      RAISE EXCEPTION ''حد السلفة لـ % هو % — عليه دلوقتي %، والسحب ده هيعمل سلفة %'', p.name, p.max_advance,
        coalesce((SELECT sum(remaining_amount) FROM public.partner_advances WHERE partner_id = p.id AND status IN (''active'', ''partially_paid'')), 0), v_adv;
    END IF;
' || s1);
  EXECUTE d;
END $$;

-- ── (6) how an employee-partner's advance is paid back ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_partner_advance_repay(p_advance uuid, p_mode text, p_monthly numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a public.partner_advances%ROWTYPE; p public.equity_partners%ROWTYPE; v_link public.advances%ROWTYPE; v_m numeric := round(coalesce(p_monthly, 0), 2);
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.partner_advances WHERE id = p_advance AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السلفة غير موجودة'; END IF;
  IF a.status NOT IN ('active', 'partially_paid') OR a.remaining_amount <= 0 THEN RAISE EXCEPTION 'السلفة دي مقفولة'; END IF;
  IF p_mode NOT IN ('profit', 'salary', 'both') THEN RAISE EXCEPTION 'اختار: من الربح، من المرتب، ولا الاتنين'; END IF;
  SELECT * INTO p FROM public.equity_partners WHERE id = a.partner_id;
  IF p_mode <> 'profit' THEN
    IF p.employee_id IS NULL THEN RAISE EXCEPTION '% مش موظف — مالوش مرتب يتخصم منه', p.name; END IF;
    IF v_m <= 0 THEN RAISE EXCEPTION 'اكتب القسط اللي يتخصم من المرتب كل شهر'; END IF;
    IF v_m > a.remaining_amount + 0.005 THEN RAISE EXCEPTION 'القسط أكبر من الباقي من السلفة (%)', a.remaining_amount; END IF;
  END IF;
  SELECT * INTO v_link FROM public.advances WHERE partner_advance_id = a.id AND status = 'active' FOR UPDATE;
  PERFORM set_config('app.partner_adv_sync', '1', true);
  IF p_mode = 'profit' THEN
    IF v_link.id IS NOT NULL THEN
      UPDATE public.advances SET remaining = 0, status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
             cancel_reason = 'سلفة شريك — اتحولت للسداد من الربح' WHERE id = v_link.id;
    END IF;
  ELSIF v_link.id IS NOT NULL THEN
    UPDATE public.advances SET monthly_deduct = v_m, remaining = a.remaining_amount WHERE id = v_link.id;
  ELSE
    INSERT INTO public.advances (employee_id, amount, remaining, monthly_deduct, reason, tenant_id, status, partner_advance_id)
    VALUES (p.employee_id, a.remaining_amount, a.remaining_amount, v_m, 'سلفة شريك — بتتخصم من المرتب (من صفحة الشريك)', a.tenant_id, 'active', a.id);
  END IF;
  PERFORM set_config('app.partner_adv_sync', '', true);
  UPDATE public.partner_advances SET repay_mode = p_mode, monthly_deduction = CASE WHEN p_mode = 'profit' THEN a.remaining_amount ELSE v_m END,
         notes = coalesce(notes || E'\n', '') || 'السداد: ' || CASE p_mode WHEN 'profit' THEN 'من الربح' WHEN 'salary' THEN 'من المرتب' ELSE 'من المرتب والربح' END
                 || CASE WHEN p_mode <> 'profit' THEN ' — قسط ' || v_m ELSE '' END
   WHERE id = a.id;
  RETURN jsonb_build_object('advance_id', a.id, 'mode', p_mode, 'monthly', CASE WHEN p_mode = 'profit' THEN NULL ELSE v_m END);
END $$;

-- the linked employee advance always mirrors the partner advance's remaining
CREATE OR REPLACE FUNCTION public.trg_partner_advance_sync_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM set_config('app.partner_adv_sync', '1', true);
  IF NEW.status = 'cancelled' THEN
    UPDATE public.advances SET remaining = 0, status = 'cancelled', cancelled_at = now(), cancel_reason = 'السلفة اتلغت من صفحة الشريك'
     WHERE partner_advance_id = NEW.id AND status = 'active';
  ELSE
    UPDATE public.advances SET remaining = greatest(NEW.remaining_amount, 0)
     WHERE partner_advance_id = NEW.id AND status = 'active' AND remaining IS DISTINCT FROM greatest(NEW.remaining_amount, 0);
  END IF;
  PERFORM set_config('app.partner_adv_sync', '', true);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_partner_advance_sync_link ON public.partner_advances;
CREATE TRIGGER zz_partner_advance_sync_link AFTER UPDATE OF remaining_amount, status ON public.partner_advances
  FOR EACH ROW EXECUTE FUNCTION public.trg_partner_advance_sync_link();

-- a linked employee advance is changed only from the partner page (or by the payroll's deduction)
CREATE OR REPLACE FUNCTION public.guard_partner_linked_advance()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF OLD.partner_advance_id IS NOT NULL AND coalesce(current_setting('app.partner_adv_sync', true), '') <> '1'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.monthly_deduct IS DISTINCT FROM OLD.monthly_deduct) THEN
    RAISE EXCEPTION 'دي سلفة شريك — غيّرها من صفحة الشريك';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a0_guard_partner_linked_advance ON public.advances;
CREATE TRIGGER a0_guard_partner_linked_advance BEFORE UPDATE ON public.advances FOR EACH ROW EXECUTE FUNCTION public.guard_partner_linked_advance();

-- a payroll deduction (or its return when the salary is cancelled) moves to the partner advance
CREATE OR REPLACE FUNCTION public.trg_advance_payment_to_partner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.advances%ROWTYPE; v_pa uuid; v_day date; v_name text; v_pos uuid;
BEGIN
  SELECT * INTO l FROM public.advances WHERE id = NEW.advance_id;
  v_pa := l.partner_advance_id;
  IF v_pa IS NULL OR coalesce(NEW.amount, 0) = 0 THEN RETURN NEW; END IF;
  SELECT p.name INTO v_name FROM public.partner_advances a JOIN public.equity_partners p ON p.id = a.partner_id WHERE a.id = v_pa;
  -- the salary's book day: the month's last day, or today for this month
  v_day := least(public.cairo_today(), CASE WHEN NEW.month ~ '^\d{4}-\d{2}$' THEN (to_date(NEW.month || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date ELSE public.cairo_today() END);
  IF NEW.amount > 0 THEN
    UPDATE public.partner_advances SET remaining_amount = round(remaining_amount - NEW.amount, 2),
           status = CASE WHEN round(remaining_amount - NEW.amount, 2) <= 0 THEN 'fully_paid' ELSE 'partially_paid' END
     WHERE id = v_pa;
    INSERT INTO public.partner_advance_payments (advance_id, amount, payment_date, payment_method, reference_type, reference_id, notes, created_by, status)
    VALUES (v_pa, NEW.amount, v_day, 'salary', 'advance_payment', NEW.id, 'خصم من مرتب ' || coalesce(NEW.month, ''), auth.uid(), 'active');
    PERFORM public.post_journal(NEW.tenant_id, v_day, 'سداد سلفة شريك من المرتب — ' || coalesce(v_name, ''), 'partner_adv_salary', NEW.id, jsonb_build_array(
      jsonb_build_object('account_code', '1450', 'debit', NEW.amount, 'credit', 0, 'description', 'سلفة شريك اتخصمت من مرتبه'),
      jsonb_build_object('account_code', '1400', 'debit', 0, 'credit', NEW.amount, 'description', 'سداد سلفة ' || coalesce(v_name, ''))));
  ELSE
    -- the salary was cancelled: its deduction comes back (the payment row of the same salary and advance)
    SELECT ap.id INTO v_pos FROM public.advance_payments ap
     WHERE ap.advance_id = NEW.advance_id AND ap.salary_id IS NOT DISTINCT FROM NEW.salary_id AND ap.amount = -NEW.amount
       AND EXISTS (SELECT 1 FROM public.partner_advance_payments x WHERE x.reference_type = 'advance_payment' AND x.reference_id = ap.id AND x.status = 'active')
     ORDER BY ap.paid_at DESC LIMIT 1;
    IF v_pos IS NOT NULL THEN
      PERFORM public._partner_advances_unapply('advance_payment', v_pos);
      PERFORM set_config('app.reverse_on_original_date', '1', true);
      PERFORM public.reverse_journal_for_source(NEW.tenant_id, 'partner_adv_salary', v_pos, 'إلغاء المرتب — رجوع قسط سلفة الشريك');
      PERFORM set_config('app.reverse_on_original_date', '', true);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_advance_payment_to_partner ON public.advance_payments;
CREATE TRIGGER zz_advance_payment_to_partner AFTER INSERT ON public.advance_payments FOR EACH ROW EXECUTE FUNCTION public.trg_advance_payment_to_partner();

-- a 'salary' advance is not paid from the profit distribution (and not shown as «سداد سلفته» in its preview)
DO $$
DECLARE f text; d text;
  s1 text := 'WHERE partner_id = r.partner_id AND status IN (''active'', ''partially_paid'')
                AND remaining_amount > 0 ORDER BY';
  s2 text := 'WHERE a.partner_id = ep.id AND a.status IN (''active'', ''partially_paid'') AND a.remaining_amount > 0), 0))';
BEGIN
  FOREACH f IN ARRAY ARRAY['public.distribute_profits', 'public.distribute_profits_manual'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE p.oid = (SELECT min(oid) FROM pg_proc WHERE proname = split_part(f, '.', 2) AND pronamespace = 'public'::regnamespace);
    IF position(s1 in d) = 0 THEN RAISE EXCEPTION '0296: % text not found', f; END IF;
    d := replace(d, s1, 'WHERE partner_id = r.partner_id AND status IN (''active'', ''partially_paid'') AND coalesce(repay_mode, ''profit'') <> ''salary''  -- 0296
                AND remaining_amount > 0 ORDER BY');
    EXECUTE d;
  END LOOP;
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE proname = 'period_split_preview' AND pronamespace = 'public'::regnamespace;
  IF position(s2 in d) = 0 THEN RAISE EXCEPTION '0296: period_split_preview text not found'; END IF;
  d := replace(d, s2, 'WHERE a.partner_id = ep.id AND a.status IN (''active'', ''partially_paid'') AND a.remaining_amount > 0 AND coalesce(a.repay_mode, ''profit'') <> ''salary''), 0))');
  EXECUTE d;
END $$;

-- the partner page shows how each advance is paid back and the limit
DO $$
DECLARE d text;
  s1 text := '''date'', a.advance_date, ''status'', a.status, ''reason'', a.reason,';
  s2 text := '''archived_at'', p.archived_at,';
BEGIN
  d := pg_get_functiondef('public.partner_cards(uuid)'::regprocedure);
  IF position(s1 in d) = 0 OR position(s2 in d) = 0 THEN RAISE EXCEPTION '0296: partner_cards text not found'; END IF;
  d := replace(d, s1, '''date'', a.advance_date, ''status'', a.status, ''reason'', a.reason, ''repay_mode'', a.repay_mode, ''monthly'', a.monthly_deduction,
        ''payments'', coalesce((SELECT jsonb_agg(jsonb_build_object(''id'', x.id, ''amount'', x.amount, ''date'', x.payment_date, ''method'', x.payment_method,
            ''ref_type'', x.reference_type, ''ref'', x.reference_id, ''status'', x.status) ORDER BY x.payment_date, x.created_at)
          FROM public.partner_advance_payments x WHERE x.advance_id = a.id), ''[]''::jsonb),');
  d := replace(d, s2, '''archived_at'', p.archived_at, ''max_advance'', p.max_advance,');
  EXECUTE d;
END $$;

-- ── grants ──────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.partner_advance_repay(uuid, numeric, uuid, text, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_advance_from_capital(uuid, numeric, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_partner_advance_repay(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_partner_advance_limit(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_partner_advance_repay(uuid, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_partner_advance_sync_link() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_advance_payment_to_partner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_advance_repay(uuid, numeric, uuid, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_advance_from_capital(uuid, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_partner_advance_repay(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_partner_advance_limit(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_partner_advance_repay(uuid, text, numeric) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
SELECT x, '0296', 'partner advances: repay / limit / repay mode (owner / admin)'
  FROM unnest(ARRAY['partner_advance_repay', 'partner_advance_from_capital', 'cancel_partner_advance_repay',
                    'set_partner_advance_limit', 'set_partner_advance_repay']) x
ON CONFLICT DO NOTHING;
