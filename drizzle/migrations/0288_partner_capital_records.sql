-- 0288 (owner 2026-11-26 «نفذ» on SPEC-partner-capital-records-period-split.md, module capital-records):
--  * «اتدفعت إمتى» = partner_transactions.deposited_on (information only: no till, no entry, no %);
--  * «رأس مال موجود بالفعل» edited any time (edit_existing_capital) and a contribution / capital withdrawal that went
--    through the till edited any day (edit_partner_capital_move = cancel on its own day + the corrected one), both with a
--    reason, linked (replaces / replaced_by), who / when kept; a cancel keeps who / when too;
--  * nothing that changes the capital of a month whose profit was already distributed (owner answer 3: refuse until the
--    distribution is reversed);
--  * proof files on a partner movement (attachments.record_type 'partner_transaction'; they follow an edit).

ALTER TABLE public.partner_transactions
  ADD COLUMN IF NOT EXISTS deposited_on date,
  ADD COLUMN IF NOT EXISTS edited_by uuid,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edit_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS replaces uuid REFERENCES public.partner_transactions(id),
  ADD COLUMN IF NOT EXISTS replaced_by uuid REFERENCES public.partner_transactions(id);

ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_record_type_check;
ALTER TABLE public.attachments ADD CONSTRAINT attachments_record_type_check CHECK (record_type = ANY (ARRAY[
  'voucher', 'invoice', 'shipment', 'sale_return', 'purchase_return', 'stock_transfer', 'inventory_adjustment',
  'personal_expense', 'treasury_transfer', 'quote', 'partner_transaction']));

-- the first month whose capital share a movement changes (null = not a capital movement)
CREATE OR REPLACE FUNCTION public._partner_tx_effective_month(t public.partner_transactions)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t.transaction_type = 'capital_adjustment' AND t.existing_capital THEN date_trunc('month', public.partner_tx_day(t))::date
    WHEN t.transaction_type IN ('contribution', 'capital_withdrawal') THEN (date_trunc('month', public.partner_tx_day(t)) + interval '1 month')::date
    ELSE NULL END
$$;

-- refuses a capital change from p_month on when a live distribution covers that month or a later one
CREATE OR REPLACE FUNCTION public._partner_capital_lock_check(p_tenant uuid, p_month date)
RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE v date;
BEGIN
  IF p_month IS NULL THEN RETURN; END IF;
  SELECT min(greatest(date_trunc('month', d.period_from)::date, p_month)) INTO v
    FROM public.profit_distributions d
   WHERE d.tenant_id = p_tenant AND coalesce(d.status, '') <> 'reversed' AND d.period_from IS NOT NULL AND d.period_to >= p_month;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'ربح شهر % اتوزع خلاص ورأس المال ده داخل في نسب التوزيع — اعكس التوزيع الأول وبعدين عدّل', to_char(v, 'YYYY-MM');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._partner_tx_effective_month(public.partner_transactions) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._partner_capital_lock_check(uuid, date) FROM PUBLIC, anon, authenticated;

-- «رأس مال موجود بالفعل» + «اتدفعت إمتى»
DROP FUNCTION IF EXISTS public.partner_existing_capital(uuid, numeric, date, text);
CREATE OR REPLACE FUNCTION public.partner_existing_capital(p_partner uuid, p_amount numeric, p_day date, p_notes text DEFAULT NULL,
                                                           p_deposited_on date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_t uuid := public.current_tenant_id(); p public.equity_partners%ROWTYPE; v_id uuid;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.equity_partners WHERE id = p_partner AND tenant_id = v_t;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  IF NOT p.is_active THEN RAISE EXCEPTION 'الشريك ده موقوف'; END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'اكتب المبلغ'; END IF;
  IF p_day IS NULL THEN RAISE EXCEPTION 'اختار من إمتى بيتحسب'; END IF;
  IF p_day > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ مينفعش يكون بعد النهارده'; END IF;
  IF p_deposited_on > public.cairo_today() THEN RAISE EXCEPTION 'تاريخ الإيداع مينفعش يكون بعد النهارده'; END IF;
  PERFORM public._partner_capital_lock_check(v_t, date_trunc('month', p_day)::date);
  PERFORM set_config('app.partner_money', '1', true);
  INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by,
                                           movement_date, existing_capital, deposited_on)
  VALUES (v_t, p_partner, 'capital_adjustment', round(p_amount, 2),
          'رأس مال موجود بالفعل' || coalesce(' — ' || nullif(btrim(p_notes), ''), ''), to_char(p_day, 'YYYY-MM'), auth.uid(), p_day, true,
          coalesce(p_deposited_on, p_day))
  RETURNING id INTO v_id;
  PERFORM set_config('app.partner_money', '', true);
  RETURN v_id;
END $function$;

-- proof files follow the corrected movement
CREATE OR REPLACE FUNCTION public._partner_tx_move_files(p_old uuid, p_new uuid)
RETURNS void LANGUAGE sql SET search_path TO 'public' AS $$
  UPDATE public.attachments SET record_id = p_new WHERE record_type = 'partner_transaction' AND record_id = p_old;
$$;
REVOKE ALL ON FUNCTION public._partner_tx_move_files(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- edit «رأس مال موجود بالفعل» (any time, with a reason)
CREATE OR REPLACE FUNCTION public.edit_existing_capital(p_tx uuid, p_amount numeric, p_day date, p_deposited_on date,
                                                        p_notes text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE t public.partner_transactions%ROWTYPE; v_id uuid; v_desc text; v_amt numeric := round(p_amount, 2);
  v_dep date := coalesce(p_deposited_on, p_day);
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب التعديل'; END IF;
  SELECT * INTO t FROM public.partner_transactions WHERE id = p_tx AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR coalesce(t.is_void, false) THEN RAISE EXCEPTION 'الحركة غير موجودة أو ملغية'; END IF;
  IF NOT (t.existing_capital AND t.transaction_type = 'capital_adjustment') THEN RAISE EXCEPTION 'دي مش «رأس مال موجود بالفعل»'; END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'اكتب المبلغ'; END IF;
  IF p_day IS NULL THEN RAISE EXCEPTION 'اختار من إمتى بيتحسب'; END IF;
  IF p_day > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ مينفعش يكون بعد النهارده'; END IF;
  IF v_dep > public.cairo_today() THEN RAISE EXCEPTION 'تاريخ الإيداع مينفعش يكون بعد النهارده'; END IF;
  v_desc := CASE WHEN p_notes IS NULL THEN t.description
                 ELSE 'رأس مال موجود بالفعل' || coalesce(' — ' || nullif(btrim(p_notes), ''), '') END;
  IF v_amt = t.amount AND p_day = public.partner_tx_day(t) AND v_dep IS NOT DISTINCT FROM coalesce(t.deposited_on, public.partner_tx_day(t))
     AND v_desc IS NOT DISTINCT FROM t.description THEN
    RAISE EXCEPTION 'مفيش حاجة اتغيرت';
  END IF;
  IF EXISTS (SELECT 1 FROM public.partner_capital_settlements s
              WHERE s.tenant_id = t.tenant_id AND s.status = 'active' AND s.capital_by_partner ? t.partner_id::text) THEN
    RAISE EXCEPTION 'رأس المال ده اتقرر مصير فرقه — الغي القرار من «الفرق بين رأس المال والدفاتر» الأول';
  END IF;
  -- only the capital of the months that really change: from the earlier of the two months
  IF v_amt <> t.amount OR date_trunc('month', p_day) <> date_trunc('month', public.partner_tx_day(t)) THEN
    PERFORM public._partner_capital_lock_check(t.tenant_id, least(date_trunc('month', p_day)::date, public._partner_tx_effective_month(t)));
  END IF;
  PERFORM set_config('app.partner_money', '1', true);
  INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by,
                                           movement_date, existing_capital, deposited_on, replaces, edited_by, edited_at, edit_reason)
  VALUES (t.tenant_id, t.partner_id, 'capital_adjustment', v_amt, v_desc, to_char(p_day, 'YYYY-MM'), t.created_by,
          p_day, true, v_dep, t.id, auth.uid(), now(), btrim(p_reason))
  RETURNING id INTO v_id;
  UPDATE public.partner_transactions SET is_void = true, cancel_reason = 'اتعدلت: ' || btrim(p_reason),
         cancelled_by = auth.uid(), cancelled_at = now(), replaced_by = v_id
   WHERE id = t.id;
  PERFORM set_config('app.partner_money', '', true);
  PERFORM public._partner_tx_move_files(t.id, v_id);
  RETURN v_id;
END $function$;

-- edit a contribution / capital withdrawal that went through the till (any day): cancel on its own day + the corrected one
CREATE OR REPLACE FUNCTION public.edit_partner_capital_move(p_tx uuid, p_amount numeric, p_date date, p_notes text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE t public.partner_transactions%ROWTYPE; r public.treasury%ROWTYPE; v jsonb; v_new uuid; v_amt numeric := round(p_amount, 2);
  v_day date := coalesce(p_date, public.partner_tx_day(t)); v_notes text; v_new_month date;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب التعديل'; END IF;
  SELECT * INTO t FROM public.partner_transactions WHERE id = p_tx AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR coalesce(t.is_void, false) THEN RAISE EXCEPTION 'الحركة غير موجودة أو ملغية'; END IF;
  IF t.transaction_type NOT IN ('contribution', 'capital_withdrawal') OR t.related_treasury_id IS NULL OR t.distribution_id IS NOT NULL THEN
    RAISE EXCEPTION 'التعديل هنا للمساهمة أو السحب من رأس المال اللي دخل / طلع من الخزنة بس';
  END IF;
  IF EXISTS (SELECT 1 FROM public.partner_transactions s WHERE s.related_treasury_id = t.related_treasury_id AND s.id <> t.id AND NOT coalesce(s.is_void, false)) THEN
    RAISE EXCEPTION 'السحب ده متقسم (رأس مال + ربح) — الغيه واعمل واحد جديد';
  END IF;
  v_day := coalesce(p_date, public.partner_tx_day(t));
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF v_day > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ في المستقبل'; END IF;
  IF v_amt = t.amount AND v_day = public.partner_tx_day(t) AND p_notes IS NULL THEN RAISE EXCEPTION 'مفيش حاجة اتغيرت'; END IF;
  v_new_month := (date_trunc('month', v_day) + interval '1 month')::date;
  PERFORM public._partner_capital_lock_check(t.tenant_id, least(v_new_month, public._partner_tx_effective_month(t)));
  SELECT * INTO r FROM public.treasury WHERE id = t.related_treasury_id;
  v_notes := coalesce(nullif(btrim(p_notes), ''), r.description);
  PERFORM public.cancel_partner_transaction(t.id, 'اتعدلت: ' || btrim(p_reason));
  v := public.partner_money(t.partner_id, CASE WHEN t.transaction_type = 'contribution' THEN 'contribution' ELSE 'withdrawal' END,
                            v_amt, 'capital', NULL, t.branch_id, t.payment_method, v_day, v_notes,
                            CASE WHEN t.transaction_type = 'contribution' THEN r.transfer_to_account ELSE r.transfer_from_account END);
  SELECT id INTO v_new FROM public.partner_transactions
   WHERE related_treasury_id = (v->>'treasury_id')::uuid AND transaction_type = t.transaction_type LIMIT 1;
  UPDATE public.partner_transactions SET replaces = t.id, edited_by = auth.uid(), edited_at = now(), edit_reason = btrim(p_reason),
         deposited_on = CASE WHEN t.transaction_type = 'contribution' THEN v_day END
   WHERE id = v_new;
  UPDATE public.partner_transactions SET replaced_by = v_new WHERE id = t.id;
  PERFORM public._partner_tx_move_files(t.id, v_new);
  RETURN v || jsonb_build_object('old', t.id, 'new', v_new, 'difference', round(v_amt - t.amount, 2));
END $function$;

-- cancel: who / when, and never under a distributed month (capital movements)
DO $patch$
DECLARE d text := pg_get_functiondef('public.cancel_partner_transaction(uuid, text)'::regprocedure); n text; v_m text;
BEGIN
  n := replace(d, 'cancel_reason = btrim(p_reason)', 'cancel_reason = btrim(p_reason), cancelled_by = auth.uid(), cancelled_at = now()');
  IF (length(n) - length(d)) <> 2 * length(', cancelled_by = auth.uid(), cancelled_at = now()') THEN RAISE EXCEPTION '0288: cancel text (who / when) not found'; END IF;
  v_m := '  IF t.existing_capital AND t.transaction_type = ''capital_adjustment'' AND EXISTS';
  IF position(v_m IN n) = 0 THEN RAISE EXCEPTION '0288: cancel anchor not found'; END IF;
  n := replace(n, v_m,
    '  PERFORM public._partner_capital_lock_check(t.tenant_id, (SELECT min(public._partner_tx_effective_month(x)) FROM public.partner_transactions x' || E'\n' ||
    '     WHERE NOT coalesce(x.is_void, false) AND (x.id = t.id OR (t.related_treasury_id IS NOT NULL AND x.related_treasury_id = t.related_treasury_id))));' || E'\n' || v_m);
  EXECUTE n;
END $patch$;

-- the cards: deposit day, who edited / cancelled, what it replaced; «تعديل» for existing capital and unsplit till capital moves
DO $patch$
DECLARE d text := pg_get_functiondef('public.partner_cards(uuid)'::regprocedure); n text; a text; b text;
BEGIN
  a := $a$'editable', NOT coalesce(t.is_void, false) AND t.transaction_type = 'contribution' AND t.related_treasury_id IS NOT NULL
                    AND (t.created_at AT TIME ZONE 'Africa/Cairo')::date = public.cairo_today(),$a$;
  b := $b$'editable', NOT coalesce(t.is_void, false) AND t.distribution_id IS NULL
                    AND ((t.existing_capital AND t.transaction_type = 'capital_adjustment')
                      OR (t.transaction_type IN ('contribution', 'capital_withdrawal') AND t.related_treasury_id IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM public.partner_transactions s WHERE s.related_treasury_id = t.related_treasury_id AND s.id <> t.id))),
        'deposited_on', t.deposited_on, 'edited_at', t.edited_at, 'edit_reason', t.edit_reason,
        'edited_by', (SELECT pr.name FROM public.profiles pr WHERE pr.id = t.edited_by),
        'cancelled_at', t.cancelled_at, 'cancelled_by', (SELECT pr.name FROM public.profiles pr WHERE pr.id = t.cancelled_by),
        'replaces', t.replaces, 'replaced_by', t.replaced_by,
        'replaces_amount', (SELECT o.amount FROM public.partner_transactions o WHERE o.id = t.replaces),
        'files', (SELECT count(*) FROM public.attachments f WHERE f.record_type = 'partner_transaction' AND f.record_id = t.id),$b$;
  IF position(a IN d) = 0 THEN RAISE EXCEPTION '0288: partner_cards editable text not found'; END IF;
  n := replace(d, a, b);
  EXECUTE n;
END $patch$;

GRANT EXECUTE ON FUNCTION public.partner_existing_capital(uuid, numeric, date, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_existing_capital(uuid, numeric, date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_partner_capital_move(uuid, numeric, date, text, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('edit_existing_capital', '0288', 'owner / admin: edit «رأس مال موجود بالفعل» with a reason'),
  ('edit_partner_capital_move', '0288', 'owner / admin: edit a till contribution / capital withdrawal with a reason')
ON CONFLICT DO NOTHING;
