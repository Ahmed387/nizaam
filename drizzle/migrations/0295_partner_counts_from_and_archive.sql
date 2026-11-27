-- 0295 (owner 2026-11-27): «يتحسب من بداية شهر» chosen by the owner for till money too; delete / archive a partner.
--  * partner_transactions.counts_from (the 1st of a month): a till contribution / capital withdrawal counts in the partner's
--    capital and % of profit from that month. NULL = the old rule (the month after its day) — old rows are left as they are
--    (owner «سيبها زي ما هي»). The screens suggest: money in → the month after the day, money out → the same month; choosing
--    against it only warns (owner «تنبيه بس»).
--  * partner_money(..., p_counts_from) / edit_partner_capital_move(..., p_counts_from); a month whose profit was distributed is
--    refused (_partner_capital_lock_check).
--  * delete_partner (only a partner with NO movement, advance, distribution line or login) and set_partner_archived
--    (is_active off + who / when / why; refused while capital, profit or advances are not zero). The browser loses
--    INSERT / UPDATE / DELETE on equity_partners: a direct delete used to cascade-delete every movement of the partner.

ALTER TABLE public.partner_transactions ADD COLUMN IF NOT EXISTS counts_from date;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_tx_counts_from_month') THEN
    ALTER TABLE public.partner_transactions ADD CONSTRAINT partner_tx_counts_from_month
      CHECK (counts_from IS NULL OR counts_from = date_trunc('month', counts_from)::date);
  END IF;
END $$;

-- the month a movement starts to count (counts_from wins for till money)
CREATE OR REPLACE FUNCTION public._partner_tx_effective_month(t partner_transactions)
RETURNS date LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE
    WHEN t.transaction_type IN ('capital_adjustment', 'capital_withdrawal') AND t.existing_capital THEN date_trunc('month', public.partner_tx_day(t))::date
    WHEN t.transaction_type IN ('contribution', 'capital_withdrawal') THEN coalesce(t.counts_from, (date_trunc('month', public.partner_tx_day(t)) + interval '1 month')::date)
    ELSE NULL END
$function$;

DO $$
DECLARE d text := pg_get_functiondef('public.partner_capital_for_month(uuid,date)'::regprocedure);
  a text := 'AND NOT coalesce(t.existing_capital, false) AND public.partner_tx_day(t) < date_trunc(''month'', p_month)::date)';
BEGIN
  IF position('counts_from' IN d) > 0 THEN RETURN; END IF;
  IF position(a IN d) = 0 THEN RAISE EXCEPTION '0295: partner_capital_for_month text not found'; END IF;
  EXECUTE replace(d, a, 'AND NOT coalesce(t.existing_capital, false) AND public._partner_tx_effective_month(t) <= date_trunc(''month'', p_month)::date)  -- 0295: counts_from');
END $$;

-- the first month (January 2026 → p_to) in which the partner's capital would be below zero, NULL = none
CREATE OR REPLACE FUNCTION public._partner_first_negative_month(p_partner uuid, p_to date)
RETURNS date LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT min(g.m)::date FROM generate_series(DATE '2026-01-01', greatest(p_to, DATE '2026-01-01'), interval '1 month') g(m)
   WHERE public.partner_capital_for_month(p_partner, g.m::date) < -0.005
$function$;
REVOKE ALL ON FUNCTION public._partner_first_negative_month(uuid, date) FROM PUBLIC, anon, authenticated;

-- partner_money: + p_counts_from
DO $$
DECLARE d text := pg_get_functiondef('public.partner_money(uuid,text,numeric,text,numeric,uuid,text,date,text,text)'::regprocedure);
  s1 text := 'p_account text DEFAULT NULL::text)';
  s2 text := '  IF v_day > public.cairo_today() THEN RAISE EXCEPTION ''التاريخ في المستقبل''; END IF;';
  s3 text := '  PERFORM public.post_journal(p.tenant_id, v_day, v_desc, ''treasury_row'', v_tr, v_lines);';
  s4 text := 'RETURN jsonb_build_object(''treasury_id'', v_tr,';
BEGIN
  IF position(s1 IN d) = 0 OR position(s2 IN d) = 0 OR position(s3 IN d) = 0 OR position(s4 IN d) = 0 THEN
    RAISE EXCEPTION '0295: partner_money text not found';
  END IF;
  d := replace(d, s1, 'p_account text DEFAULT NULL::text, p_counts_from date DEFAULT NULL::date)');
  d := replace(d, s2, s2 || '
  -- 0295: the owner chooses from which month it counts (the 1st of a month, from January 2026)
  IF p_counts_from IS NOT NULL AND p_counts_from <> date_trunc(''month'', p_counts_from)::date THEN RAISE EXCEPTION ''«يتحسب من» لازم يكون أول الشهر''; END IF;
  IF p_counts_from IS NOT NULL AND p_counts_from < DATE ''2026-01-01'' THEN RAISE EXCEPTION ''«يتحسب من» لازم يكون من يناير 2026 أو بعده''; END IF;');
  d := replace(d, s3, '  -- 0295: from which month it counts (NULL = the month after its day), and never inside a distributed month
  IF p_counts_from IS NOT NULL THEN
    UPDATE public.partner_transactions SET counts_from = p_counts_from
     WHERE related_treasury_id = v_tr AND transaction_type IN (''contribution'', ''capital_withdrawal'');
  END IF;
  IF v_cap > 0 THEN
    PERFORM public._partner_capital_lock_check(p.tenant_id, coalesce(p_counts_from, (date_trunc(''month'', v_day) + interval ''1 month'')::date));
    -- a month whose capital goes below zero (money out counted before money in) is refused
    IF public._partner_first_negative_month(p.id, greatest(coalesce(p_counts_from, v_day), (date_trunc(''month'', public.cairo_today()) + interval ''1 month'')::date)) IS NOT NULL THEN
      RAISE EXCEPTION ''رأس مال % هيبقى بالسالب في شهر % — غيّر «يتحسب من» أو المبلغ'', p.name,
        to_char(public._partner_first_negative_month(p.id, greatest(coalesce(p_counts_from, v_day), (date_trunc(''month'', public.cairo_today()) + interval ''1 month'')::date)), ''YYYY-MM'');
    END IF;
  END IF;
' || s3);
  d := replace(d, s4, 'RETURN jsonb_build_object(''treasury_id'', v_tr, ''counts_from'', coalesce(p_counts_from, (date_trunc(''month'', v_day) + interval ''1 month'')::date),');
  DROP FUNCTION public.partner_money(uuid,text,numeric,text,numeric,uuid,text,date,text,text);
  EXECUTE d;
END $$;
GRANT EXECUTE ON FUNCTION public.partner_money(uuid,text,numeric,text,numeric,uuid,text,date,text,text,date) TO authenticated;

-- edit_partner_capital_move: + p_counts_from
DO $$
DECLARE d text := pg_get_functiondef('public.edit_partner_capital_move(uuid,numeric,date,text,text)'::regprocedure);
  s1 text := 'p_reason text)';
  s2 text := 'AND p_notes IS NULL THEN RAISE EXCEPTION ''مفيش حاجة اتغيرت''';
  s3 text := '  v_new_month := (date_trunc(''month'', v_day) + interval ''1 month'')::date;';
  s4 text := 'ELSE r.transfer_from_account END);';
  s5 text := '         deposited_on = CASE WHEN t.transaction_type = ''contribution'' THEN v_day END';
BEGIN
  IF position(s1 IN d) = 0 OR position(s2 IN d) = 0 OR position(s3 IN d) = 0 OR position(s4 IN d) = 0 OR position(s5 IN d) = 0 THEN
    RAISE EXCEPTION '0295: edit_partner_capital_move text not found';
  END IF;
  d := replace(d, s1, 'p_reason text, p_counts_from date DEFAULT NULL::date)');
  d := replace(d, s2, 'AND p_notes IS NULL AND coalesce(p_counts_from, public._partner_tx_effective_month(t)) = public._partner_tx_effective_month(t) THEN RAISE EXCEPTION ''مفيش حاجة اتغيرت''');
  d := replace(d, s3, '  v_new_month := coalesce(p_counts_from, (date_trunc(''month'', v_day) + interval ''1 month'')::date);  -- 0295');
  d := replace(d, s4, 'ELSE r.transfer_from_account END, v_new_month);');
  DROP FUNCTION public.edit_partner_capital_move(uuid,numeric,date,text,text);
  EXECUTE d;
END $$;
GRANT EXECUTE ON FUNCTION public.edit_partner_capital_move(uuid,numeric,date,text,text,date) TO authenticated;

-- edit_partner_contribution keeps the month the old one counted from
DO $$
DECLARE d text := pg_get_functiondef('public.edit_partner_contribution(uuid,numeric,text)'::regprocedure);
  s text := '  RETURN v || jsonb_build_object(''old'', p_tx,';
BEGIN
  IF position('counts_from' IN d) > 0 THEN RETURN; END IF;
  IF position(s IN d) = 0 THEN RAISE EXCEPTION '0295: edit_partner_contribution text not found'; END IF;
  EXECUTE replace(d, s, '  UPDATE public.partner_transactions SET counts_from = t.counts_from  -- 0295
   WHERE related_treasury_id = (v->>''treasury_id'')::uuid AND transaction_type = ''contribution'';
' || s);
END $$;

-- the partner page shows the month each movement counts from
DO $$
DECLARE d text := pg_get_functiondef('public.partner_cards(uuid)'::regprocedure);
  s text := '''deposited_on'', t.deposited_on,';
BEGIN
  IF position('''counts_from''' IN d) > 0 THEN RETURN; END IF;
  IF position(s IN d) = 0 THEN RAISE EXCEPTION '0295: partner_cards text not found'; END IF;
  EXECUTE replace(d, s, s || ' ''counts_from'', public._partner_tx_effective_month(t),');
END $$;

-- ===== delete / archive a partner =====
ALTER TABLE public.equity_partners ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.equity_partners ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE public.equity_partners ADD COLUMN IF NOT EXISTS archive_reason text;

CREATE OR REPLACE FUNCTION public.delete_partner(p_partner uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p public.equity_partners%ROWTYPE; v_why text;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الحذف'; END IF;
  SELECT * INTO p FROM public.equity_partners WHERE id = p_partner AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  v_why := CASE
    WHEN EXISTS (SELECT 1 FROM public.partner_transactions WHERE partner_id = p.id) THEN 'ليه حركات (حتى لو ملغية)'
    WHEN EXISTS (SELECT 1 FROM public.partner_advances WHERE partner_id = p.id) THEN 'ليه سلف'
    WHEN EXISTS (SELECT 1 FROM public.profit_distribution_lines WHERE partner_id = p.id) THEN 'داخل في توزيع أرباح'
    WHEN EXISTS (SELECT 1 FROM public.partner_users WHERE partner_id = p.id) THEN 'مربوط بحساب دخول'
    WHEN coalesce(p.initial_capital, 0) <> 0 THEN 'ليه رأس مال'
  END;
  IF v_why IS NOT NULL THEN RAISE EXCEPTION 'مينفعش يتحذف لأنه % — اعمله «أرشفة» بدل الحذف', v_why; END IF;
  PERFORM set_config('app.allow_hard_delete', 'on', true);
  DELETE FROM public.equity_partners WHERE id = p.id;
  PERFORM set_config('app.allow_hard_delete', '', true);
  PERFORM public.log_audit_event('DELETE', 'equity_partners', p.id::text, NULL, jsonb_build_object('name', p.name, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('id', p.id, 'name', p.name);
END $function$;

CREATE OR REPLACE FUNCTION public.set_partner_archived(p_partner uuid, p_archived boolean, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p public.equity_partners%ROWTYPE; c jsonb;
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.equity_partners WHERE id = p_partner AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشريك غير موجود'; END IF;
  IF coalesce(p_archived, false) THEN
    IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الأرشفة'; END IF;
    c := public.partner_cards(p.id);
    IF abs(coalesce((c->>'capital')::numeric, 0)) > 0.005 THEN RAISE EXCEPTION 'رأس ماله % — اسحبه الأول وبعدين أرشفه', (c->>'capital')::numeric; END IF;
    IF abs(coalesce((c->>'profit')::numeric, 0)) > 0.005 THEN RAISE EXCEPTION 'صافي ربحه % — صفّيه الأول وبعدين أرشفه', (c->>'profit')::numeric; END IF;
    IF coalesce((c->>'advances')::numeric, 0) > 0.005 THEN RAISE EXCEPTION 'عليه سلف % — اتسدّ الأول وبعدين أرشفه', (c->>'advances')::numeric; END IF;
    UPDATE public.equity_partners SET is_active = false, archived_at = now(), archived_by = auth.uid(), archive_reason = btrim(p_reason) WHERE id = p.id;
  ELSE
    UPDATE public.equity_partners SET is_active = true, archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE id = p.id;
  END IF;
  RETURN jsonb_build_object('id', p.id, 'name', p.name, 'archived', coalesce(p_archived, false));
END $function$;

REVOKE ALL ON FUNCTION public.delete_partner(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_partner_archived(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_partner(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_partner_archived(uuid, boolean, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('delete_partner', '0295', 'owner / admin: delete a partner that has no movement, advance, distribution line or login'),
  ('set_partner_archived', '0295', 'owner / admin: archive (capital, profit and advances zero) or bring back a partner')
ON CONFLICT DO NOTHING;

-- partners are written only through the SECURITY DEFINER functions
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.equity_partners FROM authenticated, anon;
