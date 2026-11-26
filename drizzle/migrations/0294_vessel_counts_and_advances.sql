-- 0294 (owner 2026-11-26 «نفذ اقتراحاتك في الثغرات … نفذ اقتراحك في تسوية الوعاء»):
--  A. A hand-written «سلف موظفين» voucher (to an employee) IS an advance: an `advances` row (deducted from his salary
--     like any advance); «رد سلف موظفين» pays his open advances back, oldest first (`advance_payments`), and is refused
--     above what is open. Cancelling the voucher cancels the advance (refused once a salary / repayment took from it)
--     or puts the repaid amount back; restoring it brings them back. `cancel_employee_advance` cancels such a voucher.
--  B. A ledger reversal of an entry in a locked period goes on the first open day (`ledger_effective_date`), like the
--     till reversal — it went on the cancel day.
--  C. «تسوية الوعاء» (vessel count): someone counts the money really in a vessel (cash / Vodafone / InstaPay / PayMob /
--     «الخزينة» / …); the difference with the system is booked in that vessel on the count's day so the system equals
--     the money in hand. The owner chooses each time:
--       shortage → «عجز خزنة» (6920, a loss this month) | on an employee (an advance on him, off his salary)
--                  | «على السنين اللي فاتت» (3800, no effect on this year's profit)
--       surplus  → «زيادة خزنة» (4200 «إيرادات أخرى», profit) | «على السنين اللي فاتت» (3800)
--     Settings (owner): `vessel_count_mode` 'owner' (the owner counts and books) or 'approval' (whoever has
--     «تسوية الوعاء ← يعدّ» counts, the owner approves and chooses). Cancel = the owner, on the count's day.

-- ---------- A. advances from hand-written vouchers ----------
ALTER TABLE public.advances ADD COLUMN IF NOT EXISTS voucher_id uuid;
ALTER TABLE public.advance_payments ADD COLUMN IF NOT EXISTS voucher_id uuid;
CREATE INDEX IF NOT EXISTS advances_voucher_idx ON public.advances (voucher_id) WHERE voucher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS advance_payments_voucher_idx ON public.advance_payments (voucher_id) WHERE voucher_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.voucher_category_employee_kind(p_category uuid)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH RECURSIVE c AS (
    SELECT id, parent_id, system_key, 0 AS lvl FROM public.voucher_categories WHERE id = p_category
    UNION ALL
    SELECT p.id, p.parent_id, p.system_key, c.lvl + 1 FROM public.voucher_categories p JOIN c ON p.id = c.parent_id WHERE c.lvl < 5
  )
  SELECT system_key FROM c WHERE system_key IN ('advance', 'advance_repayment', 'salary') ORDER BY lvl LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.voucher_category_employee_kind(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.voucher_advance_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE k text; a record; v_left numeric; v_take numeric; v_open numeric; m text;
BEGIN
  IF public.sahl_import_mode() THEN RETURN NEW; END IF;
  IF NEW.source IS DISTINCT FROM 'manual' OR NEW.party_type::text IS DISTINCT FROM 'employee' OR NEW.party_id IS NULL THEN RETURN NEW; END IF;
  k := public.voucher_category_employee_kind(NEW.category_id);
  IF k IS NULL OR k NOT IN ('advance', 'advance_repayment') THEN RETURN NEW; END IF;
  m := to_char(NEW.voucher_date, 'YYYY-MM');

  IF NEW.status::text = 'active' AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'active') THEN
    IF k = 'advance' AND NEW.type::text = 'payment' THEN
      IF EXISTS (SELECT 1 FROM public.advances WHERE voucher_id = NEW.id) THEN
        UPDATE public.advances SET status = 'active', remaining = amount, cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
         WHERE voucher_id = NEW.id;
      ELSE
        INSERT INTO public.advances (employee_id, amount, monthly_deduct, remaining, reason, tenant_id, voucher_id, status)
        VALUES (NEW.party_id, NEW.amount, NEW.amount, NEW.amount,
                coalesce(nullif(btrim(NEW.description), ''), 'سلفة') || ' — سند ' || NEW.voucher_number, NEW.tenant_id, NEW.id, 'active');
      END IF;
    ELSIF k = 'advance_repayment' AND NEW.type::text = 'receipt' THEN
      SELECT coalesce(sum(remaining), 0) INTO v_open FROM public.advances
       WHERE employee_id = NEW.party_id AND coalesce(status, 'active') <> 'cancelled' AND remaining > 0.005;
      IF NEW.amount > v_open + 0.005 THEN
        RAISE EXCEPTION 'المفتوح على الموظف من السلف % بس — مينفعش يرد %', round(v_open, 2), NEW.amount USING ERRCODE = 'check_violation';
      END IF;
      v_left := NEW.amount;
      FOR a IN SELECT id, remaining FROM public.advances
                WHERE employee_id = NEW.party_id AND coalesce(status, 'active') <> 'cancelled' AND remaining > 0.005
                ORDER BY created_at, id FOR UPDATE LOOP
        EXIT WHEN v_left <= 0.005;
        v_take := least(v_left, a.remaining);
        INSERT INTO public.advance_payments (advance_id, amount, month, paid_at, tenant_id, voucher_id)
        VALUES (a.id, v_take, m, now(), NEW.tenant_id, NEW.id);
        UPDATE public.advances SET remaining = round(remaining - v_take, 2) WHERE id = a.id;
        v_left := v_left - v_take;
      END LOOP;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status::text = 'cancelled' AND OLD.status::text = 'active' THEN
    IF k = 'advance' THEN
      FOR a IN SELECT id, amount, remaining FROM public.advances WHERE voucher_id = NEW.id AND coalesce(status, 'active') <> 'cancelled' FOR UPDATE LOOP
        IF coalesce((SELECT sum(p.amount) FROM public.advance_payments p WHERE p.advance_id = a.id), 0) > 0.005
           OR round(a.remaining, 2) < round(a.amount, 2) THEN
          RAISE EXCEPTION 'السلفة دي اتخصم منها % — الغي الخصم الأول (المرتب أو سند رد السلفة)', round(a.amount - a.remaining, 2)
            USING ERRCODE = 'check_violation';
        END IF;
        UPDATE public.advances SET status = 'cancelled', remaining = 0, cancelled_at = now(), cancelled_by = auth.uid(),
               cancel_reason = coalesce(NEW.cancel_reason, 'إلغاء السند ' || NEW.voucher_number)
         WHERE id = a.id;
      END LOOP;
    ELSE
      FOR a IN SELECT p.advance_id, sum(p.amount) AS s FROM public.advance_payments p WHERE p.voucher_id = NEW.id
                GROUP BY 1 HAVING sum(p.amount) > 0.005 LOOP
        INSERT INTO public.advance_payments (advance_id, amount, month, paid_at, tenant_id, voucher_id)
        VALUES (a.advance_id, -a.s, m, now(), NEW.tenant_id, NEW.id);
        UPDATE public.advances SET remaining = round(remaining + a.s, 2) WHERE id = a.advance_id;
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.voucher_advance_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zy_voucher_advance_link ON public.vouchers;
CREATE TRIGGER zy_voucher_advance_link AFTER INSERT OR UPDATE OF status ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.voucher_advance_link();

DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.cancel_employee_advance(uuid, text)'::regprocedure);
  IF position('  IF EXISTS (SELECT 1 FROM public.advance_payments p WHERE p.advance_id = a.id)' IN d) = 0
     OR position('  UPDATE public.advances
     SET status = ''cancelled''' IN d) = 0 THEN RAISE EXCEPTION '0294: cancel_employee_advance text not found'; END IF;
  d := replace(d, '  IF EXISTS (SELECT 1 FROM public.advance_payments p WHERE p.advance_id = a.id)',
                  '  IF coalesce((SELECT sum(p.amount) FROM public.advance_payments p WHERE p.advance_id = a.id), 0) > 0.005  -- 0294: a cancelled repayment nets 0');
  d := replace(d, '  UPDATE public.advances
     SET status = ''cancelled''', '  -- 0294: an advance made by a hand-written voucher: cancel that voucher (on its day)
  IF a.voucher_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.vouchers WHERE id = a.voucher_id AND status::text = ''active'') THEN
    PERFORM public.cancel_voucher(a.voucher_id, ''إلغاء سلفة '' || coalesce(v_emp.name, '''') || '' — '' || p_reason);
    n := n + 1;
  END IF;

  UPDATE public.advances
     SET status = ''cancelled''');
  EXECUTE d;
END $$;

-- ---------- B. a ledger reversal in a locked period goes on the first open day ----------
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.ledger_gl_reverse'::regproc);
  IF position('v_day := CASE WHEN public.ledger_period_closed(e.tenant_id, e.entry_date) THEN public.cairo_today() ELSE e.entry_date END;' IN d) = 0 THEN
    RAISE EXCEPTION '0294: ledger_gl_reverse text not found';
  END IF;
  EXECUTE replace(d, 'v_day := CASE WHEN public.ledger_period_closed(e.tenant_id, e.entry_date) THEN public.cairo_today() ELSE e.entry_date END;',
    'v_day := CASE WHEN public.ledger_period_closed(e.tenant_id, e.entry_date) THEN public.ledger_effective_date(e.tenant_id, e.entry_date) ELSE e.entry_date END;  -- 0294');
END $$;

-- ---------- C. «تسوية الوعاء» ----------
INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, parent_id, is_system, is_active)
SELECT a.tenant_id, '6920', 'Cash shortages', 'عجز الخزنة', 'expense', 'debit', a.parent_id, true, true
  FROM public.chart_of_accounts a
 WHERE a.code = '6900' AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts b WHERE b.tenant_id = a.tenant_id AND b.code = '6920');

INSERT INTO public.voucher_categories (tenant_id, name, type, is_system, system_key, is_active, is_deductible_from_profit, gl_account_code, is_added_to_profit)
SELECT t.id, x.name, x.type::voucher_type, true, x.k, true, x.ded, x.gl, x.add
  FROM public.tenants t
  CROSS JOIN (VALUES ('عجز خزنة', 'payment', 'vessel_short_loss', true, '6920', false),
                     ('عجز خزنة على السنين اللي فاتت', 'payment', 'vessel_short_prior', false, '3800', false),
                     ('زيادة خزنة', 'receipt', 'vessel_over_gain', false, '4200', true),
                     ('زيادة خزنة على السنين اللي فاتت', 'receipt', 'vessel_over_prior', false, '3800', false)) AS x(name, type, k, ded, gl, add)
 WHERE EXISTS (SELECT 1 FROM public.chart_of_accounts a WHERE a.tenant_id = t.id AND a.code = x.gl)
   AND NOT EXISTS (SELECT 1 FROM public.voucher_categories c WHERE c.tenant_id = t.id AND c.system_key = x.k);

CREATE SEQUENCE IF NOT EXISTS public.vessel_count_seq;
CREATE TABLE IF NOT EXISTS public.vessel_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  count_number text NOT NULL,
  payment_method text NOT NULL,
  count_date date NOT NULL,
  system_balance numeric NOT NULL,
  actual_balance numeric NOT NULL,
  difference numeric NOT NULL,                -- actual − system: − = عجز, + = زيادة
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'cancelled')),
  treatment text CHECK (treatment IN ('loss', 'employee', 'prior_years', 'gain')),
  employee_id uuid REFERENCES public.employees(id),
  note text, reason text,
  voucher_id uuid,
  counted_by uuid, counted_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid, decided_at timestamptz,
  cancelled_by uuid, cancelled_at timestamptz, cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vessel_counts_branch_idx ON public.vessel_counts (branch_id, count_date DESC);
CREATE INDEX IF NOT EXISTS vessel_counts_voucher_idx ON public.vessel_counts (voucher_id) WHERE voucher_id IS NOT NULL;
ALTER TABLE public.vessel_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vessel_counts_read ON public.vessel_counts;
CREATE POLICY vessel_counts_read ON public.vessel_counts FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND (branch_id = ANY ((SELECT public.my_branch_ids())::uuid[]) OR (SELECT public.is_admin((SELECT auth.uid())))
              OR (SELECT public.has_central_access((SELECT auth.uid())))));
DROP POLICY IF EXISTS suspended_block_write ON public.vessel_counts;
CREATE POLICY suspended_block_write ON public.vessel_counts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_super_admin((SELECT auth.uid()))) OR NOT (SELECT public.current_tenant_is_suspended()));
DROP POLICY IF EXISTS branch_paused_read ON public.vessel_counts;
CREATE POLICY branch_paused_read ON public.vessel_counts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (branch_id = ANY ((SELECT public.paused_branch_ids())::uuid[]))
         OR (SELECT public.is_super_admin((SELECT auth.uid()))) OR (SELECT public.is_owner((SELECT auth.uid())))
         OR (SELECT public.is_admin((SELECT auth.uid()))));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vessel_counts FROM authenticated, anon;
GRANT SELECT ON public.vessel_counts TO authenticated;
DROP TRIGGER IF EXISTS zz_block_hard_delete ON public.vessel_counts;
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.vessel_counts FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- the permission «تسوية الوعاء ← يعدّ» (on for the branch manager; the owner / manager always)
DO $$
DECLARE d text := pg_get_functiondef('public.role_permission_default(text,text)'::regprocedure);
BEGIN
  IF position('vessel_counts.create' IN d) > 0 THEN RETURN; END IF;
  IF (SELECT count(*) FROM regexp_matches(d, '''vessel_transfers\.create''', 'g')) <> 1 THEN RAISE EXCEPTION '0294: role_permission_default not the expected version'; END IF;
  EXECUTE replace(d, '''vessel_transfers.create''', '''vessel_transfers.create'',''vessel_counts.create''');
END $$;

CREATE OR REPLACE FUNCTION public.vessel_count_mode(p_tenant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN v IN ('owner', 'approval') THEN v ELSE 'owner' END
    FROM (SELECT (SELECT s.value #>> '{}' FROM public.settings s WHERE s.scope = p_tenant AND s.key = 'vessel_count_mode' LIMIT 1) AS v) x
$$;
REVOKE ALL ON FUNCTION public.vessel_count_mode(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_vessel_count_mode(p_mode text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_t uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'الإعداد ده للمالك بس' USING ERRCODE = '42501'; END IF;
  IF p_mode NOT IN ('owner', 'approval') THEN RAISE EXCEPTION 'اختار: المالك بس، ولا يعدّ ويستنى موافقة المالك'; END IF;
  INSERT INTO public.settings (key, value, tenant_id, updated_at, updated_by)  -- scope is generated from tenant_id
  VALUES ('vessel_count_mode', to_jsonb(p_mode), v_t, now(), auth.uid())
  ON CONFLICT (scope, key) DO UPDATE SET value = excluded.value, updated_at = now(), updated_by = auth.uid();
  RETURN p_mode;
END $function$;

CREATE OR REPLACE FUNCTION public._vessel_balance(p_branch uuid, p_method text, p_as_of date)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT round(coalesce(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0), 2)
    FROM public.treasury WHERE branch_id = p_branch AND coalesce(nullif(payment_method, ''), 'cash') = p_method
     AND coalesce(transaction_date, (created_at AT TIME ZONE 'Africa/Cairo')::date) <= p_as_of
$$;
REVOKE ALL ON FUNCTION public._vessel_balance(uuid, text, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._vessel_label(p_tenant uuid, p_method text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT f.label FROM public.transfer_fees f WHERE f.tenant_id = p_tenant AND f.payment_method = p_method LIMIT 1),
                  CASE p_method WHEN 'cash' THEN 'الكاش (الدرج)' WHEN 'vodafone' THEN 'فودافون كاش' WHEN 'instapay' THEN 'إنستاباي'
                                WHEN 'bank' THEN 'الحساب البنكي' ELSE p_method END)
$$;
REVOKE ALL ON FUNCTION public._vessel_label(uuid, text) FROM PUBLIC, anon, authenticated;

-- the board: every real vessel of the branch with its balance now, the mode, what the caller may do, the counts
CREATE OR REPLACE FUNCTION public.vessel_count_board(p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_t uuid; v_uid uuid := auth.uid(); v_owner boolean; v_mode text;
BEGIN
  PERFORM public.assert_access(p_branch, NULL);
  SELECT tenant_id INTO v_t FROM public.branches WHERE id = p_branch;
  v_owner := public.is_owner(v_uid);
  v_mode := public.vessel_count_mode(v_t);
  RETURN jsonb_build_object(
    'mode', v_mode, 'is_owner', v_owner,
    'can_count', v_owner OR (v_mode = 'approval' AND public.perm_resolve(v_uid, 'vessel_counts.create', p_branch)),
    'vessels', (SELECT coalesce(jsonb_agg(jsonb_build_object('method', m, 'label', public._vessel_label(v_t, m),
                                   'balance', public._vessel_balance(p_branch, m, public.cairo_today())) ORDER BY (m <> 'cash'), m), '[]'::jsonb)
                  FROM (SELECT 'cash' AS m
                        UNION SELECT unnest(ARRAY['vodafone', 'instapay', 'bank'])
                        UNION SELECT f.payment_method FROM public.transfer_fees f
                               WHERE f.tenant_id = v_t AND coalesce(f.is_enabled, true) AND coalesce(f.kind, '') <> 'virtual'
                        UNION SELECT DISTINCT coalesce(nullif(t.payment_method, ''), 'cash') FROM public.treasury t
                               WHERE t.branch_id = p_branch
                                 AND NOT EXISTS (SELECT 1 FROM public.transfer_fees f2 WHERE f2.tenant_id = v_t AND f2.payment_method = t.payment_method AND f2.kind = 'virtual')) q),
    'counts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'id', c.id, 'number', c.count_number, 'method', c.payment_method, 'label', public._vessel_label(v_t, c.payment_method),
                  'date', c.count_date, 'system', c.system_balance, 'actual', c.actual_balance, 'difference', c.difference,
                  'status', c.status, 'treatment', c.treatment, 'employee', (SELECT name FROM public.employees WHERE id = c.employee_id),
                  'note', c.note, 'reason', c.reason, 'cancel_reason', c.cancel_reason,
                  'counted_by', (SELECT name FROM public.profiles WHERE id = c.counted_by), 'counted_at', c.counted_at,
                  'decided_by', (SELECT name FROM public.profiles WHERE id = c.decided_by),
                  'voucher', (SELECT voucher_number FROM public.vouchers WHERE id = c.voucher_id)) ORDER BY c.counted_at DESC), '[]'::jsonb)
                 FROM (SELECT * FROM public.vessel_counts WHERE branch_id = p_branch ORDER BY counted_at DESC LIMIT 200) c));
END $function$;

-- book the difference (internal)
CREATE OR REPLACE FUNCTION public._apply_vessel_count(p_id uuid, p_treatment text, p_employee uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c public.vessel_counts%ROWTYPE; v_cat uuid; v_key text; v_amt numeric; v_type voucher_type; v_emp_id uuid; v_emp_name text; v_v uuid; v_desc text;
BEGIN
  SELECT * INTO c FROM public.vessel_counts WHERE id = p_id FOR UPDATE;
  IF abs(c.difference) < 0.01 THEN
    UPDATE public.vessel_counts SET status = 'applied', decided_by = auth.uid(), decided_at = now(), reason = nullif(btrim(p_reason), '') WHERE id = c.id;
    RETURN jsonb_build_object('id', c.id, 'number', c.count_number, 'difference', 0);
  END IF;
  IF c.difference < 0 AND coalesce(p_treatment, '') NOT IN ('loss', 'employee', 'prior_years') THEN
    RAISE EXCEPTION 'العجز % — اختار: خسارة على الشركة، على موظف، ولا على السنين اللي فاتت', abs(c.difference);
  END IF;
  IF c.difference > 0 AND coalesce(p_treatment, '') NOT IN ('gain', 'prior_years') THEN
    RAISE EXCEPTION 'الزيادة % — اختار: ربح (إيرادات أخرى) ولا على السنين اللي فاتت', c.difference;
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الفرق'; END IF;
  v_amt := abs(c.difference);
  v_type := CASE WHEN c.difference < 0 THEN 'payment'::voucher_type ELSE 'receipt'::voucher_type END;
  v_key := CASE p_treatment WHEN 'loss' THEN 'vessel_short_loss' WHEN 'gain' THEN 'vessel_over_gain' WHEN 'employee' THEN 'advance'
                ELSE CASE WHEN c.difference < 0 THEN 'vessel_short_prior' ELSE 'vessel_over_prior' END END;
  SELECT id INTO v_cat FROM public.voucher_categories WHERE tenant_id = c.tenant_id AND system_key = v_key AND type = v_type LIMIT 1;
  IF v_cat IS NULL THEN RAISE EXCEPTION 'تصنيف تسوية الوعاء مش موجود (%)', v_key; END IF;
  IF p_treatment = 'employee' THEN
    SELECT id, name INTO v_emp_id, v_emp_name FROM public.employees WHERE id = p_employee AND tenant_id = c.tenant_id AND coalesce(is_active, true);
    IF v_emp_id IS NULL THEN RAISE EXCEPTION 'اختار الموظف اللي العجز عليه (من الموظفين الشغالين)'; END IF;
  END IF;
  v_desc := 'تسوية الوعاء ' || c.count_number || ' — ' || public._vessel_label(c.tenant_id, c.payment_method) || ': في السيستم '
            || c.system_balance || ' والفعلي ' || c.actual_balance || ' — ' || CASE WHEN c.difference < 0 THEN 'عجز ' ELSE 'زيادة ' END || v_amt
            || ' — ' || btrim(p_reason);
  PERFORM set_config('app.vessel_count_op', '1', true);
  v_v := public.create_manual_voucher(c.branch_id, v_type, v_cat, v_amt, c.payment_method, c.count_number, 'تسوية الوعاء', 0,
           CASE WHEN p_treatment = 'employee' THEN 'employee'::voucher_party_type ELSE 'other'::voucher_party_type END,
           CASE WHEN p_treatment = 'employee' THEN v_emp_id END,
           CASE WHEN p_treatment = 'employee' THEN v_emp_name ELSE 'تسوية الوعاء' END,
           v_desc, c.count_date, 'تسوية الوعاء');
  PERFORM set_config('app.vessel_count_op', '', true);
  UPDATE public.vessel_counts SET status = 'applied', treatment = p_treatment, employee_id = CASE WHEN p_treatment = 'employee' THEN v_emp_id END,
         reason = btrim(p_reason), voucher_id = v_v, decided_by = auth.uid(), decided_at = now()
   WHERE id = c.id;
  RETURN jsonb_build_object('id', c.id, 'number', c.count_number, 'difference', c.difference, 'treatment', p_treatment,
                            'voucher', (SELECT voucher_number FROM public.vouchers WHERE id = v_v));
END $function$;
REVOKE ALL ON FUNCTION public._apply_vessel_count(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- count: the owner books it now (he must choose for a difference); in 'approval' mode anybody allowed sends it to the owner
CREATE OR REPLACE FUNCTION public.submit_vessel_count(p_branch uuid, p_method text, p_actual numeric, p_note text DEFAULT NULL,
  p_date date DEFAULT NULL, p_treatment text DEFAULT NULL, p_employee uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_t uuid; v_owner boolean; v_mode text; v_day date := public.cairo_today(); v_sys numeric; v_id uuid; v_num text;
  v_actual numeric := round(p_actual, 2); r record;
BEGIN
  PERFORM public.assert_access(p_branch, NULL);
  SELECT tenant_id INTO v_t FROM public.branches WHERE id = p_branch;
  v_owner := public.is_owner(v_uid);
  v_mode := public.vessel_count_mode(v_t);
  IF NOT v_owner THEN
    IF v_mode <> 'approval' THEN RAISE EXCEPTION 'تسوية الوعاء للمالك بس (من الإعدادات)' USING ERRCODE = '42501'; END IF;
    IF NOT public.perm_resolve(v_uid, 'vessel_counts.create', p_branch) THEN
      RAISE EXCEPTION 'مش مسموحلك تعمل تسوية الوعاء في الفرع ده — الصلاحية بتتفتح من الإعدادات ← الموظفين' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_method IS NULL OR NOT public.vessel_is_known(v_t, p_method) THEN RAISE EXCEPTION 'الوعاء مش موجود'; END IF;
  IF EXISTS (SELECT 1 FROM public.transfer_fees WHERE tenant_id = v_t AND payment_method = p_method AND kind = 'virtual') THEN
    RAISE EXCEPTION 'ده وعاء دفتري — مفيش فيه فلوس تتعدّ';
  END IF;
  IF v_actual IS NULL OR v_actual < 0 THEN RAISE EXCEPTION 'اكتب الفلوس اللي في الوعاء فعلاً (صفر أو أكتر)'; END IF;
  IF p_date IS NOT NULL AND p_date <> v_day THEN
    IF NOT v_owner THEN RAISE EXCEPTION 'تسوية بتاريخ قديم للمالك بس'; END IF;
    IF p_date > v_day THEN RAISE EXCEPTION 'مينفعش تاريخ بعد النهارده'; END IF;
    IF p_date < DATE '2026-01-01' THEN RAISE EXCEPTION 'التاريخ لازم يكون في 2026'; END IF;
    v_day := p_date;
  END IF;
  IF EXISTS (SELECT 1 FROM public.vessel_counts WHERE branch_id = p_branch AND payment_method = p_method AND status = 'pending') THEN
    RAISE EXCEPTION 'فيه تسوية للوعاء ده مستنية موافقة المالك — استنى ردّه الأول';
  END IF;
  v_sys := public._vessel_balance(p_branch, p_method, v_day);
  v_num := 'VC' || lpad(nextval('public.vessel_count_seq')::text, 5, '0');
  INSERT INTO public.vessel_counts (tenant_id, branch_id, count_number, payment_method, count_date, system_balance, actual_balance, difference,
                                    status, note, counted_by)
  VALUES (v_t, p_branch, v_num, p_method, v_day, v_sys, v_actual, round(v_actual - v_sys, 2), 'pending', nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  RETURNING id INTO v_id;
  IF v_owner THEN
    RETURN public._apply_vessel_count(v_id, p_treatment, p_employee, coalesce(nullif(btrim(coalesce(p_reason, '')), ''), p_note))
           || jsonb_build_object('status', 'applied');
  END IF;
  -- tell the owner(s)
  FOR r IN SELECT DISTINCT x.u AS user_id FROM (SELECT ur.user_id AS u FROM public.user_roles ur WHERE ur.tenant_id = v_t AND ur.role::text = 'owner'
                                             UNION SELECT owner_user_id FROM public.tenants WHERE id = v_t) x WHERE x.u IS NOT NULL LOOP
    INSERT INTO public.notifications (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
    VALUES (v_t, r.user_id, 'تسوية وعاء مستنية موافقتك ' || v_num,
            public._vessel_label(v_t, p_method) || ' — ' || (SELECT name FROM public.branches WHERE id = p_branch) || ': في السيستم ' || v_sys
              || ' والفعلي ' || v_actual || ' (' || CASE WHEN v_actual < v_sys THEN 'عجز ' ELSE 'زيادة ' END || abs(v_actual - v_sys) || ')',
            'vessel_count', '/branch/' || p_branch || '/treasury?tab=vessel_counts', 'vessel_counts', v_id);
  END LOOP;
  RETURN jsonb_build_object('id', v_id, 'number', v_num, 'status', 'pending', 'difference', round(v_actual - v_sys, 2));
END $function$;

CREATE OR REPLACE FUNCTION public.decide_vessel_count(p_id uuid, p_approve boolean, p_treatment text DEFAULT NULL, p_employee uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c public.vessel_counts%ROWTYPE;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'الموافقة على تسوية الوعاء للمالك بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.vessel_counts WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR c.status <> 'pending' THEN RAISE EXCEPTION 'التسوية مش مستنية موافقة'; END IF;
  IF NOT coalesce(p_approve, false) THEN
    IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الرفض'; END IF;
    UPDATE public.vessel_counts SET status = 'rejected', reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now() WHERE id = c.id;
    RETURN jsonb_build_object('id', c.id, 'number', c.count_number, 'status', 'rejected');
  END IF;
  RETURN public._apply_vessel_count(c.id, p_treatment, p_employee, p_reason) || jsonb_build_object('status', 'applied');
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_vessel_count(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c public.vessel_counts%ROWTYPE;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'إلغاء تسوية الوعاء للمالك بس' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب سبب الإلغاء'; END IF;
  SELECT * INTO c FROM public.vessel_counts WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR c.status NOT IN ('applied', 'pending') THEN RAISE EXCEPTION 'التسوية مش موجودة أو ملغية'; END IF;
  IF c.voucher_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.vouchers WHERE id = c.voucher_id AND status::text = 'active') THEN
    PERFORM set_config('app.vessel_count_op', '1', true);
    PERFORM public.cancel_voucher(c.voucher_id, 'إلغاء تسوية الوعاء ' || c.count_number || ' — ' || btrim(p_reason));
    PERFORM set_config('app.vessel_count_op', '', true);
  END IF;
  UPDATE public.vessel_counts SET status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_by = auth.uid(), cancelled_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('id', c.id, 'number', c.count_number, 'status', 'cancelled');
END $function$;

-- a vessel-count voucher moves only with its count; its categories are made only by the count
CREATE OR REPLACE FUNCTION public.guard_vessel_count_voucher()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_num text;
BEGIN
  IF coalesce(current_setting('app.vessel_count_op', true), '') = '1' OR public.sahl_import_mode() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.voucher_categories WHERE id = NEW.category_id
                 AND system_key IN ('vessel_short_loss', 'vessel_short_prior', 'vessel_over_gain', 'vessel_over_prior')) THEN
      RAISE EXCEPTION 'التصنيف ده بيتعمل من «تسوية الوعاء» بس' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.amount IS NOT DISTINCT FROM OLD.amount AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
     AND NEW.party_id IS NOT DISTINCT FROM OLD.party_id AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method
     AND NEW.voucher_date IS NOT DISTINCT FROM OLD.voucher_date AND NEW.type IS NOT DISTINCT FROM OLD.type THEN
    RETURN NEW;
  END IF;
  SELECT count_number INTO v_num FROM public.vessel_counts WHERE voucher_id = OLD.id LIMIT 1;
  IF v_num IS NOT NULL THEN
    RAISE EXCEPTION 'ده سند من تسوية الوعاء % — الغي التسوية نفسها من الخزنة ← «تسويات الأوعية»', v_num USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.guard_vessel_count_voucher() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a0_guard_vessel_count_voucher ON public.vouchers;
CREATE TRIGGER a0_guard_vessel_count_voucher BEFORE INSERT OR UPDATE ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.guard_vessel_count_voucher();

-- A vessel count is not a transfer: its voucher names no vessel account (the count number is its reference)
DO $$
DECLARE d text := pg_get_functiondef('public.assert_vessel_account(text,text,text)'::regprocedure);
BEGIN
  IF position('app.vessel_count_op' IN d) > 0 THEN RETURN; END IF;
  IF position('  IF public.sahl_import_mode() THEN RETURN; END IF;' IN d) = 0 THEN RAISE EXCEPTION '0294: assert_vessel_account text not found'; END IF;
  EXECUTE replace(d, '  IF public.sahl_import_mode() THEN RETURN; END IF;',
    '  IF public.sahl_import_mode() THEN RETURN; END IF;
  IF coalesce(current_setting(''app.vessel_count_op'', true), '''') = ''1'' THEN RETURN; END IF;  -- 0294: vessel count');
END $$;

GRANT EXECUTE ON FUNCTION public.vessel_count_board(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_vessel_count(uuid, text, numeric, text, date, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_vessel_count(uuid, boolean, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_vessel_count(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_vessel_count_mode(text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('vessel_count_board', '0294', 'a branch: its vessels with their balance, the count mode, the counts'),
  ('submit_vessel_count', '0294', 'count a vessel: the owner books the difference, in approval mode staff send it to the owner'),
  ('decide_vessel_count', '0294', 'owner: approve (choose how the difference is booked) or reject a count'),
  ('cancel_vessel_count', '0294', 'owner: cancel a count (its voucher on its day)'),
  ('set_vessel_count_mode', '0294', 'owner: who counts — the owner only, or staff with the owner''s approval')
ON CONFLICT DO NOTHING;
