-- 0219 — fixed assets that reach the books, with automatic monthly depreciation (owner 2026-11-14 «ضيفها وتضيف الفورم
-- بتاعتها ولو يتحسب ولو مفيش ميتحسبش»).
--   add_fixed_asset(...)        owner / admin. Each asset sits in a branch. How it was paid:
--                               'opening' = owned before the system started → Dr 1500 / Cr 3950 on its purchase day;
--                               'paid'    = paid now from a vessel of the branch → a till row (category
--                               `fixed_asset_purchase`, no voucher) + Dr 1500 / Cr cash (1100 / 1110), so tills = books.
--   post_monthly_depreciation   rewritten (the old one wrote journal lines with a column that does not exist and could
--                               never run): straight line, (cost − salvage) / months, starting the month AFTER the
--                               purchase, one entry per asset per month on the month's last day (Dr 6500 / Cr 1590),
--                               never above cost − salvage, never twice (`depreciation_entries`).
--   depreciation_catch_up(t)    posts every completed month still missing for every active asset; pg_cron
--                               «fixed-assets-depreciation» runs it daily for every company — no asset, nothing happens.
--   dispose_fixed_asset         rewritten: money received goes into a vessel of the asset's branch (till row
--                               `fixed_asset_sale`) — the old one debited 1100 with no till row.
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id),
  ADD COLUMN IF NOT EXISTS funding text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS treasury_id uuid,
  ADD COLUMN IF NOT EXISTS acquisition_entry_id uuid;

CREATE OR REPLACE FUNCTION public.fa_set_entry_branch(p_entry uuid, p_branch uuid)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ UPDATE journal_entries SET branch_id = p_branch WHERE id = p_entry AND p_branch IS NOT NULL $function$;
REVOKE ALL ON FUNCTION public.fa_set_entry_branch(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.add_fixed_asset(p_name text, p_category text, p_branch uuid, p_date date, p_cost numeric,
  p_salvage numeric, p_life_months int, p_funding text, p_method text DEFAULT 'cash', p_notes text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; v_id uuid; v_code text; v_tr uuid; v_e uuid; v_at timestamptz; v_lines jsonb;
  v_cost numeric := round(COALESCE(p_cost, 0), 2); v_salv numeric := round(COALESCE(p_salvage, 0), 2);
  v_pm text := COALESCE(NULLIF(p_method, ''), 'cash'); r jsonb;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'إضافة الأصول للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'اكتب اسم الأصل'; END IF;
  IF v_cost <= 0 THEN RAISE EXCEPTION 'التكلفة لازم تكون أكبر من صفر'; END IF;
  IF v_salv < 0 OR v_salv >= v_cost THEN RAISE EXCEPTION 'قيمة الخردة لازم تكون أقل من التكلفة'; END IF;
  IF COALESCE(p_life_months, 0) < 1 THEN RAISE EXCEPTION 'العمر الإنتاجي بالشهور لازم يكون 1 أو أكتر'; END IF;
  IF p_date IS NULL OR p_date > public.cairo_today() THEN RAISE EXCEPTION 'تاريخ الشراء غلط'; END IF;
  IF p_funding NOT IN ('opening', 'paid') THEN RAISE EXCEPTION 'اختار: كان عندنا قبل السيستم، ولا اتدفع من خزنة'; END IF;
  IF NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = p_branch AND b.tenant_id = v_t AND NOT COALESCE(b.is_system, false)) THEN
    RAISE EXCEPTION 'اختار الفرع';
  END IF;
  IF public.ledger_period_closed(v_t, p_date) THEN RAISE EXCEPTION 'التاريخ ده في فترة مقفولة'; END IF;

  SELECT 'FA-' || lpad((COALESCE(max(NULLIF(regexp_replace(code, '\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
    INTO v_code FROM fixed_assets WHERE tenant_id = v_t;
  INSERT INTO fixed_assets (tenant_id, code, name, category, acquisition_date, cost, salvage_value, useful_life_months,
                            depreciation_method, asset_account_id, accum_depreciation_account_id, depreciation_expense_account_id,
                            status, notes, branch_id, funding, payment_method)
  VALUES (v_t, v_code, btrim(p_name), NULLIF(btrim(p_category), ''), p_date, v_cost, v_salv, p_life_months, 'straight_line',
          public.ensure_account(v_t, '1500', 'Fixed Assets', 'asset'),
          public.ensure_account(v_t, '1590', 'Accumulated Depreciation', 'asset'),
          public.ensure_account(v_t, '6500', 'Depreciation Expense', 'expense'),
          'active', NULLIF(btrim(p_notes), ''), p_branch, p_funding, CASE WHEN p_funding = 'paid' THEN v_pm END)
  RETURNING id INTO v_id;

  IF p_funding = 'paid' THEN
    IF NOT public.vessel_is_known(v_t, v_pm) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_pm; END IF;
    v_at := CASE WHEN p_date = public.cairo_today() THEN now() ELSE (p_date + time '12:00') AT TIME ZONE 'Africa/Cairo' END;
    PERFORM set_config('app.skip_treasury_voucher', '1', true);
    INSERT INTO treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by, payment_method, transaction_date, created_at)
    VALUES (p_branch, v_t, 'expense', 'fixed_asset_purchase', v_cost, 'شراء أصل ثابت — ' || btrim(p_name) || ' (' || v_code || ')',
            v_id, auth.uid(), v_pm, p_date, v_at)
    RETURNING id INTO v_tr;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1500', 'debit', v_cost, 'credit', 0, 'description', 'أصل ثابت — ' || btrim(p_name)),
      jsonb_build_object('account_code', public.ledger_cash_account(v_pm), 'debit', 0, 'credit', v_cost, 'description', 'شراء أصل ثابت — ' || btrim(p_name)));
    v_e := public.post_journal(v_t, p_date, 'شراء أصل ثابت — ' || btrim(p_name) || ' (' || v_code || ')', 'treasury_row', v_tr, v_lines);
  ELSE
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1500', 'debit', v_cost, 'credit', 0, 'description', 'أصل ثابت — ' || btrim(p_name)),
      jsonb_build_object('account_code', '3950', 'debit', 0, 'credit', v_cost, 'description', 'أصل كان عندنا قبل السيستم — ' || btrim(p_name)));
    v_e := public.post_journal(v_t, p_date, 'أصل ثابت (رصيد افتتاحي) — ' || btrim(p_name) || ' (' || v_code || ')', 'fixed_asset_opening', v_id, v_lines);
  END IF;
  PERFORM public.fa_set_entry_branch(v_e, p_branch);
  UPDATE fixed_assets SET treasury_id = v_tr, acquisition_entry_id = v_e WHERE id = v_id;

  r := public.depreciation_catch_up(v_t);
  RETURN jsonb_build_object('id', v_id, 'code', v_code, 'entry', v_e, 'treasury_id', v_tr, 'depreciation', r);
END
$function$;

DROP FUNCTION IF EXISTS public.post_monthly_depreciation(uuid, date);
CREATE OR REPLACE FUNCTION public.post_monthly_depreciation(_tenant_id uuid, _period_month date)
 RETURNS TABLE(asset_id uuid, amount numeric, journal_entry_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a record; v_m numeric; v_e uuid; v_start date; v_end date; v_done numeric; v_base numeric;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF public.assert_company_access(NULL) IS DISTINCT FROM _tenant_id
       OR NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN
      RAISE EXCEPTION 'الإهلاك للمالك أو المدير بس' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_start := date_trunc('month', _period_month)::date;
  v_end := (v_start + interval '1 month - 1 day')::date;
  IF v_end >= public.cairo_today() THEN RETURN; END IF;           -- only completed months
  IF public.ledger_period_closed(_tenant_id, v_end) THEN RETURN; END IF;
  FOR a IN
    SELECT * FROM fixed_assets fa
     WHERE fa.tenant_id = _tenant_id AND fa.status = 'active'
       AND date_trunc('month', fa.acquisition_date) < v_start          -- starts the month after the purchase
       AND (fa.disposal_date IS NULL OR fa.disposal_date > v_end)
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM depreciation_entries de WHERE de.asset_id = a.id AND de.period_month = v_start);
    v_base := GREATEST(a.cost - COALESCE(a.salvage_value, 0), 0);
    v_m := round(v_base / a.useful_life_months, 2);
    SELECT COALESCE(sum(de.amount), 0) INTO v_done FROM depreciation_entries de WHERE de.asset_id = a.id;
    IF v_done + v_m > v_base THEN v_m := round(GREATEST(v_base - v_done, 0), 2); END IF;
    CONTINUE WHEN v_m <= 0;
    v_e := public.post_journal(_tenant_id, v_end, 'إهلاك ' || a.name || ' (' || a.code || ') — ' || to_char(v_start, 'MM/YYYY'),
             'depreciation', a.id, jsonb_build_array(
               jsonb_build_object('account_code', '6500', 'debit', v_m, 'credit', 0, 'description', 'مصروف إهلاك ' || a.name),
               jsonb_build_object('account_code', '1590', 'debit', 0, 'credit', v_m, 'description', 'مجمع إهلاك ' || a.name)));
    PERFORM public.fa_set_entry_branch(v_e, a.branch_id);
    INSERT INTO depreciation_entries (tenant_id, asset_id, period_month, amount, journal_entry_id)
    VALUES (_tenant_id, a.id, v_start, v_m, v_e);
    asset_id := a.id; amount := v_m; journal_entry_id := v_e;
    RETURN NEXT;
  END LOOP;
END
$function$;
REVOKE ALL ON FUNCTION public.post_monthly_depreciation(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_monthly_depreciation(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.depreciation_catch_up(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m date; v_first date; v_n int := 0; v_sum numeric := 0; x record;
BEGIN
  SELECT (date_trunc('month', min(acquisition_date)) + interval '1 month')::date INTO v_first
    FROM fixed_assets WHERE tenant_id = p_tenant AND status = 'active';
  IF v_first IS NULL THEN RETURN jsonb_build_object('entries', 0, 'amount', 0); END IF;
  m := v_first;
  WHILE m < date_trunc('month', public.cairo_today())::date LOOP
    FOR x IN SELECT * FROM public.post_monthly_depreciation(p_tenant, m) LOOP
      v_n := v_n + 1; v_sum := v_sum + x.amount;
    END LOOP;
    m := (m + interval '1 month')::date;
  END LOOP;
  RETURN jsonb_build_object('entries', v_n, 'amount', round(v_sum, 2));
END
$function$;
REVOKE ALL ON FUNCTION public.depreciation_catch_up(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.dispose_fixed_asset(uuid, date, numeric);
CREATE OR REPLACE FUNCTION public.dispose_fixed_asset(_asset_id uuid, _disposal_date date, _disposal_amount numeric, _method text DEFAULT 'cash')
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a record; v_t uuid; v_accum numeric; v_nbv numeric; v_gain numeric; v_in numeric; v_lines jsonb := '[]'::jsonb;
  v_tr uuid; v_e uuid; v_pm text := COALESCE(NULLIF(_method, ''), 'cash'); v_at timestamptz;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM fixed_assets WHERE id = _asset_id AND tenant_id = v_t FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'الأصل مش موجود'; END IF;
  IF a.status = 'disposed' THEN RAISE EXCEPTION 'الأصل اتشال قبل كده'; END IF;
  IF _disposal_date IS NULL OR _disposal_date > public.cairo_today() OR _disposal_date < a.acquisition_date THEN RAISE EXCEPTION 'تاريخ غلط'; END IF;
  IF public.ledger_period_closed(v_t, _disposal_date) THEN RAISE EXCEPTION 'التاريخ ده في فترة مقفولة'; END IF;
  PERFORM public.depreciation_catch_up(v_t);
  SELECT COALESCE(sum(de.amount), 0) INTO v_accum FROM depreciation_entries de WHERE de.asset_id = a.id;
  v_in := round(GREATEST(COALESCE(_disposal_amount, 0), 0), 2);
  v_nbv := round(a.cost - v_accum, 2);
  v_gain := round(v_in - v_nbv, 2);
  IF v_in > 0 THEN
    IF a.branch_id IS NULL THEN RAISE EXCEPTION 'الأصل مش مربوط بفرع — مينفعش تستلم فلوس عليه'; END IF;
    IF NOT public.vessel_is_known(v_t, v_pm) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_pm; END IF;
    v_at := CASE WHEN _disposal_date = public.cairo_today() THEN now() ELSE (_disposal_date + time '12:00') AT TIME ZONE 'Africa/Cairo' END;
    PERFORM set_config('app.skip_treasury_voucher', '1', true);
    INSERT INTO treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by, payment_method, transaction_date, created_at)
    VALUES (a.branch_id, v_t, 'income', 'fixed_asset_sale', v_in, 'بيع أصل ثابت — ' || a.name || ' (' || a.code || ')', a.id, auth.uid(), v_pm, _disposal_date, v_at)
    RETURNING id INTO v_tr;
    v_lines := v_lines || jsonb_build_object('account_code', public.ledger_cash_account(v_pm), 'debit', v_in, 'credit', 0, 'description', 'بيع أصل ' || a.name);
  END IF;
  IF v_accum > 0 THEN v_lines := v_lines || jsonb_build_object('account_code', '1590', 'debit', v_accum, 'credit', 0, 'description', 'إقفال مجمع إهلاك ' || a.name); END IF;
  v_lines := v_lines || jsonb_build_object('account_code', '1500', 'debit', 0, 'credit', round(a.cost, 2), 'description', 'خروج الأصل ' || a.name);
  IF v_gain > 0 THEN
    PERFORM public.ensure_account(v_t, '4950', 'Gain on Asset Disposal', 'revenue');
    v_lines := v_lines || jsonb_build_object('account_code', '4950', 'debit', 0, 'credit', v_gain, 'description', 'ربح بيع أصل ' || a.name);
  ELSIF v_gain < 0 THEN
    PERFORM public.ensure_account(v_t, '6900', 'Loss on Asset Disposal', 'expense');
    v_lines := v_lines || jsonb_build_object('account_code', '6900', 'debit', -v_gain, 'credit', 0, 'description', 'خسارة استبعاد أصل ' || a.name);
  END IF;
  v_e := public.post_journal(v_t, _disposal_date, 'استبعاد أصل ثابت — ' || a.name || ' (' || a.code || ')',
                             CASE WHEN v_tr IS NULL THEN 'asset_disposal' ELSE 'treasury_row' END, COALESCE(v_tr, a.id), v_lines);
  PERFORM public.fa_set_entry_branch(v_e, a.branch_id);
  UPDATE fixed_assets SET status = 'disposed', disposal_date = _disposal_date, disposal_amount = v_in,
         disposal_journal_entry_id = v_e, updated_at = now() WHERE id = a.id;
  RETURN v_e;
END
$function$;
REVOKE ALL ON FUNCTION public.dispose_fixed_asset(uuid, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset(uuid, date, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.add_fixed_asset(text, text, uuid, date, numeric, numeric, int, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_fixed_asset(text, text, uuid, date, numeric, numeric, int, text, text, text) TO authenticated;

-- the browser no longer writes the table directly (SEC-004)
REVOKE INSERT, UPDATE, DELETE ON public.fixed_assets FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.depreciation_entries FROM anon, authenticated;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('add_fixed_asset', '0219', 'owner / admin adds an asset: till row or opening entry'),
  ('post_monthly_depreciation', '0219', 'owner / admin, one completed month'),
  ('dispose_fixed_asset', '0219', 'owner / admin, money into a vessel of the asset branch')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.depreciation_daily()
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM fixed_assets WHERE status = 'active' LOOP
    BEGIN
      PERFORM public.depreciation_catch_up(t.tenant_id);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO ledger_sync_errors (tenant_id, context, error) VALUES (t.tenant_id, 'depreciation_daily', SQLERRM);
    END;
  END LOOP;
  RETURN n;
END
$function$;
REVOKE ALL ON FUNCTION public.depreciation_daily() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('fixed-assets-depreciation', '13 2 * * *', $$SELECT public.depreciation_daily()$$);

-- 0219b: the old insert trigger posted a second acquisition entry (Dr 1500 / Cr 2350 clearing) — add_fixed_asset posts it now.
DROP TRIGGER IF EXISTS trg_fixed_asset_journal ON public.fixed_assets;
