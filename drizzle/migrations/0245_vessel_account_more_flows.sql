-- 0245 — the vessel account is asked in three more places (owner 2026-11-16 «ضيفهم في كله ما عدا مرتجعات السنة اللي فاتت»):
-- partner money (`partner_money(…, p_account)`), fixed assets (`add_fixed_asset(…, p_account)` when paid from a vessel,
-- `dispose_fixed_asset(…, _account)` when sold for money) and money between two branches
-- (`transfer_treasury_atomic(…, p_transfer_from_account)` = our sending account, `p_transfer_to_account` = our receiving one;
-- `receive_treasury_transfer` puts the receiving account on the incoming row, and the sending account on a returned part).
-- Required when the vessel has active accounts (same rule as 0244). Prior-year returns stay without an account.
ALTER TABLE public.treasury_transfers ADD COLUMN IF NOT EXISTS transfer_from_account text;

CREATE OR REPLACE FUNCTION pg_temp.rep(d text, a text, b text, what text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(a IN d) = 0 THEN RAISE EXCEPTION '0245 anchor missing: %', what; END IF;
  RETURN replace(d, a, b);
END $$;

DO $m$
DECLARE d text;
BEGIN
  -- partner money
  d := pg_get_functiondef('public.partner_money(uuid,text,numeric,text,numeric,uuid,text,date,text)'::regprocedure);
  d := pg_temp.rep(d, $a$p_notes text DEFAULT NULL::text)
 RETURNS jsonb$a$, $b$p_notes text DEFAULT NULL::text, p_account text DEFAULT NULL::text)
 RETURNS jsonb$b$, 'pm header');
  d := pg_temp.rep(d, $a$IF NOT public.vessel_is_known(p.tenant_id, v_pm) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_pm; END IF;$a$,
    $b$IF NOT public.vessel_is_known(p.tenant_id, v_pm) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_pm; END IF;
  PERFORM public.assert_vessel_account(v_pm, p_account, p_account);$b$, 'pm assert');
  d := pg_temp.rep(d, $a$payment_method, transaction_date, created_at)
    VALUES (p_branch, p.tenant_id, 'income', 'partner_contribution', v_amt, v_desc, p.id, auth.uid(), v_pm, v_day, v_at)$a$,
    $b$payment_method, transaction_date, created_at, transfer_to_account)
    VALUES (p_branch, p.tenant_id, 'income', 'partner_contribution', v_amt, v_desc, p.id, auth.uid(), v_pm, v_day, v_at, nullif(btrim(p_account), ''))$b$, 'pm in');
  d := pg_temp.rep(d, $a$payment_method, transaction_date, created_at)
    VALUES (p_branch, p.tenant_id, 'expense', 'partner_withdrawal', v_amt, v_desc, p.id, auth.uid(), v_pm, v_day, v_at)$a$,
    $b$payment_method, transaction_date, created_at, transfer_from_account)
    VALUES (p_branch, p.tenant_id, 'expense', 'partner_withdrawal', v_amt, v_desc, p.id, auth.uid(), v_pm, v_day, v_at, nullif(btrim(p_account), ''))$b$, 'pm out');
  DROP FUNCTION public.partner_money(uuid,text,numeric,text,numeric,uuid,text,date,text);
  EXECUTE d;

  -- fixed asset bought from a vessel
  d := pg_get_functiondef('public.add_fixed_asset(text,text,uuid,date,numeric,numeric,integer,text,text,text)'::regprocedure);
  d := pg_temp.rep(d, $a$p_notes text DEFAULT NULL::text)
 RETURNS jsonb$a$, $b$p_notes text DEFAULT NULL::text, p_account text DEFAULT NULL::text)
 RETURNS jsonb$b$, 'fa header');
  d := pg_temp.rep(d, $a$IF NOT public.vessel_is_known(v_t, v_pm) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_pm; END IF;$a$,
    $b$IF NOT public.vessel_is_known(v_t, v_pm) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_pm; END IF;
    PERFORM public.assert_vessel_account(v_pm, p_account, p_account);$b$, 'fa assert');
  d := pg_temp.rep(d, $a$payment_method, transaction_date, created_at)
    VALUES (p_branch, v_t, 'expense', 'fixed_asset_purchase'$a$,
    $b$payment_method, transaction_date, created_at, transfer_from_account)
    VALUES (p_branch, v_t, 'expense', 'fixed_asset_purchase'$b$, 'fa cols');
  d := pg_temp.rep(d, $a$v_id, auth.uid(), v_pm, p_date, v_at)$a$, $b$v_id, auth.uid(), v_pm, p_date, v_at, nullif(btrim(p_account), ''))$b$, 'fa vals');
  DROP FUNCTION public.add_fixed_asset(text,text,uuid,date,numeric,numeric,integer,text,text,text);
  EXECUTE d;

  -- fixed asset sold for money
  d := pg_get_functiondef('public.dispose_fixed_asset(uuid,date,numeric,text)'::regprocedure);
  d := pg_temp.rep(d, $a$_method text DEFAULT 'cash'::text)
 RETURNS uuid$a$, $b$_method text DEFAULT 'cash'::text, _account text DEFAULT NULL::text)
 RETURNS uuid$b$, 'fd header');
  d := pg_temp.rep(d, $a$IF NOT public.vessel_is_known(v_t, v_pm) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_pm; END IF;$a$,
    $b$IF NOT public.vessel_is_known(v_t, v_pm) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_pm; END IF;
    PERFORM public.assert_vessel_account(v_pm, _account, _account);$b$, 'fd assert');
  d := pg_temp.rep(d, $a$payment_method, transaction_date, created_at)
    VALUES (a.branch_id, v_t, 'income', 'fixed_asset_sale', v_in, 'بيع أصل ثابت — ' || a.name || ' (' || a.code || ')', a.id, auth.uid(), v_pm, _disposal_date, v_at)$a$,
    $b$payment_method, transaction_date, created_at, transfer_to_account)
    VALUES (a.branch_id, v_t, 'income', 'fixed_asset_sale', v_in, 'بيع أصل ثابت — ' || a.name || ' (' || a.code || ')', a.id, auth.uid(), v_pm, _disposal_date, v_at, nullif(btrim(_account), ''))$b$, 'fd insert');
  DROP FUNCTION public.dispose_fixed_asset(uuid,date,numeric,text);
  EXECUTE d;

  -- money between two branches: our sending account + our receiving account
  d := pg_get_functiondef('public.transfer_treasury_atomic(uuid,uuid,numeric,text,text,numeric,text,text,boolean,date)'::regprocedure);
  d := pg_temp.rep(d, $a$p_date date DEFAULT NULL::date)
 RETURNS uuid$a$, $b$p_date date DEFAULT NULL::date, p_transfer_from_account text DEFAULT NULL::text)
 RETURNS uuid$b$, 'tt header');
  d := pg_temp.rep(d, $a$IF NOT public.vessel_is_known(v_tenant, v_pm) THEN RAISE EXCEPTION 'الوعاء مش موجود أو موقوف من الإعدادات'; END IF;$a$,
    $b$IF NOT public.vessel_is_known(v_tenant, v_pm) THEN RAISE EXCEPTION 'الوعاء مش موجود أو موقوف من الإعدادات'; END IF;
  IF EXISTS (SELECT 1 FROM public.vessel_accounts va WHERE va.tenant_id = v_tenant AND va.payment_method = v_pm AND va.is_active) THEN
    IF NOT EXISTS (SELECT 1 FROM public.vessel_accounts va WHERE va.tenant_id = v_tenant AND va.payment_method = v_pm AND va.is_active
                     AND va.number_key = public.vessel_account_key(p_transfer_from_account)) THEN
      RAISE EXCEPTION 'اختار الحساب اللي هيتحول منه';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.vessel_accounts va WHERE va.tenant_id = v_tenant AND va.payment_method = v_pm AND va.is_active
                     AND va.number_key = public.vessel_account_key(p_transfer_to_account)) THEN
      RAISE EXCEPTION 'اختار الحساب اللي هيتحول عليه في الفرع التاني';
    END IF;
  END IF;$b$, 'tt check');
  d := pg_temp.rep(d, $a$payment_method, fee_amount, reference_number, transfer_to_account, fee_actually_charged, transfer_date, created_at)
  VALUES (p_from_branch, p_to_branch, round(p_amount, 2), p_reason, v_user, v_tenant,
    v_pm, v_fee, p_reference_number, p_transfer_to_account, v_fee_charged, v_day, v_ts)$a$,
    $b$payment_method, fee_amount, reference_number, transfer_to_account, fee_actually_charged, transfer_date, created_at, transfer_from_account)
  VALUES (p_from_branch, p_to_branch, round(p_amount, 2), p_reason, v_user, v_tenant,
    v_pm, v_fee, p_reference_number, p_transfer_to_account, v_fee_charged, v_day, v_ts, nullif(btrim(p_transfer_from_account), ''))$b$, 'tt header row');
  d := pg_temp.rep(d, $a$reference_number, transfer_to_account, reference_id, transaction_date, created_at)
  VALUES (p_from_branch, 'expense', 'transfer', round(p_amount, 2), 'تحويل لفرع: ' || COALESCE(p_reason, ''), v_user, v_tenant,
          v_pm, p_reference_number, p_transfer_to_account, v_transfer_id, v_day, v_ts)$a$,
    $b$reference_number, transfer_to_account, reference_id, transaction_date, created_at, transfer_from_account)
  VALUES (p_from_branch, 'expense', 'transfer', round(p_amount, 2), 'تحويل لفرع: ' || COALESCE(p_reason, ''), v_user, v_tenant,
          v_pm, p_reference_number, p_transfer_to_account, v_transfer_id, v_day, v_ts, nullif(btrim(p_transfer_from_account), ''))$b$, 'tt out row');
  d := pg_temp.rep(d, $a$reference_number, reference_id, transaction_date, created_at)
    VALUES (p_from_branch, 'expense', 'transfer_fee'$a$,
    $b$reference_number, reference_id, transaction_date, created_at, transfer_from_account)
    VALUES (p_from_branch, 'expense', 'transfer_fee'$b$, 'tt fee cols');
  d := pg_temp.rep(d, $a$v_pm, true, p_reference_number, v_transfer_id, v_day, v_ts);$a$,
    $b$v_pm, true, p_reference_number, v_transfer_id, v_day, v_ts, nullif(btrim(p_transfer_from_account), ''));$b$, 'tt fee vals');
  DROP FUNCTION public.transfer_treasury_atomic(uuid,uuid,numeric,text,text,numeric,text,text,boolean,date);
  EXECUTE d;

  -- receiving: the incoming row on our receiving account, a returned part back on the sending account
  d := pg_get_functiondef('public.receive_treasury_transfer(uuid,numeric,text)'::regprocedure);
  d := pg_temp.rep(d, $a$reference_number, reference_id, transaction_date, created_at)
    VALUES (tr.to_branch_id, 'income', 'transfer', round(p_received, 2),$a$,
    $b$reference_number, reference_id, transaction_date, created_at, transfer_to_account)
    VALUES (tr.to_branch_id, 'income', 'transfer', round(p_received, 2),$b$, 'rc in cols');
  d := pg_temp.rep(d, $a$v_pm, tr.reference_number, tr.id, v_day, v_ts)$a$, $b$v_pm, tr.reference_number, tr.id, v_day, v_ts, tr.transfer_to_account)$b$, 'rc in vals');
  d := pg_temp.rep(d, $a$transaction_date, created_at)
    VALUES (tr.from_branch_id, 'income', 'transfer', v_back,$a$,
    $b$transaction_date, created_at, transfer_to_account)
    VALUES (tr.from_branch_id, 'income', 'transfer', v_back,$b$, 'rc back cols');
  d := pg_temp.rep(d, $a$v_user, tr.tenant_id, v_pm, tr.id, v_day, v_ts)$a$, $b$v_user, tr.tenant_id, v_pm, tr.id, v_day, v_ts, tr.transfer_from_account)$b$, 'rc back vals');
  EXECUTE d;
END $m$;

REVOKE ALL ON FUNCTION public.partner_money(uuid,text,numeric,text,numeric,uuid,text,date,text,text),
  public.add_fixed_asset(text,text,uuid,date,numeric,numeric,integer,text,text,text,text),
  public.dispose_fixed_asset(uuid,date,numeric,text,text),
  public.transfer_treasury_atomic(uuid,uuid,numeric,text,text,numeric,text,text,boolean,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_money(uuid,text,numeric,text,numeric,uuid,text,date,text,text),
  public.add_fixed_asset(text,text,uuid,date,numeric,numeric,integer,text,text,text,text),
  public.dispose_fixed_asset(uuid,date,numeric,text,text),
  public.transfer_treasury_atomic(uuid,uuid,numeric,text,text,numeric,text,text,boolean,date,text) TO authenticated;
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN RAISE EXCEPTION '0245: exposed'; END IF;
END $chk$;
