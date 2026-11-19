-- 0275 «ظبّط رأس مال الشركاء» (owner «نفذ» 2026-11-19): the company owner sets, in one wizard, how much of the money
-- that was already in the business when the books started (goods + tills + what people owe − what we owe = account 3950
-- «رصيد افتتاحي») belongs to each partner, plus the partners' money in / out during the year — for any company.
--  * opening capital = partner_transactions 'capital_adjustment' on the books' first day, no till row, description
--    «رأس مال افتتاحي — <name>», journal Dr 3950 / Cr 3100 (source 'partner_opening'). Never above 3950.
--  * cash put in the till  → partner_money(contribution)            (till +, 1100 / 3100)
--  * paid a supplier from his pocket → partner_money(contribution) into the branch's cash + a supplier payment voucher the
--    same day from that cash (till net 0, supplier −, capital +)
--  * withdrawal            → partner_money(withdrawal, from capital)
--  * capital_share = each partner's capital / total; the split uses partner_capital_for_month, which now counts the
--    opening capital from its own month.
-- ONE call does everything or nothing; p_apply = false only checks and computes the result (writes nothing, uses no
-- voucher / entry number). Refused after a profit distribution, or a period that is closed.
-- Owner only. Running it again replaces the opening capital (old rows voided, their entries reversed) and adds the new moves.

CREATE OR REPLACE FUNCTION public.partner_capital_for_month(p_partner_id uuid, p_month date)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(p.initial_capital, 0)
       + coalesce((SELECT sum(CASE WHEN t.transaction_type = 'capital_withdrawal' THEN -t.amount ELSE t.amount END)
                     FROM public.partner_transactions t
                    WHERE t.partner_id = p.id AND coalesce(t.is_void, false) = false
                      AND coalesce(t.description, '') <> 'تعديل رأس المال المدفوع'
                      AND ((t.transaction_type IN ('contribution', 'capital_withdrawal') AND public.partner_tx_day(t) < date_trunc('month', p_month)::date)
                        -- 0275: the opening capital belongs to the month it is dated in (the books' first day)
                        OR (t.transaction_type = 'capital_adjustment' AND t.related_treasury_id IS NULL
                            AND public.partner_tx_day(t) <= date_trunc('month', p_month)::date))), 0)
  FROM public.equity_partners p WHERE p.id = p_partner_id;
$function$;

-- what the wizard opens with
CREATE OR REPLACE FUNCTION public.partner_capital_setup_info()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id(); v_start date; v_open numeric;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'تظبيط رأس مال الشركاء لصاحب الشركة بس' USING ERRCODE = '42501'; END IF;
  SELECT min(e.entry_date) INTO v_start FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
    JOIN chart_of_accounts a ON a.id = l.account_id WHERE e.tenant_id = v_t AND e.status = 'posted' AND a.code = '3950';
  SELECT coalesce(sum(l.credit - l.debit), 0) INTO v_open FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
    JOIN chart_of_accounts a ON a.id = l.account_id
   WHERE e.tenant_id = v_t AND e.status = 'posted' AND a.code = '3950' AND e.entry_date <= coalesce(v_start, public.cairo_today())
     AND coalesce(e.source_type, '') NOT LIKE 'partner_opening%';
  RETURN jsonb_build_object(
    'start_day', v_start,
    'opening_equity', round(v_open, 2),
    'distributed', EXISTS (SELECT 1 FROM partner_transactions t WHERE t.tenant_id = v_t AND t.transaction_type = 'profit_share' AND NOT coalesce(t.is_void, false)),
    'partners', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'is_active', p.is_active,
        'opening', coalesce((SELECT sum(t.amount) FROM partner_transactions t WHERE t.partner_id = p.id AND t.transaction_type = 'capital_adjustment'
                              AND t.related_treasury_id IS NULL AND NOT coalesce(t.is_void, false)), 0),
        'capital', (public.partner_cards(p.id)->>'capital')::numeric, 'capital_share', p.capital_share) ORDER BY p.name)
      FROM equity_partners p WHERE p.tenant_id = v_t AND p.is_active), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.partner_capital_setup(p_openings jsonb, p_moves jsonb DEFAULT '[]'::jsonb, p_apply boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_t uuid := public.current_tenant_id(); v_info jsonb; v_start date; v_open numeric; v_sum numeric := 0; v_old_sum numeric := 0;
  r jsonb; m jsonb; v_amt numeric; v_tx uuid; v_name text; v_day date; v_cat uuid; v_pid uuid;
  v_cap jsonb := '{}'::jsonb; v_total numeric; v_rows jsonb; v_replace boolean;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'تظبيط رأس مال الشركاء لصاحب الشركة بس' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(coalesce(p_openings, '[]'::jsonb)) <> 'array' OR jsonb_typeof(coalesce(p_moves, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'بيانات غلط'; END IF;
  v_info := public.partner_capital_setup_info();
  IF (v_info->>'distributed')::boolean THEN
    RAISE EXCEPTION 'فيه أرباح اتوزعت على الشركاء — الغي التوزيع الأول قبل ما تغيّر رأس المال';
  END IF;
  v_start := (v_info->>'start_day')::date;
  v_open := (v_info->>'opening_equity')::numeric;
  IF v_start IS NULL THEN RAISE EXCEPTION 'مفيش أرصدة افتتاحية في الدفاتر لسه — سجّل الأرصدة الافتتاحية الأول'; END IF;
  v_replace := jsonb_array_length(coalesce(p_openings, '[]'::jsonb)) > 0;

  -- ── checks + the arithmetic preview (nothing is written, no number is used up) ──
  SELECT jsonb_object_agg(x->>'id', (x->>'capital')::numeric - CASE WHEN v_replace THEN (x->>'opening')::numeric ELSE 0 END)
    INTO v_cap FROM jsonb_array_elements(v_info->'partners') x;
  v_cap := coalesce(v_cap, '{}'::jsonb);
  IF NOT v_replace THEN SELECT coalesce(sum((x->>'opening')::numeric), 0) INTO v_sum FROM jsonb_array_elements(v_info->'partners') x; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p_openings, '[]'::jsonb)) LOOP
    v_amt := round(coalesce((r->>'amount')::numeric, 0), 2);
    IF v_amt < 0 THEN RAISE EXCEPTION 'رأس المال مينفعش يبقى بالسالب'; END IF;
    IF NOT v_cap ? (r->>'partner_id') THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
    v_cap := jsonb_set(v_cap, ARRAY[r->>'partner_id'], to_jsonb((v_cap->>(r->>'partner_id'))::numeric + v_amt));
    v_sum := v_sum + v_amt;
  END LOOP;
  IF v_sum > v_open + 0.01 THEN
    RAISE EXCEPTION 'مجموع رأس المال الافتتاحي (%) أكبر من صافي الملك يوم البداية (%)', v_sum, v_open;
  END IF;
  FOR m IN SELECT * FROM jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) ORDER BY coalesce(nullif(value->>'date', ''), '9999') LOOP
    v_amt := round(coalesce((m->>'amount')::numeric, 0), 2);
    v_day := coalesce(nullif(m->>'date', '')::date, public.cairo_today());
    IF v_amt <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
    IF NOT v_cap ? (m->>'partner_id') THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
    IF v_day < v_start THEN RAISE EXCEPTION 'تاريخ الحركة (%) قبل بداية الدفاتر (%) — ده جزء من رأس المال الافتتاحي', v_day, v_start; END IF;
    IF v_day > public.cairo_today() THEN RAISE EXCEPTION 'التاريخ في المستقبل'; END IF;
    IF NOT EXISTS (SELECT 1 FROM branches WHERE id = nullif(m->>'branch_id', '')::uuid AND tenant_id = v_t) THEN RAISE EXCEPTION 'اختار الفرع'; END IF;
    CASE m->>'kind'
      WHEN 'cash', 'supplier' THEN
        IF m->>'kind' = 'supplier' AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = nullif(m->>'supplier_id', '')::uuid AND tenant_id = v_t) THEN
          RAISE EXCEPTION 'اختار المورد';
        END IF;
        v_cap := jsonb_set(v_cap, ARRAY[m->>'partner_id'], to_jsonb((v_cap->>(m->>'partner_id'))::numeric + v_amt));
      WHEN 'withdrawal' THEN
        IF v_amt > (v_cap->>(m->>'partner_id'))::numeric + 0.005 THEN
          RAISE EXCEPTION 'السحب (%) أكبر من رأس مال الشريك وقتها (%)', v_amt, (v_cap->>(m->>'partner_id'))::numeric;
        END IF;
        v_cap := jsonb_set(v_cap, ARRAY[m->>'partner_id'], to_jsonb((v_cap->>(m->>'partner_id'))::numeric - v_amt));
      ELSE RAISE EXCEPTION 'نوع الحركة غير معروف: %', m->>'kind';
    END CASE;
  END LOOP;
  SELECT sum(greatest(value::numeric, 0)) INTO v_total FROM jsonb_each_text(v_cap);

  IF NOT p_apply THEN
    SELECT jsonb_agg(jsonb_build_object('id', x->>'id', 'name', x->>'name',
             'capital_before', (x->>'capital')::numeric, 'capital_after', (v_cap->>(x->>'id'))::numeric,
             'share_before', (x->>'capital_share')::numeric,
             'share_after', CASE WHEN coalesce(v_total, 0) > 0 THEN round((v_cap->>(x->>'id'))::numeric / v_total, 4) ELSE (x->>'capital_share')::numeric END)
             ORDER BY x->>'name')
      INTO v_rows FROM jsonb_array_elements(v_info->'partners') x;
    RETURN jsonb_build_object('start_day', v_start, 'opening_equity', v_open, 'opening_total', v_sum,
      'kept_as_retained', round(v_open - v_sum, 2), 'partners', coalesce(v_rows, '[]'::jsonb), 'applied', false);
  END IF;

  -- ── apply: everything below is one transaction ──
  IF v_replace THEN
    PERFORM set_config('app.reverse_on_original_date', '1', true);
    FOR v_tx IN SELECT t.id FROM partner_transactions t WHERE t.tenant_id = v_t AND t.transaction_type = 'capital_adjustment'
                  AND t.related_treasury_id IS NULL AND NOT coalesce(t.is_void, false) LOOP
      UPDATE partner_transactions SET is_void = true, cancel_reason = 'اتستبدل من «ظبّط رأس مال الشركاء»' WHERE id = v_tx;
      PERFORM public.reverse_journal_for_source(v_t, 'partner_opening', v_tx, 'استبدال رأس المال الافتتاحي');
    END LOOP;
    PERFORM set_config('app.reverse_on_original_date', '', true);
    FOR r IN SELECT * FROM jsonb_array_elements(p_openings) LOOP
      v_amt := round(coalesce((r->>'amount')::numeric, 0), 2);
      IF v_amt <= 0 THEN CONTINUE; END IF;
      v_pid := (r->>'partner_id')::uuid;
      SELECT name INTO v_name FROM equity_partners WHERE id = v_pid;
      INSERT INTO partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by, movement_date)
      VALUES (v_t, v_pid, 'capital_adjustment', v_amt, 'رأس مال افتتاحي — ' || v_name, to_char(v_start, 'YYYY-MM'), auth.uid(), v_start)
      RETURNING id INTO v_tx;
      PERFORM public.post_journal(v_t, v_start, 'رأس مال افتتاحي — ' || v_name, 'partner_opening', v_tx, jsonb_build_array(
        jsonb_build_object('account_code', '3950', 'debit', v_amt, 'credit', 0, 'description', 'من الرصيد الافتتاحي — ' || v_name),
        jsonb_build_object('account_code', '3100', 'debit', 0, 'credit', v_amt, 'description', 'رأس مال ' || v_name)));
    END LOOP;
  END IF;

  FOR m IN SELECT * FROM jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) ORDER BY coalesce(nullif(value->>'date', ''), '9999') LOOP
    v_amt := round((m->>'amount')::numeric, 2);
    v_day := coalesce(nullif(m->>'date', '')::date, public.cairo_today());
    v_pid := (m->>'partner_id')::uuid;
    SELECT name INTO v_name FROM equity_partners WHERE id = v_pid;
    IF m->>'kind' = 'cash' THEN
      PERFORM public.partner_money(v_pid, 'contribution', v_amt, 'capital', NULL, (m->>'branch_id')::uuid,
                coalesce(nullif(m->>'method', ''), 'cash'), v_day, nullif(m->>'notes', ''), nullif(m->>'account', ''));
    ELSIF m->>'kind' = 'supplier' THEN
      SELECT id INTO v_cat FROM voucher_categories WHERE tenant_id = v_t AND type = 'payment' AND gl_account_code = '2100' AND coalesce(is_active, true)
       ORDER BY is_system DESC NULLS LAST, created_at LIMIT 1;
      IF v_cat IS NULL THEN RAISE EXCEPTION 'مفيش بند «مدفوعات موردين» في الشركة'; END IF;
      PERFORM public.partner_money(v_pid, 'contribution', v_amt, 'capital', NULL, (m->>'branch_id')::uuid,
                'cash', v_day, coalesce(nullif(m->>'notes', ''), 'مساهمة — دفع لمورد من جيبه — ' || v_name), NULL);
      PERFORM public.create_manual_voucher((m->>'branch_id')::uuid, 'payment', v_cat, v_amt, 'cash', NULL, NULL, 0, 'supplier',
                (m->>'supplier_id')::uuid, NULL, 'دفعها الشريك ' || v_name || ' من جيبه', v_day, NULL);
    ELSE
      PERFORM public.partner_money(v_pid, 'withdrawal', v_amt, 'capital', NULL, (m->>'branch_id')::uuid,
                coalesce(nullif(m->>'method', ''), 'cash'), v_day, nullif(m->>'notes', ''), nullif(m->>'account', ''));
    END IF;
  END LOOP;

  -- the split follows the capital
  SELECT sum(greatest((public.partner_cards(p2.id)->>'capital')::numeric, 0)) INTO v_total FROM equity_partners p2 WHERE p2.tenant_id = v_t AND p2.is_active;
  IF coalesce(v_total, 0) > 0 THEN
    UPDATE equity_partners p2 SET capital_share = round(greatest((public.partner_cards(p2.id)->>'capital')::numeric, 0) / v_total, 4), updated_at = now()
     WHERE p2.tenant_id = v_t AND p2.is_active;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id', p2.id, 'name', p2.name,
           'capital_before', (SELECT (x->>'capital')::numeric FROM jsonb_array_elements(v_info->'partners') x WHERE x->>'id' = p2.id::text),
           'capital_after', (public.partner_cards(p2.id)->>'capital')::numeric,
           'share_before', (SELECT (x->>'capital_share')::numeric FROM jsonb_array_elements(v_info->'partners') x WHERE x->>'id' = p2.id::text),
           'share_after', p2.capital_share) ORDER BY p2.name)
    INTO v_rows FROM equity_partners p2 WHERE p2.tenant_id = v_t AND p2.is_active;
  RETURN jsonb_build_object('start_day', v_start, 'opening_equity', v_open, 'opening_total', v_sum,
    'kept_as_retained', round(v_open - v_sum, 2), 'partners', coalesce(v_rows, '[]'::jsonb), 'applied', true,
    'books_balanced', (SELECT coalesce(sum(l.debit - l.credit), 0) = 0 FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
                        WHERE e.tenant_id = v_t AND e.status = 'posted'));
END $function$;

REVOKE ALL ON FUNCTION public.partner_capital_setup_info() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_capital_setup(jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_capital_setup_info() TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_capital_setup(jsonb, jsonb, boolean) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('partner_capital_setup_info', '0275', 'partners capital wizard — what it opens with (owner)'),
  ('partner_capital_setup', '0275', 'partners capital wizard — preview / apply in one transaction (owner)')
ON CONFLICT (function_name) DO NOTHING;
