-- 0250 — رأس مال الفروع على الأوعية والحسابات + «رجّع / انقل رأس مال» (SPEC-branch-capital-vessels.md, owner 2026-11-17).
-- One row of branch_capital_allocations = capital moved FROM a place TO a place (the partners' treasury is the system
-- branch PARTNER-CASH): kind 'allocate' (partners → branch), 'return' (branch → partners), 'move' (branch → branch).
-- A branch's capital = Σ in − Σ out. Same till category `capital_allocation` for all three (already internal: no voucher,
-- no profit). Each till leg posts through post_treasury_transfer_leg, now on the vessel's own cash account
-- (1100 cash / 1110 the others) instead of a fixed 1100 — no non-cash transfer leg existed before.

ALTER TABLE public.branch_capital_allocations
  ADD COLUMN IF NOT EXISTS from_branch_id uuid REFERENCES public.branches(id),
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'allocate' CHECK (kind IN ('allocate', 'return', 'move')),
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS from_account text,
  ADD COLUMN IF NOT EXISTS to_account text;
UPDATE public.branch_capital_allocations a SET from_branch_id = b.id
  FROM public.branches b
 WHERE a.from_branch_id IS NULL AND b.tenant_id = a.tenant_id AND b.is_system AND b.code = 'PARTNER-CASH';
CREATE INDEX IF NOT EXISTS branch_capital_allocations_from_idx ON public.branch_capital_allocations (tenant_id, from_branch_id);

-- every transfer leg on the vessel's own cash account
DO $m$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.post_treasury_transfer_leg(uuid)'::regprocedure);
  n := replace(d, $a$jsonb_build_object('account_code', '1100',$a$,
                  $b$jsonb_build_object('account_code', public.ledger_cash_account(coalesce(nullif(t.payment_method, ''), 'cash')),$b$);
  IF n = d OR (length(d) - length(replace(d, $a$'1100'$a$, ''))) / 6 <> 2 THEN RAISE EXCEPTION '0250: leg anchor'; END IF;
  EXECUTE n;
END $m$;

-- a branch's capital now (or at a day)
CREATE OR REPLACE FUNCTION public.branch_capital_now(p_tenant uuid, p_branch uuid, p_to date DEFAULT NULL)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT coalesce(sum(CASE WHEN branch_id = p_branch THEN amount ELSE -amount END), 0)
    FROM branch_capital_allocations
   WHERE tenant_id = p_tenant AND (branch_id = p_branch OR from_branch_id = p_branch)
     AND (p_to IS NULL OR allocation_date <= p_to)
$$;

CREATE OR REPLACE FUNCTION public._capital_move(p_from uuid, p_to uuid, p_amount numeric, p_date date, p_method text,
  p_from_account text, p_to_account text, p_notes text, p_kind text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id(); v_uid uuid := auth.uid(); v_id uuid; v_out uuid; v_in uuid;
  v_day date := coalesce(p_date, public.cairo_today()); v_ts timestamptz; v_pm text := coalesce(nullif(btrim(p_method), ''), 'cash');
  v_fa text := nullif(btrim(coalesce(p_from_account, '')), ''); v_ta text := nullif(btrim(coalesce(p_to_account, '')), '');
  fb record; tb record; v_bal numeric; v_cap numeric; v_amt numeric := round(coalesce(p_amount, 0), 2);
  v_out_desc text; v_in_desc text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT (has_role(v_uid, 'admin') OR has_role(v_uid, 'super_admin') OR has_role(v_uid, 'accountant') OR public.is_owner(v_uid)) THEN
    RAISE EXCEPTION 'رأس مال الفروع للمالك أو المدير أو المحاسب بس' USING ERRCODE = '42501';
  END IF;
  SELECT id, name, tenant_id, coalesce(is_system, false) AS sys, code INTO fb FROM branches WHERE id = p_from;
  SELECT id, name, tenant_id, coalesce(is_system, false) AS sys, code INTO tb FROM branches WHERE id = p_to;
  IF fb.id IS NULL OR tb.id IS NULL OR fb.tenant_id <> v_t OR tb.tenant_id <> v_t THEN RAISE EXCEPTION 'الفرع مش موجود'; END IF;
  IF fb.id = tb.id THEN RAISE EXCEPTION 'اختار فرعين مختلفين'; END IF;
  IF v_amt <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF v_day > public.cairo_today() THEN RAISE EXCEPTION 'مينفعش تاريخ في المستقبل'; END IF;
  IF public.ledger_period_closed(v_t, v_day) THEN RAISE EXCEPTION 'التاريخ ده في فترة مقفولة'; END IF;
  IF NOT public.vessel_is_known(v_t, v_pm) THEN RAISE EXCEPTION 'الوعاء مش موجود أو موقوف من الإعدادات'; END IF;
  IF EXISTS (SELECT 1 FROM transfer_fees f WHERE f.tenant_id = v_t AND f.payment_method = v_pm AND f.kind = 'virtual') THEN
    RAISE EXCEPTION 'رأس المال بيتحول على وعاء فلوس حقيقية، مش وعاء دفتري';
  END IF;
  IF EXISTS (SELECT 1 FROM vessel_accounts va WHERE va.tenant_id = v_t AND va.payment_method = v_pm AND va.is_active) THEN
    IF NOT EXISTS (SELECT 1 FROM vessel_accounts va WHERE va.tenant_id = v_t AND va.payment_method = v_pm AND va.is_active
                     AND va.number_key = public.vessel_account_key(v_fa)) THEN
      RAISE EXCEPTION 'اختار الحساب اللي هيتحول منه';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vessel_accounts va WHERE va.tenant_id = v_t AND va.payment_method = v_pm AND va.is_active
                     AND va.number_key = public.vessel_account_key(v_ta)) THEN
      RAISE EXCEPTION 'اختار الحساب اللي هيوصل عليه';
    END IF;
  END IF;

  SELECT coalesce(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) INTO v_bal
    FROM treasury WHERE branch_id = fb.id AND coalesce(nullif(payment_method, ''), 'cash') = v_pm;
  IF v_bal < v_amt THEN
    IF fb.code = 'PARTNER-CASH' THEN
      RAISE EXCEPTION 'رصيد خزينة الشركاء على الوعاء ده غير كافٍ — المتاح: % ج.م. سجّل مساهمة الشريك في خزينة الشركاء الأول', round(v_bal, 2);
    END IF;
    RAISE EXCEPTION 'رصيد الوعاء ده في «%» غير كافٍ — المتاح: % ج.م', fb.name, round(v_bal, 2);
  END IF;
  IF fb.code IS DISTINCT FROM 'PARTNER-CASH' THEN
    v_cap := public.branch_capital_now(v_t, fb.id);
    IF v_amt > v_cap THEN
      RAISE EXCEPTION 'رأس مال «%» الحالي % ج.م بس — المسموح يطلع منه % ج.م', fb.name, round(v_cap, 2), round(greatest(v_cap, 0), 2);
    END IF;
  END IF;

  INSERT INTO branch_capital_allocations (tenant_id, branch_id, from_branch_id, kind, amount, allocation_date, notes, created_by,
                                          payment_method, from_account, to_account)
  VALUES (v_t, tb.id, fb.id, p_kind, v_amt, v_day, nullif(btrim(coalesce(p_notes, '')), ''), v_uid, v_pm, v_fa, v_ta)
  RETURNING id INTO v_id;

  v_out_desc := CASE p_kind WHEN 'allocate' THEN 'ضخ رأس مال لفرع ' || tb.name
                            WHEN 'return' THEN 'رجوع رأس مال لخزينة الشركاء'
                            ELSE 'نقل رأس مال لفرع ' || tb.name END;
  v_in_desc := CASE p_kind WHEN 'allocate' THEN 'رأس مال من الشركاء'
                           WHEN 'return' THEN 'رأس مال راجع من فرع ' || fb.name
                           ELSE 'رأس مال منقول من فرع ' || fb.name END;
  v_ts := CASE WHEN v_day = public.cairo_today() THEN now() ELSE (v_day + time '12:00') AT TIME ZONE 'Africa/Cairo' END;

  PERFORM set_config('app.skip_treasury_voucher', '1', true);
  INSERT INTO treasury (branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_id,
                        transaction_date, created_at, transfer_from_account, transfer_to_account)
  VALUES (fb.id, 'expense', 'capital_allocation', v_amt, v_out_desc, v_uid, v_t, v_pm, v_id, v_day, v_ts, v_fa, v_ta)
  RETURNING id INTO v_out;
  INSERT INTO treasury (branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_id,
                        transaction_date, created_at, transfer_from_account, transfer_to_account)
  VALUES (tb.id, 'income', 'capital_allocation', v_amt, v_in_desc, v_uid, v_t, v_pm, v_id, v_day, v_ts, v_fa, v_ta)
  RETURNING id INTO v_in;
  PERFORM set_config('app.skip_treasury_voucher', '0', true);
  PERFORM public.post_treasury_transfer_leg(v_out);
  PERFORM public.post_treasury_transfer_leg(v_in);
  RETURN v_id;
END $$;

-- partners' treasury → a branch on a vessel + accounts (a NEW name, so the old function is replaced in place, never dropped)
CREATE OR REPLACE FUNCTION public.allocate_branch_capital(p_branch uuid, p_amount numeric, p_date date DEFAULT NULL,
  p_method text DEFAULT 'cash', p_from_account text DEFAULT NULL, p_to_account text DEFAULT NULL, p_notes text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_pc uuid;
BEGIN
  SELECT id INTO v_pc FROM branches WHERE tenant_id = public.current_tenant_id() AND is_system AND code = 'PARTNER-CASH' LIMIT 1;
  IF v_pc IS NULL THEN RAISE EXCEPTION 'خزينة الشركاء غير موجودة'; END IF;
  IF p_branch = v_pc THEN RAISE EXCEPTION 'مينفعش تضخ رأس مال لخزينة الشركاء نفسها'; END IF;
  RETURN public._capital_move(v_pc, p_branch, p_amount, p_date, p_method, p_from_account, p_to_account, p_notes, 'allocate');
END $$;

-- the old door (cash only) now goes through the same path
CREATE OR REPLACE FUNCTION public.allocate_capital_to_branch(_branch_id uuid, _amount numeric, _allocation_date date DEFAULT CURRENT_DATE,
  _notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN public.allocate_branch_capital(_branch_id, _amount, coalesce(_allocation_date, public.cairo_today()), 'cash', NULL, NULL, _notes);
END $$;

-- «رجّع / انقل رأس مال»: p_to NULL = back to the partners' treasury, else another branch
CREATE OR REPLACE FUNCTION public.move_branch_capital(p_from uuid, p_to uuid, p_amount numeric, p_date date DEFAULT NULL,
  p_method text DEFAULT 'cash', p_from_account text DEFAULT NULL, p_to_account text DEFAULT NULL, p_notes text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_pc uuid;
BEGIN
  SELECT id INTO v_pc FROM branches WHERE tenant_id = public.current_tenant_id() AND is_system AND code = 'PARTNER-CASH' LIMIT 1;
  IF v_pc IS NULL THEN RAISE EXCEPTION 'خزينة الشركاء غير موجودة'; END IF;
  IF p_from = v_pc THEN RAISE EXCEPTION 'من خزينة الشركاء استخدم «تحويل رأس مال»'; END IF;
  RETURN public._capital_move(p_from, coalesce(p_to, v_pc), p_amount, p_date, p_method, p_from_account, p_to_account, p_notes,
                              CASE WHEN p_to IS NULL OR p_to = v_pc THEN 'return' ELSE 'move' END);
END $$;

-- the branch's capital = in − out
DO $m$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.get_branch_financial_position'::regproc);
  n := regexp_replace(d,
    'SELECT COALESCE\(SUM\(amount\), 0\) INTO _allocated FROM public\.branch_capital_allocations\s+WHERE tenant_id = _tenant AND branch_id = _branch_id AND \(_to IS NULL OR allocation_date <= _to\);',
    '_allocated := public.branch_capital_now(_tenant, _branch_id, _to);');
  IF n = d THEN RAISE EXCEPTION '0250: position anchor'; END IF;
  EXECUTE n;
END $m$;

REVOKE ALL ON FUNCTION public._capital_move(uuid, uuid, numeric, date, text, text, text, text, text),
  public.branch_capital_now(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_branch_capital(uuid, numeric, date, text, text, text, text),
  public.move_branch_capital(uuid, uuid, numeric, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_branch_capital(uuid, numeric, date, text, text, text, text),
  public.move_branch_capital(uuid, uuid, numeric, date, text, text, text, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('allocate_branch_capital', '0250', 'capital partners → branch on a vessel + accounts'),
  ('move_branch_capital', '0250', 'capital branch → partners / another branch')
ON CONFLICT DO NOTHING;
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN RAISE EXCEPTION '0250: exposed'; END IF;
END $chk$;
