-- 0283 «الفرق ده راح فين؟» (owner 2026-11-25 «نفذ»; «اختار بنفسي»): when the partners' «موجود بالفعل» capital is not what the
-- books say the company owned on its first day (account 3950 «رصيد افتتاحي»), the owner decides where the difference went:
--  1) أصول مش متسجلة — added on «الأصول الثابتة» as «قبل السيستم» (add_fixed_asset 'opening': Dr 1500 / Cr 3950), so the
--     books' opening grows and the difference shrinks by itself (nothing here);
--  2) 'loss'    خسارة قبل السيستم — Dr 3800 «الأرباح المحتجزة» (accumulated losses), 2026 profit untouched;
--  3) 'drawing' سحبها شريك قبل السيستم — Dr 3200 «مسحوبات الشركاء»; `keep_share` = his % stays, else a no-till
--     «مسحوب من رأس المال» row on the day before the start lowers his capital (and %) from the first month;
--  4) 'leave'   سيبه زي ما هو — no entry at all, the decision is only remembered (the card stops asking).
-- For 1–3 ONE entry on the books' first day moves the opening into each partner's capital:
--    Dr 3950 (the books' opening) + Dr 3800 (losses) + Dr 3200 (drawings) = Cr 3100 (each partner's new capital)
-- and when the capital is LESS than the opening: Dr 3950 = Cr 3100 + Cr 3800 (the rest = retained profit, «أرباح محتجزة»).
-- Tills, stock, contacts and 2026 profit never move. Cancelled by `partner_capital_gap_cancel` (entry reversed on its day,
-- the drawing rows voided). Example: ناصر 6M + محمد 4M = 10M, opening 4,845,828.43 → 5,154,171.57: loss 4M + ناصر drew 1,154,171.57.

CREATE TABLE IF NOT EXISTS public.partner_capital_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('recognize', 'leave')),
  capital_total numeric(14,2) NOT NULL,               -- «موجود بالفعل» this decision covers
  opening_used numeric(14,2) NOT NULL DEFAULT 0,      -- of the books' opening (3950)
  capital_by_partner jsonb NOT NULL DEFAULT '{}',
  items jsonb NOT NULL DEFAULT '[]',
  journal_entry_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancel_reason text, notes text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.partner_capital_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pcs_read ON public.partner_capital_settlements;
CREATE POLICY pcs_read ON public.partner_capital_settlements FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()) AND ((SELECT public.is_owner(auth.uid())) OR (SELECT public.is_admin(auth.uid()))));
REVOKE INSERT, UPDATE, DELETE ON public.partner_capital_settlements FROM anon, authenticated;
GRANT SELECT ON public.partner_capital_settlements TO authenticated;

-- where things stand: the books' opening, the «موجود بالفعل» capital not yet decided, and the difference
CREATE OR REPLACE FUNCTION public.partner_capital_gap_info()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id(); v_start date; v_open numeric; v_used numeric; v_new jsonb; v_newtot numeric;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501'; END IF;
  SELECT min(e.entry_date) INTO v_start FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
    JOIN chart_of_accounts a ON a.id = l.account_id
   WHERE e.tenant_id = v_t AND e.status = 'posted' AND a.code = '3950' AND coalesce(e.source_type, '') <> 'partner_capital_recognition';
  v_start := coalesce(v_start, '2026-01-01'::date);
  -- what is LEFT of the books' opening = the 3950 balance now (opening balances, stock corrections, «قبل السيستم» assets,
  -- minus what active decisions moved to the partners' capital; a cancelled decision's reversal puts it back by itself)
  SELECT coalesce(sum(l.credit - l.debit), 0) INTO v_open FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
    JOIN chart_of_accounts a ON a.id = l.account_id
   WHERE e.tenant_id = v_t AND e.status = 'posted' AND a.code = '3950' AND coalesce(e.source_type, '') NOT LIKE 'partner_opening%';
  SELECT coalesce(sum(opening_used), 0) INTO v_used FROM partner_capital_settlements WHERE tenant_id = v_t AND status = 'active';
  v_open := v_open + v_used;   -- the whole opening; left = v_open − v_used
  -- each partner's «موجود بالفعل» not covered yet by an active decision
  SELECT coalesce(jsonb_object_agg(p.id, x.amt), '{}'), coalesce(sum(x.amt), 0) INTO v_new, v_newtot
    FROM equity_partners p
    CROSS JOIN LATERAL (SELECT round(coalesce((SELECT sum(t.amount) FROM partner_transactions t WHERE t.partner_id = p.id AND t.existing_capital
                                                 AND t.transaction_type = 'capital_adjustment' AND NOT coalesce(t.is_void, false)), 0)
                              - coalesce((SELECT sum((s.capital_by_partner->>p.id::text)::numeric) FROM partner_capital_settlements s
                                           WHERE s.tenant_id = v_t AND s.status = 'active'), 0), 2) AS amt) x
   WHERE p.tenant_id = v_t AND x.amt <> 0;
  RETURN jsonb_build_object(
    'start_day', v_start,
    'opening', round(v_open, 2), 'opening_used', round(v_used, 2), 'opening_left', round(v_open - v_used, 2),
    'capital_new', round(v_newtot, 2), 'capital_by_partner', v_new,
    'gap', round(v_newtot - (v_open - v_used), 2),
    'partners', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'capital_new', coalesce((v_new->>p.id::text)::numeric, 0))
                                  ORDER BY p.name) FROM equity_partners p WHERE p.tenant_id = v_t AND p.is_active), '[]'::jsonb),
    'decisions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'capital_total', s.capital_total,
                                  'opening_used', s.opening_used, 'items', s.items, 'status', s.status, 'cancel_reason', s.cancel_reason,
                                  'created_at', s.created_at) ORDER BY s.created_at DESC)
                           FROM partner_capital_settlements s WHERE s.tenant_id = v_t), '[]'::jsonb));
END $$;

-- decide (preview with p_apply = false writes nothing)
CREATE OR REPLACE FUNCTION public.partner_capital_gap_settle(p_items jsonb, p_apply boolean DEFAULT false, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id(); info jsonb; v_gap numeric; v_open numeric; v_new numeric; x jsonb;
  v_loss numeric := 0; v_draw numeric := 0; v_leave boolean := false; v_lines jsonb := '[]'::jsonb; v_id uuid; v_je uuid; v_tx uuid;
  v_items jsonb := '[]'::jsonb; v_start date; p record; v_name text; v_retained numeric := 0;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'لصاحب الشركة بس' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'بيانات غلط'; END IF;
  info := public.partner_capital_gap_info();
  v_gap := (info->>'gap')::numeric; v_open := (info->>'opening_left')::numeric; v_new := (info->>'capital_new')::numeric;
  v_start := (info->>'start_day')::date;
  IF v_new = 0 THEN RAISE EXCEPTION 'مفيش رأس مال «موجود بالفعل» جديد يتقرر مصيره'; END IF;
  IF public.ledger_period_closed(v_t, v_start) THEN RAISE EXCEPTION 'أول يوم في الدفاتر في فترة مقفولة'; END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    IF x->>'kind' = 'leave' THEN v_leave := true;
    ELSIF x->>'kind' = 'loss' THEN
      IF coalesce((x->>'amount')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'اكتب مبلغ الخسارة'; END IF;
      v_loss := v_loss + round((x->>'amount')::numeric, 2);
    ELSIF x->>'kind' = 'drawing' THEN
      IF coalesce((x->>'amount')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'اكتب مبلغ السحب'; END IF;
      SELECT name INTO v_name FROM equity_partners WHERE id = (x->>'partner_id')::uuid AND tenant_id = v_t;
      IF v_name IS NULL THEN RAISE EXCEPTION 'اختار الشريك اللي سحب'; END IF;
      IF (x->>'keep_share') IS NULL THEN RAISE EXCEPTION 'اختار: نسبة % تفضل زي ما هي ولا تقل', v_name; END IF;
      v_draw := v_draw + round((x->>'amount')::numeric, 2);
    ELSE RAISE EXCEPTION 'اختيار غلط: %', x->>'kind'; END IF;
  END LOOP;

  IF v_leave AND jsonb_array_length(p_items) > 1 THEN RAISE EXCEPTION '«سيبه زي ما هو» مينفعش يتجمع مع اختيار تاني'; END IF;
  IF NOT v_leave THEN
    IF v_open < 0 THEN RAISE EXCEPTION 'الرصيد الافتتاحي في الدفاتر بالسالب — راجع الأرصدة الافتتاحية الأول'; END IF;
    IF v_gap > 0 AND abs(v_loss + v_draw - v_gap) > 0.05 THEN
      RAISE EXCEPTION 'لازم المجموع (%) يساوي الفرق (%) — فاضل %', round(v_loss + v_draw, 2), v_gap, round(v_gap - v_loss - v_draw, 2);
    END IF;
    IF v_gap <= 0 AND v_loss + v_draw > 0 THEN RAISE EXCEPTION 'رأس المال مش أكبر من الدفاتر — مفيش فرق يتوزع على خسارة أو سحب'; END IF;
    v_retained := greatest(-v_gap, 0);
    -- the entry: Dr 3950 the opening used, Dr 3800 losses, Dr 3200 drawings = Cr 3100 each partner (+ Cr 3800 the rest)
    v_lines := jsonb_build_array(jsonb_build_object('account_code', '3950', 'debit', least(v_open, v_new + v_retained), 'credit', 0,
                                                    'description', 'الرصيد الافتتاحي ← رأس مال الشركاء'));
    IF v_loss > 0 THEN v_lines := v_lines || jsonb_build_object('account_code', '3800', 'debit', v_loss, 'credit', 0, 'description', 'خسائر قبل السيستم'); END IF;
    FOR x IN SELECT * FROM jsonb_array_elements(p_items) WHERE value->>'kind' = 'drawing' LOOP
      v_lines := v_lines || jsonb_build_object('account_code', '3200', 'debit', round((x->>'amount')::numeric, 2), 'credit', 0,
        'description', 'مسحوبات قبل السيستم — ' || (SELECT name FROM equity_partners WHERE id = (x->>'partner_id')::uuid));
    END LOOP;
    FOR p IN SELECT e.id, e.name, (info->'capital_by_partner'->>e.id::text)::numeric AS amt FROM equity_partners e
              WHERE e.tenant_id = v_t AND (info->'capital_by_partner') ? e.id::text LOOP
      IF p.amt > 0 THEN v_lines := v_lines || jsonb_build_object('account_code', '3100', 'debit', 0, 'credit', p.amt, 'description', 'رأس مال ' || p.name);
      ELSE v_lines := v_lines || jsonb_build_object('account_code', '3100', 'debit', -p.amt, 'credit', 0, 'description', 'رأس مال ' || p.name); END IF;
    END LOOP;
    IF v_retained > 0 THEN v_lines := v_lines || jsonb_build_object('account_code', '3800', 'debit', 0, 'credit', v_retained, 'description', 'أرباح محتجزة قبل السيستم'); END IF;
  END IF;

  IF NOT p_apply THEN
    RETURN jsonb_build_object('applied', false, 'gap', v_gap, 'leave', v_leave, 'lines', v_lines, 'retained', v_retained,
      'balanced', (SELECT abs(sum((l->>'debit')::numeric) - sum((l->>'credit')::numeric)) < 0.01 FROM jsonb_array_elements(v_lines) l) OR v_leave);
  END IF;

  INSERT INTO partner_capital_settlements (tenant_id, kind, capital_total, opening_used, capital_by_partner, items, notes, created_by)
  VALUES (v_t, CASE WHEN v_leave THEN 'leave' ELSE 'recognize' END, v_new,
          CASE WHEN v_leave THEN 0 ELSE least(v_open, v_new + v_retained) END, info->'capital_by_partner', '[]'::jsonb, nullif(btrim(p_notes), ''), auth.uid())
  RETURNING id INTO v_id;
  IF NOT v_leave THEN
    v_je := public.post_journal(v_t, v_start, 'رأس مال الشركاء من الرصيد الافتتاحي', 'partner_capital_recognition', v_id, v_lines);
    PERFORM set_config('app.partner_money', '1', true);
    FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_tx := NULL;
      IF x->>'kind' = 'drawing' AND NOT (x->>'keep_share')::boolean THEN
        INSERT INTO partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by, movement_date, existing_capital)
        VALUES (v_t, (x->>'partner_id')::uuid, 'capital_withdrawal', round((x->>'amount')::numeric, 2), 'مسحوب قبل السيستم',
                to_char(v_start - 1, 'YYYY-MM'), auth.uid(), v_start - 1, true)
        RETURNING id INTO v_tx;
      END IF;
      v_items := v_items || (x || jsonb_build_object('tx_id', v_tx));
    END LOOP;
    PERFORM set_config('app.partner_money', '', true);
  ELSE
    v_items := p_items;
  END IF;
  UPDATE partner_capital_settlements SET items = v_items, journal_entry_id = v_je WHERE id = v_id;
  RETURN jsonb_build_object('applied', true, 'id', v_id, 'journal_entry_id', v_je, 'gap', v_gap, 'leave', v_leave, 'lines', v_lines);
END $$;

CREATE OR REPLACE FUNCTION public.partner_capital_gap_cancel(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id(); s partner_capital_settlements%ROWTYPE; x jsonb; n int := 0;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'لصاحب الشركة بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  SELECT * INTO s FROM partner_capital_settlements WHERE id = p_id AND tenant_id = v_t FOR UPDATE;
  IF NOT FOUND OR s.status <> 'active' THEN RAISE EXCEPTION 'القرار ده مش موجود أو ملغي'; END IF;
  IF s.journal_entry_id IS NOT NULL THEN
    PERFORM set_config('app.reverse_on_original_date', '1', true);
    PERFORM public.reverse_journal_for_source(v_t, 'partner_capital_recognition', s.id, 'إلغاء: ' || btrim(p_reason));
    PERFORM set_config('app.reverse_on_original_date', '', true);
  END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(s.items) LOOP
    IF nullif(x->>'tx_id', '') IS NOT NULL THEN
      UPDATE partner_transactions SET is_void = true, cancel_reason = btrim(p_reason) WHERE id = (x->>'tx_id')::uuid AND NOT coalesce(is_void, false);
      n := n + 1;
    END IF;
  END LOOP;
  UPDATE partner_capital_settlements SET status = 'cancelled', cancel_reason = btrim(p_reason) WHERE id = s.id;
  RETURN jsonb_build_object('cancelled', true, 'drawings_voided', n);
END $$;

-- a «موجود بالفعل» row already covered by an active decision can't be cancelled alone (cancel the decision first)
DO $p$
DECLARE d text := pg_get_functiondef('public.cancel_partner_transaction(uuid,text)'::regprocedure);
  old_ text := $o$  IF t.existing_capital THEN
    UPDATE$o$;
  new_ text := $n$  IF t.existing_capital AND t.transaction_type = 'capital_adjustment' AND EXISTS (SELECT 1 FROM public.partner_capital_settlements s
       WHERE s.tenant_id = t.tenant_id AND s.status = 'active' AND s.capital_by_partner ? t.partner_id::text) THEN
    RAISE EXCEPTION 'رأس المال ده اتقرر مصير فرقه — الغي القرار من «الفرق بين رأس المال والدفاتر» الأول';
  END IF;
  IF t.existing_capital AND EXISTS (SELECT 1 FROM public.partner_capital_settlements s, jsonb_array_elements(s.items) i
       WHERE s.tenant_id = t.tenant_id AND s.status = 'active' AND i->>'tx_id' = t.id::text) THEN
    RAISE EXCEPTION 'السحب ده جزء من قرار «الفرق ده راح فين؟» — الغي القرار نفسه';
  END IF;
  IF t.existing_capital THEN
    UPDATE$n$;
BEGIN
  IF position(old_ in d) = 0 THEN RAISE EXCEPTION '0283: cancel_partner_transaction text not found'; END IF;
  EXECUTE replace(d, old_, new_);
END $p$;

GRANT EXECUTE ON FUNCTION public.partner_capital_gap_info() TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_capital_gap_settle(jsonb, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_capital_gap_cancel(uuid, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('partner_capital_gap_info', '0283', 'partners: books opening vs «موجود بالفعل» capital (owner / admin)'),
  ('partner_capital_gap_settle', '0283', 'partners: where the difference went — loss / drawing / leave, preview or apply (owner)'),
  ('partner_capital_gap_cancel', '0283', 'partners: cancel that decision, entry reversed on its day (owner)')
ON CONFLICT (function_name) DO NOTHING;
